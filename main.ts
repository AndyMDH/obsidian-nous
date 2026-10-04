import {
	FileSystemAdapter,
	MarkdownView,
	Notice,
	Platform,
	Plugin,
	TFile,
	TFolder,
	requestUrl,
	requireApiVersion,
	setIcon,
} from "obsidian";
import type {
	ApiProvider,
	NousSettings,
	EnrichResult,
	NoteIndexEntry,
	WikiSynthesisResult,
} from "./src/types";
import { DEFAULT_SETTINGS } from "./src/types";
import { AnthropicProvider } from "./src/anthropic";
import type { HttpPost } from "./src/anthropic";
import { LlmApiError, type LlmProvider } from "./src/llmProvider";
import { OpenAiCompatibleProvider } from "./src/openaiCompatible";
import { GeminiProvider } from "./src/gemini";
import {
	ENRICH_TOOL,
	WIKI_TOOL,
	enrichDocumentUserMessage,
	enrichImageUserMessage,
	enrichSystemPrompt,
	enrichUserMessage,
	wikiSystemPrompt,
	wikiUserMessage,
} from "./src/prompts";
import * as logic from "./src/logic";
import {
	audioMimeType,
	transcribeWithGemini,
	transcribeWithOpenAi,
	type HttpPostBinary,
} from "./src/transcribe";
import {
	WHISPER_MODELS_DIR_SEGMENTS,
	WHISPER_MODEL_SOURCES,
	WHISPER_FAST_MODEL_SOURCE,
	DEFAULT_WHISPER_CLI_BIN,
	downloadProgressText,
	parseLfsPointer,
	type LfsPointer,
	type WhisperModelSource,
} from "./src/whisperModel";
import {
	DEFAULT_NATIVE_RECORDER_BIN,
	buildCompletedNativeRecordingNote,
	buildLiveNativeRecordingNote,
	buildNativeRecordingProblemNote,
	buildPendingNativeRecordingNote,
	LIVE_NOTE_NOTES_HEADING,
	LIVE_NOTE_TYPING_HINT,
	extractNativeRecordingManualNotes,
	hasMeaningfulNativeRecordingManualNotes,
	interleaveMeetingTracks,
	nativeRecorderArgs,
	shiftTrackSegments,
	trackStartDeltasMs,
	nativeRecorderLatestAssetUrl,
	nativeRecorderReleaseAssetUrl,
	isLiveNativeRecordingNote,
	parseLiveNativeRecordingNote,
	parsePendingNativeRecordingNote,
	parseNativeRecorderChecksum,
	parseNativeRecorderStatus,
	type NativeRecorderStatus,
	type TrackTranscript,
	type TranscriptSegment,
} from "./src/nativeRecorder";
import {
	type CapturePrerequisiteStatus,
	type NativeRecorderReadiness,
	MEETING_RECORDER_MISSING_NOTICE,
	hasGeminiOrOpenAiTranscriptionKey,
} from "./src/onboarding";
import { augmentedPath, buildEnrichArgs, buildQueryArgs, buildWikiArgs, cliErrorDetail, summarizeLogLines } from "./src/cliRunner";
import type { CliExec } from "./src/cliRunner";
import { meetingEnricherSkill, vaultQuerySkill, wikiBuilderSkill } from "./src/skillTemplates";
import type { SkillFolders } from "./src/skillTemplates";
import { appendNousNoticeIcon, nousNotice, nousNoticeFragment } from "./src/ui/notice";
import { pickVoiceMimeType } from "./src/voiceMime";
import { registerNousIcons } from "./src/ui/icons";
import { nousTranscriptDimmer } from "./src/ui/transcriptDimmer";
import { ConfirmTranscriptMigrationModal } from "./src/ui/confirmTranscriptMigrationModal";
import { NousSettingTab } from "./src/ui/settingTab";
import { VoiceCaptureSetupModal } from "./src/ui/voiceCaptureSetupModal";
import { OnboardingModal } from "./src/ui/onboardingModal";
import { LiveVoiceCaptureModal } from "./src/ui/liveVoiceCaptureModal";
import { QueryModal } from "./src/ui/queryModal";

const LOG_FOLDER = ".nous";
const LOG_FILE = `${LOG_FOLDER}/pipeline.log`;
// appendLog() had no cap at all - a full read-modify-write of the whole
// file, every single line, forever, with the file only ever growing. Kept
// generous (a few thousand lines is still a small text file) since this log
// is the one real debugging tool for CLI mode, where the plugin can't see
// what the `claude` agent itself did.
const LOG_MAX_LINES = 5000;

// "local" never has a key (it's a reachable-server URL, not a credential) -
// excluded from secretStorage handling in loadSettings()/saveSettings().
const API_KEY_PROVIDERS: Exclude<ApiProvider, "local">[] = ["anthropic", "openai", "gemini", "glm"];
// Agent runs (enrich/wiki-build/query) are real Claude Code invocations, not
// instant - can legitimately take minutes on a full inbox. This cap only
// exists so a hung one (dropped connection, stuck auth prompt) can't jam
// cliRunInProgress forever; it should never fire in normal operation.
const AGENT_CLI_TIMEOUT_MS = 15 * 60 * 1000;
// Version/capability probes (claude --version, whisper-cli --help, recorder
// version) should return in under a second - if the binary hangs instead
// (stuck auth prompt, a first-run update check, a broken install), this cap
// keeps the screen that's waiting on it (most often onboarding's "Checking
// the connection...") from spinning forever with no error and no way for
// the user to tell what went wrong.
const QUICK_CLI_TIMEOUT_MS = 15 * 1000;
// `brew install whisper-cpp` is usually well under a minute (a small,
// bottled formula) but can run longer compiling from source or on a slow
// connection - generous, but still bounded, so a genuinely stuck install
// doesn't wait forever with no way out beyond quitting Obsidian.
const WHISPER_CLI_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

// A folder dropped straight into the inbox (e.g. an entire GitHub repo
// dragged in) nests its files a level or more deep - the inbox scan has to
// walk subfolders too, or those files sit there forever with no error, since
// nothing is technically wrong with them. Only the inbox's OWN "duplicates"
// subfolder is skipped (isRoot guards that) - a dropped folder that happens
// to contain its own subfolder named "duplicates" (a photo-dedup export,
// say) must still be walked, or its files are silently, permanently skipped
// with no log line to explain why.
function collectFilesRecursive(
	folder: TFolder,
	matches: (file: TFile) => boolean,
	isRoot = true
): TFile[] {
	const found: TFile[] = [];
	for (const child of folder.children) {
		if (child instanceof TFile) {
			if (matches(child)) found.push(child);
		} else if (child instanceof TFolder && !(isRoot && child.name === "duplicates")) {
			found.push(...collectFilesRecursive(child, matches, false));
		}
	}
	return found;
}

// Electron's renderer exposes a real `require` global (Obsidian runs with
// nodeIntegration on desktop) - not part of DOM's Window type, so declare it.
declare global {
	interface Window {
		require: (id: string) => unknown;
	}
}

// Loaded on demand rather than as static imports, kept lazy from before this
// plugin went desktop-only (isDesktopOnly: true) - only the macOS-gated code
// paths that actually need them ever call this.
type NodeModules = {
	crypto: typeof import("crypto");
	execFile: typeof import("child_process").execFile;
	fs: typeof import("fs").promises;
	fsConstants: typeof import("fs").constants;
	fsCreateWriteStream: typeof import("fs").createWriteStream;
	https: typeof import("https");
	os: typeof import("os");
	path: typeof import("path");
};
let nodeModulesPromise: Promise<NodeModules> | null = null;
function loadNodeModules(): Promise<NodeModules> {
	if (!nodeModulesPromise) {
		//
		// This must be window.require, not a dynamic import("child_process")
		// - Electron's renderer has no native module loader that resolves
		// bare Node specifiers, so a real import() throws "Failed to resolve
		// module specifier" at runtime (esbuild leaves external dynamic
		// imports untouched regardless of format/platform). require() is a
		// real Electron-provided global, and wrapping it in a resolved
		// Promise keeps this exactly as lazy as the import() it replaces.
		nodeModulesPromise = Promise.resolve().then(() => {
			const req = window.require;
			const cp = req("child_process") as typeof import("child_process");
			const crypto = req("crypto") as typeof import("crypto");
			const fs = req("fs") as typeof import("fs");
			const os = req("os") as typeof import("os");
			const path = req("path") as typeof import("path");
			const https = req("https") as typeof import("https");
			return {
				crypto,
				execFile: cp.execFile,
				fs: fs.promises,
				fsConstants: fs.constants,
				fsCreateWriteStream: fs.createWriteStream,
				https,
				os,
				path,
			};
		});
	}
	return nodeModulesPromise;
}

// The native folder-picker dialog Notion import uses (main.ts's
// importFromNotion) is Electron-provided, not a Node builtin, so it doesn't
// belong in NodeModules above - loaded the same lazy window.require() way
// for the same reason (Electron's renderer can't resolve a bare specifier
// via a real import()). "@electron/remote" is what current Electron calls
// this since core Electron dropped the old `electron.remote` shortcut;
// Obsidian's main process enables it for plugin windows.
type ElectronRemoteDialog = {
	showOpenDialog: (options: { properties: string[] }) => Promise<{ canceled: boolean; filePaths: string[] }>;
};
let electronRemoteDialogPromise: Promise<ElectronRemoteDialog> | null = null;
function loadElectronRemoteDialog(): Promise<ElectronRemoteDialog> {
	if (!electronRemoteDialogPromise) {
		electronRemoteDialogPromise = Promise.resolve().then(() => {
			const remote = window.require("@electron/remote") as { dialog: ElectronRemoteDialog };
			return remote.dialog;
		});
	}
	return electronRemoteDialogPromise;
}


export default class NousPlugin extends Plugin {
	settings: NousSettings;
	private inFlight = new Set<string>();
	private cliRunInProgress = false;
	// A trigger that arrives while a run is already in progress used to just
	// no-op (main.ts's `if (this.cliRunInProgress) return;`) with nothing to
	// pick the file back up except some later, unrelated trigger - if the
	// dropped file was the last activity before Obsidian closed, it could
	// sit unprocessed indefinitely with no notice explaining why. This flags
	// that a rerun is owed, so the run that's already in flight schedules
	// exactly one more pass right after it finishes.
	private cliRerunQueued = false;
	// API mode's counterpart to cliRunInProgress/cliRerunQueued above - without
	// it, dragging several files in at once fires overlapping
	// processInboxViaApi() runs that each snapshot the tag registry/note index
	// independently, so duplicate detection and wiki updates can race on the
	// same file/wiki page (lost update).
	private apiRunInProgress = false;
	private apiRerunQueued = false;
	// Suppresses the auto-process-on-create listener while importFromNotion()
	// is bulk-writing files, so a large import doesn't fire one enrichment
	// run per file. processInbox() runs once, after the whole batch lands.
	private notionImportInProgress = false;
	private voiceRecorder: MediaRecorder | null = null;
	private voiceStream: MediaStream | null = null;
	// toggleVoiceCapture()'s only "already recording" guard is
	// this.voiceRecorder?.state === "recording" - but voiceRecorder isn't
	// assigned until after two awaited calls (the backend check, then
	// getUserMedia()). Two rapid toggles (a double-click, a hotkey fired
	// twice) both pass that guard before either await resolves, both
	// acquire a mic stream, and the second silently overwrites the first's
	// - leaking its track and orphaning its onstop handler. This flag
	// closes that window.
	private voiceCaptureStarting = false;
	private voiceRibbonEl: HTMLElement | null = null;
	private voiceStatusBarEl: HTMLElement | null = null;
	private meetingRibbonEl: HTMLElement | null = null;
	private meetingStatusBarEl: HTMLElement | null = null;
	private meetingPollInterval: number | null = null;
	private nativeRecorderLastProblem: string | null = null;
	// toggleMeetingCapture() decides start-vs-stop from an awaited status
	// check (nativeRecorderStatus()) - two rapid clicks (a double-click on
	// the meeting ribbon) can both see "not recording" before either one's
	// "start" has actually landed, both call createLiveNativeMeetingNote(),
	// and the second overwrites activeNativeMeetingNotePath, orphaning the
	// first live note (it never receives a transcript when the one real
	// recording eventually stops). This flag rejects the second click
	// outright instead.
	private meetingToggleInProgress = false;
	private meetingTranscribing = false;
	// Live "REC 00:42" timers - warm-paper spec §3's status-bar states.
	private voiceRecordingTimer: number | null = null;
	private meetingRecordingTimer: number | null = null;
	private activeNativeMeetingNotePath: string | null = null;
	// Live transcripts already known by the time a voice recording is saved
	// (see saveVoiceRecording()) - checked by processFile()/
	// transcribeInboxAudioForCli() so a known transcript skips the batch
	// transcribeAudio() call entirely. Keyed by vault path, one-shot: read
	// and deleted by whichever pipeline branch consumes it.
	private liveTranscripts = new Map<string, string>();
	// A pending-transcription note gets rescanned on every processInbox()
	// run - which fires very often (every new capture, every app open) - so
	// without this, "waiting on speech-to-text" repeated as a fresh notice
	// bubble every single time, for as long as the note stayed pending. One
	// notice per file per Obsidian session is enough; the note's own body
	// already explains what to do permanently, so nothing is lost by not
	// repeating the toast.
	private notifiedPendingTranscription = new Set<string>();
	// A finished recording folder normally leaves the watch dir the moment
	// toggleNativeMeetingCapture() ingests it. If Obsidian quits mid-call (or
	// crashes) before that stop-and-ingest ever runs, the folder is left
	// behind with nothing to pick it up - checkOrphanedNativeRecordings()
	// below is the watchdog for that. One notice per folder per session, same
	// dedupe pattern as notifiedPendingTranscription above.
	private notifiedOrphanedRecordings = new Set<string>();
	private orphanCheckInterval: number | null = null;
	// Not private: LiveVoiceCaptureModal clears this on its own onClose (all
	// close paths - Stop, Cancel, Esc/click-outside - route through there).
	liveCaptureModal: LiveVoiceCaptureModal | null = null;

