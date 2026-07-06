import {
	App,
	FileSystemAdapter,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	requestUrl,
} from "obsidian";
import { execFile } from "child_process";
import type { ApiProvider, CortexSettings, EnrichResult, NoteIndexEntry, WikiSynthesisResult } from "./src/types";
import { DEFAULT_SETTINGS } from "./src/types";
import { AnthropicProvider } from "./src/anthropic";
import type { HttpPost } from "./src/anthropic";
import { LlmApiError, type LlmProvider } from "./src/llmProvider";
import { OpenAiCompatibleProvider } from "./src/openaiCompatible";
import { GeminiProvider } from "./src/gemini";
import {
	ENRICH_TOOL,
	WIKI_TOOL,
	enrichImageUserMessage,
	enrichSystemPrompt,
	enrichUserMessage,
	wikiSystemPrompt,
	wikiUserMessage,
} from "./src/prompts";
import * as logic from "./src/logic";
import { augmentedPath, buildEnrichArgs, buildWikiArgs, summarizeLogLines } from "./src/cliRunner";
import type { CliExec } from "./src/cliRunner";
import { meetingEnricherSkill, wikiBuilderSkill } from "./src/skillTemplates";
import type { SkillFolders } from "./src/skillTemplates";

const LOG_FOLDER = ".cortex";
const LOG_FILE = `${LOG_FOLDER}/pipeline.log`;

