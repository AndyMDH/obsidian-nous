export interface CortexSettings {
	apiKey: string;
	model: string;
	inboxFolder: string;
	meetingsFolder: string;
	wikisFolder: string;
	tagsFolder: string;
	wikiThreshold: number;
	autoProcessOnCreate: boolean;
	dedupLookback: number;
}

export const DEFAULT_SETTINGS: CortexSettings = {
	apiKey: "",
	model: "claude-sonnet-5",
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
	source: "handy" | "pasted";
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
