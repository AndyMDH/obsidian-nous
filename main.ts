import {
	App,
	FileSystemAdapter,
	Modal,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	requestUrl,
	requireApiVersion,
	setIcon,
	type ButtonComponent,
	type SettingDefinitionItem,
	type SettingGroup,
} from "obsidian";
import type { ApiProvider, NousSettings, EnrichResult, NoteIndexEntry, WikiSynthesisResult } from "./src/types";
import { DEFAULT_SETTINGS, MODEL_OPTIONS } from "./src/types";
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
	downloadProgressText,
	parseLfsPointer,
	type LfsPointer,
} from "./src/whisperModel";
import {
	DEFAULT_NATIVE_RECORDER_BIN,
	buildCompletedNativeRecordingNote,
	buildLiveNativeRecordingNote,
	buildNativeRecordingProblemNote,
	buildPendingNativeRecordingNote,
	extractNativeRecordingManualNotes,
	hasMeaningfulNativeRecordingManualNotes,
	interleaveMeetingTracks,
	nativeRecorderArgs,
	shiftTrackSegments,
	trackStartDeltasMs,
	nativeRecorderReleaseAssetUrl,
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
	ONBOARDING_PREREQUISITES_TEXT,
	MEETING_RECORDER_MISSING_NOTICE,
	NATIVE_RECORDER_INSTALL_DESC,
	VOICE_CAPTURE_SETTINGS_DESC,
	capturePrerequisitesContinueText,
	capturePrerequisiteItems,
	hasGeminiOrOpenAiTranscriptionKey,
	nativeRecorderReadinessText,
	onboardingFinishIntro,
	onboardingFinishNextActions,
	onboardingFinishTitle,
	shouldOfferNativeRecorderInstall,
} from "./src/onboarding";
import { RealtimeTranscriber, type RealtimeSocket } from "./src/realtimeTranscribe";
import { augmentedPath, buildEnrichArgs, buildQueryArgs, buildWikiArgs, cliErrorDetail, summarizeLogLines } from "./src/cliRunner";
import type { CliExec } from "./src/cliRunner";
import { meetingEnricherSkill, vaultQuerySkill, wikiBuilderSkill } from "./src/skillTemplates";
import type { SkillFolders } from "./src/skillTemplates";

const LOG_FOLDER = ".nous";
const LOG_FILE = `${LOG_FOLDER}/pipeline.log`;