export default class CortexPlugin extends Plugin {
	settings: CortexSettings;
	private inFlight = new Set<string>();
	private cliRunInProgress = false;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CortexSettingTab(this.app, this));

		this.addRibbonIcon("brain-circuit", "Process Cortex inbox", () => {
			void this.processInbox();
		});

		this.addCommand({
			id: "process-inbox",
			name: "Process inbox now",
			callback: () => void this.processInbox(),
		});

		this.addCommand({
			id: "build-wikis",
			name: "Build/update wikis now",
			callback: () => void this.buildWikis(),
		});

		if (this.settings.autoProcessOnCreate) {
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (file instanceof TFile && this.isInInbox(file)) {
						// Dictation/sync tools sometimes create then immediately
						// rewrite a file - give it a moment to settle before reading.
						// CLI mode has no per-file granularity (one claude -p call
						// processes the whole inbox), so it always goes through the
						// same dispatcher as a manual run rather than processFile
						// directly - the API-only method that would otherwise be
						// called here regardless of execution mode.
						window.setTimeout(() => void this.processInbox(), 2000);
					}
				})
			);
		}

		// Catch up on anything that arrived while Obsidian was closed - this is
		// the plugin's substitute for the bash version's daily launchd run,
		// since a plugin only runs while Obsidian is open.
		this.app.workspace.onLayoutReady(() => void this.processInbox());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private httpPost: HttpPost = async (url, headers, body) => {
		const res = await requestUrl({ url, method: "POST", headers, body, throw: false });
		return { status: res.status, text: res.text };
	};

	private getLlmProvider(): LlmProvider {
		const provider: ApiProvider = this.settings.apiProvider;
		const apiKey = this.settings.apiKeys[provider];
		const model = this.settings.models[provider];
		switch (provider) {
			case "openai":
				return new OpenAiCompatibleProvider(this.httpPost, apiKey, model, "https://api.openai.com/v1");
			case "gemini":
				return new GeminiProvider(this.httpPost, apiKey, model);
			case "local":
				return new OpenAiCompatibleProvider(this.httpPost, apiKey, model, this.settings.localBaseUrl);
			case "anthropic":
			default:
				return new AnthropicProvider(this.httpPost, apiKey, model);
		}
	}

	private cliExec: CliExec = (command, args, options) => {
		return new Promise((resolve) => {
			const child = execFile(
				command,
				args,
				{ cwd: options.cwd, env: options.env, maxBuffer: 20 * 1024 * 1024 },
				(error, stdout, stderr) => {
					const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
					resolve({ code, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
				}
			);
			// execFile leaves the child's stdin open by default; claude waits
			// on it (and warns) before proceeding. Close it immediately since
			// we never pipe anything in - same effect as `< /dev/null`.
			child.stdin?.end();
		});
	};

	private getVaultBasePath(): string | null {
		return this.app.vault.adapter instanceof FileSystemAdapter
			? this.app.vault.adapter.getBasePath()
			: null;
	}

	private cliEnv(): Record<string, string> {
		const home = process.env.HOME ?? "";
		return {
			...(process.env as Record<string, string>),
			PATH: augmentedPath(process.env.PATH ?? "", home, null),
		};
	}

	private async ensureFolderExists(dirPath: string) {
		if (!(await this.app.vault.adapter.exists(dirPath))) {
			await this.app.vault.adapter.mkdir(dirPath);
		}
	}

	private async ensureSkillsInstalled() {
		const folders: SkillFolders = {
			inbox: this.settings.inboxFolder,
			meetings: this.settings.meetingsFolder,
			wikis: this.settings.wikisFolder,
			tags: this.settings.tagsFolder,
		};
		await this.writeSkillIfMissing(
			".claude/skills/meeting-enricher/SKILL.md",
			meetingEnricherSkill(folders)
		);
		await this.writeSkillIfMissing(".claude/skills/wiki-builder/SKILL.md", wikiBuilderSkill(folders));
	}

	private async writeSkillIfMissing(path: string, content: string) {
		if (await this.app.vault.adapter.exists(path)) return;
		const dir = path.substring(0, path.lastIndexOf("/"));
		await this.ensureFolderExists(dir);
		await this.app.vault.adapter.write(path, content);
	}

	private async readLogLineCount(): Promise<number> {
		if (!(await this.app.vault.adapter.exists(LOG_FILE))) return 0;
		const content = await this.app.vault.adapter.read(LOG_FILE);
		return content.split("\n").filter((l) => l.length > 0).length;
	}

	private async readLogSince(beforeCount: number): Promise<string> {
		if (!(await this.app.vault.adapter.exists(LOG_FILE))) return "";
		const content = await this.app.vault.adapter.read(LOG_FILE);
		return content
			.split("\n")
			.filter((l) => l.length > 0)
			.slice(beforeCount)
			.join("\n");
	}

	private isInInbox(file: TFile): boolean {
		return (
			file.path.startsWith(this.settings.inboxFolder + "/") &&
			!file.path.includes("/duplicates/") &&
			logic.isCaptureFile(file.extension)
		);
	}

	private async appendLog(message: string) {
		const line = `${new Date().toISOString()} ${message}\n`;
		if (!(await this.app.vault.adapter.exists(LOG_FOLDER))) {
			await this.app.vault.createFolder(LOG_FOLDER);
		}
		if (await this.app.vault.adapter.exists(LOG_FILE)) {
			const existing = await this.app.vault.adapter.read(LOG_FILE);
			await this.app.vault.adapter.write(LOG_FILE, existing + line);
		} else {
			await this.app.vault.adapter.write(LOG_FILE, line);
		}
	}

	private async listTagRegistry(): Promise<string[]> {
		const folder = this.app.vault.getFolderByPath(this.settings.tagsFolder);
		if (!folder) return [];
		return folder.children
			.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
			.map((f) => f.basename);
	}

	private async buildNoteIndex(): Promise<NoteIndexEntry[]> {
		const folder = this.app.vault.getFolderByPath(this.settings.meetingsFolder);
		if (!folder) return [];
		const files = folder.children
			.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, this.settings.dedupLookback);

		const entries: NoteIndexEntry[] = [];
		for (const file of files) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const content = await this.app.vault.read(file);
			entries.push({
				title: (fm?.title as string) ?? file.basename,
				filename: file.basename,
				date: (fm?.date as string) ?? "",
				project: (fm?.project as string) ?? "",
				tags: Array.isArray(fm?.tags) ? (fm.tags as string[]) : [],
				snippet: logic.extractTranscriptSnippet(content),
			});
		}
		return entries;
	}

	private async createTagFileIfMissing(tagName: string) {
		const path = `${this.settings.tagsFolder}/${tagName}.md`;
		if (await this.app.vault.adapter.exists(path)) return;
		const today = new Date().toISOString().slice(0, 10);
		await this.app.vault.create(path, logic.buildTagFileContent(tagName, today));
	}

	private async moveToDuplicates(file: TFile) {
		const dupFolder = `${this.settings.inboxFolder}/duplicates`;
		if (!(await this.app.vault.adapter.exists(dupFolder))) {
			await this.app.vault.createFolder(dupFolder);
		}
		await this.app.fileManager.renameFile(file, `${dupFolder}/${file.name}`);
	}

	private async findExistingWikiLink(tags: string[]): Promise<string | null> {
		const folder = this.app.vault.getFolderByPath(this.settings.wikisFolder);
		if (!folder) return null;
		for (const f of folder.children) {
			if (!(f instanceof TFile) || f.extension !== "md") continue;
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (fm?.topic && tags.includes(fm.topic as string)) return f.basename;
		}
		return null;
	}

	async processInbox() {
		if (this.settings.executionMode === "cli") {
			await this.processInboxViaCli();
		} else {
			await this.processInboxViaApi();
		}
	}

	async processInboxViaApi() {
		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		if (!folder) return;
		const files = folder.children.filter(
			(f): f is TFile => f instanceof TFile && logic.isCaptureFile(f.extension)
		);
		if (files.length === 0) return;

		let enriched = 0;
		for (const file of files) {
			try {
				if (await this.processFile(file)) enriched++;
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				new Notice(`Cortex: failed on "${file.name}" - ${msg}`, 10000);
				await this.appendLog(`ERROR: ${file.name} - ${msg}`);
			}
		}

		if (enriched > 0) {
			new Notice(`Cortex: ${enriched} note${enriched === 1 ? "" : "s"} enriched.`);
			await this.buildWikisViaApi();
		}
	}

	private async processInboxViaCli() {
		if (!Platform.isDesktopApp) {
			new Notice("Cortex: CLI execution mode only works on desktop.", 10000);
			return;
		}
		if (this.cliRunInProgress) return;
		const basePath = this.getVaultBasePath();
		if (!basePath) {
			new Notice("Cortex: could not resolve this vault's filesystem path.", 10000);
			return;
		}

		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		const hasFiles = folder?.children.some(
			(f) => f instanceof TFile && logic.isCaptureFile(f.extension)
		);
		if (!hasFiles) return;

		this.cliRunInProgress = true;
		try {
			await this.runInboxCli(basePath);
		} finally {
			this.cliRunInProgress = false;
		}
	}

	private async runInboxCli(basePath: string) {
		await this.ensureSkillsInstalled();
		const before = await this.readLogLineCount();
		const env = this.cliEnv();

		const enrichResult = await this.cliExec(
			this.settings.claudeCliPath,
			buildEnrichArgs(this.settings.inboxFolder),
			{ cwd: basePath, env }
		);
		if (enrichResult.code !== 0) {
			await this.appendLog(
				`ERROR: meeting-enricher CLI exited ${enrichResult.code} - ${enrichResult.stderr.slice(0, 300)}`
			);
			new Notice(
				`Cortex: enrichment failed (is "${this.settings.claudeCliPath}" the right CLI path?) - see .cortex/pipeline.log`,
				10000
			);
			return;
		}

		const wikiResult = await this.cliExec(
			this.settings.claudeCliPath,
			buildWikiArgs(this.settings.meetingsFolder),
			{ cwd: basePath, env }
		);
		if (wikiResult.code !== 0) {
			await this.appendLog(
				`ERROR: wiki-builder CLI exited ${wikiResult.code} - ${wikiResult.stderr.slice(0, 300)}`
			);
			new Notice("Cortex: wiki step failed - see .cortex/pipeline.log", 10000);
			return;
		}

		const summary = summarizeLogLines(await this.readLogSince(before));
		if (summary.enriched > 0) {
			const parts = [`${summary.enriched} note${summary.enriched === 1 ? "" : "s"} enriched`];
			if (summary.newWikis > 0) parts.push(`${summary.newWikis} new wiki${summary.newWikis === 1 ? "" : "s"}`);
			if (summary.updatedWikis > 0)
				parts.push(`${summary.updatedWikis} wiki${summary.updatedWikis === 1 ? "" : "s"} updated`);
			new Notice(`Cortex: ${parts.join(", ")}.`);
		}
		if (summary.problems > 0) {
			new Notice(`Cortex: ${summary.problems} item(s) skipped or errored - see .cortex/pipeline.log`, 8000);
		}
	}

	private async runWikiBuilderCli() {
		if (!Platform.isDesktopApp) {
			new Notice("Cortex: CLI execution mode only works on desktop.", 10000);
			return;
		}
		const basePath = this.getVaultBasePath();
		if (!basePath) {
			new Notice("Cortex: could not resolve this vault's filesystem path.", 10000);
			return;
		}
		await this.ensureSkillsInstalled();
		const before = await this.readLogLineCount();
		const result = await this.cliExec(
			this.settings.claudeCliPath,
			buildWikiArgs(this.settings.meetingsFolder),
			{ cwd: basePath, env: this.cliEnv() }
		);
		if (result.code !== 0) {
			await this.appendLog(`ERROR: wiki-builder CLI exited ${result.code} - ${result.stderr.slice(0, 300)}`);
			new Notice("Cortex: wiki step failed - see .cortex/pipeline.log", 10000);
			return;
		}
		const summary = summarizeLogLines(await this.readLogSince(before));
		const parts: string[] = [];
		if (summary.newWikis > 0) parts.push(`${summary.newWikis} new wiki${summary.newWikis === 1 ? "" : "s"}`);
		if (summary.updatedWikis > 0)
			parts.push(`${summary.updatedWikis} wiki${summary.updatedWikis === 1 ? "" : "s"} updated`);
		new Notice(parts.length > 0 ? `Cortex: ${parts.join(", ")}.` : "Cortex: no wikis to build or update.");
	}

	private mimeTypeForExtension(extension: string): string {
		const ext = extension.toLowerCase();
		if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
		return `image/${ext}`;
	}

	async processFile(file: TFile): Promise<boolean> {
		if (this.inFlight.has(file.path)) return false;
		if (this.settings.apiProvider !== "local" && !this.settings.apiKeys[this.settings.apiProvider]) {
			new Notice(`Cortex: no ${this.settings.apiProvider} API key set in plugin settings.`, 10000);
			return false;
		}
		this.inFlight.add(file.path);
		try {
			const isImage = logic.IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
			let raw = "";
			let image: { mediaType: string; base64Data: string } | undefined;
			if (isImage) {
				const binary = await this.app.vault.readBinary(file);
				if (binary.byteLength === 0) return false;
				image = {
					mediaType: this.mimeTypeForExtension(file.extension),
					base64Data: logic.arrayBufferToBase64(binary),
				};
			} else {
				raw = await this.app.vault.read(file);
				if (raw.trim().length === 0) return false;
			}

			const tagRegistry = await this.listTagRegistry();
			const existingIndex = await this.buildNoteIndex();
			const dateHint = logic.extractFilenameDateHint(file.name);
			const ctime = new Date(file.stat.ctime).toISOString().slice(0, 10);

			const message = image
				? { text: enrichImageUserMessage(dateHint, ctime, existingIndex), image }
				: { text: enrichUserMessage(raw, dateHint, ctime, existingIndex) };

			const result = await this.getLlmProvider().callTool<EnrichResult>(
				enrichSystemPrompt(tagRegistry),
				message,
				ENRICH_TOOL
			);

			if (result.is_duplicate) {
				await this.moveToDuplicates(file);
				await this.appendLog(
					`DUPLICATE: ${file.name} matches ${result.duplicate_of ?? "an existing note"} - moved to duplicates/`
				);
				return false;
			}

			if (result.new_tag) {
				await this.createTagFileIfMissing(result.new_tag.name);
				await this.appendLog(
					`NEW TAG: ${result.new_tag.name} - ${result.new_tag.justification}`
				);
			}

			const existingWikiLink = await this.findExistingWikiLink(result.tags);
			const enrichedAt = new Date().toISOString();
			const finalFilename = logic.meetingFilename(result.date, result.title);
			const destPath = `${this.settings.meetingsFolder}/${finalFilename}`;

			if (isImage) {
				const imageFilename = logic.meetingImageFilename(result.date, result.title, file.extension);
				const markdown = logic.buildMeetingMarkdown(result, "", enrichedAt, existingWikiLink, imageFilename);
				await this.app.vault.create(destPath, markdown);
				await this.app.fileManager.renameFile(file, `${this.settings.meetingsFolder}/${imageFilename}`);
			} else {
				const markdown = logic.buildMeetingMarkdown(result, raw, enrichedAt, existingWikiLink);
				await this.app.vault.create(destPath, markdown);
				await this.app.vault.delete(file);
			}
			await this.appendLog(
				`ENRICHED: ${finalFilename} - tags: [${result.tags.join(", ")}] - project: ${result.project}`
			);
			return true;
		} catch (e) {
			if (e instanceof LlmApiError) {
				new Notice(`Cortex API error (${e.status}) on "${file.name}" - see .cortex/pipeline.log`, 10000);
				await this.appendLog(`ERROR: ${file.name} - ${this.settings.apiProvider} API ${e.status}: ${e.body.slice(0, 300)}`);
				return false;
			}
			throw e;
		} finally {
			this.inFlight.delete(file.path);
		}
	}

	async buildWikis() {
		if (this.settings.executionMode === "cli") {
			await this.runWikiBuilderCli();
		} else {
			await this.buildWikisViaApi();
		}
	}

	async buildWikisViaApi() {
		const meetingsFolder = this.app.vault.getFolderByPath(this.settings.meetingsFolder);
		if (!meetingsFolder) return;
		const noteFiles = meetingsFolder.children.filter(
			(f): f is TFile => f instanceof TFile && f.extension === "md"
		);
		const notesMeta: logic.NoteMeta[] = noteFiles.map((f) => {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			return {
				filename: f.basename,
				title: (fm?.title as string) ?? f.basename,
				date: (fm?.date as string) ?? "",
				tags: Array.isArray(fm?.tags) ? (fm.tags as string[]) : [],
			};
		});

		const clusters = logic.clusterByTag(notesMeta);

		const wikiFolderPath = this.settings.wikisFolder;
		if (!(await this.app.vault.adapter.exists(wikiFolderPath))) {
			await this.app.vault.createFolder(wikiFolderPath);
		}
		const wikiFolder = this.app.vault.getFolderByPath(wikiFolderPath);
		const existingWikiFiles = wikiFolder
			? wikiFolder.children.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
			: [];
		const wikiByTopic = new Map<string, TFile>();
		for (const wf of existingWikiFiles) {
			const fm = this.app.metadataCache.getFileCache(wf)?.frontmatter;
			if (fm?.topic) wikiByTopic.set(fm.topic as string, wf);
		}

		for (const cluster of clusters) {
			const existingWiki = wikiByTopic.get(cluster.tag);
			try {
				if (!existingWiki) {
					if (cluster.notes.length >= this.settings.wikiThreshold) {
						await this.createWiki(cluster.tag, cluster.notes, noteFiles);
					}
					continue;
				}
				const wikiFm = this.app.metadataCache.getFileCache(existingWiki)?.frontmatter;
				const updatedDate = (wikiFm?.updated as string) ?? "1970-01-01";
				const newNotes = cluster.notes.filter((n) => n.date > updatedDate);
				if (newNotes.length > 0) {
					await this.updateWiki(cluster.tag, existingWiki, cluster.notes, noteFiles);
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				new Notice(`Cortex: wiki build failed for "${cluster.tag}" - ${msg}`, 10000);
				await this.appendLog(`ERROR: wiki ${cluster.tag} - ${msg}`);
			}
		}
	}

	private async readSourcesForWiki(
		notes: logic.NoteMeta[],
		noteFiles: TFile[]
	): Promise<{ sources: { title: string; date: string; body: string }[]; timeline: logic.TimelineEntry[] }> {
		const sources: { title: string; date: string; body: string }[] = [];
		const timeline: logic.TimelineEntry[] = [];
		for (const note of notes) {
			const file = noteFiles.find((f) => f.basename === note.filename);
			if (!file) continue;
			const content = await this.app.vault.read(file);
			sources.push({
				title: note.title,
				date: note.date,
				body: logic.extractEnrichedSections(content),
			});
			timeline.push({
				date: note.date,
				title: note.title,
				oneLine: logic.firstSentence(logic.extractSummaryText(content)),
			});
		}
		return { sources, timeline };
	}

	private async createWiki(topic: string, notes: logic.NoteMeta[], noteFiles: TFile[]) {
		const { sources, timeline } = await this.readSourcesForWiki(notes, noteFiles);
		const result = await this.getLlmProvider().callTool<WikiSynthesisResult>(
			wikiSystemPrompt(topic, false),
			{ text: wikiUserMessage(sources, null) },
			WIKI_TOOL
		);
		const today = new Date().toISOString().slice(0, 10);
		const markdown = logic.buildWikiMarkdown(
			topic,
			result,
			timeline,
			notes.map((n) => n.title),
			today,
			today
		);
		const path = `${this.settings.wikisFolder}/${logic.wikiFilename(topic)}`;
		await this.app.vault.create(path, markdown);
		await this.linkWikiIntoSources(topic, notes, noteFiles);
		await this.appendLog(`NEW WIKI: ${topic} - sources: ${notes.length}`);
	}

	private async updateWiki(
		topic: string,
		existingWiki: TFile,
		allNotes: logic.NoteMeta[],
		noteFiles: TFile[]
	) {
		const existingContent = await this.app.vault.read(existingWiki);
		const existingFm = this.app.metadataCache.getFileCache(existingWiki)?.frontmatter;
		const updatedDate = (existingFm?.updated as string) ?? "1970-01-01";
		const newNotes = allNotes.filter((n) => n.date > updatedDate);

		const { sources: newSources } = await this.readSourcesForWiki(newNotes, noteFiles);
		const { timeline: allTimeline } = await this.readSourcesForWiki(allNotes, noteFiles);
		const existingCurrentState = this.extractCurrentState(existingContent);

		const result = await this.getLlmProvider().callTool<WikiSynthesisResult>(
			wikiSystemPrompt(topic, true),
			{ text: wikiUserMessage(newSources, existingCurrentState) },
			WIKI_TOOL
		);

		const created = (existingFm?.created as string) ?? new Date().toISOString().slice(0, 10);
		const today = new Date().toISOString().slice(0, 10);
		const markdown = logic.buildWikiMarkdown(
			topic,
			result,
			allTimeline,
			allNotes.map((n) => n.title),
			created,
			today
		);
		await this.app.vault.modify(existingWiki, markdown);
		// Pass every source, not just the new ones: linkWikiIntoSources is
		// idempotent (skips notes that already have the link), and this way an
		// older note that somehow missed the backlink gets fixed too instead of
		// only being checked once, on the run that first added it as a source.
		await this.linkWikiIntoSources(topic, allNotes, noteFiles);
		await this.appendLog(`UPDATED WIKI: ${topic} - sources: ${allNotes.length}`);
	}

	private extractCurrentState(wikiContent: string): string {
		const idx = wikiContent.indexOf("## Current state");
		if (idx === -1) return "";
		const after = wikiContent.slice(idx + "## Current state".length);
		const nextIdx = after.indexOf("\n## ");
		return (nextIdx === -1 ? after : after.slice(0, nextIdx)).trim();
	}

	private async linkWikiIntoSources(topic: string, notes: logic.NoteMeta[], noteFiles: TFile[]) {
		const wikiLink = `[[${logic.wikiFilename(topic).replace(/\.md$/, "")}]]`;
		for (const note of notes) {
			const file = noteFiles.find((f) => f.basename === note.filename);
			if (!file) continue;
			await this.app.vault.process(file, (data) => {
				if (data.includes(wikiLink)) return data;
				const relatedIdx = data.indexOf("## Related");
				if (relatedIdx === -1) return data + `\n\n## Related\n\n${wikiLink}\n`;
				return data.slice(0, relatedIdx + "## Related".length) +
					`\n\n${wikiLink}` +
					data.slice(relatedIdx + "## Related".length);
			});
		}
	}
}

