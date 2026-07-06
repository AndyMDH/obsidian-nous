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
	wikiThreshold: number;
	autoProcessOnCreate: boolean;
	dedupLookback: number;
}

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
	meetingsFolder: "10-Meetings",
	wikisFolder: "20-Wikis",
	tagsFolder: "30-Tags",
	wikiThreshold: 4,
	autoProcessOnCreate: true,
	dedupLookback: 50,
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
	source: "handy" | "pasted" | "photo";
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
