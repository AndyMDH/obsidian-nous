import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	requestUrl,
} from "obsidian";
import type { CortexSettings, EnrichResult, NoteIndexEntry, WikiSynthesisResult } from "./src/types";
import { DEFAULT_SETTINGS } from "./src/types";
import { AnthropicApiError, callClaudeTool } from "./src/anthropic";
import type { HttpPost } from "./src/anthropic";
import {
	ENRICH_TOOL,
	WIKI_TOOL,
	enrichSystemPrompt,
	enrichUserMessage,
	wikiSystemPrompt,
	wikiUserMessage,
} from "./src/prompts";
import * as logic from "./src/logic";

const LOG_FOLDER = ".cortex";
const LOG_FILE = `${LOG_FOLDER}/pipeline.log`;

export default class CortexPlugin extends Plugin {
	settings: CortexSettings;
	private inFlight = new Set<string>();

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
						window.setTimeout(() => void this.processFile(file), 2000);
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

	private isInInbox(file: TFile): boolean {
		return (
			file.path.startsWith(this.settings.inboxFolder + "/") &&
			!file.path.includes("/duplicates/") &&
			(file.extension === "md" || file.extension === "txt")
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
		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		if (!folder) return;
		const files = folder.children.filter(
			(f): f is TFile =>
				f instanceof TFile && (f.extension === "md" || f.extension === "txt")
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
			await this.buildWikis();
		}
	}

	async processFile(file: TFile): Promise<boolean> {
		if (this.inFlight.has(file.path)) return false;
		if (!this.settings.apiKey) {
			new Notice("Cortex: no Anthropic API key set in plugin settings.", 10000);
			return false;
		}
		this.inFlight.add(file.path);
		try {
			const raw = await this.app.vault.read(file);
			if (raw.trim().length === 0) return false;

			const tagRegistry = await this.listTagRegistry();
			const existingIndex = await this.buildNoteIndex();
			const dateHint = logic.extractFilenameDateHint(file.name);
			const ctime = new Date(file.stat.ctime).toISOString().slice(0, 10);

			const result = await callClaudeTool<EnrichResult>(
				this.httpPost,
				this.settings.apiKey,
				this.settings.model,
				enrichSystemPrompt(tagRegistry),
				enrichUserMessage(raw, dateHint, ctime, existingIndex),
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
			const markdown = logic.buildMeetingMarkdown(result, raw, enrichedAt, existingWikiLink);
			const finalFilename = logic.meetingFilename(result.date, result.title);
			const destPath = `${this.settings.meetingsFolder}/${finalFilename}`;

			await this.app.vault.create(destPath, markdown);
			await this.app.vault.delete(file);
			await this.appendLog(
				`ENRICHED: ${finalFilename} - tags: [${result.tags.join(", ")}] - project: ${result.project}`
			);
			return true;
		} catch (e) {
			if (e instanceof AnthropicApiError) {
				new Notice(`Cortex API error (${e.status}) on "${file.name}" - see .cortex/pipeline.log`, 10000);
				await this.appendLog(`ERROR: ${file.name} - Anthropic API ${e.status}: ${e.body.slice(0, 300)}`);
				return false;
			}
			throw e;
		} finally {
			this.inFlight.delete(file.path);
		}
	}

	async buildWikis() {
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
		const result = await callClaudeTool<WikiSynthesisResult>(
			this.httpPost,
			this.settings.apiKey,
			this.settings.model,
			wikiSystemPrompt(topic, false),
			wikiUserMessage(sources, null),
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

		const result = await callClaudeTool<WikiSynthesisResult>(
			this.httpPost,
			this.settings.apiKey,
			this.settings.model,
			wikiSystemPrompt(topic, true),
			wikiUserMessage(newSources, existingCurrentState),
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
			.setName("Anthropic API key")
			.setDesc(
				"Stored locally in this vault's .obsidian/plugins/cortex/data.json - keep this vault out of any repo or sync you don't fully control."
			)
			.addText((text) =>
				text
					.setPlaceholder("sk-ant-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Anthropic model id used for both enrichment and wiki synthesis.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					})
			);

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