// "local" never has a key (it's a reachable-server URL, not a credential) -
// excluded from secretStorage handling in loadSettings()/saveSettings().
const API_KEY_PROVIDERS: Exclude<ApiProvider, "local">[] = ["anthropic", "openai", "gemini", "glm"];
const DEFAULT_CLAUDE_CLI_BIN = "claude";
const DEFAULT_WHISPER_CLI_BIN = "whisper-cli";
// afconvert (CoreAudio) can read AIFF/WAV/CAF/M4A/MP3 but not WebM/Opus, so
// local transcription silently fails if the browser records WebM (Chromium's
// default with no mimeType hint) - ask for an afconvert-readable container
// first and only fall back to WebM if the platform truly can't produce one.
const PREFERRED_VOICE_MIME_TYPES = ["audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm"];
function pickVoiceMimeType(): string | undefined {
	return PREFERRED_VOICE_MIME_TYPES.find(
		(type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
	);
}
const LOCAL_BASE_URL_DESC = 'OpenAI-compatible endpoint, e.g. Ollama\'s default "http://localhost:11434/v1".';

// Electron's renderer exposes a real `require` global (Obsidian runs with
// nodeIntegration on desktop) - not part of DOM's Window type, so declare it.
declare global {
	interface Window {
		require: (id: string) => unknown;
	}
}

// child_process/crypto/fs/os/path aren't available on mobile, so they can't be
// static imports (that would break the plugin bundle on load, everywhere,
// not just where these are used) - loaded on demand instead, only from the
// desktop/macOS-gated code paths that actually need them.
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
		// obsidianmd/no-nodejs-modules fires here and can't be suppressed
		// (eslint-comments/no-restricted-disable blocks it) - it only turns
		// off when manifest.json sets isDesktopOnly: true, which would be
		// false advertising: Nous genuinely runs in API-key mode on mobile,
		// it just can't offer local whisper/CLI/HEIC features there. Every
		// caller of loadNodeModules() already checks Platform.isMacOS or
		// Platform.isDesktopApp before awaiting it, so this is safe.
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

// "ws" (live/streaming voice transcription - see src/realtimeTranscribe.ts)
// is different from the modules above: it's an npm package, not a Node
// builtin, so window.require("ws") would fail (nothing ships a
// node_modules/ws alongside main.js in an installed plugin). Instead it's
// bundled straight into main.js by esbuild (deliberately left out of the
// `external` array), so a dynamic import() of it resolves against the
// bundle's own internal module registry rather than a real specifier - safe
// even though a dynamic import() of an actual Node builtin like
// child_process is not (see the comment above). Still loaded lazily and only
// from the desktop-gated live-transcription path, same spirit as
// loadNodeModules(): nothing pulls this in on mobile.
let wsModulePromise: Promise<typeof import("ws")> | null = null;
function loadWsModule(): Promise<typeof import("ws")> {
	if (!wsModulePromise) wsModulePromise = import("ws");
	return wsModulePromise;
}

export default class NousPlugin extends Plugin {
	settings: NousSettings;
	private inFlight = new Set<string>();
	private cliRunInProgress = false;
	private voiceRecorder: MediaRecorder | null = null;
	private voiceStream: MediaStream | null = null;
	private voiceRibbonEl: HTMLElement | null = null;
	private voiceStatusBarEl: HTMLElement | null = null;
	private meetingRibbonEl: HTMLElement | null = null;
	private meetingStatusBarEl: HTMLElement | null = null;
	private meetingPollInterval: number | null = null;
	private nativeRecorderLastProblem: string | null = null;
	private activeNativeMeetingNotePath: string | null = null;
	// Live transcripts already known by the time a voice recording is saved
	// (see saveVoiceRecording()) - checked by processFile()/
	// transcribeInboxAudioForCli() so a known transcript skips the batch
	// transcribeAudio() call entirely. Keyed by vault path, one-shot: read
	// and deleted by whichever pipeline branch consumes it.
	private liveTranscripts = new Map<string, string>();
	// Not private: LiveVoiceCaptureModal clears this on its own onClose (all
	// close paths - Stop, Cancel, Esc/click-outside - route through there).
	liveCaptureModal: LiveVoiceCaptureModal | null = null;

	async onload() {
		await this.loadSettings();
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
			id: "quick-capture",
			name: "Quick capture",
			callback: () => new QuickCaptureModal(this.app, this).open(),
		});

		this.addRibbonIcon("plus-circle", "Nous quick capture", () => {
			new QuickCaptureModal(this.app, this).open();
		});

		this.voiceRibbonEl = this.addRibbonIcon("mic", "Nous: toggle voice capture", () => {
			void this.toggleVoiceCapture();
		});

		this.voiceStatusBarEl = this.addStatusBarItem();
		this.voiceStatusBarEl.hide();

		this.addCommand({
			id: "setup-wizard",
			name: "Open setup wizard",
			callback: () => new OnboardingModal(this.app, this).open(),
		});

		this.addCommand({
			id: "toggle-voice-capture",
			name: "Toggle voice capture (start/stop recording)",
			callback: () => void this.toggleVoiceCapture(),
		});

		if (Platform.isMacOS) {
			this.addCommand({
				id: "toggle-meeting-capture",
				name: "Toggle meeting capture (start/stop recording)",
				callback: () => void this.toggleMeetingCapture(),
			});

			this.meetingRibbonEl = this.addRibbonIcon("phone-call", "Nous: toggle meeting capture", () => {
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
			this.register(() => {
				if (this.meetingPollInterval !== null) window.clearInterval(this.meetingPollInterval);
			});
		}

		if (this.settings.autoProcessOnCreate) {
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (file instanceof TFile && this.isInInbox(file)) {
						// Dictation/sync tools create then immediately rewrite a
						// file - let it settle before reading.
						window.setTimeout(() => void this.processInbox(), 2000);
					}
				})
			);
		}

		// Catch up on anything that arrived while Obsidian was closed.
		this.app.workspace.onLayoutReady(() => {
			if (!this.settings.onboarded) {
				new OnboardingModal(this.app, this).open();
			} else {
				void this.processInbox();
			}
		});
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<NousSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
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
			`Audio capture needs local whisper-cli (Settings → Nous → Voice capture) or a Gemini/OpenAI API key. A key is only used to turn speech into text - enrichment still runs in your chosen mode.${localHint}`
		);
	}

	private hasCloudAudioTranscription(): boolean {
		return hasGeminiOrOpenAiTranscriptionKey(this.settings.apiKeys);
	}

	// Display-only default path (used synchronously by the settings tab), so
	// this avoids the async node-module loader - macOS-only feature, so a
	// plain "/" join is safe (no need for the "path" module's platform logic).
	defaultWhisperModelPath(): string {
		return `${process.env.HOME ?? ""}/.local/share/whisper-models/ggml-large-v3-turbo.bin`;
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

	async hasWhisperModel(): Promise<boolean> {
		const modelPath = this.settings.whisperModelPath.trim() || this.defaultWhisperModelPath();
		return NousPlugin.fileExists(modelPath);
	}

	// One-click speech-model install: fetch the git-lfs pointer for the
	// expected sha256/size, stream the model to disk (1.6 GB - never buffer it
	// in memory), verify, then rename into place. The VAD model rides along
	// but its failure is non-fatal.
	async downloadWhisperModels(onProgress: (text: string) => void): Promise<string> {
		if (!Platform.isMacOS) throw new Error("Local whisper transcription is macOS-only.");
		const { fs, os, path } = await loadNodeModules();
		const dir = path.join(os.homedir(), ...WHISPER_MODELS_DIR_SEGMENTS);
		await fs.mkdir(dir, { recursive: true });

		let installedPath = "";
		for (const source of WHISPER_MODEL_SOURCES) {
			const target = path.join(dir, source.filename);
			if (await NousPlugin.fileExists(target)) {
				if (source.required) installedPath = target;
				continue;
			}
			try {
				const pointerResponse = await requestUrl({ url: source.pointerUrl, method: "GET", throw: false });
				if (pointerResponse.status >= 400) throw new Error(`checksum fetch failed (${pointerResponse.status})`);
				const pointer = parseLfsPointer(pointerResponse.text);
				if (!pointer) throw new Error("model checksum file was missing or malformed");

				await this.streamDownloadToFile(source.downloadUrl, target, pointer, (received) =>
					onProgress(downloadProgressText(source.filename, received, pointer.size))
				);
				if (source.required) installedPath = target;
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (source.required) throw new Error(`could not download ${source.filename}: ${msg}`);
				await this.appendLog(`WARN: optional VAD model download failed: ${msg}`);
			}
		}
		if (!installedPath) throw new Error("model download produced no file");

		// Point the setting at the default location the download used, in case
		// a custom (missing) path was configured.
		this.settings.whisperModelPath = "";
		await this.saveSettings();
		return installedPath;
	}

	// Shared by the settings tab and the setup wizard: one persistent notice
	// that live-updates with progress, then a terse outcome line (detail goes
	// to the log, per the project's notice style).
	async downloadWhisperModelsWithNotice(): Promise<boolean> {
		const notice = new Notice("Nous: starting speech-model download…", 0);
		try {
			await this.downloadWhisperModels((text) => notice.setMessage(text));
			notice.setMessage("Nous: speech model installed - voice notes now transcribe locally.");
			window.setTimeout(() => notice.hide(), 8000);
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await this.appendLog(`ERROR: speech-model download failed: ${msg}`);
			notice.setMessage("Nous: model download failed - see .nous/pipeline.log");
			window.setTimeout(() => notice.hide(), 10000);
			return false;
		}
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

		const modelPath = this.settings.whisperModelPath.trim() || this.defaultWhisperModelPath();
		if (!(await NousPlugin.fileExists(modelPath))) return null;

		const { fs: fsPromises, os, path } = await loadNodeModules();
		const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const wavPath = path.join(os.tmpdir(), `nous-voice-${stamp}.wav`);
		const outBase = path.join(os.tmpdir(), `nous-voice-${stamp}`);
		const cleanupPaths = [wavPath, `${outBase}.json`];
		try {
			const env = this.cliEnv();
			// Previously shelled out to afconvert, but CoreAudio's ExtAudioFile
			// rejects the fragmented/streaming mp4 (or webm) MediaRecorder
			// produces - "couldn't set destination file's estimated duration" -
			// because a live recording has no upfront duration atom. Chromium's
			// own decoder has no such requirement (it produced the file), so
			// decode + resample here instead of round-tripping through a CLI tool.
			let wavBuffer: ArrayBuffer;
			try {
				wavBuffer = await NousPlugin.decodeToWav16kMono(binary);
			} catch (err) {
				return {
					failure: `couldn't decode the .${extension} recording: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
			await fsPromises.writeFile(wavPath, Buffer.from(wavBuffer));

			const whisperCli = this.settings.whisperCliPath.trim() || DEFAULT_WHISPER_CLI_BIN;
			const vadModelPath = this.defaultWhisperVadModelPath();
			const args = ["-m", modelPath, "-f", wavPath, "-l", "auto", "-oj", "-of", outBase];
			if (await NousPlugin.fileExists(vadModelPath)) {
				args.push("--vad", "--vad-model", vadModelPath);
			}

			const result = await this.cliExec(whisperCli, args, { cwd: os.tmpdir(), env });
			if (result.code !== 0) {
				return {
					failure: `${whisperCli} exited ${result.code}: ${cliErrorDetail(result)}`,
				};
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
				: { failure: "whisper-cli produced no speech text (silence, or the recording was too quiet)" };
		} catch (err) {
			return { failure: err instanceof Error ? err.message : String(err) };
		} finally {
			await Promise.all(cleanupPaths.map((p) => fsPromises.unlink(p).catch(() => {})));
		}
	}

	private async canUseLocalAudioTranscription(): Promise<boolean> {
		if (!Platform.isMacOS) return false;

		const modelPath = this.settings.whisperModelPath.trim() || this.defaultWhisperModelPath();
		if (!(await NousPlugin.fileExists(modelPath))) return false;

		const { os } = await loadNodeModules();
		const whisperCli = this.settings.whisperCliPath.trim() || DEFAULT_WHISPER_CLI_BIN;
		const result = await this.cliExec(whisperCli, ["--help"], { cwd: os.tmpdir(), env: this.cliEnv() });
		return result.code === 0;
	}

	private async hasAudioTranscriptionBackend(): Promise<boolean> {
		return this.hasCloudAudioTranscription() || (await this.canUseLocalAudioTranscription());
	}

	async getCapturePrerequisiteStatus(): Promise<CapturePrerequisiteStatus> {
		const voiceReady = await this.hasAudioTranscriptionBackend();
		let meeting: CapturePrerequisiteStatus["meeting"] = "unsupported";
		if (Platform.isMacOS) {
			const nativeStatus = await this.nativeRecorderStatus();
			meeting = nativeStatus.available ? "ready-native" : "needs-recorder";
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
		const versionResult = await this.cliExec(command, ["version"], { cwd: os.homedir(), env: this.cliEnv() });
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
			});
			if (result.code !== 0) {
				throw new Error(
					`"${this.settings.claudeCliPath} --version" exited ${result.code}: ${cliErrorDetail(result)}`
				);
			}
			return `Claude Code found (${result.stdout.trim().slice(0, 60)}).`;
		}
		const provider = this.getLlmProvider();
		const result = await provider.callTool<{ ok: boolean }>(
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
		);
		if (!result || result.ok !== true) {
			throw new Error("The model responded, but not with the expected tool call - it may not support tool use.");
		}
		return `Connected - ${this.settings.models[this.settings.apiProvider]} responded correctly.`;
	}

	private cliExec: CliExec = async (command, args, options) => {
		const { execFile } = await loadNodeModules();
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
			// claude waits on open stdin before proceeding - close it
			// immediately since nothing is ever piped in.
			child.stdin?.end();
		});
	};

	private getVaultBasePath(): string | null {
		return this.app.vault.adapter instanceof FileSystemAdapter
			? this.app.vault.adapter.getBasePath()
			: null;
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

	private async ensureSkillsInstalled() {
		const folders: SkillFolders = {
			inbox: this.settings.inboxFolder,
			meetings: this.settings.meetingsFolder,
			wikis: this.settings.wikisFolder,
			tags: this.settings.tagsFolder,
		};
		// Regenerate on every version bump, not just when a file is missing -
		// otherwise an installed SKILL.md silently drifts from what the
		// current plugin source actually produces (e.g. it kept referencing
		// the old .cortex/pipeline.log path for two weeks after the plugin
		// itself was renamed to Nous).
		const stale = this.settings.skillsVersion !== this.manifest.version;
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

	async ensureCoreFolders() {
		const s = this.settings;
		for (const folder of [s.inboxFolder, s.meetingsFolder, s.tagsFolder, s.wikisFolder]) {
			await this.ensureFolderExists(folder);
		}
	}

	// A believable first capture for the wizard's "watch it happen" moment.
	async createSampleNote() {
		const path = `${this.settings.inboxFolder}/Try me.md`;
		if (await this.app.vault.adapter.exists(path)) return;
		await this.app.vault.create(
			path,
			"Quick thought after today's kickoff with the new client: they want the reporting dashboard live before the end of next quarter, but their data quality is a mess - half the customer records are missing regions. Maria offered to run a cleanup sprint first. I should sketch the dashboard wireframe this week and check whether we can reuse the ETL setup from the last project.\n"
		);
		new Notice("Nous: sample note dropped in the inbox - watch it get enriched.");
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
		if (!(await this.hasAudioTranscriptionBackend())) {
			new VoiceCaptureSetupModal(this.app, this).open();
			return;
		}
		try {
			this.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			new Notice("Nous: microphone access denied - allow it for Obsidian in system settings.", 8000);
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
		new Notice("Nous: recording - press the hotkey again to stop.");
	}

	// Only true when every fallback condition is satisfied: opt-in toggle,
	// an OpenAI key (Realtime API only, reuses apiKeys.openai), and desktop
	// (browser WebSocket can't set an Authorization header - see
	// src/realtimeTranscribe.ts's header comment - so this needs the same
	// Node "ws" + nodeIntegration trick as CLI mode and local whisper.cpp,
	// neither of which exist on mobile). Any false here means the ribbon
	// falls straight through to the unchanged headless path above.
	private canUseLiveTranscription(): boolean {
		return this.settings.liveTranscriptionEnabled && !!this.settings.apiKeys.openai && Platform.isDesktopApp;
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
		new Notice("Nous: voice note captured.");
		if (!this.settings.autoProcessOnCreate) void this.processInbox();
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
				recording ? "Nous: recording - click to stop" : "Nous: toggle voice capture"
			);
		}
		if (this.voiceStatusBarEl) {
			if (recording) {
				this.voiceStatusBarEl.setText("🔴 Nous recording…");
				this.voiceStatusBarEl.show();
			} else {
				this.voiceStatusBarEl.hide();
			}
		}
	}

	// One button for full meeting capture (both sides of a call). Obsidian's
	// own mic access (toggleVoiceCapture above) can never hear the other
	// participant, so macOS meeting capture uses the native nous-recorder
	// helper directly.
	async toggleMeetingCapture() {
		if (!Platform.isMacOS) {
			new Notice("Nous: meeting capture needs macOS.");
			return;
		}

		const nativeStatus = await this.nativeRecorderStatus();
		if (nativeStatus.available) {
			await this.toggleNativeMeetingCapture(nativeStatus);
			return;
		}

		new Notice(MEETING_RECORDER_MISSING_NOTICE, 15000);
	}

	private async toggleNativeMeetingCapture(status: NativeRecorderStatus) {
		if (status.recording) {
			const liveNote = await this.findActiveNativeMeetingNote(status.output);
			const result = await this.runNativeRecorder("stop");
			if (result.code !== 0) {
				await this.appendLog(`ERROR: native recorder failed to stop: ${cliErrorDetail(result)}`);
				new Notice("Nous: recorder couldn't stop - see .nous/pipeline.log", 10000);
				return;
			}
			const stopped = parseNativeRecorderStatus(result.stdout);
			const recordingDir = stopped.output ?? status.output;
			this.setMeetingRecordingIndicator(false);
			this.activeNativeMeetingNotePath = null;
			new Notice("Nous: meeting recording stopped. Preparing transcript...");
			if (recordingDir) {
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
			new Notice("Nous: recorder couldn't start - see .nous/pipeline.log", 10000);
			return;
		}
		new Notice("Nous: starting meeting recording...");
		await new Promise((resolve) => window.setTimeout(resolve, 1500));
		const next = await this.nativeRecorderStatus();
		if (!next.available || !next.recording) {
			this.setMeetingRecordingIndicator(false);
			const detail = await this.nativeRecorderLogTail();
			this.nativeRecorderLastProblem = `Allow microphone and screen/audio recording permissions in macOS Privacy & Security, then try again.${detail ? ` Details: ${detail}` : ""}`;
			if (detail) await this.appendLog(`ERROR: native recorder stopped immediately: ${detail}`);
			new Notice(
				"Nous: recording stopped right away - allow Microphone and Screen Recording in Privacy & Security, then try again.",
				12000
			);
			return;
		}
		this.nativeRecorderLastProblem = null;
		this.setMeetingRecordingIndicator(true);
		try {
			this.activeNativeMeetingNotePath = await this.createLiveNativeMeetingNote(next.output);
			new Notice("Nous: meeting recording started. Live note opened.");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await this.appendLog(`ERROR: could not create live meeting note: ${msg}`);
			new Notice("Nous: meeting recording started, but the live note could not be opened.", 10000);
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
		});
	}

	private async nativeRecorderCommand(): Promise<string> {
		const configured = this.settings.nativeRecorderPath.trim() || DEFAULT_NATIVE_RECORDER_BIN;
		if (configured !== DEFAULT_NATIVE_RECORDER_BIN) return configured;

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

		const assetUrl = nativeRecorderReleaseAssetUrl(this.manifest.version);
		const checksumUrl = `${assetUrl}.sha256`;
		const checksumResponse = await requestUrl({ url: checksumUrl, method: "GET", throw: false });
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
		this.settings.nativeRecorderPath = DEFAULT_NATIVE_RECORDER_BIN;
		await this.saveSettings();
		return target;
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
				}
				return;
			}

			await this.ensureFolderExists(this.settings.inboxFolder);
			let notePath: string;
			const content = buildCompletedNativeRecordingNote(transcript.stamp, transcript.transcript, manualNotes);
			if (liveFile) {
				await this.app.vault.modify(liveFile, content);
				notePath = liveFile.path;
			} else {
				notePath = await this.uniqueVaultPath(`${this.settings.inboxFolder}/${transcript.stamp} Meeting transcript.md`);
				await this.app.vault.create(notePath, content);
			}
			await this.appendLog(`TRANSCRIBED: ${path.basename(recordingDir)} -> ${notePath}`);
			new Notice(`Nous: meeting transcript added to inbox: ${path.basename(notePath)}`);
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
			new Notice("Nous: transcription failed - your notes and audio are kept. See .nous/pipeline.log", 10000);
			await this.appendLog(`ERROR: native recording transcription failed: ${msg}`);
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
			new Notice("Nous: native recording had no transcribable audio.", 10000);
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
		let notePath: string;
		const content = buildPendingNativeRecordingNote(recordingDir, stamp, manualNotes);
		if (liveFile) {
			await this.app.vault.modify(liveFile, content);
			notePath = liveFile.path;
		} else {
			notePath = await this.uniqueVaultPath(`${this.settings.inboxFolder}/${stamp} Meeting recording needs transcription.md`);
			await this.app.vault.create(notePath, content);
		}
		await this.appendLog(`PENDING: ${path.basename(recordingDir)} needs speech-to-text setup -> ${notePath}`);
		new Notice(
			"Nous: meeting recording saved. Set up speech-to-text later, then run 'Nous: Process inbox now' to finish it.",
			12000
		);
	}

	private async markLiveNativeMeetingNoteProblem(
		liveFile: TFile,
		problem: string,
		knownManualNotes?: string
	): Promise<void> {
		const content = await this.app.vault.read(liveFile);
		const live = parseLiveNativeRecordingNote(content);
		if (!live) return;
		const manualNotes = knownManualNotes ?? extractNativeRecordingManualNotes(content);
		await this.app.vault.modify(liveFile, buildNativeRecordingProblemNote(live.recordedAt, problem, manualNotes));
		await this.appendLog(`RECOVERED: live native meeting note kept without transcript -> ${liveFile.path}`);
		new Notice("Nous: no transcript was created. Your live notes were kept in the inbox.", 10000);
		if (hasMeaningfulNativeRecordingManualNotes(manualNotes)) void this.processInbox();
	}

	private async transcribeExternalAudioWithSegments(filePath: string, filename: string): Promise<TrackTranscript> {
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
		const notePath = await this.uniqueVaultPath(`${this.settings.inboxFolder}/${stamp} Meeting live note.md`);
		await this.app.vault.create(notePath, buildLiveNativeRecordingNote(recordingDir, stamp));
		const file = this.app.vault.getFileByPath(notePath);
		if (file) await this.app.workspace.getLeaf(true).openFile(file);
		await this.appendLog(`LIVE NOTE: native meeting recording -> ${notePath}`);
		return notePath;
	}

	private async findActiveNativeMeetingNote(recordingDir: string | null = null): Promise<TFile | null> {
		if (this.activeNativeMeetingNotePath) {
			const file = this.app.vault.getFileByPath(this.activeNativeMeetingNotePath);
			if (file) {
				const live = parseLiveNativeRecordingNote(await this.app.vault.read(file));
				if (live) return file;
			}
		}

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
		if (this.meetingRibbonEl) {
			setIcon(this.meetingRibbonEl, recording ? "circle-stop" : "phone-call");
			this.meetingRibbonEl.toggleClass("nous-recording", recording);
			this.meetingRibbonEl.setAttribute(
				"aria-label",
				recording ? "Nous: meeting recording - click to stop" : "Nous: toggle meeting capture"
			);
		}
		if (this.meetingStatusBarEl) {
			if (recording) {
				this.meetingStatusBarEl.setText("🔴 Nous meeting recording…");
				this.meetingStatusBarEl.show();
			} else {
				this.meetingStatusBarEl.hide();
			}
		}
	}

	private async updateMeetingRecordingIndicator(): Promise<void> {
		const nativeStatus = await this.nativeRecorderStatus();
		this.setMeetingRecordingIndicator(nativeStatus.available && nativeStatus.recording);
	}

	async quickCapture(text: string, attached: File | null) {
		await this.ensureFolderExists(this.settings.inboxFolder);
		const stamp = window.moment().format("YYYY-MM-DD HH.mm.ss");
		if (attached) {
			const bytes = await attached.arrayBuffer();
			await this.app.vault.createBinary(`${this.settings.inboxFolder}/${stamp} ${attached.name}`, bytes);
		}
		if (text.trim()) {
			await this.app.vault.create(`${this.settings.inboxFolder}/${stamp}.md`, text.trim() + "\n");
		}
		new Notice("Nous: captured to inbox.");
		if (!this.settings.autoProcessOnCreate) void this.processInbox();
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
				new Notice(`Nous: failed on "${file.name}" - see .nous/pipeline.log`, 10000);
				await this.appendLog(`ERROR: ${file.name} - ${msg}`);
			}
		}

		if (enriched > 0) {
			new Notice(`Nous: ${enriched} note${enriched === 1 ? "" : "s"} enriched.`);
			await this.buildWikisViaApi();
		}
	}

	private async processInboxViaCli() {
		if (!Platform.isDesktopApp) {
			new Notice("Nous: CLI execution mode only works on desktop.", 10000);
			return;
		}
		if (this.cliRunInProgress) return;
		const basePath = this.getVaultBasePath();
		if (!basePath) {
			new Notice("Nous: could not resolve this vault's filesystem path.", 10000);
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

	// The claude binary can't read audio - transcribe each recording here and
	// leave a text note in the inbox for the CLI enricher to pick up.
	private async transcribeInboxAudioForCli(): Promise<void> {
		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		if (!folder) return;
		const audioFiles = folder.children.filter(
			(f): f is TFile => f instanceof TFile && logic.AUDIO_EXTENSIONS.includes(f.extension.toLowerCase())
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
				const notePath = `${this.settings.inboxFolder}/${file.basename} (voice).md`;
				const audioDest = `${this.settings.meetingsFolder}/${file.name}`;
				await this.app.vault.create(
					notePath,
					`${transcript.trim()}\n\n![[${file.name}]]\n`
				);
				await this.app.fileManager.renameFile(file, audioDest);
				await this.appendLog(`TRANSCRIBED: ${file.name} -> ${notePath}`);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				new Notice(`Nous: could not transcribe "${file.name}" - see .nous/pipeline.log`, 10000);
				await this.appendLog(`ERROR: ${file.name} - transcription failed: ${msg}`);
			}
		}
	}

	private async transcribePendingNativeRecordingsForCli(): Promise<void> {
		const folder = this.app.vault.getFolderByPath(this.settings.inboxFolder);
		if (!folder) return;
		const files = folder.children.filter(
			(f): f is TFile => f instanceof TFile && ["md", "txt"].includes(f.extension.toLowerCase())
		);
		let warnedMissingBackend = false;
		for (const file of files) {
			const content = await this.app.vault.read(file);
			const pending = parsePendingNativeRecordingNote(content);
			if (!pending) continue;

			if (!(await this.hasAudioTranscriptionBackend())) {
				if (!warnedMissingBackend) {
					new Notice(
						"Nous: a meeting recording is waiting for speech-to-text - set it up in Settings → Nous → Voice capture.",
						12000
					);
					warnedMissingBackend = true;
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
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				new Notice(`Nous: could not transcribe "${file.name}" - see .nous/pipeline.log`, 10000);
				await this.appendLog(`ERROR: ${file.name} - pending native recording transcription failed: ${msg}`);
			}
		}
	}

	private async runInboxCli(basePath: string) {
		await this.transcribeInboxAudioForCli();
		await this.transcribePendingNativeRecordingsForCli();
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
				`ERROR: meeting-enricher CLI exited ${enrichResult.code} - ${cliErrorDetail(enrichResult)}`
			);
			new Notice(
				"Nous: enrichment failed - see .nous/pipeline.log",
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
				`ERROR: wiki-builder CLI exited ${wikiResult.code} - ${cliErrorDetail(wikiResult)}`
			);
			new Notice("Nous: wiki step failed - see .nous/pipeline.log", 10000);
			return;
		}

		const summary = summarizeLogLines(await this.readLogSince(before));
		if (summary.enriched > 0) {
			const parts = [`${summary.enriched} note${summary.enriched === 1 ? "" : "s"} enriched`];
			if (summary.newWikis > 0) parts.push(`${summary.newWikis} new wiki${summary.newWikis === 1 ? "" : "s"}`);
			if (summary.updatedWikis > 0)
				parts.push(`${summary.updatedWikis} wiki${summary.updatedWikis === 1 ? "" : "s"} updated`);
			new Notice(`Nous: ${parts.join(", ")}.`);
		}
		if (summary.problems > 0) {
			new Notice(`Nous: ${summary.problems} item(s) skipped or errored - see .nous/pipeline.log`, 8000);
		}
	}

	private async runWikiBuilderCli() {
		if (!Platform.isDesktopApp) {
			new Notice("Nous: CLI execution mode only works on desktop.", 10000);
			return;
		}
		const basePath = this.getVaultBasePath();
		if (!basePath) {
			new Notice("Nous: could not resolve this vault's filesystem path.", 10000);
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
			await this.appendLog(`ERROR: wiki-builder CLI exited ${result.code} - ${cliErrorDetail(result)}`);
			new Notice("Nous: wiki step failed - see .nous/pipeline.log", 10000);
			return;
		}
		const summary = summarizeLogLines(await this.readLogSince(before));
		const parts: string[] = [];
		if (summary.newWikis > 0) parts.push(`${summary.newWikis} new wiki${summary.newWikis === 1 ? "" : "s"}`);
		if (summary.updatedWikis > 0)
			parts.push(`${summary.updatedWikis} wiki${summary.updatedWikis === 1 ? "" : "s"} updated`);
		new Notice(parts.length > 0 ? `Nous: ${parts.join(", ")}.` : "Nous: no wikis to build or update.");
	}

	async runVaultQuery(question: string) {
		if (this.settings.executionMode !== "cli") {
			new Notice("Nous: vault query needs CLI mode - switch it in Settings → Nous.", 10000);
			return;
		}
		if (!Platform.isDesktopApp) {
			new Notice("Nous: CLI execution mode only works on desktop.", 10000);
			return;
		}
		const basePath = this.getVaultBasePath();
		if (!basePath) {
			new Notice("Nous: could not resolve this vault's filesystem path.", 10000);
			return;
		}
		await this.ensureSkillsInstalled();
		new Notice("Nous: searching vault...");
		const result = await this.cliExec(
			this.settings.claudeCliPath,
			buildQueryArgs(question),
			{ cwd: basePath, env: this.cliEnv() }
		);
		if (result.code !== 0) {
			await this.appendLog(`ERROR: vault-query CLI exited ${result.code} - ${cliErrorDetail(result)}`);
			new Notice("Nous: query failed - see .nous/pipeline.log", 10000);
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
			new Notice(`Nous: no ${this.settings.apiProvider} API key set in plugin settings.`, 10000);
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
				if (binary.byteLength === 0) return false;

				if (isHeic) {
					if (!Platform.isDesktopApp) {
						new Notice(
							`Nous: HEIC capture needs desktop (uses macOS's sips tool) - "${file.name}" left in inbox.`,
							10000
						);
						return false;
					}
					try {
						binary = await this.convertHeicToJpeg(binary);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						new Notice(
							`Nous: HEIC conversion failed for "${file.name}" (needs macOS's sips tool) - see .nous/pipeline.log`,
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
				if (binary.byteLength === 0) return false;

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
					if (binary.byteLength === 0) return false;
					// Transcript goes through the normal text-enrichment path.
					raw = await this.transcribeAudio(ext, binary, file.name);
				}
			} else {
				raw = await this.app.vault.read(file);
				if (raw.trim().length === 0) return false;
				const liveNativeRecording = parseLiveNativeRecordingNote(raw);
				if (liveNativeRecording) return false;
				const pendingNativeRecording = parsePendingNativeRecordingNote(raw);
				if (pendingNativeRecording) {
					if (!(await this.hasAudioTranscriptionBackend())) {
						new Notice(
							`Nous: "${file.name}" is waiting for speech-to-text - set it up in Settings → Nous → Voice capture.`,
							12000
						);
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
					new Notice(`Nous: transcribed pending meeting recording "${file.name}".`);
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
				new Notice(`Nous API error (${e.status}) on "${file.name}" - see .nous/pipeline.log`, 10000);
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
				new Notice(`Nous: wiki build failed for "${cluster.tag}" - see .nous/pipeline.log`, 10000);
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
		// Pass every source, not just new ones - idempotent, and it repairs
		// older notes that missed the backlink.
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

class NousSettingTab extends PluginSettingTab {
	plugin: NousPlugin;
	// Provider whose model dropdown is showing the Custom field. Not persisted.
	private customModelFor: ApiProvider | null = null;
	// Whether rarely-touched fields (CLI paths, folder names, thresholds) are
	// shown. View-only, not persisted - resets to collapsed each time the
	// tab is reopened, same as customModelFor above.
	private showAdvanced = false;

	constructor(app: App, plugin: NousPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Obsidian's declarative getSettingDefinitions() API (below) only exists
	// since 1.13.0 - manifest.json's minAppVersion is kept at 1.6.6 (not
	// bumped to 1.13.0) specifically so pre-1.13.0 installs stay supported,
	// and 1.13.0 is a preview/insider release as of mid-2026 (1.12.7 is
	// current stable), so most installs are still on a runtime that has no
	// working SettingTab.display()/update() at all and
	// throws "e.display is not a function" the moment the tab opens. This
	// display() is a plain fallback that renders the same definitions
	// imperatively. On 1.13.0+, per Obsidian's own docs, display() is simply
	// never called once getSettingDefinitions() returns a non-empty array, so
	// this sits inert there and the native declarative rendering (search,
	// keyboard nav) is untouched.
	display(): void {
		this.renderLegacySettings();
	}

	private renderLegacySettings(): void {
		this.containerEl.empty();
		// None of this class's render callbacks use the group param below -
		// avoid constructing a real SettingGroup (Obsidian 1.11.0+ only) so
		// this fallback keeps working on the older versions it exists for.
		const group = undefined as unknown as SettingGroup;
		for (const item of this.getSettingDefinitions()) {
			if (!("render" in item) || typeof item.render !== "function") continue;
			const setting = new Setting(this.containerEl);
			if (item.name) setting.setName(item.name);
			if (item.desc) setting.setDesc(item.desc);
			item.render(setting, group);
		}
	}

	// Same story: this class's `render` callbacks call `this.update()` after
	// a change that should re-render (e.g. switching execution mode reveals
	// different fields below it). On 1.13.0+, defer to the real inherited
	// update() (search indexing etc.); pre-1.13.0 it doesn't exist, so fall
	// back to a plain re-render via display() above.
	update(): void {
		const inherited = (Object.getPrototypeOf(NousSettingTab.prototype) as { update?: () => void }).update;
		if (typeof inherited === "function") {
			inherited.call(this);
		} else {
			this.renderLegacySettings();
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = [];

		items.push({
			name: "Execution mode",
			render: (setting) => {
				setting
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
								this.update();
							});
					});
			},
		});

		if (!Platform.isDesktopApp && this.plugin.settings.executionMode === "cli") {
			items.push({
				name: "",
				render: (setting) => {
					setting
						.setDesc(
							"CLI mode doesn't work on mobile - switch to direct API key here, or use this device only to browse the vault."
						)
						.setClass("mod-warning");
				},
			});
		}

		items.push({
			name: "Advanced settings",
			render: (setting) => {
				setting
					.setDesc("CLI/recorder/whisper paths, folder names, and tuning thresholds - defaults work for almost everyone.")
					.addToggle((toggle) =>
						toggle.setValue(this.showAdvanced).onChange((value) => {
							this.showAdvanced = value;
							this.update();
						})
					);
			},
		});

		if (this.plugin.settings.executionMode === "cli" && this.showAdvanced) {
			items.push({
				name: "Claude CLI path",
				render: (setting) => {
					setting
						.setDesc(
							'Command or full path to the Claude Code CLI. Obsidian (an Electron app) often starts with a slimmer PATH than your terminal, so if "claude" isn\'t found, try the full path (e.g. from running `which claude` in your terminal).'
						)
						.addText((text) =>
							text
								.setPlaceholder(DEFAULT_CLAUDE_CLI_BIN)
								.setValue(this.plugin.settings.claudeCliPath)
								.onChange(async (value) => {
									this.plugin.settings.claudeCliPath = value.trim() || DEFAULT_CLAUDE_CLI_BIN;
									await this.plugin.saveSettings();
								})
						);
				},
			});
		}
		if (this.plugin.settings.executionMode !== "cli") {
			const provider = this.plugin.settings.apiProvider;
			const providerLabel = {
				anthropic: "Anthropic",
				openai: "OpenAI",
				gemini: "Gemini",
				glm: "GLM",
				local: "Local",
			}[provider];

			items.push({
				name: "Provider",
				render: (setting) => {
					setting
						.setDesc(
							'Which model API to call directly. "local" needs no API key and sends nothing off this machine (e.g. Ollama).'
						)
						.addDropdown((dropdown) => {
							dropdown
								.addOption("anthropic", "Anthropic")
								.addOption("openai", "OpenAI")
								.addOption("gemini", "Gemini")
								.addOption("glm", "GLM (Z.ai)")
								.addOption("local", "Local (OpenAI-compatible, e.g. Ollama)")
								.setValue(provider)
								.onChange(async (value) => {
									this.plugin.settings.apiProvider = value as ApiProvider;
									await this.plugin.saveSettings();
									this.update();
								});
						});
				},
			});

			if (provider === "local") {
				items.push({
					name: "Base URL",
					render: (setting) => {
						setting.setDesc(LOCAL_BASE_URL_DESC).addText((text) =>
							text.setValue(this.plugin.settings.localBaseUrl).onChange(async (value) => {
								this.plugin.settings.localBaseUrl = value.trim() || DEFAULT_SETTINGS.localBaseUrl;
								await this.plugin.saveSettings();
							})
						);
					},
				});
			} else if (provider === "glm") {
				items.push({
					name: "GLM API key",
					render: (setting) => {
						setting.setDesc("Your Z.ai API key - stored locally in this vault.").addText((text) => {
							text.inputEl.type = "password";
							text.inputEl.autocomplete = "off";
							text.setValue(this.plugin.settings.apiKeys.glm).onChange(async (value) => {
								this.plugin.settings.apiKeys.glm = value.trim();
								await this.plugin.saveSettings();
							});
						});
					},
				});
				items.push({
					name: "Base URL",
					render: (setting) => {
						setting
							.setDesc(
								'Z.ai OpenAI-compatible endpoint. The coding endpoint is "https://api.z.ai/api/coding/paas/v4" if you have a Coding Plan.'
							)
							.addText((text) =>
								text.setValue(this.plugin.settings.glmBaseUrl).onChange(async (value) => {
									this.plugin.settings.glmBaseUrl = value.trim() || DEFAULT_SETTINGS.glmBaseUrl;
									await this.plugin.saveSettings();
								})
							);
					},
				});
			} else {
				items.push({
					name: `${providerLabel} API key`,
					render: (setting) => {
						setting
							.setDesc(
								`Stored locally in this vault's ${this.app.vault.configDir}/plugins/nous/data.json - keep this vault out of any repo or sync you don't fully control.`
							)
							.addText((text) => {
								text.inputEl.type = "password";
								text.inputEl.autocomplete = "off";
								text.setValue(this.plugin.settings.apiKeys[provider]).onChange(async (value) => {
									this.plugin.settings.apiKeys[provider] = value.trim();
									await this.plugin.saveSettings();
								});
							});
					},
				});
			}

			if (provider === "local") {
				items.push({
					name: "Model",
					render: (setting) => {
						setting
							.setDesc('Model your local server should run, e.g. an Ollama model tag like "llama3.1".')
							.addText((text) =>
								text.setValue(this.plugin.settings.models[provider]).onChange(async (value) => {
									this.plugin.settings.models[provider] = value.trim();
									await this.plugin.saveSettings();
								})
							);
					},
				});
			} else {
				const options = MODEL_OPTIONS[provider];
				const current = this.plugin.settings.models[provider];
				const isListed = options.some((o) => o.id === current);
				const showCustom = !isListed || this.customModelFor === provider;
				items.push({
					name: "Model",
					render: (setting) => {
						setting
							.setDesc(`${providerLabel} model used for both enrichment and wiki synthesis.`)
							.addDropdown((dropdown) => {
								for (const o of options) dropdown.addOption(o.id, o.label);
								dropdown.addOption("__custom__", "Custom model ID…");
								dropdown.setValue(showCustom ? "__custom__" : current).onChange(async (value) => {
									if (value === "__custom__") {
										this.customModelFor = provider;
									} else {
										this.customModelFor = null;
										this.plugin.settings.models[provider] = value;
										await this.plugin.saveSettings();
									}
									this.update();
								});
							});
					},
				});
				if (showCustom) {
					items.push({
						name: "Custom model ID",
						render: (setting) => {
							setting
								.setDesc(`Exact ${providerLabel} model id to use instead of the list above.`)
								.addText((text) =>
									text.setValue(current).onChange(async (value) => {
										this.plugin.settings.models[provider] = value.trim();
										await this.plugin.saveSettings();
									})
								);
						},
					});
				}
			}
		}

		items.push({
			name: "Test connection",
			render: (setting) => {
				setting
					.setDesc(
						this.plugin.settings.executionMode === "cli"
							? "Checks that the Claude Code CLI can be found and run from Obsidian."
							: "Makes one tiny API call with the provider, key, and model above to confirm they work."
					)
					.addButton((button) =>
						button.setButtonText("Test").onClick(async () => {
							button.setButtonText("Testing…").setDisabled(true);
							try {
								new Notice(`Nous: ${await this.plugin.testConnection()}`);
							} catch (e) {
								const msg =
									e instanceof LlmApiError
										? `${e.message} (HTTP ${e.status})`
										: e instanceof Error
											? e.message
											: String(e);
								new Notice(`Nous: connection test failed - ${msg}`, 10000);
							} finally {
								button.setButtonText("Test").setDisabled(false);
							}
						})
					);
			},
		});

		items.push({
			name: "Auto-process on capture",
			render: (setting) => {
				setting
					.setDesc("Enrich a new inbox note within a couple seconds of it being created, instead of only on manual runs.")
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.autoProcessOnCreate).onChange(async (value) => {
							this.plugin.settings.autoProcessOnCreate = value;
							await this.plugin.saveSettings();
							new Notice("Reload the plugin (or restart Obsidian) for this change to take effect.");
						})
				);
			},
		});

		items.push({
			name: "Meeting capture",
			render: (setting) => {
				setting.setHeading();
			},
		});
		items.push({
			name: "",
			render: (setting) => {
				setting
					.setDesc(
						"On macOS, the phone button uses the native Nous recorder. Click once to start a meeting recording, then click it again to stop."
					)
					.setClass("setting-item-description");
			},
		});

		if (Platform.isMacOS) {
			items.push({
				name: "Native recorder status",
				render: (setting) => {
					const refreshStatus = async (button?: ButtonComponent) => {
						button?.setButtonText("Checking...").setDisabled(true);
						setting.setDesc("Checking native recorder status...");
						try {
							const status = await this.plugin.getNativeRecorderReadiness();
							setting.setDesc(nativeRecorderReadinessText(status));
							button?.setButtonText(status.state === "needs-permission" ? "Recheck after retrying phone button" : "Refresh");
							setting.settingEl.toggleClass(
								"mod-warning",
								status.state === "missing" || status.state === "needs-permission" || status.state === "error"
							);
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e);
							setting.setDesc(`Could not check the native recorder: ${msg}`);
							setting.settingEl.toggleClass("mod-warning", true);
						} finally {
							button?.setDisabled(false);
						}
					};

					setting
						.setDesc("Checking native recorder status...")
						.addButton((button) => button.setButtonText("Refresh").onClick(() => void refreshStatus(button)));
					void refreshStatus();
				},
			});
			items.push({
				name: "Native recorder helper",
				render: (setting) => {
					setting
						.setDesc(NATIVE_RECORDER_INSTALL_DESC)
						.addButton((button) =>
							button.setButtonText("Install/update").onClick(async () => {
								button.setButtonText("Installing...").setDisabled(true);
								try {
									const installedPath = await this.plugin.installNativeRecorderFromRelease();
									new Notice(`Nous: native recorder installed at ${installedPath}`);
									this.update();
								} catch (e) {
									const msg = e instanceof Error ? e.message : String(e);
									new Notice(`Nous: native recorder install failed - ${msg}`, 12000);
								} finally {
									button.setButtonText("Install/update").setDisabled(false);
								}
							})
						);
				},
			});
		}

		if (this.showAdvanced && Platform.isMacOS) {
			items.push({
				name: "Nous Recorder path",
				render: (setting) => {
					setting
						.setDesc(
							"Command or full path to the native meeting recorder helper. The default works when the helper is installed in ~/.local/bin or another path directory."
						)
						.addText((text) =>
							text
								.setPlaceholder(DEFAULT_NATIVE_RECORDER_BIN)
								.setValue(this.plugin.settings.nativeRecorderPath)
								.onChange(async (value) => {
									this.plugin.settings.nativeRecorderPath = value.trim() || DEFAULT_NATIVE_RECORDER_BIN;
									await this.plugin.saveSettings();
								})
						);
				},
			});
		}

		if (this.showAdvanced) {
			items.push({
				name: "Wiki threshold",
				render: (setting) => {
					setting
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
				},
			});

			if (this.plugin.settings.executionMode === "api") {
				// CLI mode's duplicate check lives in the skill - nothing to configure here.
				items.push({
					name: "Duplicate-check lookback",
					render: (setting) => {
						setting
							.setDesc(
								"How many of the most recent meeting notes to compare new captures against for duplicates and related-note linking."
							)
							.addText((text) =>
								text.setValue(String(this.plugin.settings.dedupLookback)).onChange(async (value) => {
									const n = parseInt(value, 10);
									if (!Number.isNaN(n) && n > 0) {
										this.plugin.settings.dedupLookback = n;
										await this.plugin.saveSettings();
									}
								})
							);
					},
				});
			}
		}

		items.push({
			name: "Voice capture",
			render: (setting) => {
				setting.setHeading();
			},
		});
		items.push({
			name: "",
			render: (setting) => {
				setting
					.setDesc(VOICE_CAPTURE_SETTINGS_DESC)
					.setClass("setting-item-description");
			},
		});

		if (Platform.isMacOS) {
			items.push({
				name: "Speech model",
				render: (setting) => {
					setting.setDesc("Checking…");
					void this.plugin.hasWhisperModel().then((present) => {
						if (present) {
							setting.setDesc("Speech model installed - voice notes transcribe locally.");
							return;
						}
						setting.setDesc(
							"No local speech model yet. Download once (~1.6 GB) and voice transcription runs fully on this Mac. Also needs whisper-cli: \"brew install whisper-cpp\"."
						);
						setting.addButton((b) =>
							b.setButtonText("Download model").setCta().onClick(() => {
								b.setDisabled(true);
								void this.plugin.downloadWhisperModelsWithNotice().finally(() => this.update());
							})
						);
					});
				},
			});
		}

		items.push({
			name: "Live voice transcription (beta)",
			render: (setting) => {
				setting
					.setDesc(
						"Shows your words as you talk, Siri-style, instead of only after you stop. OpenAI-only for now - the only supported provider that streams your own speech live. Desktop only, reuses the OpenAI key above. Falls back to normal recording if unavailable or interrupted - nothing is lost."
					)
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.liveTranscriptionEnabled).onChange(async (value) => {
							this.plugin.settings.liveTranscriptionEnabled = value;
							await this.plugin.saveSettings();
							this.update();
						})
					);
			},
		});
		if (this.plugin.settings.liveTranscriptionEnabled && !this.plugin.settings.apiKeys.openai) {
			items.push({
				name: "",
				render: (setting) => {
					setting
						.setDesc("Needs an OpenAI API key above - until then, voice capture works normally (non-live).")
						.setClass("mod-warning");
				},
			});
		}

		if (this.showAdvanced) {
			items.push({
				name: "Whisper CLI path",
				render: (setting) => {
					setting
						.setDesc(
							'Command or full path to whisper-cli, the local transcription engine (for example, installed via "brew install whisper-cpp"). macOS only.'
						)
						.addText((text) =>
							text
								.setPlaceholder(DEFAULT_WHISPER_CLI_BIN)
								.setValue(this.plugin.settings.whisperCliPath)
								.onChange(async (value) => {
									this.plugin.settings.whisperCliPath = value.trim() || DEFAULT_WHISPER_CLI_BIN;
									await this.plugin.saveSettings();
								})
						);
				},
			});

			items.push({
				name: "Whisper model path",
				render: (setting) => {
					setting
						.setDesc(
							`Full path to a ggml whisper model file. Leave blank to use the default location (${this.plugin.defaultWhisperModelPath()}).`
						)
						.addText((text) =>
							text
								.setPlaceholder(this.plugin.defaultWhisperModelPath())
								.setValue(this.plugin.settings.whisperModelPath)
								.onChange(async (value) => {
									this.plugin.settings.whisperModelPath = value.trim();
									await this.plugin.saveSettings();
								})
						);
				},
			});

			items.push({
				name: "Folders",
				render: (setting) => {
					setting.setHeading();
				},
			});

			const folderSetting = (key: keyof NousSettings, name: string): SettingDefinitionItem => ({
				name,
				render: (setting) => {
					setting.addText((text) =>
						text.setValue(this.plugin.settings[key] as string).onChange(async (value) => {
							(this.plugin.settings[key] as string) = value.trim();
							await this.plugin.saveSettings();
						})
					);
				},
			});
			items.push(folderSetting("inboxFolder", "Inbox folder"));
			items.push(folderSetting("meetingsFolder", "Meetings folder"));
			items.push(folderSetting("wikisFolder", "Wikis folder"));
			items.push(folderSetting("tagsFolder", "Tags folder"));
			items.push(folderSetting("queriesFolder", "Queries folder"));
		}

		return items;
	}
}