	async onload() {
		registerNousIcons();
		await this.loadSettings();
		document.body.addClass("nous-styled-notes");
		this.register(() => document.body.removeClass("nous-styled-notes"));

		// Reading view: tag every block at or below the "## Transcript"
		// heading. Per-block classes survive Obsidian's virtualized preview,
		// where a sibling-selector anchor scrolls out of the DOM.
		this.registerMarkdownPostProcessor((el, ctx) => {
			const info = ctx.getSectionInfo(el);
			if (!info) return;
			const lines = info.text.split("\n");
			const headingLine = lines.findIndex((line) => line.trim() === "## Transcript");
			if (headingLine === -1 || info.lineStart < headingLine) return;
			el.addClass("nous-transcript-block");
		});

		// Reading view: mark the note's own type on .markdown-preview-view
		// itself (nous-kind-meeting/-wiki/-tag), replacing what used to be
		// three separate :has(.metadata-property[...]) selector roots
		// threaded through every note-styling rule below - 105 :has() uses
		// eliminated (Obsidian's plugin health scanner flags :has() as a
		// real performance risk: broad selector invalidation on every DOM
		// change, re-evaluated per rule). Priority mirrors the old
		// :has()/:not()/:not() logic exactly: topic wins if present (wiki),
		// else enriched_at (meeting/note), else created alone (tag page) -
		// safe because the pipeline never writes more than one of these
		// three to the same note.
		this.registerMarkdownPostProcessor((el, ctx) => {
			const previewRoot = el.closest(".markdown-preview-view");
			if (!previewRoot) return;
			const fm = ctx.frontmatter as Record<string, unknown> | null | undefined;
			const kind = fm?.topic !== undefined ? "wiki" : fm?.enriched_at !== undefined ? "meeting" : fm?.created !== undefined ? "tag" : null;
			previewRoot.classList.remove("nous-kind-meeting", "nous-kind-wiki", "nous-kind-tag");
			if (kind) previewRoot.classList.add(`nous-kind-${kind}`);
		});

		// Reading view: tag a block with which named section it's the
		// heading for, or the content immediately under, replacing the
		// remaining div:has(> h2[data-heading="X"]) [+ div] selectors -
		// same :has() performance concern as the kind-tagger above, same
		// technique as the existing transcript-heading scan below.
		this.registerMarkdownPostProcessor((el, ctx) => {
			const info = ctx.getSectionInfo(el);
			if (!info) return;
			const lines = info.text.split("\n");
			const ownLine = lines[info.lineStart]?.trim() ?? "";
			if (ownLine === "## Related") el.addClass("nous-heading-related");

			let prevNonBlank: string | null = null;
			for (let i = info.lineStart - 1; i >= 0; i--) {
				const line = lines[i]?.trim();
				if (line) {
					prevNonBlank = line;
					break;
				}
			}
			if (!prevNonBlank) return;
			const afterClass: Record<string, string> = {
				"## Open questions": "nous-after-open-questions",
				"## Action items": "nous-after-action-items",
				"## Watch": "nous-after-watch",
				"## New terms": "nous-after-new-terms",
				"## Glossary": "nous-after-glossary",
				"## Related": "nous-after-related",
				"## Timeline": "nous-after-timeline",
				"## Sources": "nous-after-sources",
			};
			const specific = afterClass[prevNonBlank];
			if (specific) el.addClass(specific);
			if (prevNonBlank.startsWith("## ")) el.addClass("nous-after-heading");
		});

		// Editing view: same treatment via line decorations.
		this.registerEditorExtension(nousTranscriptDimmer);
		this.addSettingTab(new NousSettingTab(this.app, this));

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

		this.addCommand({
			id: "query-vault",
			name: "Query vault",
			callback: () => new QueryModal(this.app, (question) => void this.runVaultQuery(question)).open(),
		});

		this.addCommand({
			id: "log-a-win",
			name: "Log a win",
			callback: () => void this.logWin(),
		});

		this.voiceRibbonEl = this.addRibbonIcon("mic", "toggle voice capture", () => {
			void this.toggleVoiceCapture();
		});

		this.voiceStatusBarEl = this.addStatusBarItem();
		this.voiceStatusBarEl.hide();
		this.register(() => {
			if (this.voiceRecordingTimer !== null) window.clearInterval(this.voiceRecordingTimer);
			if (this.meetingRecordingTimer !== null) window.clearInterval(this.meetingRecordingTimer);
		});

		this.addCommand({
			id: "setup-wizard",
			name: "Open setup wizard",
			callback: () => new OnboardingModal(this.app, this).open(),
		});

		this.addCommand({
			id: "show-tour",
			name: "Show quick tour",
			callback: () => new OnboardingModal(this.app, this, "tour").open(),
		});

		this.addCommand({
			id: "import-from-notion",
			name: "Import from Notion",
			callback: () => new OnboardingModal(this.app, this, "notion-import").open(),
		});

		this.addCommand({
			id: "open-settings",
			name: "Open settings",
			callback: () => this.openNousSettings(),
		});

		this.addCommand({
			id: "toggle-voice-capture",
			name: "Start/stop voice recording",
			callback: () => void this.toggleVoiceCapture(),
		});

		if (Platform.isMacOS) {
			this.addCommand({
				id: "toggle-meeting-capture",
				name: "Start/stop meeting recording",
				callback: () => void this.toggleMeetingCapture(),
			});

			this.meetingRibbonEl = this.addRibbonIcon("audio-lines", "toggle meeting capture", () => {
				void this.toggleMeetingCapture();
			});
			this.meetingStatusBarEl = this.addStatusBarItem();
			this.meetingStatusBarEl.hide();

			// A recording can start/stop outside Nous too via the native helper
			// CLI, so the button-press-time update alone can go stale. Poll
			// lightly to keep the indicator honest.
			this.meetingPollInterval = window.setInterval(() => {
				void this.updateMeetingRecordingIndicator();
			}, 5000);
			this.app.workspace.onLayoutReady(() => void this.recoverOrphanedLiveRecording());
			this.register(() => {
				if (this.meetingPollInterval !== null) window.clearInterval(this.meetingPollInterval);
			});

			// Staleness only matters on a 20-minute scale, so this runs far
			// less often than the recording-indicator poll above.
			this.orphanCheckInterval = window.setInterval(() => {
				void this.checkOrphanedNativeRecordings();
			}, 5 * 60 * 1000);
			this.register(() => {
				if (this.orphanCheckInterval !== null) window.clearInterval(this.orphanCheckInterval);
			});
		}

		this.addCommand({
			id: "convert-transcripts-to-collapsed-sections",
			name: "Convert transcripts to collapsed sections",
			callback: () => void this.convertLegacyTranscripts(),
		});

		// Always registered, with the setting read at event time - gating the
		// registration itself on the setting meant the "Auto-process on
		// capture" toggle did nothing until the plugin was reloaded.
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (!this.settings.autoProcessOnCreate) return;
				if (file instanceof TFile && this.isInInbox(file) && !this.notionImportInProgress) {
					// Dictation/sync tools create then immediately rewrite a
					// file - let it settle before reading.
					window.setTimeout(() => void this.processInbox(), 2000);
				}
			})
		);

		// Catch up on anything that arrived while Obsidian was closed.
		this.app.workspace.onLayoutReady(() => {
			if (!this.settings.onboarded) {
				new OnboardingModal(this.app, this).open();
			} else {
				void this.processInbox();
				if (Platform.isMacOS) void this.checkOrphanedNativeRecordings();
			}
		});
	}

	// Obsidian's own Component lifecycle (registerEvent/registerInterval/
	// addCommand, all used throughout onload above) already tears itself
	// down automatically on unload - a live mic MediaStream/MediaRecorder
	// the plugin opened directly via browser APIs is not covered by that,
	// so a plugin disable/reload mid-recording would otherwise leave the
	// mic running indefinitely with nothing left able to stop it. The
	// native meeting recorder is deliberately left alone here - it is a
	// separate OS process designed to keep recording across a plugin
	// reload, not something this plugin should kill.
	onunload() {
		this.voiceRecorder?.stop();
		void this.liveCaptureModal?.stopAndClose();
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<NousSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		// apiKeys/models are per-provider maps - a plain Object.assign above
		// replaces the whole map with whatever's on disk, so a provider added
		// in a later version (e.g. glm) is missing entirely from an older
		// data.json and comes back undefined instead of "", instead of
		// falling back to DEFAULT_SETTINGS's empty default like every other
		// setting does. Merge these two maps key-by-key instead.
		this.settings.apiKeys = Object.assign({}, DEFAULT_SETTINGS.apiKeys, data?.apiKeys);
		this.settings.models = Object.assign({}, DEFAULT_SETTINGS.models, data?.models);
		// Installs that predate the wizard already have settings on disk -
		// don't greet a configured vault with a first-run welcome.
		if (data && data.onboarded === undefined) {
			this.settings.onboarded = true;
		}

		if (requireApiVersion("1.11.4") && this.app.secretStorage) {
			let migratedAnyPlaintextKey = false;
			for (const provider of API_KEY_PROVIDERS) {
				const stored = this.app.secretStorage.getSecret(this.secretId(provider));
				if (stored) {
					this.settings.apiKeys[provider] = stored;
				} else if (this.settings.apiKeys[provider]) {
					// Upgrading from a pre-1.11.4 install: this key was saved
					// to plain-text data.json before secretStorage existed.
					// Move it over now; saveSettings() below blanks the
					// plaintext copy out of data.json.
					this.app.secretStorage.setSecret(this.secretId(provider), this.settings.apiKeys[provider]);
					migratedAnyPlaintextKey = true;
				}
			}
			if (migratedAnyPlaintextKey) await this.saveSettings();
		}
	}

	// API keys go through Obsidian's own secretStorage (App.secretStorage,
	// 1.11.4+) instead of the plugin's plain-text data.json, once available -
	// see docs/ARCHITECTURE.md's "Privacy and security model". Older
	// Obsidian has no such API, so those installs keep today's plain-text
	// behavior; nothing here is desktop/mobile-gated, secretStorage is a
	// plain App property on both.
	//
	// The `requireApiVersion("1.11.4") && this.app.secretStorage` guard is
	// deliberately inlined at each call site (loadSettings()/saveSettings()
	// below) rather than factored into a shared helper - obsidianmd/
	// no-unsupported-api only recognizes a literal requireApiVersion(...)
	// check as an ancestor of the guarded call, not one hidden behind a
	// method call, so factoring it out would silently bring back the lint
	// error it's meant to satisfy.
	private secretId(provider: ApiProvider): string {
		return `nous-apikey-${provider}`;
	}

	async saveSettings() {
		if (requireApiVersion("1.11.4") && this.app.secretStorage) {
			const toPersist: NousSettings = { ...this.settings, apiKeys: { ...this.settings.apiKeys } };
			for (const provider of API_KEY_PROVIDERS) {
				this.app.secretStorage.setSecret(this.secretId(provider), this.settings.apiKeys[provider]);
				toPersist.apiKeys[provider] = "";
			}
			await this.saveData(toPersist);
		} else {
			await this.saveData(this.settings);
		}
	}

	private httpPost: HttpPost = async (url, headers, body) => {
		const res = await requestUrl({ url, method: "POST", headers, body, throw: false });
		return { status: res.status, text: res.text };
	};

	private httpPostBinary: HttpPostBinary = async (url, headers, body) => {
		const res = await requestUrl({ url, method: "POST", headers, body, throw: false });
		return { status: res.status, text: res.text };
	};

	// Audio -> text, preferring fully local/offline whisper.cpp (macOS only)
	// so voice capture needs no API key at all; falls back to whichever of
	// Gemini/OpenAI has a key (Anthropic has no audio API), independent of
	// execution mode.
	async transcribeAudio(extension: string, binary: ArrayBuffer, filename: string): Promise<string> {
		return (await this.transcribeAudioWithSegments(extension, binary, filename)).text;
	}

	// Same as transcribeAudio, but keeps whisper's per-segment timing when the
	// local path handled it - meeting capture uses the offsets to interleave
	// the two tracks into a dialogue. Cloud transcription has no reliable
	// timing, so those paths return segments: null.
	private async transcribeAudioWithSegments(
		extension: string,
		binary: ArrayBuffer,
		filename: string
	): Promise<TrackTranscript> {
		const local = await this.transcribeLocally(extension, binary);
		if (local && "text" in local) return { text: local.text, segments: local.segments };

		const keys = this.settings.apiKeys;
		const mediaType = audioMimeType(extension);
		const preferOpenAi = this.settings.apiProvider === "openai" && !!keys.openai;
		if (keys.gemini && !preferOpenAi) {
			const text = await transcribeWithGemini(
				this.httpPost,
				keys.gemini,
				mediaType,
				logic.arrayBufferToBase64(binary)
			);
			return { text, segments: null };
		}
		if (keys.openai) {
			const text = await transcribeWithOpenAi(
				this.httpPostBinary,
				keys.openai,
				mediaType,
				new Uint8Array(binary),
				filename
			);
			return { text, segments: null };
		}
		const localHint = local && "failure" in local ? ` Local attempt failed: ${local.failure}` : "";
		throw new Error(
			`Audio capture needs speech-to-text - install the local one or add a Gemini/OpenAI key in Settings → Nous → Voice capture. A key is only used to turn speech into text - enrichment still runs in your chosen mode.${localHint}`
		);
	}

	private hasCloudAudioTranscription(): boolean {
		return hasGeminiOrOpenAiTranscriptionKey(this.settings.apiKeys);
	}

	// Display-only default path (used synchronously by the settings tab), so
	// this avoids the async node-module loader - macOS-only feature, so a
	// plain "/" join is safe (no need for the "path" module's platform logic).
	// Points at the quantized large-v3-turbo model (~574MB) - the default
	// download target for anyone setting up from scratch, chosen for
	// accuracy close to the full model at a size close to the smaller model
	// it replaced. See resolveWhisperModelPath() below for what actually
	// gets used once a model exists on disk.
	defaultWhisperModelPath(): string {
		return `${process.env.HOME ?? ""}/.local/share/whisper-models/ggml-large-v3-turbo-q5_0.bin`;
	}

	// Earlier defaults, most accurate first - anyone who already downloaded
	// one of these keeps working without needing to notice anything changed,
	// or re-download a model they don't need. New installs never target
	// either path; this is read-only migration.
	private legacyWhisperModelPaths(): string[] {
		const dir = `${process.env.HOME ?? ""}/.local/share/whisper-models`;
		return [`${dir}/ggml-large-v3-turbo.bin`, `${dir}/${WHISPER_FAST_MODEL_SOURCE.filename}`];
	}

	private defaultWhisperVadModelPath(): string {
		return `${process.env.HOME ?? ""}/.local/share/whisper-models/ggml-silero-v5.1.2.bin`;
	}

	private static async fileExists(p: string): Promise<boolean> {
		const { fs } = await loadNodeModules();
		return fs
			.access(p)
			.then(() => true)
			.catch(() => false);
	}

	// A configured path is trusted as-is (existence checked by the caller).
	// With no configured path, prefer whichever model is actually on disk -
	// the current default if this is a fresh setup, otherwise the first
	// earlier default this vault already had - falling back to the current
	// default path if none exist yet (nothing to transcribe with, but the
	// right place for a future download to land).
	private async resolveWhisperModelPath(): Promise<string> {
		const configured = this.settings.whisperModelPath.trim();
		if (configured) return configured;
		const preferred = this.defaultWhisperModelPath();
		if (await NousPlugin.fileExists(preferred)) return preferred;
		for (const legacy of this.legacyWhisperModelPaths()) {
			if (await NousPlugin.fileExists(legacy)) return legacy;
		}
		return preferred;
	}

	async hasWhisperModel(): Promise<boolean> {
		return NousPlugin.fileExists(await this.resolveWhisperModelPath());
	}

	// One-click speech-model install: fetch the git-lfs pointer for the
	// expected sha256/size, stream the model to disk (never buffer the whole
	// thing in memory - models here run ~500MB-1.6GB, still sizable), verify,
	// then rename into place. The VAD model rides along but its failure is
	// non-fatal.
	// Set right before a download starts, checked from inside the progress
	// callback so cancelWhisperDownload() can interrupt an in-flight request
	// (transfers here are not instant, and until this there was no way to
	// back out of one once started).
	private whisperDownloadCancelled = false;

	cancelWhisperDownload(): void {
		this.whisperDownloadCancelled = true;
	}

	// Shared single-source fetch, used by the required-model loop below and
	// by downloadFastWhisperModel(): existence check, git-lfs pointer fetch,
	// streamed download. Throws for a required source that fails; returns
	// null for an optional one so the caller's loop can keep going.
	private async fetchModelSource(
		source: WhisperModelSource,
		dir: string,
		path: typeof import("path"),
		onProgress: (text: string) => void
	): Promise<string | null> {
		const target = path.join(dir, source.filename);
		if (await NousPlugin.fileExists(target)) return target;
		if (this.whisperDownloadCancelled) throw new Error("cancelled");
		try {
			const pointerResponse = await requestUrl({ url: source.pointerUrl, method: "GET", throw: false });
			if (pointerResponse.status >= 400) throw new Error(`checksum fetch failed (${pointerResponse.status})`);
			const pointer = parseLfsPointer(pointerResponse.text);
			if (!pointer) throw new Error("model checksum file was missing or malformed");

			await this.streamDownloadToFile(source.downloadUrl, target, pointer, (received) =>
				onProgress(downloadProgressText(source.filename, received, pointer.size))
			);
			return target;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg === "cancelled") throw e;
			if (source.required) throw new Error(`could not download ${source.filename}: ${msg}`);
			await this.appendLog(`WARN: optional ${source.filename} download failed: ${msg}`);
			return null;
		}
	}

	async downloadWhisperModels(onProgress: (text: string) => void): Promise<string> {
		if (!Platform.isMacOS) throw new Error("Local whisper transcription is macOS-only.");
		this.whisperDownloadCancelled = false;
		const { fs, os, path } = await loadNodeModules();
		const dir = path.join(os.homedir(), ...WHISPER_MODELS_DIR_SEGMENTS);
		await fs.mkdir(dir, { recursive: true });

		let installedPath = "";
		for (const source of WHISPER_MODEL_SOURCES) {
			const target = await this.fetchModelSource(source, dir, path, onProgress);
			if (target && source.required) installedPath = target;
		}
		if (!installedPath) throw new Error("model download produced no file");

		// Point the setting at the default location the download used, in case
		// a custom (missing) path was configured.
		this.settings.whisperModelPath = "";
		await this.saveSettings();
		return installedPath;
	}

	// Opt-in swap to the smaller, faster, less accurate model - offered only
	// from Settings → Nous → Advanced settings, never during onboarding.
	// Unlike downloadWhisperModels() this always sets whisperModelPath
	// explicitly, so the switch takes effect even though the accurate
	// default may also exist on disk.
	async downloadFastWhisperModel(onProgress: (text: string) => void): Promise<string> {
		if (!Platform.isMacOS) throw new Error("Local whisper transcription is macOS-only.");
		this.whisperDownloadCancelled = false;
		const { fs, os, path } = await loadNodeModules();
		const dir = path.join(os.homedir(), ...WHISPER_MODELS_DIR_SEGMENTS);
		await fs.mkdir(dir, { recursive: true });

		const target = await this.fetchModelSource(WHISPER_FAST_MODEL_SOURCE, dir, path, onProgress);
		if (!target) throw new Error("model download produced no file");

		this.settings.whisperModelPath = target;
		await this.saveSettings();
		return target;
	}

	// Shared control-flow for "long-running task behind a persistent notice
	// that can be cancelled" - the model download and the whisper-cli install
	// both open a notice, update it on success/cancel/failure, log failures,
	// and fade the notice out after a delay. Written out in full twice before
	// this consolidated the skeleton into one place; only the wording (and,
	// for the download, live byte progress) varies per call site.
	private async runCancellableTaskWithNotice(
		startMessage: string,
		task: (onProgress: (text: string) => void) => Promise<unknown>,
		messages: { success: string; cancelled: string; failure: (detail: string) => string },
		logPrefix: string
	): Promise<boolean> {
		const notice = nousNotice(startMessage, 0);
		try {
			await task((text) => notice.setMessage(nousNoticeFragment(text)));
			notice.setMessage(nousNoticeFragment(messages.success));
			window.setTimeout(() => notice.hide(), 8000);
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg === "cancelled") {
				notice.setMessage(nousNoticeFragment(messages.cancelled));
				window.setTimeout(() => notice.hide(), 6000);
				return false;
			}
			await this.appendLog(`ERROR: ${logPrefix}: ${msg}`);
			notice.setMessage(nousNoticeFragment(messages.failure(msg)));
			window.setTimeout(() => notice.hide(), 12000);
			return false;
		}
	}

	async downloadWhisperModelsWithNotice(): Promise<boolean> {
		return this.runCancellableTaskWithNotice(
			"Fetching your speech model…",
			(onProgress) => this.downloadWhisperModels(onProgress),
			{
				success: "Speech model installed - your voice notes now transcribe right here on your Mac.",
				cancelled: "Download cancelled.",
				failure: () => "model download failed - more in your Nous log",
			},
			"speech-model download failed"
		);
	}

	async downloadFastWhisperModelWithNotice(): Promise<boolean> {
		return this.runCancellableTaskWithNotice(
			"Fetching the faster speech model…",
			(onProgress) => this.downloadFastWhisperModel(onProgress),
			{
				success: "Faster speech model installed - transcripts run quicker, and less accurately.",
				cancelled: "Download cancelled.",
				failure: () => "model download failed - more in your Nous log",
			},
			"fast speech-model download failed"
		);
	}

	// Set right before the install starts, checked from the child-process
	// callback so a real "SIGTERM because timed out" can be told apart from
	// "SIGTERM because cancelWhisperCliInstall() was called" - both look
	// identical to Node's error.killed otherwise.
	private whisperCliInstallCancelled = false;
	private whisperCliInstallChild: import("child_process").ChildProcess | null = null;

	cancelWhisperCliInstall(): void {
		this.whisperCliInstallCancelled = true;
		this.whisperCliInstallChild?.kill();
	}

	// A dedicated execFile call rather than going through the shared
	// cliExec() - this needs to hold onto the child process for
	// cancelWhisperCliInstall() to kill, and threading a cancel token
	// through cliExec's shared type would touch every other caller
	// (claude, whisper-cli --help, the recorder) for the sake of the one
	// call site that actually needs it.
	async installWhisperCli(): Promise<void> {
		if (!Platform.isMacOS) throw new Error("Local whisper transcription is macOS-only.");
		this.whisperCliInstallCancelled = false;
		const { execFile, os } = await loadNodeModules();
		const env = this.cliEnv();

		const brewCheck = await this.cliExec("brew", ["--version"], {
			cwd: os.tmpdir(),
			env,
			timeoutMs: QUICK_CLI_TIMEOUT_MS,
		});
		if (brewCheck.code !== 0) {
			throw new Error('Homebrew is not installed - install it from brew.sh, then try again.');
		}

		await new Promise<void>((resolve, reject) => {
			const child = execFile(
				"brew",
				["install", "whisper-cpp"],
				{
					cwd: os.tmpdir(),
					env,
					maxBuffer: 20 * 1024 * 1024,
					timeout: WHISPER_CLI_INSTALL_TIMEOUT_MS,
					killSignal: "SIGTERM",
				},
				(error, stdout, stderr) => {
					this.whisperCliInstallChild = null;
					if (!error) {
						resolve();
						return;
					}
					if (this.whisperCliInstallCancelled) {
						reject(new Error("cancelled"));
						return;
					}
					const detail = (stderr?.toString().trim() || stdout?.toString().trim() || error.message).slice(0, 300);
					reject(new Error(detail || "(no output)"));
				}
			);
			this.whisperCliInstallChild = child;
			child.stdin?.end();
		});

		// Check the standard brew-installed name directly, not
		// this.hasWhisperCli() (which reads settings.whisperCliPath) - a
		// leftover custom path (for example, pointed at a bogus location to
		// simulate "not installed" for testing) would otherwise report
		// failure forever even right after a real, successful install.
		const check = await this.cliExec(DEFAULT_WHISPER_CLI_BIN, ["--help"], {
			cwd: os.tmpdir(),
			env,
			timeoutMs: QUICK_CLI_TIMEOUT_MS,
		});
		if (check.code !== 0) {
			throw new Error(
				'Install finished, but "whisper-cli" still is not runnable - check Settings → Nous → Advanced settings → Whisper CLI path.'
			);
		}
		if (this.settings.whisperCliPath.trim() && this.settings.whisperCliPath.trim() !== DEFAULT_WHISPER_CLI_BIN) {
			this.settings.whisperCliPath = "";
			await this.saveSettings();
		}
	}

	async installWhisperCliWithNotice(): Promise<boolean> {
		return this.runCancellableTaskWithNotice(
			"Installing local transcription… this can take a minute or two.",
			() => this.installWhisperCli(),
			{
				success: "Local transcription installed.",
				cancelled: "Install cancelled.",
				failure: (detail) => `Install didn't work - ${detail}`,
			},
			"whisper-cli install failed"
		);
	}

	private async streamDownloadToFile(
		url: string,
		target: string,
		expected: LfsPointer,
		onProgress: (receivedBytes: number) => void,
		redirectsLeft = 5
	): Promise<void> {
		const { crypto, fs, fsCreateWriteStream, https } = await loadNodeModules();
		const tmp = `${target}.download-${Date.now().toString(36)}`;

		try {
			await new Promise<void>((resolve, reject) => {
				const request = https.get(url, (response) => {
					const status = response.statusCode ?? 0;
					if (status >= 300 && status < 400 && response.headers.location) {
						response.resume();
						if (redirectsLeft <= 0) {
							reject(new Error("too many redirects"));
							return;
						}
						this.streamDownloadToFile(response.headers.location, target, expected, onProgress, redirectsLeft - 1)
							.then(resolve, reject);
						return;
					}
					if (status !== 200) {
						response.resume();
						reject(new Error(`download failed (HTTP ${status})`));
						return;
					}

					const hash = crypto.createHash("sha256");
					const file = fsCreateWriteStream(tmp);
					let received = 0;
					let lastReported = 0;
					response.on("data", (chunk: Buffer) => {
						// Checked here, not just between files - a single model
						// runs ~500MB-1.6GB, so cancelWhisperDownload() has to be
						// able to interrupt a transfer already in progress, not
						// just stop the next one from starting.
						if (this.whisperDownloadCancelled) {
							request.destroy();
							reject(new Error("cancelled"));
							return;
						}
						hash.update(chunk);
						received += chunk.length;
						// Progress at most every ~16 MB so the UI update itself
						// doesn't become the bottleneck.
						if (received - lastReported > 16_000_000 || received === expected.size) {
							lastReported = received;
							onProgress(received);
						}
					});
					response.on("error", reject);
					file.on("error", reject);
					file.on("finish", () => {
						const digest = hash.digest("hex");
						if (received !== expected.size) {
							reject(new Error(`download incomplete (${received} of ${expected.size} bytes)`));
						} else if (digest !== expected.sha256) {
							reject(new Error("downloaded model failed its checksum"));
						} else {
							resolve();
						}
					});
					response.pipe(file);
				});
				request.on("error", reject);
			});
			// The redirect branch resolves after its own recursion completed
			// the rename; only rename when this depth actually wrote the file.
			if (await NousPlugin.fileExists(tmp)) {
				await fs.rename(tmp, target);
			}
		} finally {
			await fs.unlink(tmp).catch(() => {});
		}
	}

	// Decodes any audio Chromium understands (mp4/aac, webm/opus, wav, mp3...)
	// and resamples to 16kHz mono PCM, then hand-encodes a WAV - whisper-cli
	// expects a plain WAV, and this avoids afconvert's fragile handling of
	// MediaRecorder's non-finalized containers.
	private static async decodeToWav16kMono(binary: ArrayBuffer): Promise<ArrayBuffer> {
		const ctx = new AudioContext();
		let decoded: AudioBuffer;
		try {
			decoded = await ctx.decodeAudioData(binary.slice(0));
		} finally {
			void ctx.close();
		}

		const targetRate = 16000;
		const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
		const source = offline.createBufferSource();
		source.buffer = decoded;
		source.connect(offline.destination);
		source.start();
		const resampled = await offline.startRendering();
		const samples = resampled.getChannelData(0);

		const wav = new ArrayBuffer(44 + samples.length * 2);
		const view = new DataView(wav);
		const writeAscii = (offset: number, text: string) => {
			for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
		};
		writeAscii(0, "RIFF");
		view.setUint32(4, 36 + samples.length * 2, true);
		writeAscii(8, "WAVE");
		writeAscii(12, "fmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true); // PCM
		view.setUint16(22, 1, true); // mono
		view.setUint32(24, targetRate, true);
		view.setUint32(28, targetRate * 2, true); // byte rate (rate * blockAlign)
		view.setUint16(32, 2, true); // block align
		view.setUint16(34, 16, true); // bits per sample
		writeAscii(36, "data");
		view.setUint32(40, samples.length * 2, true);
		let offset = 44;
		for (let i = 0; i < samples.length; i++, offset += 2) {
			const clamped = Math.max(-1, Math.min(1, samples[i]));
			view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
		}
		return wav;
	}

	// Returns null when local transcription isn't set up at all (so
	// transcribeAudio can fall through to the cloud-key path silently), or
	// {failure} when it was attempted but broke - callers surface that reason
	// instead of a generic "not configured" message.
	private async transcribeLocally(
		extension: string,
		binary: ArrayBuffer
	): Promise<{ text: string; segments: TranscriptSegment[] } | { failure: string } | null> {
		if (!Platform.isMacOS) return null; // afconvert is macOS-only

		const modelPath = await this.resolveWhisperModelPath();
		if (!(await NousPlugin.fileExists(modelPath))) return null;

		const { fs: fsPromises, os, path } = await loadNodeModules();
		const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const wavPath = path.join(os.tmpdir(), `nous-voice-${stamp}.wav`);
		const outBase = path.join(os.tmpdir(), `nous-voice-${stamp}`);
		const cleanupPaths = [wavPath, `${outBase}.json`];
		try {
			// afconvert would be cheaper, but CoreAudio's ExtAudioFile rejects
			// the fragmented/streaming mp4 (or webm) MediaRecorder produces -
			// "couldn't set destination file's estimated duration" - because a
			// live recording has no upfront duration atom. Chromium's own
			// decoder has no such requirement (it produced the file), so decode
			// + resample here. Finalized files from disk take the afconvert
			// path in transcribeFileLocallyWithSegments instead.
			let wavBuffer: ArrayBuffer;
			try {
				wavBuffer = await NousPlugin.decodeToWav16kMono(binary);
			} catch (err) {
				return {
					failure: `couldn't decode the .${extension} recording: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
			await fsPromises.writeFile(wavPath, Buffer.from(wavBuffer));
			return await this.runWhisperOnWav(wavPath, outBase, modelPath);
		} catch (err) {
			return { failure: err instanceof Error ? err.message : String(err) };
		} finally {
			await Promise.all(cleanupPaths.map((p) => fsPromises.unlink(p).catch(() => {})));
		}
	}

	private async runWhisperOnWav(
		wavPath: string,
		outBase: string,
		modelPath: string
	): Promise<{ text: string; segments: TranscriptSegment[] } | { failure: string }> {
		const { fs: fsPromises, os } = await loadNodeModules();
		const whisperCli = this.settings.whisperCliPath.trim() || DEFAULT_WHISPER_CLI_BIN;
		const vadModelPath = this.defaultWhisperVadModelPath();
		const args = ["-m", modelPath, "-f", wavPath, "-l", "auto", "-oj", "-of", outBase];
		if (await NousPlugin.fileExists(vadModelPath)) {
			args.push("--vad", "--vad-model", vadModelPath);
		}

		const result = await this.cliExec(whisperCli, args, { cwd: os.tmpdir(), env: this.cliEnv() });
		if (result.code !== 0) {
			return { failure: `${whisperCli} exited ${result.code}: ${cliErrorDetail(result)}` };
		}

		const raw = await fsPromises.readFile(`${outBase}.json`, "utf8");
		const parsed = JSON.parse(raw) as {
			transcription?: { text?: string; offsets?: { from?: number } }[];
		};
		const segments = (parsed.transcription ?? [])
			.map((segment) => ({
				from: segment.offsets?.from ?? 0,
				text: (segment.text ?? "").trim(),
			}))
			.filter((segment) => segment.text.length > 0);
		const text = segments
			.map((segment) => segment.text)
			.join(" ")
			.trim();
		return text
			? { text, segments }
			: { failure: "local transcription produced no speech text (silence, or the recording was too quiet)" };
	}

	// Local transcription for a finalized audio FILE (a native-recorder track):
	// afconvert resamples on disk and whisper reads the wav from disk, so a
	// one-hour meeting never has to fit in the renderer's memory. Returns null
	// when local transcription is not set up or the attempt failed - callers
	// fall back to the in-memory path (which can also reach cloud keys).
	private async transcribeFileLocallyWithSegments(filePath: string): Promise<TrackTranscript | null> {
		if (!Platform.isMacOS) return null;
		const modelPath = await this.resolveWhisperModelPath();
		if (!(await NousPlugin.fileExists(modelPath))) return null;

		const { fs: fsPromises, os, path } = await loadNodeModules();
		const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const wavPath = path.join(os.tmpdir(), `nous-track-${stamp}.wav`);
		const outBase = path.join(os.tmpdir(), `nous-track-${stamp}`);
		try {
			const converted = await this.cliExec(
				"afconvert",
				["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", filePath, wavPath],
				{ cwd: os.tmpdir(), env: this.cliEnv() }
			);
			if (converted.code !== 0) {
				await this.appendLog(`WARN: afconvert failed for ${path.basename(filePath)}: ${cliErrorDetail(converted)}`);
				return null;
			}
			const result = await this.runWhisperOnWav(wavPath, outBase, modelPath);
			if ("failure" in result) {
				await this.appendLog(`WARN: local transcription of ${path.basename(filePath)}: ${result.failure}`);
				// No speech is a result, not an error - do not re-decode the
				// whole file in memory just to hear the same silence.
				if (result.failure.startsWith("local transcription produced no speech text")) {
					return { text: "", segments: [] };
				}
				return null;
			}
			return result;
		} finally {
			await Promise.all(
				[wavPath, `${outBase}.json`].map((p) => fsPromises.unlink(p).catch(() => {}))
			);
		}
	}

	// Split from canUseLocalAudioTranscription so the setup UI can tell "no
	// model yet" apart from "model's here, whisper-cli isn't" - those need
	// different instructions, not the same "Download model" button repeated.
	async hasWhisperCli(): Promise<boolean> {
		if (!Platform.isMacOS) return false;
		const { os } = await loadNodeModules();
		const whisperCli = this.settings.whisperCliPath.trim() || DEFAULT_WHISPER_CLI_BIN;
		const result = await this.cliExec(whisperCli, ["--help"], {
			cwd: os.tmpdir(),
			env: this.cliEnv(),
			timeoutMs: QUICK_CLI_TIMEOUT_MS,
		});
		return result.code === 0;
	}

	private async canUseLocalAudioTranscription(): Promise<boolean> {
		if (!Platform.isMacOS) return false;
		if (!(await this.hasWhisperModel())) return false;
		return this.hasWhisperCli();
	}

	private async hasAudioTranscriptionBackend(): Promise<boolean> {
		return this.hasCloudAudioTranscription() || (await this.canUseLocalAudioTranscription());
	}

	async getCapturePrerequisiteStatus(): Promise<CapturePrerequisiteStatus> {
		const voiceReady = await this.hasAudioTranscriptionBackend();
		let meeting: CapturePrerequisiteStatus["meeting"] = "unsupported";
		if (Platform.isMacOS) {
			const nativeStatus = await this.nativeRecorderStatus();
			// The "status" subcommand can exit 0 (recorder is installed and
			// idle) even right after a "start" attempt failed on a macOS
			// permission prompt - nativeRecorderLastProblem is the only place
			// that failure is recorded, so it has to be checked here too, or
			// this screen's numbered checklist says "Ready to record" while
			// the detailed row right below it says the opposite.
			meeting = !nativeStatus.available
				? "needs-recorder"
				: this.nativeRecorderLastProblem
					? "needs-permission"
					: "ready-native";
		}
		return { voiceReady, meeting };
	}

	async getNativeRecorderReadiness(): Promise<NativeRecorderReadiness> {
		if (!Platform.isMacOS) {
			return {
				state: "unsupported",
				command: null,
				version: null,
				detail: "Meeting recording needs macOS.",
			};
		}

		const { os } = await loadNodeModules();
		const command = await this.nativeRecorderCommand();
		const versionResult = await this.cliExec(command, ["version"], {
			cwd: os.homedir(),
			env: this.cliEnv(),
			timeoutMs: QUICK_CLI_TIMEOUT_MS,
		});
		const statusResult = await this.runNativeRecorder("status");
		const version = versionResult.code === 0 ? versionResult.stdout.trim().slice(0, 80) : null;
		const failedOutput = (statusResult.stderr || statusResult.stdout || versionResult.stderr || versionResult.stdout)
			.trim()
			.slice(0, 240);

		if (statusResult.code !== 0) {
			const state = versionResult.code === 0 ? "error" : "missing";
			return {
				state,
				command,
				version,
				detail: failedOutput || "The helper command did not run.",
			};
		}

		const status = parseNativeRecorderStatus(statusResult.stdout);
		if (this.nativeRecorderLastProblem) {
			return {
				state: "needs-permission",
				command,
				version,
				detail: this.nativeRecorderLastProblem,
			};
		}
		return {
			state: status.recording ? "recording" : "installed",
			command,
			version,
			detail: status.output ?? "",
		};
	}

	private getLlmProvider(): LlmProvider {
		const provider: ApiProvider = this.settings.apiProvider;
		const apiKey = this.settings.apiKeys[provider];
		const model = this.settings.models[provider];
		switch (provider) {
			case "openai":
				return new OpenAiCompatibleProvider(this.httpPost, apiKey, model, "https://api.openai.com/v1");
			case "gemini":
				return new GeminiProvider(this.httpPost, apiKey, model);
			case "glm":
				return new OpenAiCompatibleProvider(this.httpPost, apiKey, model, this.settings.glmBaseUrl);
			case "local":
				return new OpenAiCompatibleProvider(this.httpPost, apiKey, model, this.settings.localBaseUrl);
			case "anthropic":
			default:
				return new AnthropicProvider(this.httpPost, apiKey, model);
		}
	}

	// API mode: one minimal tool call with the configured provider/model/key.
	// CLI mode: `claude --version` (the common failure is PATH, not auth).
	async testConnection(): Promise<string> {
		if (this.settings.executionMode === "cli") {
			const basePath = this.getVaultBasePath();
			if (!basePath) throw new Error("Could not resolve this vault's filesystem path.");
			const result = await this.cliExec(this.settings.claudeCliPath, ["--version"], {
				cwd: basePath,
				env: this.cliEnv(),
				timeoutMs: QUICK_CLI_TIMEOUT_MS,
			});
			if (result.code !== 0) {
				throw new Error(
					`"${this.settings.claudeCliPath} --version" exited ${result.code}: ${cliErrorDetail(result)}`
				);
			}
			return `Found Claude Code (${result.stdout.trim().slice(0, 60)}).`;
		}
		const provider = this.getLlmProvider();
		// Unlike cliExec (timeoutMs above), Obsidian's requestUrl has no
		// timeout option at all - a dropped connection (an unreachable local
		// server, a firewalled remote endpoint) would otherwise leave
		// "Checking the connection..." spinning forever with no Retry/Skip
		// ever surfacing. Bounded here, at the call site, rather than inside
		// httpPost itself - real enrichment calls share that same plumbing
		// and can legitimately take longer than a quick ping should.
		const result = await Promise.race([
			provider.callTool<{ ok: boolean }>(
				"You are a connection test. Call the ping tool exactly once with ok=true.",
				{ text: "ping" },
				{
					name: "ping",
					description: "Confirm the connection works.",
					input_schema: {
						type: "object",
						properties: { ok: { type: "boolean" } },
						required: ["ok"],
					},
				},
				64
			),
			new Promise<never>((_, reject) =>
				window.setTimeout(() => reject(new Error("Timed out waiting for a response.")), QUICK_CLI_TIMEOUT_MS)
			),
		]);
		if (!result || result.ok !== true) {
			throw new Error("The model responded, but not with the expected tool call - it may not support tool use.");
		}
		return `Connected! ${this.settings.models[this.settings.apiProvider]} said hello back.`;
	}

	private cliExec: CliExec = async (command, args, options) => {
		const { execFile } = await loadNodeModules();
		return new Promise((resolve) => {
			const child = execFile(
				command,
				args,
				{
					cwd: options.cwd,
					env: options.env,
					maxBuffer: 20 * 1024 * 1024,
					// Without this, a hung child (dropped connection, a stuck
					// auth prompt, anything that never exits) leaves this
					// promise pending forever - which for the inbox/wiki runs
					// means cliRunInProgress's `finally` never fires either,
					// silently jamming every future automatic and manual
					// "process inbox" for the rest of the session.
					timeout: options.timeoutMs,
					killSignal: "SIGTERM",
				},
				(error, stdout, stderr) => {
					const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
					resolve({ code, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
				}
			);
			// claude waits on open stdin before proceeding - close it
			// immediately since nothing is ever piped in.
			child.stdin?.end();
		});
	};

	// Obsidian has no public API for this, but the internal one is stable and
	// widely used: jump straight to this plugin's settings tab. New users
	// consistently struggle to find Settings -> Community plugins -> Nous, so
	// every instruction that names that path also offers this jump.
	openNousSettings(): void {
		const setting = (this.app as unknown as {
			setting?: { open: () => void; openTabById: (id: string) => void };
		}).setting;
		if (!setting) return;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	// A notice whose last line is a clickable "Open Nous settings" link.
	settingsNotice(message: string, timeoutMs = 10000): void {
		const fragment = createFragment((el) => {
			const line = el.createDiv();
			appendNousNoticeIcon(line);
			line.createSpan({ text: message });
			const link = el.createEl("a", { text: "Open Nous settings" });
			link.addEventListener("click", () => this.openNousSettings());
		});
		new Notice(fragment, timeoutMs).noticeEl.addClass("nous-notice");
	}

	private getVaultBasePath(): string | null {
		return this.app.vault.adapter instanceof FileSystemAdapter
			? this.app.vault.adapter.getBasePath()
			: null;
	}

	// The same "bail with a notice" guard three CLI-mode entry points each
	// wrote out by hand (processInboxViaCli, runWikiBuilderCli,
	// runVaultQuery) - one definition instead of three copies of the exact
	// same message that could drift if only one ever got edited.
	private requireVaultBasePath(): string | null {
		const basePath = this.getVaultBasePath();
		if (!basePath) nousNotice("Couldn't find your vault's file path.", 10000);
		return basePath;
	}

	// Named allowlist rather than spreading all of process.env - the CLI only
	// needs PATH/HOME/USER to resolve and locale/auth vars to behave normally,
	// and forwarding the whole parent environment into a spawned process
	// needlessly exposes things like HOSTNAME to it. USER/LOGNAME are kept
	// (unlike HOSTNAME) because `claude`'s Keychain-based auth lookup fails
	// with "Not logged in" if the invoking process's USER is missing.
	private cliEnv(): Record<string, string> {
		const home = process.env.HOME ?? "";
		const env: Record<string, string> = { HOME: home };
		for (const key of ["USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR", "SHELL"]) {
			const value = process.env[key];
			if (value) env[key] = value;
		}
		for (const [key, value] of Object.entries(process.env)) {
			if (value && (key.startsWith("ANTHROPIC_") || key.startsWith("CLAUDE_"))) env[key] = value;
		}
		env.PATH = augmentedPath(process.env.PATH ?? "", home, null);
		return env;
	}

	private async ensureFolderExists(dirPath: string) {
		if (!(await this.app.vault.adapter.exists(dirPath))) {
			await this.app.vault.adapter.mkdir(dirPath);
		}
	}

	// `force` rewrites the skill files even on the same version - used when a
	// setting they interpolate (the owner's name) changes.
	async ensureSkillsInstalled(force = false) {
		const folders: SkillFolders = {
			inbox: this.settings.inboxFolder,
			meetings: this.settings.meetingsFolder,
			wikis: this.settings.wikisFolder,
			tags: this.settings.tagsFolder,
			owner: this.settings.ownerName,
		};
		// Regenerate on every version bump, not just when a file is missing -
		// otherwise an installed SKILL.md silently drifts from what the
		// current plugin source actually produces (e.g. it kept referencing
		// the old .cortex/pipeline.log path for two weeks after the plugin
		// itself was renamed to Nous).
		const stale = force || this.settings.skillsVersion !== this.manifest.version;
		await this.writeSkill(".claude/skills/meeting-enricher/SKILL.md", meetingEnricherSkill(folders), stale);
		await this.writeSkill(".claude/skills/wiki-builder/SKILL.md", wikiBuilderSkill(folders), stale);
		await this.writeSkill(".claude/skills/vault-query/SKILL.md", vaultQuerySkill(folders), stale);
		if (stale) {
			this.settings.skillsVersion = this.manifest.version;
			await this.saveSettings();
		}
	}

	private async writeSkill(path: string, content: string, forceRewrite: boolean) {
		if (!forceRewrite && (await this.app.vault.adapter.exists(path))) return;
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

	// Not private: LiveVoiceCaptureModal logs live-transcription failures
	// here too, same ERROR-line convention as the rest of the pipeline.
	async appendLog(message: string) {
		const line = `${new Date().toISOString()} ${message}\n`;
		if (!(await this.app.vault.adapter.exists(LOG_FOLDER))) {
			await this.app.vault.createFolder(LOG_FOLDER);
		}
		if (await this.app.vault.adapter.exists(LOG_FILE)) {
			const existing = await this.app.vault.adapter.read(LOG_FILE);
			const lines = existing.split("\n").filter((l) => l.length > 0);
			lines.push(line.trimEnd());
			// Trim from the front once over the cap, rather than letting a
			// personal-vault log file grow without bound forever.
			const kept = lines.length > LOG_MAX_LINES ? lines.slice(-LOG_MAX_LINES) : lines;
			await this.app.vault.adapter.write(LOG_FILE, kept.join("\n") + "\n");
		} else {
			await this.app.vault.adapter.write(LOG_FILE, line);
		}
	}

	// CLI mode's meeting-enricher/wiki-builder skills append to the log
	// directly via Bash, per src/skillTemplates.ts's instructions - entirely
	// outside appendLog() above, so its cap alone can't bound a vault that's
	// mostly used in CLI mode. Called once before each CLI run instead.
	private async trimLogIfNeeded(): Promise<void> {
		if (!(await this.app.vault.adapter.exists(LOG_FILE))) return;
		const existing = await this.app.vault.adapter.read(LOG_FILE);
		const lines = existing.split("\n").filter((l) => l.length > 0);
		if (lines.length <= LOG_MAX_LINES) return;
		await this.app.vault.adapter.write(LOG_FILE, lines.slice(-LOG_MAX_LINES).join("\n") + "\n");
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

	// One-time migration for notes written before the collapsed-transcript
	// change. Bulk-rewrites real vault files, so nothing is written until the
	// user confirms via ConfirmTranscriptMigrationModal.
	async convertLegacyTranscripts() {
		const meetingsFolder = this.app.vault.getFolderByPath(this.settings.meetingsFolder);
		const noteFiles = meetingsFolder
			? meetingsFolder.children.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
			: [];

		const candidates: { file: TFile; content: string }[] = [];
		for (const file of noteFiles) {
			const content = await this.app.vault.read(file);
			const converted = logic.convertLegacyTranscriptToCallout(content);
			if (converted !== null) candidates.push({ file, content: converted });
		}

		if (candidates.length === 0) {
			nousNotice("All caught up - no old transcripts left to convert.");
			return;
		}

		new ConfirmTranscriptMigrationModal(this.app, candidates.length, async () => {
			for (const { file, content } of candidates) {
				await this.app.vault.modify(file, content);
			}
			await this.appendLog(`MIGRATED: ${candidates.length} notes converted to collapsed transcript format`);
			nousNotice(
				`${candidates.length} note${candidates.length === 1 ? "" : "s"} converted to collapsed transcript format.`
			);
		}).open();
	}

	private async createTagFileIfMissing(tagName: string) {
		// tagName is model-generated (Step 3's "new tag" path, API mode) -
		// unlike every other filename builder here, this one skipped
		// sanitizeFilename, so a stray "/" in a model's tag name (e.g.
		// "finance/budgeting" instead of kebab-case) would silently create a
		// nested path instead of a flat tag file, corrupting the tag
		// registry's flat-file assumption.
		const path = `${this.settings.tagsFolder}/${logic.sanitizeFilename(tagName)}.md`;
		if (await this.app.vault.adapter.exists(path)) return;
		const today = new Date().toISOString().slice(0, 10);
		await this.app.vault.create(path, logic.buildTagFileContent(tagName, today));
	}

	async ensureCoreFolders() {
		const s = this.settings;
		for (const folder of [s.inboxFolder, s.meetingsFolder, s.tagsFolder, s.wikisFolder]) {
			await this.ensureFolderExists(folder);
		}
		await this.createWikisPlaceholder();
	}

	// 30-Wikis stays empty until a tag clears wikiThreshold, which reads as
	// broken to a new user. This note explains the wait; it carries no
	// frontmatter, so wiki-lookup code (which matches on frontmatter.topic)
	// never picks it up.
	async createWikisPlaceholder() {
		const path = `${this.settings.wikisFolder}/About this folder.md`;
		if (await this.app.vault.adapter.exists(path)) return;
		await this.app.vault.create(
			path,
			`This folder is empty on purpose.\n\nA wiki appears here once a topic in "${this.settings.tagsFolder}" has at least ${this.settings.wikiThreshold} notes. Until then, keep capturing - nothing is broken.\n`
		);
	}

	// A believable first capture for the wizard's "watch it happen" moment.
	async createSampleNote() {
		const path = `${this.settings.inboxFolder}/Try me.md`;
		if (await this.app.vault.adapter.exists(path)) return;
		await this.app.vault.create(
			path,
			"Quick thought after today's kickoff with the new client: they want the reporting dashboard live before the end of next quarter, but their data quality is a mess - half the customer records are missing regions. Maria offered to run a cleanup sprint first. I should sketch the dashboard wireframe this week and check whether we can reuse the ETL setup from the last project.\n"
		);
		nousNotice("Dropped a sample note in your inbox - watch it come to life.");
	}

	// Lets a desktop user pick their unzipped Notion "Markdown & CSV" export
	// with a native folder dialog - no need to drag it into the vault first,
	// Nous reads straight off disk. Returns null if the user cancelled.
	async pickNotionExportFolder(): Promise<string | null> {
		const dialog = await loadElectronRemoteDialog();
		const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0];
	}

	// Reads every .md file under a folder on disk (the unzipped Notion
	// export) and copies each one into the inbox with Notion's ID suffix
	// stripped from the title. Deliberately does no Notion-specific parsing
	// beyond that - the text lands in the inbox exactly like any other
	// capture, so the normal enrichment pipeline tags and structures it.
	// Page links and images referencing other exported files are not
	// rewritten, so those won't resolve after import.
	async importFromNotion(sourceFolderPath: string): Promise<{ imported: number; skipped: number }> {
		const { fs, path } = await loadNodeModules();

		await this.ensureFolderExists(this.settings.inboxFolder);

		const filePaths: string[] = [];
		const collect = async (dir: string) => {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) await collect(full);
				else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) filePaths.push(full);
			}
		};
		await collect(sourceFolderPath);

		this.notionImportInProgress = true;
		let imported = 0;
		let skipped = 0;
		try {
			for (const filePath of filePaths) {
				const basename = path.basename(filePath, path.extname(filePath));
				const title = logic.sanitizeFilename(logic.stripNotionIdSuffix(basename));
				const destPath = await this.uniqueInboxPath(title);
				if (!destPath) {
					skipped++;
					continue;
				}
				const content = await fs.readFile(filePath, "utf8");
				await this.app.vault.create(destPath, content);
				imported++;
			}
		} finally {
			this.notionImportInProgress = false;
		}

		// Mid-wizard (not yet onboarded), a provider may not be connected -
		// finish() runs processInbox() itself once setup completes. Already
		// set up, run it now so the import doesn't sit there unprocessed.
		if (imported > 0 && this.settings.onboarded) {
			void this.processInbox();
		}

		return { imported, skipped };
	}

	// Notion re-exports the same workspace with fresh IDs each time, so a
	// second import of an already-imported page would otherwise silently
	// duplicate it - skip (not overwrite) anything already sitting in the
	// inbox under that title.
	private async uniqueInboxPath(title: string): Promise<string | null> {
		const path = `${this.settings.inboxFolder}/${title}.md`;
		if (!(await this.app.vault.adapter.exists(path))) return path;
		return null;
	}

	// Drops a #win-tagged capture skeleton in the inbox and opens it for
	// editing - meeting-enricher (Step 3.5) picks it up on the next pass and
	// does the actual structured-field extraction, same as any other capture.
	async logWin() {
		await this.ensureCoreFolders();
		const date = new Date().toISOString().slice(0, 10);
		let path = `${this.settings.inboxFolder}/${date} Win.md`;
		let suffix = 2;
		while (await this.app.vault.adapter.exists(path)) {
			path = `${this.settings.inboxFolder}/${date} Win ${suffix}.md`;
			suffix++;
		}
		const file = await this.app.vault.create(
			path,
			"#win\n\nWhat did you ship or achieve?\n\nCategory: client work, training, internship, internal tool, open source, writing, certification, event, or other\n"
		);
		await this.app.workspace.getLeaf(true).openFile(file);
	}

	// Hands-free voice capture: one command toggles recording, no UI. The
	// finished recording lands in the inbox and flows through the normal
	// audio pipeline (transcribe -> enrich).
	async toggleVoiceCapture() {
		if (this.liveCaptureModal) {
			void this.liveCaptureModal.stopAndClose();
			return;
		}
		// Beta live-transcription path (opt-in, desktop-only, needs an
		// OpenAI key - see canUseLiveTranscription()): a modal owns its own
		// getUserMedia/MediaRecorder lifecycle, so the headless path below
		// is untouched and remains the fallback for everyone else.
		if (this.canUseLiveTranscription()) {
			this.liveCaptureModal = new LiveVoiceCaptureModal(this.app, this);
			this.liveCaptureModal.open();
			return;
		}
		if (this.voiceRecorder?.state === "recording") {
			this.voiceRecorder.stop();
			return;
		}
		if (this.voiceCaptureStarting) return;
		this.voiceCaptureStarting = true;
		try {
			if (!(await this.hasAudioTranscriptionBackend())) {
				new VoiceCaptureSetupModal(this.app, this).open();
				return;
			}
			try {
				this.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			} catch {
				nousNotice("Can't hear you - allow microphone access for Obsidian in System Settings.", 8000);
				return;
			}
			const mimeType = pickVoiceMimeType();
			const recorder = mimeType ? new MediaRecorder(this.voiceStream, { mimeType }) : new MediaRecorder(this.voiceStream);
			const chunks: Blob[] = [];
			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunks.push(e.data);
			};
			recorder.onstop = () => {
				this.voiceStream?.getTracks().forEach((t) => t.stop());
				this.voiceStream = null;
				this.voiceRecorder = null;
				this.setVoiceRecordingIndicator(false);
				void this.saveVoiceRecording(recorder.mimeType || "audio/webm", chunks);
			};
			recorder.start();
			this.voiceRecorder = recorder;
			this.setVoiceRecordingIndicator(true);
			nousNotice("🔴 Recording - tap again when you're done.", 4000);
		} finally {
			this.voiceCaptureStarting = false;
		}
	}

	// Only true when both fallback conditions are satisfied: opt-in toggle,
	// and an OpenAI key (Realtime API only, reuses apiKeys.openai). Any
	// false here means the ribbon falls straight through to the unchanged
	// headless path above.
	private canUseLiveTranscription(): boolean {
		return this.settings.liveTranscriptionEnabled && !!this.settings.apiKeys.openai;
	}

	// Shared by the headless recorder above and LiveVoiceCaptureModal below,
	// so both produce an identical saved file. `transcript`, when present
	// (live transcription succeeded), is recorded into liveTranscripts right
	// after createBinary so processFile()/transcribeInboxAudioForCli() can
	// skip the batch transcribeAudio() call for this file.
	async saveVoiceRecording(mime: string, chunks: Blob[], transcript?: string): Promise<void> {
		const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
		const buffer = await new Blob(chunks, { type: mime }).arrayBuffer();
		await this.ensureFolderExists(this.settings.inboxFolder);
		const stamp = window.moment().format("YYYY-MM-DD HH.mm.ss");
		const path = `${this.settings.inboxFolder}/${stamp} Voice note.${ext}`;
		await this.app.vault.createBinary(path, buffer);
		if (transcript?.trim()) this.liveTranscripts.set(path, transcript.trim());
		if (!this.settings.autoProcessOnCreate) void this.processInbox();
	}

	// Rebuilds a status-bar item as icon + label, matching warm-paper spec
	// §3's status-bar states (11px mono, small-caps via CSS). Doesn't touch
	// visibility - callers show()/hide() themselves, since "idle" for both
	// voice and meeting capture stays hidden rather than a permanently-
	// visible nous-clip glyph: two rarely-toggled indicators sitting in the
	// status bar at all times read as clutter for every user, not quiet
	// branding, so idle keeping today's hidden-when-inactive behavior is a
	// deliberate deviation from the spec's literal "always show idle" call.
	private renderStatusBarState(
		el: HTMLElement,
		icon: string,
		label: string,
		opts: { pulse?: boolean; spin?: boolean } = {}
	): void {
		el.empty();
		el.addClass("nous-status-bar-item");
		const iconEl = el.createSpan({ cls: "nous-status-bar-icon" });
		setIcon(iconEl, icon);
		iconEl.toggleClass("nous-status-pulse-dot", !!opts.pulse);
		iconEl.toggleClass("nous-status-spin", !!opts.spin);
		el.createSpan({ cls: "nous-status-bar-label", text: label });
	}

	// Recording previously had no persistent signal once the start Notice
	// faded - swap the ribbon icon and show a status-bar item for as long as
	// the mic is actually live. Also used by LiveVoiceCaptureModal, so it's
	// not private.
	setVoiceRecordingIndicator(recording: boolean) {
		if (this.voiceRibbonEl) {
			setIcon(this.voiceRibbonEl, recording ? "circle-stop" : "mic");
			this.voiceRibbonEl.toggleClass("nous-recording", recording);
			this.voiceRibbonEl.setAttribute(
				"aria-label",
				recording ? "recording - click to stop" : "toggle voice capture"
			);
		}
		if (this.voiceRecordingTimer !== null) {
			window.clearInterval(this.voiceRecordingTimer);
			this.voiceRecordingTimer = null;
		}
		if (this.voiceStatusBarEl) {
			if (recording) {
				this.startRecordingElapsedTimer(this.voiceStatusBarEl, (id) => {
					this.voiceRecordingTimer = id;
				});
				this.voiceStatusBarEl.show();
			} else {
				this.voiceStatusBarEl.hide();
			}
		}
	}

	// Shared by both indicators - the only differences between voice and
	// meeting recording were the ribbon icon/label and the hide condition,
	// both handled by the callers already, so this is just the elapsed-time
	// tick both used to duplicate.
	private startRecordingElapsedTimer(statusBarEl: HTMLElement, setTimer: (id: number) => void) {
		const startedAt = Date.now();
		const tick = () => {
			const elapsed = Math.floor((Date.now() - startedAt) / 1000);
			this.renderStatusBarState(statusBarEl, "nous-recording", logic.formatRecordingElapsed(elapsed), {
				pulse: true,
			});
		};
		tick();
		setTimer(window.setInterval(tick, 1000));
	}

	// One button for full meeting capture (both sides of a call). Obsidian's
	// own mic access (toggleVoiceCapture above) can never hear the other
	// participant, so macOS meeting capture uses the native nous-recorder
	// helper directly.
	async toggleMeetingCapture() {
		if (!Platform.isMacOS) {
			nousNotice("Meeting capture only works on macOS, sorry.");
			return;
		}
		if (this.meetingToggleInProgress) return;
		this.meetingToggleInProgress = true;
		try {
			const nativeStatus = await this.nativeRecorderStatus();
			if (nativeStatus.available) {
				await this.toggleNativeMeetingCapture(nativeStatus);
				return;
			}

			this.settingsNotice(MEETING_RECORDER_MISSING_NOTICE, 15000);
		} finally {
			this.meetingToggleInProgress = false;
		}
	}

	private async toggleNativeMeetingCapture(status: NativeRecorderStatus) {
		if (status.recording) {
			const liveNote = await this.findActiveNativeMeetingNote(status.output);
			const result = await this.runNativeRecorder("stop");
			if (result.code !== 0) {
				await this.appendLog(`ERROR: native recorder failed to stop: ${cliErrorDetail(result)}`);
				nousNotice("Recorder wouldn't stop - more in your Nous log", 10000);
				return;
			}
			const stopped = parseNativeRecorderStatus(result.stdout);
			const recordingDir = stopped.output ?? status.output;
			this.setMeetingRecordingIndicator(false);
			this.activeNativeMeetingNotePath = null;
			await this.clearActiveLiveRecording();
			if (recordingDir) {
				this.setMeetingTranscribingIndicator(true);
				void this.ingestNativeMeetingRecording(recordingDir, liveNote?.path ?? null);
			} else if (liveNote) {
				void this.markLiveNativeMeetingNoteProblem(
					liveNote,
					"Nous could not find the saved audio folder when the recorder stopped."
				);
			}
			return;
		}

		const result = await this.runNativeRecorder("start");
		if (result.code !== 0) {
			const detail = cliErrorDetail(result);
			this.nativeRecorderLastProblem = detail || "The helper could not start.";
			await this.appendLog(`ERROR: native recorder failed to start: ${detail}`);
			nousNotice("Recorder wouldn't start - more in your Nous log", 10000);
			return;
		}
		await new Promise((resolve) => window.setTimeout(resolve, 1500));
		const next = await this.nativeRecorderStatus();
		if (!next.available || !next.recording) {
			this.setMeetingRecordingIndicator(false);
			const detail = await this.nativeRecorderLogTail();
			this.nativeRecorderLastProblem = `Allow microphone and screen/audio recording permissions in macOS Privacy & Security, then try again.${detail ? ` Details: ${detail}` : ""}`;
			if (detail) await this.appendLog(`ERROR: native recorder stopped immediately: ${detail}`);
			nousNotice(
				"Recording stopped right away - allow microphone and screen recording in privacy & security, then try again.",
				12000
			);
			return;
		}
		this.nativeRecorderLastProblem = null;
		this.setMeetingRecordingIndicator(true);
		if (!this.settings.discreetRecording) {
			nousNotice("🔴 Recording this meeting - tap again when you're done.", 4000);
		}
		try {
			this.activeNativeMeetingNotePath = await this.createLiveNativeMeetingNote(next.output);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await this.appendLog(`ERROR: could not create live meeting note: ${msg}`);
			nousNotice("Recording started, but I couldn't open your live note.", 10000);
		}
	}

	private async nativeRecorderStatus(): Promise<NativeRecorderStatus & { available: boolean }> {
		if (!Platform.isMacOS) return { available: false, recording: false, output: null };
		const result = await this.runNativeRecorder("status");
		if (result.code !== 0) return { available: false, recording: false, output: null };
		return { available: true, ...parseNativeRecorderStatus(result.stdout) };
	}

	private async runNativeRecorder(command: "status" | "start" | "stop") {
		const { os } = await loadNodeModules();
		const recordingsDir = await this.nativeRecorderWatchDir();
		const recorder = await this.nativeRecorderCommand();
		return this.cliExec(recorder, nativeRecorderArgs(command, recordingsDir), {
			cwd: os.homedir(),
			env: this.cliEnv(),
			timeoutMs: QUICK_CLI_TIMEOUT_MS,
		});
	}

	private async nativeRecorderCommand(): Promise<string> {
		const managed = await this.managedNativeRecorderPath();
		if (managed && (await NousPlugin.fileExists(managed))) return managed;

		// Resolve the bare name to an absolute path ourselves rather than
		// leaving it to PATH lookup: the helper re-spawns itself from argv[0],
		// and a bare argv[0] resolves against the working directory instead of
		// the real install location ("The file "nous-recorder" doesn't exist",
		// NSFilePath=$HOME/nous-recorder). Same directory order as
		// augmentedPath(), and only an executable file counts, so this picks
		// the same binary a shell PATH lookup would.
		const { fs, fsConstants } = await loadNodeModules();
		const home = process.env.HOME ?? "";
		for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`]) {
			const candidate = `${dir}/${DEFAULT_NATIVE_RECORDER_BIN}`;
			const executable = await fs
				.access(candidate, fsConstants.X_OK)
				.then(() => true)
				.catch(() => false);
			if (executable) return candidate;
		}
		return DEFAULT_NATIVE_RECORDER_BIN;
	}

	private async managedNativeRecorderPath(): Promise<string | null> {
		const basePath = this.getVaultBasePath();
		if (!basePath) return null;
		const { path } = await loadNodeModules();
		const pluginDir = this.manifest.dir ?? path.join(this.app.vault.configDir, "plugins", this.manifest.id);
		return path.join(basePath, pluginDir, "bin", DEFAULT_NATIVE_RECORDER_BIN);
	}

	async installNativeRecorderFromRelease(): Promise<string> {
		if (!Platform.isMacOS) throw new Error("Native meeting capture is macOS-only.");
		const target = await this.managedNativeRecorderPath();
		if (!target) throw new Error("Could not resolve this vault's plugin directory.");

		let assetUrl = nativeRecorderReleaseAssetUrl(this.manifest.version);
		let checksumResponse = await requestUrl({ url: `${assetUrl}.sha256`, method: "GET", throw: false });
		if (checksumResponse.status >= 400) {
			// This plugin version's release has no recorder asset - fall back
			// to the newest release, which CI always builds one for.
			assetUrl = nativeRecorderLatestAssetUrl();
			checksumResponse = await requestUrl({ url: `${assetUrl}.sha256`, method: "GET", throw: false });
		}
		if (checksumResponse.status >= 400) {
			throw new Error(`could not download checksum (${checksumResponse.status})`);
		}
		const expectedChecksum = parseNativeRecorderChecksum(checksumResponse.text);
		if (!expectedChecksum) throw new Error("release checksum was missing or malformed");

		const assetResponse = await requestUrl({ url: assetUrl, method: "GET", throw: false });
		if (assetResponse.status >= 400) {
			throw new Error(`could not download helper (${assetResponse.status})`);
		}
		const actualChecksum = await this.sha256Hex(assetResponse.arrayBuffer);
		if (actualChecksum !== expectedChecksum) {
			throw new Error("downloaded helper checksum did not match the release checksum");
		}

		const { fs, path } = await loadNodeModules();
		const dir = path.dirname(target);
		const tmp = `${target}.tmp-${Date.now().toString(36)}`;
		await fs.mkdir(dir, { recursive: true });
		try {
			await fs.writeFile(tmp, Buffer.from(assetResponse.arrayBuffer));
			await fs.chmod(tmp, 0o755);
			await fs.rename(tmp, target);
		} catch (e) {
			await fs.unlink(tmp).catch(() => {});
			throw e;
		}
		await this.clearMacQuarantine(target);
		const check = await this.cliExec(target, ["version"], { cwd: path.dirname(target), env: this.cliEnv() });
		if (check.code !== 0) {
			throw new Error(`installed helper could not run: ${cliErrorDetail(check)}`);
		}

		this.nativeRecorderLastProblem = null;
		return target;
	}

	// Themes aren't installed like plugins (no release/checksum step) -
	// Obsidian's own theme browser fetches theme.css/manifest.json straight
	// from a repo's default branch, so this mirrors that exact mechanism
	// rather than inventing a different one. cssTheme in appearance.json is
	// the standard, documented, persisted preference (a restart always
	// picks it up); customCss.setTheme() below is the same *undocumented*
	// internal API Obsidian's own Appearance tab calls to apply a theme
	// live without one - best-effort, wrapped so a failure there still
	// leaves the theme correctly installed and selected for next launch.
	async installWarmPaperTheme(): Promise<void> {
		const themeName = "Warm Paper";
		const rawBase = "https://raw.githubusercontent.com/AndyMDH/warm-paper/main";
		const [cssRes, manifestRes] = await Promise.all([
			requestUrl({ url: `${rawBase}/theme.css`, method: "GET", throw: false }),
			requestUrl({ url: `${rawBase}/manifest.json`, method: "GET", throw: false }),
		]);
		if (cssRes.status >= 400) throw new Error(`could not download theme.css (${cssRes.status})`);
		if (manifestRes.status >= 400) throw new Error(`could not download manifest.json (${manifestRes.status})`);

		const adapter = this.app.vault.adapter;
		const themeDir = `${this.app.vault.configDir}/themes/${themeName}`;
		if (!(await adapter.exists(themeDir))) await adapter.mkdir(themeDir);
		await adapter.write(`${themeDir}/theme.css`, cssRes.text);
		await adapter.write(`${themeDir}/manifest.json`, manifestRes.text);

		const appearancePath = `${this.app.vault.configDir}/appearance.json`;
		let appearance: { cssTheme?: string } = {};
		try {
			appearance = JSON.parse(await adapter.read(appearancePath)) as { cssTheme?: string };
		} catch {
			// Missing or malformed - start fresh.
		}
		appearance.cssTheme = themeName;
		await adapter.write(appearancePath, JSON.stringify(appearance, null, 2));

		try {
			(this.app as unknown as { customCss?: { setTheme: (name: string) => void } }).customCss?.setTheme(
				themeName
			);
		} catch {
			// Installed and selected either way - just needs a reload/restart
			// to actually render if this internal call doesn't work.
		}
	}

	private async clearMacQuarantine(filePath: string): Promise<void> {
		if (!Platform.isMacOS) return;
		const { os } = await loadNodeModules();
		await this.cliExec("xattr", ["-d", "com.apple.quarantine", filePath], {
			cwd: os.homedir(),
			env: this.cliEnv(),
		});
	}

	private async sha256Hex(buffer: ArrayBuffer): Promise<string> {
		const { crypto } = await loadNodeModules();
		return crypto.createHash("sha256").update(Buffer.from(buffer)).digest("hex");
	}

	private async nativeRecorderWatchDir(): Promise<string> {
		const { os, path } = await loadNodeModules();
		return path.join(os.homedir(), "Movies", "NousRecordings");
	}

	private async nativeRecorderLogTail(): Promise<string> {
		const { fs, path } = await loadNodeModules();
		const logPath = path.join(await this.nativeRecorderWatchDir(), ".nous-recorder.log");
		try {
			const raw = await fs.readFile(logPath, "utf8");
			return raw
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
				.slice(-3)
				.join(" ")
				.slice(0, 300);
		} catch {
			return "";
		}
	}

	private async ingestNativeMeetingRecording(recordingDir: string, liveNotePath: string | null = null): Promise<void> {
		const { path } = await loadNodeModules();
		let liveFile: TFile | null = null;
		let manualNotes = "";
		try {
			liveFile = liveNotePath ? this.app.vault.getFileByPath(liveNotePath) : null;
			const liveContent = liveFile ? await this.app.vault.read(liveFile) : "";
			manualNotes = liveContent ? extractNativeRecordingManualNotes(liveContent) : "";

			if (!(await this.hasAudioTranscriptionBackend())) {
				await this.createPendingNativeMeetingRecording(recordingDir, liveFile, manualNotes);
				return;
			}

			const transcript = await this.transcribeNativeMeetingRecording(recordingDir);
			if (!transcript) {
				if (liveFile) {
					await this.markLiveNativeMeetingNoteProblem(
						liveFile,
						"Nous saved the meeting audio, but it did not produce a transcript."
					);
				} else {
					nousNotice("Didn't catch any speech, so no note was made.", 8000);
				}
				await this.archiveNativeRecording(recordingDir);
				return;
			}

			await this.ensureFolderExists(this.settings.inboxFolder);
			const content = buildCompletedNativeRecordingNote(transcript.stamp, transcript.transcript, manualNotes);
			const notePath = await this.writeNativeMeetingNote(
				liveFile,
				content,
				`${transcript.stamp} Meeting transcript.md`
			);
			await this.appendLog(`TRANSCRIBED: ${path.basename(recordingDir)} -> ${notePath}`);
			await this.archiveNativeRecording(recordingDir);
			if (liveFile || !this.settings.autoProcessOnCreate) void this.processInbox();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (liveFile) {
				await this.markLiveNativeMeetingNoteProblem(
					liveFile,
					`Transcription failed: ${msg}`,
					manualNotes
				).catch(async (problemError) => {
					const problemMsg = problemError instanceof Error ? problemError.message : String(problemError);
					await this.appendLog(`ERROR: could not recover live meeting note after transcription failure: ${problemMsg}`);
				});
			}
			nousNotice("Transcription hit a snag - don't worry, your notes and audio are safe. More in your Nous log", 10000);
			await this.appendLog(`ERROR: native recording transcription failed: ${msg}`);
		} finally {
			this.setMeetingTranscribingIndicator(false);
		}
	}

	// A handled recording must leave the watch directory - the nudge script
	// treats a lingering .qma as "never ingested". The audio is kept in
	// Processed/ for 30 days in case a transcript needs a re-listen, then
	// purged. Errors here are logged, never fatal: the note already exists.
	private async archiveNativeRecording(recordingDir: string): Promise<void> {
		try {
			const { fs, path } = await loadNodeModules();
			const processedDir = path.join(path.dirname(recordingDir), "Processed");
			await fs.mkdir(processedDir, { recursive: true });
			await fs.rename(recordingDir, path.join(processedDir, path.basename(recordingDir)));

			const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
			for (const entry of await fs.readdir(processedDir)) {
				const entryPath = path.join(processedDir, entry);
				const stat = await fs.stat(entryPath).catch(() => null);
				if (stat && stat.mtimeMs < cutoff) {
					await fs.rm(entryPath, { recursive: true, force: true });
				}
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await this.appendLog(`WARN: could not archive recording ${recordingDir}: ${msg}`);
		}
	}

	private async transcribeNativeMeetingRecording(
		recordingDir: string
	): Promise<{ stamp: string; transcript: string } | null> {
		const { fs, path } = await loadNodeModules();

		// A track that fails to transcribe (muted mic on a webinar, one
		// corrupt file) must not cost the meeting - transcribe each track
		// independently and let interleaveMeetingTracks work with whatever
		// survived. Only fail the recording when BOTH tracks failed.
		const transcribeTrack = async (filePath: string, filename: string): Promise<TrackTranscript | null> => {
			const exists = await fs
				.access(filePath)
				.then(() => true)
				.catch(() => false);
			if (!exists) return null;
			try {
				return await this.transcribeExternalAudioWithSegments(filePath, filename);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				await this.appendLog(`WARN: ${path.basename(recordingDir)} ${filename} could not be transcribed: ${msg}`);
				return null;
			}
		};

		const sysTrack = await transcribeTrack(path.join(recordingDir, "sys.m4a"), "sys.m4a");
		const micTrack = await transcribeTrack(path.join(recordingDir, "mic.m4a"), "mic.m4a");

		// Each m4a's timeline starts at its own first buffer; timing.json (from
		// the native helper) says when each track actually began, so late mic
		// starts don't skew the interleave. Absent for older recordings.
		const timingRaw = await fs.readFile(path.join(recordingDir, "timing.json"), "utf8").catch(() => null);
		const deltas = trackStartDeltasMs(timingRaw);
		const transcript = interleaveMeetingTracks(
			shiftTrackSegments(sysTrack, deltas.sys),
			shiftTrackSegments(micTrack, deltas.mic)
		);
		if (!transcript) {
			await this.appendLog(`SKIPPED: ${path.basename(recordingDir)} produced no transcript`);
			return null;
		}

		return {
			stamp: this.meetingStampFromRecordingDir(recordingDir),
			transcript,
		};
	}

	private async createPendingNativeMeetingRecording(
		recordingDir: string,
		liveFile: TFile | null = null,
		manualNotes = ""
	): Promise<void> {
		const { path } = await loadNodeModules();
		await this.ensureFolderExists(this.settings.inboxFolder);
		const stamp = this.meetingStampFromRecordingDir(recordingDir);
		const content = buildPendingNativeRecordingNote(recordingDir, stamp, manualNotes);
		const notePath = await this.writeNativeMeetingNote(
			liveFile,
			content,
			`${stamp} Meeting recording needs transcription.md`
		);
		await this.appendLog(`PENDING: ${path.basename(recordingDir)} needs speech-to-text setup -> ${notePath}`);
		nousNotice(
			"Recording saved! Set up speech-to-text later, then run 'Nous: Process inbox now' to finish it off.",
			12000
		);
	}

	// Shared by both the completed and pending native-recording notes: a live
	// note open for questions during the recording becomes the note itself
	// (in place), otherwise a fresh file is created in the inbox.
	private async writeNativeMeetingNote(liveFile: TFile | null, content: string, fallbackFilename: string): Promise<string> {
		if (liveFile) {
			await this.app.vault.modify(liveFile, content);
			return liveFile.path;
		}
		const notePath = await this.uniqueVaultPath(`${this.settings.inboxFolder}/${fallbackFilename}`);
		await this.app.vault.create(notePath, content);
		return notePath;
	}

	private async markLiveNativeMeetingNoteProblem(
		liveFile: TFile,
		problem: string,
		knownManualNotes?: string
	): Promise<void> {
		// Callers only ever pass a live note they resolved themselves (by
		// settings path, or the legacy inbox scan), so there is no marker check
		// here - by the time recovery calls this the settings entry is already
		// cleared, and a fresh live note has nothing else to recognize it by.
		const content = await this.app.vault.read(liveFile);
		const legacy = parseLiveNativeRecordingNote(content);
		const active = this.settings.activeLiveRecording;
		// Start time: settings first (live notes carry no frontmatter), legacy
		// frontmatter next, the filename's stamp as the last resort.
		const recordedAt =
			(active?.path === liveFile.path ? active.recordedAt : null) ??
			legacy?.recordedAt ??
			this.meetingStampFromRecordingDir(liveFile.basename);
		const manualNotes = knownManualNotes ?? extractNativeRecordingManualNotes(content);
		await this.app.vault.modify(liveFile, buildNativeRecordingProblemNote(recordedAt, problem, manualNotes));
		await this.appendLog(`RECOVERED: live native meeting note kept without transcript -> ${liveFile.path}`);
		nousNotice("No transcript this time, but your live notes are safe in the inbox.", 10000);
		if (hasMeaningfulNativeRecordingManualNotes(manualNotes)) void this.processInbox();
	}

	private async transcribeExternalAudioWithSegments(filePath: string, filename: string): Promise<TrackTranscript> {
		const local = await this.transcribeFileLocallyWithSegments(filePath);
		if (local) return local;

		const { fs } = await loadNodeModules();
		const bytes = await fs.readFile(filePath);
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		return this.transcribeAudioWithSegments("m4a", copy.buffer, filename);
	}

	private meetingStampFromRecordingDir(recordingDir: string): string {
		const base = recordingDir.split(/[\\/]/).pop() ?? "";
		const match = base.match(/^(\d{4}-\d{2}-\d{2} \d{2}\.\d{2})/);
		return match ? match[1] : window.moment().format("YYYY-MM-DD HH.mm");
	}

	private async createLiveNativeMeetingNote(recordingDir: string | null): Promise<string> {
		await this.ensureFolderExists(this.settings.inboxFolder);
		const stamp = recordingDir ? this.meetingStampFromRecordingDir(recordingDir) : window.moment().format("YYYY-MM-DD HH.mm");
		const discreet = this.settings.discreetRecording;
		const notePath = await this.uniqueVaultPath(
			`${this.settings.inboxFolder}/${stamp} ${discreet ? "Notes" : "Meeting live note"}.md`
		);
		// Record the live note BEFORE creating it: the on-create auto-process
		// hook fires immediately, and processFile() must already know this
		// path is the live note so it does not enrich it mid-meeting.
		this.settings.activeLiveRecording = { path: notePath, recordingDir, recordedAt: stamp };
		await this.saveSettings();
		await this.app.vault.create(notePath, buildLiveNativeRecordingNote({ discreet }));
		const file = this.app.vault.getFileByPath(notePath);
		if (file) {
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(file);
			window.setTimeout(() => {
				this.placeCursorInLiveNoteNotes();
				this.hideLiveNoteProperties(leaf.view);
			}, 120);
		}
		await this.appendLog(`LIVE NOTE: native meeting recording -> ${notePath}`);
		return notePath;
	}

	// Obsidian applies a note's `cssclasses` from its metadata cache, and a
	// note created milliseconds ago is not indexed yet - so on the freshly
	// opened live note the Properties panel (recording flags, folder path,
	// "status: recording") stays visible until the note is reopened. Put the
	// class on the view directly so the existing hide rule applies at once.
	private hideLiveNoteProperties(view: unknown): void {
		if (view instanceof MarkdownView) view.contentEl.addClass("nous-live-note");
	}

	// Land the cursor on the blank line after the Notes hint, ready to type.
	// Best-effort: a failure here costs nothing but the convenience.
	private placeCursorInLiveNoteNotes(): void {
		try {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;
			const lines = view.editor.getValue().split("\n");
			const hintIndex = lines.findIndex((line) => line === LIVE_NOTE_TYPING_HINT);
			const headingIndex = lines.findIndex((line) => line === LIVE_NOTE_NOTES_HEADING);
			const anchor = hintIndex !== -1 ? hintIndex + 2 : headingIndex + 1;
			if (hintIndex === -1 && headingIndex === -1) return;
			view.editor.setCursor({ line: anchor, ch: 0 });
			view.editor.focus();
		} catch {
			// Cursor placement is a nicety only.
		}
	}

	private async clearActiveLiveRecording(): Promise<void> {
		if (!this.settings.activeLiveRecording) return;
		this.settings.activeLiveRecording = null;
		await this.saveSettings();
	}

	// Obsidian was closed (or the Mac died) while a recording ran: settings
	// still name a live note, but the recorder is no longer running. If the
	// audio folder survived, finish the note from it; otherwise keep the
	// typed notes and say what happened. Either way the stale state goes.
	private liveRecoveryInProgress = false;

	private async recoverOrphanedLiveRecording(): Promise<void> {
		if (this.liveRecoveryInProgress) return;
		this.liveRecoveryInProgress = true;
		try {
			await this.recoverOrphanedLiveRecordingInner();
		} finally {
			this.liveRecoveryInProgress = false;
		}
	}

	private async recoverOrphanedLiveRecordingInner(): Promise<void> {
		const active = this.settings.activeLiveRecording;
		if (!active) return;
		const status = await this.nativeRecorderStatus();
		if (status.available && status.recording) return;
		const liveFile = this.app.vault.getFileByPath(active.path);
		await this.clearActiveLiveRecording();
		if (!liveFile) return;
		let audioExists = false;
		if (active.recordingDir) {
			const { fs } = await loadNodeModules();
			audioExists = await fs
				.access(active.recordingDir)
				.then(() => true)
				.catch(() => false);
		}
		await this.appendLog(`RECOVERY: live note ${active.path} outlived its recording (audio ${audioExists ? "found" : "missing"})`);
		if (audioExists && active.recordingDir) {
			this.setMeetingTranscribingIndicator(true);
			void this.ingestNativeMeetingRecording(active.recordingDir, liveFile.path);
			return;
		}
		await this.markLiveNativeMeetingNoteProblem(
			liveFile,
			"The recording ended without a stop - Obsidian or the Mac shut down while it ran - and no audio folder was found."
		);
	}

	private async findActiveNativeMeetingNote(recordingDir: string | null = null): Promise<TFile | null> {
		const active = this.settings.activeLiveRecording;
		if (active && (!recordingDir || !active.recordingDir || active.recordingDir === recordingDir)) {
			const file = this.app.vault.getFileByPath(active.path);
			if (file) return file;
		}
		if (this.activeNativeMeetingNotePath) {
			const file = this.app.vault.getFileByPath(this.activeNativeMeetingNotePath);
			if (file) return file;
		}

		// Legacy fallback: live notes written before 2.12 carried their state
		// in frontmatter. Scan the inbox for one.
		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		if (!folder) return null;
		const candidates: { file: TFile; recordingDir: string | null }[] = [];
		for (const child of folder.children) {
			if (!(child instanceof TFile) || !["md", "txt"].includes(child.extension.toLowerCase())) continue;
			try {
				const live = parseLiveNativeRecordingNote(await this.app.vault.read(child));
				if (live) candidates.push({ file: child, recordingDir: live.recordingDir });
			} catch {
				// Leave unreadable inbox files to the normal processor.
			}
		}
		candidates.sort((a, b) => b.file.stat.ctime - a.file.stat.ctime);
		if (recordingDir) {
			const exact = candidates.find((candidate) => candidate.recordingDir === recordingDir);
			if (exact) return exact.file;
			return candidates.length === 1 ? candidates[0].file : null;
		}
		return candidates[0]?.file ?? null;
	}

	private async uniqueVaultPath(basePath: string): Promise<string> {
		if (!(await this.app.vault.adapter.exists(basePath))) return basePath;
		const dot = basePath.lastIndexOf(".");
		const stem = dot === -1 ? basePath : basePath.slice(0, dot);
		const ext = dot === -1 ? "" : basePath.slice(dot);
		let n = 2;
		let candidate = `${stem} ${n}${ext}`;
		while (await this.app.vault.adapter.exists(candidate)) {
			n++;
			candidate = `${stem} ${n}${ext}`;
		}
		return candidate;
	}

	private setMeetingRecordingIndicator(recording: boolean) {
		// Discreet mode: the ribbon icon still flips to the stop symbol so the
		// user can find the off switch, but with no red pulse, no timer, and
		// no status bar entry - nothing on screen reads "recording".
		const discreet = this.settings.discreetRecording;
		if (this.meetingRibbonEl) {
			setIcon(this.meetingRibbonEl, recording ? "circle-stop" : "audio-lines");
			this.meetingRibbonEl.toggleClass("nous-recording", recording && !discreet);
			this.meetingRibbonEl.setAttribute(
				"aria-label",
				recording ? (discreet ? "click to stop" : "meeting recording - click to stop") : "toggle meeting capture"
			);
		}
		if (this.meetingRecordingTimer !== null) {
			window.clearInterval(this.meetingRecordingTimer);
			this.meetingRecordingTimer = null;
		}
		if (this.meetingStatusBarEl) {
			if (recording && discreet) {
				this.meetingTranscribing = false;
				this.meetingStatusBarEl.hide();
			} else if (recording) {
				this.meetingTranscribing = false;
				this.startRecordingElapsedTimer(this.meetingStatusBarEl, (id) => {
					this.meetingRecordingTimer = id;
				});
				this.meetingStatusBarEl.show();
			} else if (!this.meetingTranscribing) {
				this.meetingStatusBarEl.hide();
			}
		}
	}

	// The quiet-notification contract: state lives in the status bar, toasts
	// are reserved for the finished note and for errors.
	private setMeetingTranscribingIndicator(transcribing: boolean) {
		this.meetingTranscribing = transcribing;
		if (!this.meetingStatusBarEl) return;
		this.meetingStatusBarEl.toggleClass("nous-transcribing", transcribing);
		if (transcribing) {
			this.renderStatusBarState(this.meetingStatusBarEl, "loader-2", "Transcribing…", { spin: true });
			this.meetingStatusBarEl.show();
		} else {
			this.meetingStatusBarEl.hide();
		}
	}

	private async updateMeetingRecordingIndicator(): Promise<void> {
		const nativeStatus = await this.nativeRecorderStatus();
		this.setMeetingRecordingIndicator(nativeStatus.available && nativeStatus.recording);
		// The recorder stops itself when the Mac goes to sleep (lid closed).
		// A live note is still waiting for that audio, so finish it as soon as
		// the poll sees the recorder gone - not only on the next Obsidian
		// start. The toggle flag keeps this out of a stop the user is doing
		// by hand right now.
		if (
			nativeStatus.available &&
			!nativeStatus.recording &&
			this.settings.activeLiveRecording &&
			!this.meetingToggleInProgress &&
			!this.liveRecoveryInProgress
		) {
			await this.appendLog("RECOVERY: recorder stopped on its own (sleep?) - finishing the live note");
			void this.recoverOrphanedLiveRecording();
		}
	}

	private async checkOrphanedNativeRecordings(): Promise<void> {
		const nativeStatus = await this.nativeRecorderStatus();
		if (nativeStatus.recording) return; // still being written - not orphaned

		const { fs, path } = await loadNodeModules();
		const watchDir = await this.nativeRecorderWatchDir();
		const entries = await fs.readdir(watchDir).catch(() => [] as string[]);
		const staleCutoffMs = Date.now() - 20 * 60 * 1000;

		for (const entry of entries) {
			if (!entry.endsWith(".qma")) continue;
			const entryPath = path.join(watchDir, entry);
			if (this.notifiedOrphanedRecordings.has(entryPath)) continue;

			const stat = await fs.stat(entryPath).catch(() => null);
			if (!stat || stat.mtimeMs > staleCutoffMs) continue;

			this.notifiedOrphanedRecordings.add(entryPath);
			await this.appendLog(`WARN: orphaned recording never ingested: ${entry}`);
			nousNotice("A recording didn't make it into your notes - more in your Nous log", 10000);
		}
	}

	// Empty stubs and detected duplicates both land here, permanently,
	// unless swept - the "14-day purge" comments elsewhere describing this
	// folder predate any purge actually existing. Sweeping on every arrival
	// (rather than a separate timer) keeps this self-contained and only
	// costs a stat per existing file, which is cheap for a folder that is
	// itself capped by this same purge.
	private async moveToDuplicates(file: TFile) {
		const dupFolder = `${this.settings.inboxFolder}/duplicates`;
		if (!(await this.app.vault.adapter.exists(dupFolder))) {
			await this.app.vault.createFolder(dupFolder);
		}
		// Two files sharing a basename (a dictation tool's generic "Voice
		// Memo.m4a", a re-synced export) would otherwise collide on rename.
		const dest = await this.uniqueVaultPath(`${dupFolder}/${file.name}`);
		await this.app.fileManager.renameFile(file, dest);
		await this.purgeOldDuplicates(dupFolder);
	}

	// The text-capture path already parked empty stubs in duplicates/ with a
	// log line explaining why - the image/PDF/audio checks below returned
	// false with neither, so a corrupt/empty capture of those types sat in
	// the inbox and was silently re-checked, forever, on every single run.
	private async skipEmptyCapture(file: TFile, kind: string): Promise<void> {
		await this.moveToDuplicates(file);
		await this.appendLog(`SKIPPED: ${file.name} - empty ${kind} file, moved to duplicates/`);
	}

	private async purgeOldDuplicates(dupFolder: string): Promise<void> {
		const folder = this.app.vault.getFolderByPath(dupFolder);
		if (!folder) return;
		const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
		let purged = 0;
		for (const child of folder.children) {
			if (child instanceof TFile && child.stat.mtime < cutoff) {
				await this.app.fileManager.trashFile(child);
				purged++;
			}
		}
		if (purged > 0) await this.appendLog(`PURGED: ${purged} duplicate${purged === 1 ? "" : "s"} older than 14 days`);
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
		if (this.apiRunInProgress) {
			this.apiRerunQueued = true;
			return;
		}
		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		if (!folder) return;
		const files = collectFilesRecursive(folder, (f) => logic.isCaptureFile(f.extension));
		if (files.length === 0) return;

		this.apiRunInProgress = true;
		try {
			let enriched = 0;
			for (const file of files) {
				try {
					if (await this.processFile(file)) enriched++;
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					nousNotice(`Stumbled on "${file.name}" - more in your Nous log`, 10000);
					await this.appendLog(`ERROR: ${file.name} - ${msg}`);
				}
			}

			if (enriched > 0) {
				nousNotice(`✨ ${enriched} note${enriched === 1 ? "" : "s"} enriched.`);
				await this.buildWikisViaApi();
			}
		} finally {
			this.apiRunInProgress = false;
		}
		if (this.apiRerunQueued) {
			this.apiRerunQueued = false;
			void this.processInboxViaApi();
		}
	}

	private async processInboxViaCli() {
		if (this.cliRunInProgress) {
			this.cliRerunQueued = true;
			return;
		}
		const basePath = this.requireVaultBasePath();
		if (!basePath) return;

		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		const hasFiles = folder && collectFilesRecursive(folder, (f) => logic.isCaptureFile(f.extension)).length > 0;
		if (!hasFiles) return;

		this.cliRunInProgress = true;
		try {
			await this.runInboxCli(basePath);
		} finally {
			this.cliRunInProgress = false;
		}
		if (this.cliRerunQueued) {
			this.cliRerunQueued = false;
			void this.processInboxViaCli();
		}
	}

	// The claude binary can't read audio - transcribe each recording here and
	// leave a text note in the inbox for the CLI enricher to pick up.
	private async transcribeInboxAudioForCli(): Promise<void> {
		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		if (!folder) return;
		const audioFiles = collectFilesRecursive(folder, (f) =>
			logic.AUDIO_EXTENSIONS.includes(f.extension.toLowerCase())
		);
		for (const file of audioFiles) {
			try {
				const liveTranscript = this.liveTranscripts.get(file.path);
				let transcript: string;
				if (liveTranscript !== undefined) {
					this.liveTranscripts.delete(file.path);
					transcript = liveTranscript;
				} else {
					const binary = await this.app.vault.readBinary(file);
					if (binary.byteLength === 0) continue;
					transcript = await this.transcribeAudio(file.extension.toLowerCase(), binary, file.name);
				}
				// Two audio files sharing a basename (common with generic
				// dictation-tool filenames, and more likely now that a dropped
				// folder's subfolders get walked too) would otherwise collide.
				const notePath = await this.uniqueVaultPath(`${this.settings.inboxFolder}/${file.basename} (voice).md`);
				const audioDest = await this.uniqueVaultPath(`${this.settings.meetingsFolder}/${file.name}`);
				await this.app.vault.create(
					notePath,
					`${transcript.trim()}\n\n![[${audioDest.slice(audioDest.lastIndexOf("/") + 1)}]]\n`
				);
				await this.app.fileManager.renameFile(file, audioDest);
				await this.appendLog(`TRANSCRIBED: ${file.name} -> ${notePath}`);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				nousNotice(`Couldn't transcribe "${file.name}" - more in your Nous log`, 10000);
				await this.appendLog(`ERROR: ${file.name} - transcription failed: ${msg}`);
			}
		}
	}

	private async transcribePendingNativeRecordingsForCli(): Promise<void> {
		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		if (!folder) return;
		const files = collectFilesRecursive(folder, (f) => ["md", "txt"].includes(f.extension.toLowerCase()));
		for (const file of files) {
			const content = await this.app.vault.read(file);
			const pending = parsePendingNativeRecordingNote(content);
			if (!pending) continue;

			if (!(await this.hasAudioTranscriptionBackend())) {
				if (!this.notifiedPendingTranscription.has(file.path)) {
					this.notifiedPendingTranscription.add(file.path);
					this.settingsNotice("A meeting recording is waiting on speech-to-text.", 12000);
				}
				continue;
			}

			try {
				const transcript = await this.transcribeNativeMeetingRecording(pending.recordingDir);
				if (!transcript) continue;
				const manualNotes = extractNativeRecordingManualNotes(content);
				await this.app.vault.modify(
					file,
					buildCompletedNativeRecordingNote(transcript.stamp, transcript.transcript, manualNotes)
				);
				await this.appendLog(`TRANSCRIBED: ${file.name} pending recording -> ${file.path}`);
				await this.archiveNativeRecording(pending.recordingDir);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				nousNotice(`Couldn't transcribe "${file.name}" - more in your Nous log`, 10000);
				await this.appendLog(`ERROR: ${file.name} - pending native recording transcription failed: ${msg}`);
			}
		}
	}

	private async runInboxCli(basePath: string) {
		await this.transcribeInboxAudioForCli();
		await this.transcribePendingNativeRecordingsForCli();
		await this.ensureSkillsInstalled();
		await this.trimLogIfNeeded();
		const before = await this.readLogLineCount();
		const env = this.cliEnv();

		const enrichResult = await this.cliExec(
			this.settings.claudeCliPath,
			buildEnrichArgs(this.settings.inboxFolder, this.settings.activeLiveRecording?.path ?? null),
			{ cwd: basePath, env, timeoutMs: AGENT_CLI_TIMEOUT_MS }
		);
		if (enrichResult.code !== 0) {
			await this.appendLog(
				`ERROR: meeting-enricher CLI exited ${enrichResult.code} - ${cliErrorDetail(enrichResult)}`
			);
			nousNotice(
				"Enrichment hit a snag - more in your Nous log",
				10000
			);
			return;
		}

		const wikiResult = await this.cliExec(
			this.settings.claudeCliPath,
			buildWikiArgs(this.settings.meetingsFolder),
			{ cwd: basePath, env, timeoutMs: AGENT_CLI_TIMEOUT_MS }
		);
		if (wikiResult.code !== 0) {
			await this.appendLog(
				`ERROR: wiki-builder CLI exited ${wikiResult.code} - ${cliErrorDetail(wikiResult)}`
			);
			nousNotice("Wiki building hit a snag - more in your Nous log", 10000);
			return;
		}

		const summary = summarizeLogLines(await this.readLogSince(before));
		if (summary.enriched > 0) {
			const parts = [`${summary.enriched} note${summary.enriched === 1 ? "" : "s"} enriched`];
			if (summary.newWikis > 0) parts.push(`${summary.newWikis} new wiki${summary.newWikis === 1 ? "" : "s"}`);
			if (summary.updatedWikis > 0)
				parts.push(`${summary.updatedWikis} wiki${summary.updatedWikis === 1 ? "" : "s"} updated`);
			nousNotice(`✨ ${parts.join(", ")}.`);
		}
		if (summary.errors > 0) {
			nousNotice(`${summary.errors} error${summary.errors === 1 ? "" : "s"} - more in your Nous log`, 8000);
		} else if (summary.skipped > 0) {
			nousNotice(
				`${summary.skipped} item${summary.skipped === 1 ? "" : "s"} skipped - more in your Nous log`,
				8000
			);
		}
	}

	private async runWikiBuilderCli() {
		const basePath = this.requireVaultBasePath();
		if (!basePath) return;
		await this.ensureSkillsInstalled();
		const before = await this.readLogLineCount();
		const result = await this.cliExec(
			this.settings.claudeCliPath,
			buildWikiArgs(this.settings.meetingsFolder),
			{ cwd: basePath, env: this.cliEnv(), timeoutMs: AGENT_CLI_TIMEOUT_MS }
		);
		if (result.code !== 0) {
			await this.appendLog(`ERROR: wiki-builder CLI exited ${result.code} - ${cliErrorDetail(result)}`);
			nousNotice("Wiki building hit a snag - more in your Nous log", 10000);
			return;
		}
		const summary = summarizeLogLines(await this.readLogSince(before));
		const parts: string[] = [];
		if (summary.newWikis > 0) parts.push(`${summary.newWikis} new wiki${summary.newWikis === 1 ? "" : "s"}`);
		if (summary.updatedWikis > 0)
			parts.push(`${summary.updatedWikis} wiki${summary.updatedWikis === 1 ? "" : "s"} updated`);
		nousNotice(parts.length > 0 ? `✨ ${parts.join(", ")}.` : "Nothing new for the wikis this time.");
	}

	async runVaultQuery(question: string) {
		if (this.settings.executionMode !== "cli") {
			nousNotice("Vault search needs CLI mode - switch it in settings → Nous.", 10000);
			return;
		}
		const basePath = this.requireVaultBasePath();
		if (!basePath) return;
		await this.ensureSkillsInstalled();
		nousNotice("Searching your vault…");
		const result = await this.cliExec(
			this.settings.claudeCliPath,
			buildQueryArgs(question),
			{ cwd: basePath, env: this.cliEnv(), timeoutMs: AGENT_CLI_TIMEOUT_MS }
		);
		if (result.code !== 0) {
			await this.appendLog(`ERROR: vault-query CLI exited ${result.code} - ${cliErrorDetail(result)}`);
			nousNotice("Search hit a snag - more in your Nous log", 10000);
			return;
		}

		const stamp = window.moment().format("YYYY-MM-DD HHmmss");
		const slug = logic.sanitizeFilename(question).slice(0, 60);
		const path = `${this.settings.queriesFolder}/${stamp} ${slug}.md`;
		await this.ensureFolderExists(this.settings.queriesFolder);
		const content = `---\ntype: query\nasked: ${window.moment().toISOString(true)}\n---\n# ${question}\n\n${result.stdout.trim()}\n`;
		await this.app.vault.create(path, content);
		const file = this.app.vault.getFileByPath(path);
		if (file) await this.app.workspace.getLeaf(true).openFile(file);
	}

	private mimeTypeForExtension(extension: string): string {
		const ext = extension.toLowerCase();
		if (ext === "pdf") return "application/pdf";
		if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
		return `image/${ext}`;
	}

	// HEIC -> JPEG via macOS's sips (Obsidian can't render HEIC and most
	// vision APIs reject it). Desktop-only.
	private async convertHeicToJpeg(binary: ArrayBuffer): Promise<ArrayBuffer> {
		const { execFile, fs: fsPromises, os, path } = await loadNodeModules();
		const stamp = Date.now();
		const inPath = path.join(os.tmpdir(), `nous-heic-${stamp}.heic`);
		const outPath = path.join(os.tmpdir(), `nous-heic-${stamp}.jpg`);
		try {
			await fsPromises.writeFile(inPath, Buffer.from(binary));
			await new Promise<void>((resolve, reject) => {
				execFile("sips", ["-s", "format", "jpeg", inPath, "--out", outPath], (error) => {
					if (error) reject(Object.assign(new Error(error.message), error));
					else resolve();
				});
			});
			const converted = await fsPromises.readFile(outPath);
			return converted.buffer.slice(converted.byteOffset, converted.byteOffset + converted.byteLength);
		} finally {
			await fsPromises.unlink(inPath).catch(() => {});
			await fsPromises.unlink(outPath).catch(() => {});
		}
	}

	async processFile(file: TFile): Promise<boolean> {
		if (this.inFlight.has(file.path)) return false;
		if (this.settings.apiProvider !== "local" && !this.settings.apiKeys[this.settings.apiProvider]) {
			nousNotice(`Missing a ${this.settings.apiProvider} API key - add one in plugin settings.`, 10000);
			return false;
		}
		this.inFlight.add(file.path);
		try {
			const ext = file.extension.toLowerCase();
			const isHeic = logic.HEIC_EXTENSIONS.includes(ext);
			const isImage = isHeic || logic.IMAGE_EXTENSIONS.includes(ext);
			const isPdf = logic.PDF_EXTENSIONS.includes(ext);
			const isAudio = logic.AUDIO_EXTENSIONS.includes(ext);
			let raw = "";
			let attachment: { kind: "image" | "document"; mediaType: string; base64Data: string } | undefined;
			let convertedBinary: ArrayBuffer | undefined;
			let effectiveExtension = file.extension;

			if (isImage) {
				let binary = await this.app.vault.readBinary(file);
				if (binary.byteLength === 0) {
					await this.skipEmptyCapture(file, "image");
					return false;
				}

				if (isHeic) {
					// The real constraint is macOS's own `sips` tool, not just
					// "desktop" - this used to also gate on mobile, but a
					// Windows/Linux desktop has neither and would otherwise hit
					// convertHeicToJpeg() below and fail with a raw subprocess
					// error instead of this clear notice.
					if (!Platform.isMacOS) {
						nousNotice(
							`HEIC photos need macOS (uses its built-in converter) - left "${file.name}" in your inbox for now.`,
							10000
						);
						return false;
					}
					try {
						binary = await this.convertHeicToJpeg(binary);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						nousNotice(
							`Couldn't convert "${file.name}" (needs macOS's sips tool) - more in your Nous log`,
							10000
						);
						await this.appendLog(`ERROR: ${file.name} - HEIC conversion failed: ${msg}`);
						return false;
					}
					effectiveExtension = "jpg";
					convertedBinary = binary;
				}

				attachment = {
					kind: "image",
					mediaType: this.mimeTypeForExtension(effectiveExtension),
					base64Data: logic.arrayBufferToBase64(binary),
				};
			} else if (isPdf) {
				const binary = await this.app.vault.readBinary(file);
				if (binary.byteLength === 0) {
					await this.skipEmptyCapture(file, "PDF");
					return false;
				}

				attachment = {
					kind: "document",
					mediaType: this.mimeTypeForExtension(ext),
					base64Data: logic.arrayBufferToBase64(binary),
				};
			} else if (isAudio) {
				const liveTranscript = this.liveTranscripts.get(file.path);
				if (liveTranscript !== undefined) {
					this.liveTranscripts.delete(file.path);
					raw = liveTranscript;
				} else {
					const binary = await this.app.vault.readBinary(file);
					if (binary.byteLength === 0) {
						await this.skipEmptyCapture(file, "audio");
						return false;
					}
					// Transcript goes through the normal text-enrichment path.
					raw = await this.transcribeAudio(ext, binary, file.name);
				}
			} else {
				raw = await this.app.vault.read(file);
				if (raw.trim().length === 0) {
					// An empty stub left in place is re-checked and re-logged
					// on every run forever - park it with the duplicates,
					// which purges anything older than 14 days on its own.
					await this.moveToDuplicates(file);
					await this.appendLog(`SKIPPED: ${file.name} - empty capture stub, moved to duplicates/`);
					return false;
				}
				if (isLiveNativeRecordingNote(raw) || this.settings.activeLiveRecording?.path === file.path) return false;
				const pendingNativeRecording = parsePendingNativeRecordingNote(raw);
				if (pendingNativeRecording) {
					if (!(await this.hasAudioTranscriptionBackend())) {
						if (!this.notifiedPendingTranscription.has(file.path)) {
							this.notifiedPendingTranscription.add(file.path);
							this.settingsNotice(`"${file.name}" is waiting on speech-to-text.`, 12000);
						}
						return false;
					}
					const transcript = await this.transcribeNativeMeetingRecording(pendingNativeRecording.recordingDir);
					if (!transcript) return false;
					raw = buildCompletedNativeRecordingNote(
						transcript.stamp,
						transcript.transcript,
						extractNativeRecordingManualNotes(raw)
					);
					await this.app.vault.modify(file, raw);
					await this.appendLog(`TRANSCRIBED: ${file.name} pending recording -> ${file.path}`);
					await this.archiveNativeRecording(pendingNativeRecording.recordingDir);
					nousNotice(`✨ Transcribed your pending meeting recording "${file.name}".`);
				}
			}

			let rawTranscriptForMarkdown = raw;
			let manualNotesForMarkdown: string | undefined;
			if (!attachment && !isAudio) {
				const split = logic.splitManualNotesFromTranscript(raw);
				if (split.manualNotes) {
					rawTranscriptForMarkdown = split.transcript;
					manualNotesForMarkdown = split.manualNotes;
				}
			}

			const tagRegistry = await this.listTagRegistry();
			const existingIndex = await this.buildNoteIndex();
			const dateHint = logic.extractFilenameDateHint(file.name);
			const ctime = new Date(file.stat.ctime).toISOString().slice(0, 10);

			const message = !attachment
				? { text: enrichUserMessage(raw, dateHint, ctime, existingIndex) }
				: attachment.kind === "document"
					? { text: enrichDocumentUserMessage(dateHint, ctime, existingIndex), attachment }
					: { text: enrichImageUserMessage(dateHint, ctime, existingIndex), attachment };

			const knownTerms = await this.readVaultGlossary();
			const result = await this.getLlmProvider().callTool<EnrichResult>(
				enrichSystemPrompt(tagRegistry, this.settings.ownerName, knownTerms),
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
			// Two captures on the same day landing on the same LLM-chosen title
			// (two generic "Standup" fragments, say) would otherwise collide -
			// vault.create() throws, and since destPath is deterministic from
			// date+title, every retry hits the exact same collision forever,
			// permanently stranding the original capture in the inbox.
			const destPath = await this.uniqueVaultPath(`${this.settings.meetingsFolder}/${finalFilename}`);

			if (isImage || isPdf) {
				const attachmentFilename = logic.meetingAttachmentFilename(result.date, result.title, effectiveExtension);
				const markdown = logic.buildMeetingMarkdown(result, "", enrichedAt, existingWikiLink, {
					filename: attachmentFilename,
					kind: isPdf ? "document" : "image",
				});
				await this.app.vault.create(destPath, markdown);
				if (convertedBinary) {
					// Bytes changed (HEIC -> JPEG): write new file, drop original.
					await this.app.vault.createBinary(
						`${this.settings.meetingsFolder}/${attachmentFilename}`,
						convertedBinary
					);
					await this.app.fileManager.trashFile(file);
				} else {
					await this.app.fileManager.renameFile(file, `${this.settings.meetingsFolder}/${attachmentFilename}`);
				}
			} else if (isAudio) {
				// Transcript in the body, recording embedded underneath.
				const attachmentFilename = logic.meetingAttachmentFilename(result.date, result.title, ext);
				const markdown = logic.buildMeetingMarkdown(result, raw, enrichedAt, existingWikiLink, {
					filename: attachmentFilename,
					kind: "audio",
				});
				await this.app.vault.create(destPath, markdown);
				await this.app.fileManager.renameFile(file, `${this.settings.meetingsFolder}/${attachmentFilename}`);
			} else {
				const markdown = logic.buildMeetingMarkdown(
					result,
					rawTranscriptForMarkdown,
					enrichedAt,
					existingWikiLink,
					undefined,
					manualNotesForMarkdown
				);
				await this.app.vault.create(destPath, markdown);
				await this.app.fileManager.trashFile(file);
			}
			await this.appendLog(
				`ENRICHED: ${finalFilename} - tags: [${result.tags.join(", ")}] - project: ${result.project}`
			);
			return true;
		} catch (e) {
			if (e instanceof LlmApiError) {
				nousNotice(`API error (${e.status}) on "${file.name}" - more in your Nous log`, 10000);
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
				// "New" = not yet listed under ## Sources. Not "dated after the
				// wiki's updated day": that skipped every note from the same day
				// as the last update, forever.
				const absorbed = new Set(logic.parseWikiSources(await this.app.vault.read(existingWiki)));
				const newNotes = cluster.notes.filter((n) => !absorbed.has(n.title));
				if (newNotes.length > 0) {
					await this.updateWiki(cluster.tag, existingWiki, cluster.notes, noteFiles);
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				nousNotice(`Wiki hit a snag for "${cluster.tag}" - more in your Nous log`, 10000);
				await this.appendLog(`ERROR: wiki ${cluster.tag} - ${msg}`);
			}
		}

		await this.updateWinsPageViaApi(noteFiles);
	}

	// Deterministic, unlike the topic wikis above - no LLM call needed, see
	// logic.buildWinsMarkdown. Only runs when at least one win-tagged note
	// exists, same gate as wiki-builder's Step 6 in CLI mode.
	private async updateWinsPageViaApi(noteFiles: TFile[]) {
		const entries: logic.WinEntry[] = [];
		for (const file of noteFiles) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm || !Array.isArray(fm.tags) || !(fm.tags as string[]).includes("win")) continue;
			entries.push({
				title: (fm.title as string) ?? file.basename,
				date: (fm.date as string) ?? "",
				category: (fm.win_category as string) ?? "other",
				headcount: (fm.win_headcount as string) ?? "",
				client: (fm.win_client as string) ?? "",
				repo: (fm.win_repo as string) ?? "",
				metric: (fm.win_metric as string) ?? "",
			});
		}
		if (entries.length === 0) return;

		const winsPath = `${this.settings.wikisFolder}/Wins.md`;
		const today = new Date().toISOString().slice(0, 10);
		const markdown = logic.buildWinsMarkdown(entries, today);
		const existing = this.app.vault.getFileByPath(winsPath);
		if (existing) {
			await this.app.vault.modify(existing, markdown);
		} else {
			await this.app.vault.create(winsPath, markdown);
		}
		await this.appendLog(`WINS UPDATED: ${entries.length} total`);
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
			today,
			logic.mergeGlossary([], result.glossary)
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
		const absorbed = new Set(logic.parseWikiSources(existingContent));
		const newNotes = allNotes.filter((n) => !absorbed.has(n.title));

		const { sources: newSources } = await this.readSourcesForWiki(newNotes, noteFiles);
		const { timeline: allTimeline } = await this.readSourcesForWiki(allNotes, noteFiles);
		const existingCurrentState = this.extractCurrentState(existingContent);
		const existingGlossary = logic.parseGlossary(existingContent);

		const result = await this.getLlmProvider().callTool<WikiSynthesisResult>(
			wikiSystemPrompt(topic, true),
			{
				text: wikiUserMessage(
					newSources,
					existingCurrentState,
					existingGlossary.map((g) => g.term)
				),
			},
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
			today,
			logic.mergeGlossary(existingGlossary, result.glossary)
		);
		await this.app.vault.modify(existingWiki, markdown);
		// Pass every source, not just new ones - idempotent, and it repairs
		// older notes that missed the backlink.
		await this.linkWikiIntoSources(topic, allNotes, noteFiles);
		await this.appendLog(`UPDATED WIKI: ${topic} - sources: ${allNotes.length}`);
	}

	// Every wiki's "## Glossary" rows, flattened, so the enricher can expand
	// known jargon on first use in a new note. A handful of small tables -
	// cheap to re-read on each enrichment.
	private async readVaultGlossary(): Promise<{ term: string; meaning: string }[]> {
		const folder = this.app.vault.getFolderByPath(this.settings.wikisFolder);
		if (!folder) return [];
		const terms: { term: string; meaning: string }[] = [];
		const seen = new Set<string>();
		for (const child of folder.children) {
			if (!(child instanceof TFile) || child.extension !== "md") continue;
			try {
				for (const row of logic.parseGlossary(await this.app.vault.read(child))) {
					const key = row.term.toLowerCase();
					if (seen.has(key)) continue;
					seen.add(key);
					terms.push({ term: row.term, meaning: row.meaning });
				}
			} catch {
				// An unreadable wiki just contributes no terms.
			}
		}
		return terms;
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