class CortexSettingTab extends PluginSettingTab {
	plugin: CortexPlugin;

	constructor(app: App, plugin: CortexPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Execution mode")
			.setDesc(
				this.plugin.settings.executionMode === "cli"
					? "Shells out to the Claude Code CLI, using whatever auth it already has (subscription or API key) - no separate billing, but desktop only and requires Claude Code installed."
					: "Calls a model API directly (Anthropic, OpenAI, Gemini, or a local model) - works on mobile too (except Local, which needs a reachable server), but is billed separately from a Claude subscription/Claude Code login."
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("cli", "Claude Code CLI (uses your subscription)")
					.addOption("api", "Direct API key")
					.setValue(this.plugin.settings.executionMode)
					.onChange(async (value) => {
						this.plugin.settings.executionMode = value === "api" ? "api" : "cli";
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (!Platform.isDesktopApp && this.plugin.settings.executionMode === "cli") {
			containerEl.createEl("p", {
				text: "CLI mode doesn't work on mobile - switch to Direct API key here, or use this device only to browse the vault.",
				cls: "mod-warning",
			});
		}

		if (this.plugin.settings.executionMode === "cli") {
			new Setting(containerEl)
				.setName("Claude CLI path")
				.setDesc(
					'Command or full path to the Claude Code CLI. Obsidian (an Electron app) often starts with a slimmer PATH than your terminal, so if "claude" isn\'t found, try the full path (e.g. from running `which claude` in your terminal).'
				)
				.addText((text) =>
					text
						.setPlaceholder("claude")
						.setValue(this.plugin.settings.claudeCliPath)
						.onChange(async (value) => {
							this.plugin.settings.claudeCliPath = value.trim() || "claude";
							await this.plugin.saveSettings();
						})
				);
		} else {
			const provider = this.plugin.settings.apiProvider;
			const providerLabel = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini", local: "Local" }[
				provider
			];

			new Setting(containerEl)
				.setName("Provider")
				.setDesc(
					'Which model API to call directly. "Local" needs no API key and sends nothing off this machine (e.g. Ollama).'
				)
				.addDropdown((dropdown) => {
					dropdown
						.addOption("anthropic", "Anthropic")
						.addOption("openai", "OpenAI")
						.addOption("gemini", "Gemini")
						.addOption("local", "Local (OpenAI-compatible, e.g. Ollama)")
						.setValue(provider)
						.onChange(async (value) => {
							this.plugin.settings.apiProvider = value as ApiProvider;
							await this.plugin.saveSettings();
							this.display();
						});
				});

			if (provider !== "local") {
				new Setting(containerEl)
					.setName(`${providerLabel} API key`)
					.setDesc(
						"Stored locally in this vault's .obsidian/plugins/cortex/data.json - keep this vault out of any repo or sync you don't fully control."
					)
					.addText((text) =>
						text
							.setValue(this.plugin.settings.apiKeys[provider])
							.onChange(async (value) => {
								this.plugin.settings.apiKeys[provider] = value.trim();
								await this.plugin.saveSettings();
							})
					);
			} else {
				new Setting(containerEl)
					.setName("Base URL")
					.setDesc('OpenAI-compatible endpoint, e.g. Ollama\'s default "http://localhost:11434/v1".')
					.addText((text) =>
						text
							.setValue(this.plugin.settings.localBaseUrl)
							.onChange(async (value) => {
								this.plugin.settings.localBaseUrl = value.trim() || DEFAULT_SETTINGS.localBaseUrl;
								await this.plugin.saveSettings();
							})
					);
			}

			new Setting(containerEl)
				.setName("Model")
				.setDesc(`${providerLabel} model id used for both enrichment and wiki synthesis.`)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.models[provider])
						.onChange(async (value) => {
							this.plugin.settings.models[provider] = value.trim();
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Auto-process on capture")
			.setDesc("Enrich a new inbox note within a couple seconds of it being created, instead of only on manual runs.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoProcessOnCreate).onChange(async (value) => {
					this.plugin.settings.autoProcessOnCreate = value;
					await this.plugin.saveSettings();
					new Notice("Reload the plugin (or restart Obsidian) for this change to take effect.");
				})
			);

		new Setting(containerEl)
			.setName("Wiki threshold")
			.setDesc("Number of non-fragment meeting notes a tag needs before a wiki hub page is created for it.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.wikiThreshold)).onChange(async (value) => {
					const n = parseInt(value, 10);
					if (!Number.isNaN(n) && n > 0) {
						this.plugin.settings.wikiThreshold = n;
						await this.plugin.saveSettings();
					}
				})
			);

		if (this.plugin.settings.executionMode === "api") {
			// CLI mode's duplicate check is handled by the skill itself, reading
			// the meetings folder directly via its own Bash/Glob tool access, so
			// there's no lookback count to configure on the plugin side.
			new Setting(containerEl)
				.setName("Duplicate-check lookback")
				.setDesc("How many of the most recent meeting notes to compare new captures against for duplicates and related-note linking.")
				.addText((text) =>
					text.setValue(String(this.plugin.settings.dedupLookback)).onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!Number.isNaN(n) && n > 0) {
							this.plugin.settings.dedupLookback = n;
							await this.plugin.saveSettings();
						}
					})
				);
		}

		containerEl.createEl("h3", { text: "Folders" });

		const folderSetting = (key: keyof CortexSettings, name: string) => {
			new Setting(containerEl).setName(name).addText((text) =>
				text.setValue(this.plugin.settings[key] as string).onChange(async (value) => {
					(this.plugin.settings[key] as string) = value.trim();
					await this.plugin.saveSettings();
				})
			);
		};
		folderSetting("inboxFolder", "Inbox folder");
		folderSetting("meetingsFolder", "Meetings folder");
		folderSetting("wikisFolder", "Wikis folder");
		folderSetting("tagsFolder", "Tags folder");
	}
}