class VoiceCaptureSetupModal extends Modal {
	constructor(app: App, private plugin: NousPlugin) {
		super(app);
	}

	onOpen() {
		this.setTitle("Set up voice notes");
		this.contentEl.createEl("p", {
			text: "Voice notes need speech-to-text before Nous can start recording.",
		});
		this.contentEl.createEl("p", {
			text: "Choose one path: install local whisper.cpp on macOS for private transcription, or add a Gemini/OpenAI key in Settings -> Nous. Gemini/OpenAI keys are used only to turn speech into text.",
		});

		new Setting(this.contentEl)
			.setName("Private option")
			.setDesc("Install whisper.cpp, then set the model path in settings -> Nous -> advanced settings -> voice capture.");

		new Setting(this.contentEl)
			.setName("Cloud option")
			.setDesc("Add a Gemini or OpenAI key in settings -> Nous. You can still use Claude, GLM, or a local model for the note-writing step.");

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Open setup wizard").setCta().onClick(() => {
					this.close();
					new OnboardingModal(this.app, this.plugin).open();
				})
			)
			.addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
	}
}

// First-run setup: pick how notes are written, prove it works, then show
// the optional voice/meeting setup state before the user leaves the wizard.
class OnboardingModal extends Modal {
	private lastCaptureStatus: CapturePrerequisiteStatus | null = null;

