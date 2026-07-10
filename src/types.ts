export type ExecutionMode = "api" | "cli";

// Only relevant when executionMode is "api" - CLI mode always shells out to
// the `claude` binary regardless of this setting, since it's inherently tied
// to Claude Code rather than something to generalize across providers.
export type ApiProvider = "anthropic" | "openai" | "gemini" | "local";

export interface CortexSettings {
	executionMode: ExecutionMode;
	apiProvider: ApiProvider;
	apiKeys: Record<ApiProvider, string>;
	models: Record<ApiProvider, string>;
	localBaseUrl: string; // only used when apiProvider is "local"
	claudeCliPath: string;
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
}

// Curated model choices shown in the settings dropdown, so users pick from a
// list instead of typing a model id. "Local" has no list - any Ollama tag is
// valid - and every provider also gets a "Custom" escape hatch in the UI.
// First entry is the recommended default.
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
};

export const DEFAULT_SETTINGS: CortexSettings = {
	executionMode: "cli",
	apiProvider: "anthropic",
	apiKeys: { anthropic: "", openai: "", gemini: "", local: "" },
	models: {
		anthropic: "claude-sonnet-5",
		openai: "gpt-5.1",
		gemini: "gemini-3-pro-preview",
		local: "llama3.1",
	},
	localBaseUrl: "http://localhost:11434/v1",
	claudeCliPath: "claude",
	inboxFolder: "00-Inbox",
	meetingsFolder: "10-Notes",
	wikisFolder: "30-Wikis",
	tagsFolder: "20-Tags",
	queriesFolder: "40-Queries",
	wikiThreshold: 4,
	autoProcessOnCreate: true,
	dedupLookback: 50,
	onboarded: false,
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

export interface EnrichResult {
	type: "meeting" | "note";
	is_fragment: boolean;
	date: string;
	title: string;
	attendees: string[];
	source: "handy" | "pasted" | "photo" | "document";
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
}

export interface WikiSourceEntry {
	title: string;
	date: string;
	body: string;
}

export interface WikiSynthesisResult {
	current_state: string;
	open_questions: string[];
}

export interface TopicCluster {
	tag: string;
	notes: { title: string; filename: string; date: string }[];
}
