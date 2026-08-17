export type ExecutionMode = "api" | "cli";

// Only used in API mode - CLI mode always shells out to `claude`.
export type ApiProvider = "anthropic" | "openai" | "gemini" | "glm" | "local";

export interface NousSettings {
	executionMode: ExecutionMode;
	apiProvider: ApiProvider;
	apiKeys: Record<ApiProvider, string>;
	models: Record<ApiProvider, string>;
	glmBaseUrl: string; // only used when apiProvider is "glm"
	localBaseUrl: string; // only used when apiProvider is "local"
	claudeCliPath: string;
	// Local, offline voice-capture transcription (macOS only). Empty strings
	// mean "use the default install location" - see defaultWhisperModelPath()
	// in main.ts. Falls back to the Gemini/OpenAI key below when unavailable.
	whisperCliPath: string;
	whisperModelPath: string;
	// Native macOS meeting recorder helper.
	nativeRecorderPath: string;
	// Opt-in, desktop-only live/streaming dictation via OpenAI's Realtime
	// API (see src/realtimeTranscribe.ts) - reuses apiKeys.openai, no
	// separate key. Solo voice-note capture only; meeting capture
	// is unaffected. Default off: this is strictly
	// additive on top of the existing local-whisper/batch pipeline, which
	// stays the safety net whenever this is off, unavailable, or fails.
	liveTranscriptionEnabled: boolean;
	styledNotes: boolean;
	inboxFolder: string;
	meetingsFolder: string;
	wikisFolder: string;
	tagsFolder: string;
	queriesFolder: string;
	wikiThreshold: number;
	autoProcessOnCreate: boolean;
	dedupLookback: number;
	// First-run onboarding wizard has been completed or dismissed.
	onboarded: boolean;
	// Plugin version that last (re)wrote .claude/skills/*/SKILL.md. Compared
	// against the running manifest version so CLI-mode skill files get
	// regenerated on update instead of silently going stale forever - see
	// ensureSkillsInstalled() in main.ts.
	skillsVersion: string;
}

// Model choices for the settings dropdown; first entry is the default.
// Local has no list (any Ollama tag is valid); the UI adds a Custom option.
export const MODEL_OPTIONS: Record<Exclude<ApiProvider, "local">, { id: string; label: string }[]> = {
	anthropic: [
		{ id: "claude-sonnet-5", label: "Claude Sonnet 5 — best balance (default)" },
		{ id: "claude-opus-4-8", label: "Claude Opus 4.8 — most capable" },
		{ id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest, cheapest" },
	],
	openai: [
		{ id: "gpt-5.1", label: "GPT-5.1 — best balance (default)" },
		{ id: "gpt-5", label: "GPT-5" },
		{ id: "gpt-5-mini", label: "GPT-5 mini — cheaper" },
		{ id: "gpt-4.1", label: "GPT-4.1" },
	],
	gemini: [
		{ id: "gemini-3-pro-preview", label: "Gemini 3 Pro — best balance (default)" },
		{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
		{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — fastest, cheapest" },
	],
	glm: [
		{ id: "glm-5.2", label: "GLM-5.2 — best balance (default)" },
		{ id: "glm-5.2[1m]", label: "GLM-5.2 1M context" },
		{ id: "glm-5", label: "GLM-5" },
	],
};

export const DEFAULT_SETTINGS: NousSettings = {
	executionMode: "cli",
	apiProvider: "anthropic",
	apiKeys: { anthropic: "", openai: "", gemini: "", glm: "", local: "" },
	models: {
		anthropic: "claude-sonnet-5",
		openai: "gpt-5.1",
		gemini: "gemini-3-pro-preview",
		glm: "glm-5.2",
		local: "llama3.1",
	},
	glmBaseUrl: "https://api.z.ai/api/paas/v4/",
	localBaseUrl: "http://localhost:11434/v1",
	claudeCliPath: "claude",
	whisperCliPath: "whisper-cli",
	whisperModelPath: "",
	nativeRecorderPath: "nous-recorder",
	liveTranscriptionEnabled: false,
	styledNotes: true,
	inboxFolder: "00-Inbox",
	meetingsFolder: "10-Notes",
	wikisFolder: "30-Wikis",
	tagsFolder: "20-Tags",
	queriesFolder: "40-Queries",
	wikiThreshold: 4,
	autoProcessOnCreate: true,
	dedupLookback: 50,
	onboarded: false,
	skillsVersion: "",
};

// Compact index entry for an existing meeting note - passed to the model for
// duplicate detection and related-note linking without spending tokens on
// full note bodies.
export interface NoteIndexEntry {
	title: string;
	filename: string;
	date: string;
	project: string;
	tags: string[];
	snippet: string;
}

export type WinCategory =
	| "client work"
	| "training"
	| "internship"
	| "internal tool"
	| "open source"
	| "writing"
	| "certification"
	| "event"
	| "other";

// Present only when "win" is among tags - see enrichSystemPrompt's Wins
// section. Fields are blank strings rather than omitted when the note
// doesn't state that detail (never guessed).
export interface WinDetails {
	category: WinCategory;
	headcount: string;
	client: string;
	repo: string;
	metric: string;
}

export interface EnrichResult {
	type: "meeting" | "note";
	is_fragment: boolean;
	date: string;
	title: string;
	attendees: string[];
	source: "voice" | "pasted" | "photo" | "document";
	project: string;
	tags: string[];
	new_tag: { name: string; justification: string } | null;
	is_duplicate: boolean;
	duplicate_of: string | null;
	summary: string;
	key_points: string[];
	decisions: string[];
	action_items: string[];
	related_notes: string[];
	win: WinDetails | null;
}

export interface WikiSynthesisResult {
	current_state: string;
	open_questions: string[];
}