	constructor(app: App, private plugin: NousPlugin) {
		super(app);
	}

	onOpen() {
		this.renderWelcome();
	}

	private clear() {
		this.contentEl.empty();
	}

	private renderWelcome() {
		this.clear();
		this.setTitle("Welcome to Nous");
		this.contentEl.createEl("p", {
			text: "First, choose how Nous should write and organize your notes. After that, the wizard checks optional voice and meeting recording setup.",
		});
		this.contentEl.createEl("p", {
			text: ONBOARDING_PREREQUISITES_TEXT,
		});

		new Setting(this.contentEl)
			.setName("I have a Claude subscription (pro/max)")
			.setDesc("Uses Claude Code - no separate billing. Desktop only.")
			.addButton((b) =>
				b.setButtonText("Use Claude Code").setCta().onClick(async () => {
					this.plugin.settings.executionMode = "cli";
					await this.plugin.saveSettings();
					this.renderTest();
				})
			);

		new Setting(this.contentEl)
			.setName("I want a free local model")
			.setDesc("E.g. Ollama - nothing leaves your machine, no billing, no account. ~2 min setup.")
			.addButton((b) =>
				b.setButtonText("Use a local model").onClick(async () => {
					this.plugin.settings.executionMode = "api";
					this.plugin.settings.apiProvider = "local";
					await this.plugin.saveSettings();
					this.renderApiSetup();
				})
			);

		new Setting(this.contentEl)
			.setName("I have an API key")
			.setDesc("Anthropic, OpenAI, Gemini, or Z.ai. Billed separately, works on mobile too.")
			.addButton((b) =>
				b.setButtonText("Use an API key").onClick(async () => {
					this.plugin.settings.executionMode = "api";
					await this.plugin.saveSettings();
					this.renderApiSetup();
				})
			);

		new Setting(this.contentEl)
			.setName("Not now")
			.setDesc("You can rerun this anytime: command palette → \"Nous: Open setup wizard\".")
			.addButton((b) =>
				b.setButtonText("Skip").onClick(async () => {
					this.plugin.settings.onboarded = true;
					await this.plugin.saveSettings();
					this.close();
				})
			);
	}

	private renderApiSetup() {
		this.clear();
		this.setTitle("Connect a provider");

		const provider = () => this.plugin.settings.apiProvider;

		new Setting(this.contentEl).setName("Provider").addDropdown((dropdown) => {
			dropdown
				.addOption("anthropic", "Anthropic")
				.addOption("openai", "OpenAI")
				.addOption("gemini", "Gemini")
				.addOption("glm", "GLM (Z.ai)")
				.addOption("local", "Local (e.g. Ollama)")
				.setValue(provider())
				.onChange(async (value) => {
					this.plugin.settings.apiProvider = value as ApiProvider;
					await this.plugin.saveSettings();
					this.renderApiSetup();
				});
		});

		if (provider() === "local") {
			new Setting(this.contentEl)
				.setName("Base URL")
				.setDesc("Your OpenAI-compatible endpoint.")
				.addText((text) =>
					text.setValue(this.plugin.settings.localBaseUrl).onChange(async (value) => {
						this.plugin.settings.localBaseUrl = value.trim() || DEFAULT_SETTINGS.localBaseUrl;
						await this.plugin.saveSettings();
					})
				);
		} else if (provider() === "glm") {
			new Setting(this.contentEl)
				.setName("GLM API key")
				.setDesc("Your Z.ai API key - stored locally in this vault.")
				.addText((text) => {
					text.inputEl.type = "password";
					text.inputEl.autocomplete = "off";
					text.setPlaceholder("Paste your key").onChange(async (value) => {
						this.plugin.settings.apiKeys.glm = value.trim();
						await this.plugin.saveSettings();
					});
				});
			new Setting(this.contentEl)
				.setName("Base URL")
				.setDesc('Z.ai OpenAI-compatible endpoint. Use "https://api.z.ai/api/coding/paas/v4" for the Coding Plan.')
				.addText((text) =>
					text.setValue(this.plugin.settings.glmBaseUrl).onChange(async (value) => {
						this.plugin.settings.glmBaseUrl = value.trim() || DEFAULT_SETTINGS.glmBaseUrl;
						await this.plugin.saveSettings();
					})
				);
		} else {
			new Setting(this.contentEl)
				.setName("API key")
				.setDesc("Stored locally in this vault, never sent anywhere except your provider.")
				.addText((text) => {
					text.inputEl.type = "password";
					text.inputEl.autocomplete = "off";
					text.setPlaceholder("Paste your key").onChange(async (value) => {
						this.plugin.settings.apiKeys[provider()] = value.trim();
						await this.plugin.saveSettings();
					});
				});
		}

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Back").onClick(() => this.renderWelcome()))
			.addButton((b) => b.setButtonText("Continue").setCta().onClick(() => this.renderTest()));
	}

	private renderTest() {
		this.clear();
		this.setTitle("Check the connection");
		const isCli = this.plugin.settings.executionMode === "cli";
		this.contentEl.createEl("p", {
			text: isCli
				? "Nous will check that Claude Code is installed and reachable. If you haven't installed it yet: docs.claude.com/claude-code (a one-time step)."
				: "Nous will make one tiny API call to confirm your key and model work.",
		});
		const status = this.contentEl.createEl("p", { text: "" });

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Back").onClick(() => (isCli ? this.renderWelcome() : this.renderApiSetup())))
			.addButton((b) =>
				b.setButtonText("Test").setCta().onClick(async () => {
					b.setButtonText("Testing…").setDisabled(true);
					try {
						status.setText(`✓ ${await this.plugin.testConnection()}`);
						b.setButtonText("Test").setDisabled(false);
						this.renderCapturePrerequisites();
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						status.setText(`✗ ${msg}`);
						b.setButtonText("Test").setDisabled(false);
					}
				})
			)
			.addButton((b) => b.setButtonText("Skip test").onClick(() => this.renderCapturePrerequisites()));
	}

	private renderCapturePrerequisites() {
		this.clear();
		this.setTitle("Capture prerequisites");
		this.contentEl.createEl("p", {
			text: "Your first text capture is ready. These optional capture buttons need a little more system setup:",
		});
		const statusEl = this.contentEl.createDiv();
		statusEl.createEl("p", { text: "Checking capture setup..." });
		let continueButton: ButtonComponent | null = null;
		void this.plugin
			.getCapturePrerequisiteStatus()
			.then((status) => {
				this.lastCaptureStatus = status;
				statusEl.empty();
				for (const item of capturePrerequisiteItems(status)) {
					const setting = new Setting(statusEl).setName(item.name).setDesc(item.desc);
					if (item.warning) setting.setClass("mod-warning");
				}
				if (Platform.isMacOS) {
					const recorderStatusSetting = new Setting(statusEl)
						.setName("Native recorder status")
						.setDesc("Checking native recorder status...");
					void this.plugin
						.getNativeRecorderReadiness()
						.then((readiness) => {
							recorderStatusSetting.setDesc(nativeRecorderReadinessText(readiness));
							recorderStatusSetting.settingEl.toggleClass(
								"mod-warning",
								readiness.state === "missing" ||
									readiness.state === "needs-permission" ||
									readiness.state === "error"
							);
						})
						.catch((e) => {
							const msg = e instanceof Error ? e.message : String(e);
							recorderStatusSetting.setDesc(`Could not check the native recorder: ${msg}`);
							recorderStatusSetting.settingEl.toggleClass("mod-warning", true);
						});
				}
				if (Platform.isMacOS && !status.voiceReady) {
					void this.plugin.hasWhisperModel().then((present) => {
						if (present) return;
						new Setting(statusEl)
							.setName("Download speech model")
							.setDesc(
								"One download (~1.6 GB) and voice transcription runs fully on this Mac - no API key. Also needs whisper-cli: \"brew install whisper-cpp\"."
							)
							.addButton((button) =>
								button.setButtonText("Download").setCta().onClick(async () => {
									button.setButtonText("Downloading…").setDisabled(true);
									const ok = await this.plugin.downloadWhisperModelsWithNotice();
									if (ok) this.renderCapturePrerequisites();
									else button.setButtonText("Download").setDisabled(false);
								})
							);
					});
				}
				if (Platform.isMacOS && shouldOfferNativeRecorderInstall(status)) {
					new Setting(statusEl)
						.setName("Install native recorder")
						.setDesc(NATIVE_RECORDER_INSTALL_DESC)
						.addButton((button) =>
							button.setButtonText("Install").setCta().onClick(async () => {
								button.setButtonText("Installing...").setDisabled(true);
								try {
									await this.plugin.installNativeRecorderFromRelease();
									new Notice("Nous: native recorder installed.");
									this.renderCapturePrerequisites();
								} catch (e) {
									const msg = e instanceof Error ? e.message : String(e);
									new Notice(`Nous: native recorder install failed - ${msg}`, 12000);
									button.setButtonText("Install").setDisabled(false);
								}
							})
						);
				}
				continueButton?.setButtonText(capturePrerequisitesContinueText(status)).setDisabled(false);
			})
			.catch((e) => {
				const msg = e instanceof Error ? e.message : String(e);
				statusEl.setText(`Could not check capture setup: ${msg}`);
				continueButton?.setButtonText("Continue anyway").setDisabled(false);
			});

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Back").onClick(() => this.renderTest()))
			.addButton((b) => {
				continueButton = b;
				b.setButtonText("Checking...").setCta().setDisabled(true).onClick(() => this.renderFinish());
			});
	}

	private renderFinish() {
		this.clear();
		const status = this.lastCaptureStatus;
		this.setTitle(status ? onboardingFinishTitle(status) : "Text capture is ready");
		this.contentEl.createEl("p", {
			text: status
				? onboardingFinishIntro(status, this.plugin.settings.inboxFolder, this.plugin.settings.meetingsFolder)
				: `Text, images, and PDFs are ready now. Drop them into "${this.plugin.settings.inboxFolder}" and they come out tagged, summarized, and linked in "${this.plugin.settings.meetingsFolder}".`,
		});
		if (status) {
			const nextActions = onboardingFinishNextActions(status);
			if (nextActions.length > 0) {
				this.contentEl.createEl("p", { text: "Optional next steps:" });
				for (const item of nextActions) {
					const setting = new Setting(this.contentEl).setName(item.name).setDesc(item.desc);
					if (item.warning) setting.setClass("mod-warning");
				}
			}
		}
		this.contentEl.createEl("p", {
			text: "Want to see it happen right now? Nous can drop a sample note into the inbox and enrich it while you watch.",
		});

		new Setting(this.contentEl)
			.addButton((b) =>
				b.setButtonText("Finish").onClick(async () => {
					await this.finish(false);
				})
			)
			.addButton((b) =>
				b.setButtonText("Finish + try a sample note").setCta().onClick(async () => {
					await this.finish(true);
				})
			);
	}

	private async finish(withSample: boolean) {
		this.plugin.settings.onboarded = true;
		await this.plugin.saveSettings();
		await this.plugin.ensureCoreFolders();
		this.close();
		if (withSample) {
			await this.plugin.createSampleNote();
		}
		void this.plugin.processInbox();
	}
}

// Type/paste or attach a file - lands in the inbox, no folders involved.
class QuickCaptureModal extends Modal {
	private text = "";
	private attachedFile: File | null = null;

	constructor(app: App, private plugin: NousPlugin) {
		super(app);
	}

	onOpen() {
		this.setTitle("Quick capture");
		const input = this.contentEl.createEl("textarea", {
			attr: { rows: "5", placeholder: "Type or paste anything… (Enter to save, Shift+Enter for a new line)" },
		});
		input.setCssStyles({ width: "100%" });
		input.addEventListener("input", () => {
			this.text = input.value;
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void submit();
			}
		});

		const fileLabel = this.contentEl.createEl("p", { text: "" });
		const picker = this.contentEl.createEl("input", {
			attr: { type: "file", accept: ".png,.jpg,.jpeg,.webp,.heic,.heif,.pdf,.m4a,.webm,.mp3,.wav,.ogg,.flac" },
		});
		picker.setCssStyles({ display: "none" });
		picker.addEventListener("change", () => {
			this.attachedFile = picker.files?.[0] ?? null;
			fileLabel.setText(this.attachedFile ? `Attached: ${this.attachedFile.name}` : "");
		});

		const submit = async () => {
			if (!this.text.trim() && !this.attachedFile) return;
			this.close();
			await this.plugin.quickCapture(this.text, this.attachedFile);
		};

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Attach file").onClick(() => picker.click()))
			.addButton((b) => b.setButtonText("Capture").setCta().onClick(() => void submit()));

		input.focus();
	}
}

// Live/streaming dictation - Siri-style: transcript text grows while the
// user is still talking, instead of only appearing after Stop. Layered
// strictly on top of the same MediaRecorder capture toggleVoiceCapture()
// already uses: the recorder starts first and keeps running unconditionally
// as the safety net, so if the OpenAI Realtime side never connects, drops
// mid-recording, or errors, the recording itself is never at risk - stop
// still produces a normal saved file that falls through to the unchanged
// batch transcription pipeline exactly as if this modal had never opened.
class LiveVoiceCaptureModal extends Modal {
	private stream: MediaStream | null = null;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private audioCtx: AudioContext | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private transcriber: RealtimeTranscriber | null = null;
	// Finalized segments (server VAD committed them) plus whatever partial
	// text is still in flight for the current, not-yet-committed segment.
	private segments: string[] = [];
	private partial = "";
	// Set once Stop/Cancel/onClose has been handled, so the three
	// overlapping close paths (button, Esc/click-outside triggering
	// onClose, stopAndClose() calling this.close() which re-triggers
	// onClose) run the stop/save logic exactly once.
	private handled = false;
	// Set when the live connection drops mid-recording after some segments
	// were already committed - forces stopAndClose() to discard those
	// partial segments and let the batch pipeline re-transcribe the full
	// recording, instead of silently saving a transcript truncated at the
	// drop point (see onError below).
	private liveDropped = false;
	private statusEl: HTMLElement | null = null;
	private transcriptEl: HTMLElement | null = null;

	constructor(app: App, private plugin: NousPlugin) {
		super(app);
	}

	onOpen() {
		this.setTitle("Live voice capture (beta)");
		this.statusEl = this.contentEl.createEl("p", { text: "Starting…", cls: "setting-item-description" });
		this.transcriptEl = this.contentEl.createDiv({ text: "Listening…" });
		this.transcriptEl.setCssStyles({ minHeight: "4em", whiteSpace: "pre-wrap" });

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => void this.cancel()))
			.addButton((b) => b.setButtonText("Stop").setCta().onClick(() => void this.stopAndClose()));

		void this.start();
	}

	private renderTranscript() {
		const text = [...this.segments, this.partial].filter(Boolean).join(" ");
		this.transcriptEl?.setText(text || "Listening…");
	}

	private async start() {
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			new Notice("Nous: microphone access denied - allow it for Obsidian in system settings.", 8000);
			this.close();
			return;
		}

		// The existing, unmodified MediaRecorder path - starts first and
		// independently of the live-transcription setup below.
		const mimeType = pickVoiceMimeType();
		const recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};
		recorder.start();
		this.recorder = recorder;
		this.plugin.setVoiceRecordingIndicator(true);

		try {
			await this.startLiveTranscription();
			this.statusEl?.setText("🔴 Listening…");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.teardownLiveTranscription();
			this.statusEl?.setText("Live transcription unavailable - finishing as a normal recording.");
			await this.plugin.appendLog(`ERROR: live transcription failed to start - ${msg}`);
		}
	}

	private async startLiveTranscription() {
		const { WebSocket: WsCtor } = await loadWsModule();
		const transcriber = new RealtimeTranscriber({
			apiKey: this.plugin.settings.apiKeys.openai,
			wsFactory: (url, headers) => new WsCtor(url, { headers }) as unknown as RealtimeSocket,
			onPartial: (text) => {
				this.partial = text;
				this.renderTranscript();
			},
			onSegmentDone: (text) => {
				if (text.trim()) this.segments.push(text.trim());
				this.partial = "";
				this.renderTranscript();
			},
			onError: (message) => {
				// Also fires from our own close()/connection teardown on
				// stop - handled is already true by then, so this is only
				// a real mid-recording drop when it's still false.
				if (this.handled) return;
				this.liveDropped = true;
				this.teardownLiveTranscription();
				this.statusEl?.setText("Live transcription dropped - still recording, will transcribe after stop.");
				void this.plugin.appendLog(`ERROR: live transcription connection dropped - ${message}`);
			},
		});
		transcriber.connect();
		this.transcriber = transcriber;

		// {sampleRate: 24000} is only a hint - some platforms clamp to the
		// hardware rate, which is why sendAudioChunk() downsamples using
		// the AudioContext's actual sampleRate rather than assuming 24kHz.
		const ctx = new AudioContext({ sampleRate: 24000 });
		this.audioCtx = ctx;
		const source = ctx.createMediaStreamSource(this.stream as MediaStream);

		// A tiny inline AudioWorkletProcessor, registered via a Blob URL -
		// no new asset needs to ship with the plugin for this. It just
		// forwards each render quantum's Float32 samples to the main thread.
		const workletUrl = URL.createObjectURL(
			new Blob(
				[
					`class NousPcmWorklet extends AudioWorkletProcessor {
						process(inputs) {
							const channel = inputs[0]?.[0];
							if (channel) this.port.postMessage(channel.slice());
							return true;
						}
					}
					registerProcessor("nous-pcm-worklet", NousPcmWorklet);`,
				],
				{ type: "application/javascript" }
			)
		);
		try {
			await ctx.audioWorklet.addModule(workletUrl);
		} finally {
			URL.revokeObjectURL(workletUrl);
		}
		const worklet = new AudioWorkletNode(ctx, "nous-pcm-worklet");
		worklet.port.onmessage = (event: MessageEvent) => {
			this.transcriber?.sendAudioChunk(event.data as Float32Array, ctx.sampleRate);
		};
		// Deliberately not connected to ctx.destination - that would echo
		// the user's own mic back out through their speakers.
		source.connect(worklet);
		this.workletNode = worklet;
	}

	// Tears down only the live-transcription side (WS/worklet/context) -
	// the MediaRecorder keeps running untouched, per the fallback matrix.
	private teardownLiveTranscription() {
		this.transcriber?.close();
		this.transcriber = null;
		this.workletNode?.disconnect();
		this.workletNode = null;
		void this.audioCtx?.close();
		this.audioCtx = null;
	}

	async stopAndClose() {
		if (this.handled) return;
		this.handled = true;
		this.teardownLiveTranscription();

		const recorder = this.recorder;
		if (recorder && recorder.state !== "inactive") {
			recorder.onstop = () => {
				this.stream?.getTracks().forEach((t) => t.stop());
				this.plugin.setVoiceRecordingIndicator(false);
				// A mid-recording drop means segments/partial only cover audio
				// up to the drop point - using them would silently truncate the
				// note. Pass no transcript so the batch pipeline re-transcribes
				// the complete recording instead, matching the "nothing is
				// lost" fallback promise.
				const transcript = this.liveDropped
					? undefined
					: [...this.segments, this.partial].filter(Boolean).join(" ").trim() || undefined;
				void this.plugin.saveVoiceRecording(recorder.mimeType || "audio/webm", this.chunks, transcript);
			};
			recorder.stop();
		} else {
			// getUserMedia/recorder never got going (e.g. denied) - nothing
			// to save, the earlier Notice already explained why.
			this.plugin.setVoiceRecordingIndicator(false);
		}
		this.close();
	}

	// Explicit, visible discard - distinct from an accidental close, which
	// is treated as Stop (see onClose below), not a silent loss.
	async cancel() {
		if (this.handled) return;
		this.handled = true;
		this.teardownLiveTranscription();
		this.recorder?.stop();
		this.stream?.getTracks().forEach((t) => t.stop());
		this.plugin.setVoiceRecordingIndicator(false);
		new Notice("Nous: recording discarded.");
		this.close();
	}

	// Esc / click-outside mid-recording: this codebase never silently
	// drops a capture (see the duplicate-parking behavior in the README),
	// so treat it the same as clicking Stop rather than losing the
	// recording. stopAndClose()/cancel() both set `handled` before calling
	// close() themselves, so this no-ops on those paths.
	onClose() {
		this.plugin.liveCaptureModal = null;
		if (!this.handled) void this.stopAndClose();
		this.contentEl.empty();
	}
}

class QueryModal extends Modal {
	private question = "";

	constructor(app: App, private onSubmit: (question: string) => void) {
		super(app);
	}

	onOpen() {
		this.setTitle("Query vault");
		const input = this.contentEl.createEl("textarea", {
			attr: { rows: "3", placeholder: "What do you want to know?" },
		});
		input.setCssStyles({ width: "100%" });
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				submit();
			}
		});
		input.addEventListener("input", () => {
			this.question = input.value;
		});
		const submit = () => {
			if (!this.question.trim()) return;
			this.close();
			this.onSubmit(this.question.trim());
		};
		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("Ask").setCta().onClick(submit)
		);
		input.focus();
	}

	onClose() {
		this.contentEl.empty();
	}
}
