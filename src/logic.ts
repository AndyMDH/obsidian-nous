import type { EnrichResult, WikiSynthesisResult, GlossaryEntry, GlossaryCategory } from "./types.ts";
import { GLOSSARY_CATEGORIES } from "./types.ts";

export function sanitizeFilename(title: string): string {
	return title.replace(/[\\/:*?"<>|]/g, "-").trim();
}

// Frontmatter scalar values (title, attendee names, project, win details)
// are LLM-generated free text, not code - a colon-space, a leading #, or any
// other YAML-special character breaks the unquoted form and can silently
// corrupt the whole frontmatter block's parse (tags/date/type all fail to
// read back). Always double-quoting is simpler and safer than trying to
// detect exactly which values are "plain-scalar safe".
export function yamlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function meetingFilename(date: string, title: string): string {
	return `${date} ${sanitizeFilename(title)}.md`;
}

export function wikiFilename(topic: string): string {
	return `${sanitizeFilename(topic)} Wiki.md`;
}

// Viewable in Obsidian and accepted as-is by every provider's vision API.
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

// Obsidian can't render HEIC and most vision APIs reject it - always
// converted to JPEG first (convertHeicToJpeg in main.ts).
export const HEIC_EXTENSIONS = ["heic", "heif"];

// Native document input on Anthropic/Gemini; guarded off elsewhere.
export const PDF_EXTENSIONS = ["pdf"];

// Obsidian's Audio recorder output (webm desktop, m4a iOS) plus common
// formats. Transcribed to text first, so audio works in every mode.
export const AUDIO_EXTENSIONS = ["m4a", "webm", "mp3", "wav", "ogg", "flac"];

export function isCaptureFile(extension: string): boolean {
	const ext = extension.toLowerCase();
	return (
		ext === "md" ||
		ext === "txt" ||
		IMAGE_EXTENSIONS.includes(ext) ||
		HEIC_EXTENSIONS.includes(ext) ||
		PDF_EXTENSIONS.includes(ext) ||
		AUDIO_EXTENSIONS.includes(ext)
	);
}

export function meetingAttachmentFilename(date: string, title: string, extension: string): string {
	return `${date} ${sanitizeFilename(title)}.${extension}`;
}

// This file has no Obsidian/Node dependency (see README's "For developers"),
// so browser-standard btoa, not Buffer.from.
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

export function extractFilenameDateHint(filename: string): string | null {
	const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
	return match ? match[1] : null;
}

function truncate(text: string, maxChars: number): string {
	const collapsed = text.trim().replace(/\s+/g, " ");
	return collapsed.length > maxChars
		? collapsed.slice(0, maxChars) + "..."
		: collapsed;
}

// Callout marker for the collapsed Transcript section - present in every
// note written since the collapsed-transcript change; legacy notes still
// have the plain "## Transcript" heading until migrated (or forever, if a
// user skips the migration command).
//
// This stays "[!note]" rather than a custom type: Obsidian's Live Preview
// only renders its known, built-in callout types (note, tip, quote, etc.)
// with real icon/color/fold chrome - an unrecognized type like
// "[!transcript]" falls back to a generic blue "pick a real type" editing
// widget instead of a normal callout, no matter what CSS targets it. The
// warm-paper theme restyles [!note] itself (see its own callout section) -
// every callout the theme touches gets the same quiet flat treatment by
// design, so there's no meaningful risk in reusing the built-in type.
const TRANSCRIPT_CALLOUT_MARKER = "[!note]- Transcript";
const TRANSCRIPT_HEADING = "## Transcript";

// Duplicate check compares raw transcript text, not generated Summary
// prose - a re-pasted duplicate only character-matches the former.
export function extractTranscriptSnippet(noteContent: string, maxChars = 200): string {
	const calloutIdx = noteContent.indexOf(TRANSCRIPT_CALLOUT_MARKER);
	if (calloutIdx !== -1) {
		// Strip the "> " callout prefix line by line - the freshly captured
		// transcript this is compared against for duplicate detection has no
		// such prefix, so leaving it in would break the comparison for every
		// already-migrated note.
		const body = noteContent
			.slice(calloutIdx + TRANSCRIPT_CALLOUT_MARKER.length)
			.split("\n")
			.map((line) => line.replace(/^>\s?/, ""))
			.join("\n");
		return truncate(body, maxChars);
	}
	const idx = noteContent.indexOf(TRANSCRIPT_HEADING);
	const text =
		idx === -1
			? noteContent.replace(/^---\n[\s\S]*?\n---\n/, "")
			: noteContent.slice(idx + TRANSCRIPT_HEADING.length);
	return truncate(text, maxChars);
}

// Enriched sections only - wiki synthesis doesn't need the raw transcript.
export function extractEnrichedSections(noteContent: string): string {
	const afterFrontmatter = noteContent.replace(/^---\n[\s\S]*?\n---\n/, "");
	const calloutIdx = afterFrontmatter.indexOf(TRANSCRIPT_CALLOUT_MARKER);
	const transcriptIdx = afterFrontmatter.indexOf(TRANSCRIPT_HEADING);
	const relatedIdx = afterFrontmatter.indexOf("## Related");
	let end = afterFrontmatter.length;
	if (calloutIdx !== -1) end = Math.min(end, calloutIdx);
	if (transcriptIdx !== -1) end = Math.min(end, transcriptIdx);
	if (relatedIdx !== -1) end = Math.min(end, relatedIdx);
	return afterFrontmatter.slice(0, end).trim();
}

export interface ManualNotesSplit {
	manualNotes: string;
	transcript: string;
}

export function splitManualNotesFromTranscript(rawText: string): ManualNotesSplit {
	const transcriptHeading = /^## Transcript\s*$/m.exec(rawText);
	if (!transcriptHeading) return { manualNotes: "", transcript: rawText };

	const beforeTranscript = rawText.slice(0, transcriptHeading.index).trim();
	const transcriptBody = rawText.slice(transcriptHeading.index + transcriptHeading[0].length).trim();
	const manualStart = findFirstHeading(beforeTranscript, [
		"Meeting notes",
		"Notes",
		// Older live notes used these headings - keep recognizing them.
		"Questions to ask",
		"Live notes",
		"Notes taken during meeting",
	]);
	if (manualStart === -1) {
		return {
			manualNotes: "",
			transcript: [beforeTranscript, transcriptBody].filter(Boolean).join("\n\n"),
		};
	}

	const intro = beforeTranscript.slice(0, manualStart).trim();
	const manualNotes = beforeTranscript.slice(manualStart).trim();
	return {
		manualNotes,
		transcript: [intro, transcriptBody].filter(Boolean).join("\n\n"),
	};
}

// Summary paragraph only, so firstSentence() gets prose, not a heading.
export function extractSummaryText(noteContent: string): string {
	const idx = noteContent.indexOf("## Summary");
	if (idx === -1) return "";
	const afterHeading = noteContent.slice(idx + "## Summary".length);
	const nextHeadingIdx = afterHeading.indexOf("\n## ");
	const block =
		nextHeadingIdx === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIdx);
	return block.trim();
}

export function firstSentence(text: string): string {
	// Collapse whitespace first - `.` doesn't match newlines.
	const collapsed = text.trim().replace(/\s+/g, " ");
	const match = collapsed.match(/^.*?[.!?](?=\s|$)/);
	return (match ? match[0] : collapsed).trim();
}

// "REC 00:42" - the status bar's live recording timer (warm-paper spec §3).
// Caps at 99:59 rather than rolling into hours - a Nous capture is never a
// multi-hour recording in practice, and "REC 142:07" would just look broken.
export function formatRecordingElapsed(totalSeconds: number): string {
	const clamped = Math.max(0, Math.min(totalSeconds, 99 * 60 + 59));
	const minutes = Math.floor(clamped / 60);
	const seconds = Math.floor(clamped % 60);
	return `REC ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export interface CapturedAttachment {
	filename: string;
	kind: "image" | "document" | "audio";
}

// Quotes body under a collapsed callout marker so it starts folded in both
// Reading view and Live Preview (heading-fold state isn't guaranteed to
// persist; the callout's collapsed state is plain markdown, not editor
// state). Shared by buildMeetingMarkdown and convertLegacyTranscriptToCallout
// so the two writers can't drift out of sync with each other.
export function toCollapsedCallout(title: string, body: string): string {
	const lines = body.split("\n").map((line) => (line === "" ? ">" : `> ${line}`));
	return [`> [!note]- ${title}`, ...lines].join("\n");
}

export function buildMeetingMarkdown(
	result: EnrichResult,
	rawTranscript: string,
	enrichedAt: string,
	existingWikiLink: string | null,
	capturedAttachment?: CapturedAttachment,
	manualNotes?: string
): string {
	const fmLines = [
		"---",
		`type: ${result.type}`,
		`date: ${result.date}`,
		`title: ${yamlString(result.title)}`,
	];
	if (result.type === "meeting") {
		fmLines.push(`attendees: [${result.attendees.map(yamlString).join(", ")}]`);
	}
	fmLines.push(
		`source: ${result.source}`,
		`project: ${yamlString(result.project)}`,
		`tags: [${result.tags.map(yamlString).join(", ")}]`
	);
	// Only present when "win" is in tags - mirrors meeting-enricher's Step
	// 3.5 in src/skillTemplates.ts (CLI mode), same field order.
	if (result.win) {
		fmLines.push(
			`win_category: ${result.win.category}`,
			`win_headcount: ${yamlString(result.win.headcount)}`,
			`win_client: ${yamlString(result.win.client)}`,
			`win_repo: ${yamlString(result.win.repo)}`,
			`win_metric: ${yamlString(result.win.metric)}`
		);
	}
	fmLines.push(`status: enriched`, `enriched_at: ${enrichedAt}`, "---", "");

	const bodyParts: string[] = [`## Summary\n\n${result.summary}`];

	if (result.key_points.length > 0) {
		bodyParts.push(
			`## Key points\n\n${result.key_points.map((p) => `- ${p}`).join("\n")}`
		);
	}
	if (result.decisions.length > 0) {
		bodyParts.push(
			`## Decisions\n\n${result.decisions.map((d) => `- ${d}`).join("\n")}`
		);
	}
	const openQuestions = result.open_questions ?? [];
	if (openQuestions.length > 0) {
		bodyParts.push(`## Open questions\n\n${openQuestions.map((q) => `- ${q}`).join("\n")}`);
	}
	if (result.action_items.length > 0) {
		bodyParts.push(
			`## Action items\n\n${result.action_items.map((a) => `- [ ] ${a}`).join("\n")}`
		);
	}
	// Other people's commitments the owner wants to keep an eye on. Plain
	// bullets, not checkboxes - they are not the owner's to tick off.
	const watchItems = result.watch_items ?? [];
	if (watchItems.length > 0) {
		bodyParts.push(`## Watch\n\n${watchItems.map((w) => `- ${w}`).join("\n")}`);
	}
	const newTerms = (result.new_terms ?? []).filter((t) => t.term.trim().length > 0);
	if (newTerms.length > 0) {
		bodyParts.push(
			`## New terms\n\n${newTerms.map((t) => `- ${t.term.trim()} - ${t.guess.trim() || "unknown"}`).join("\n")}`
		);
	}

	if (!capturedAttachment && manualNotes?.trim()) {
		bodyParts.push(`## Notes taken during meeting\n\n${demoteSecondLevelHeadings(manualNotes.trim())}`);
	}

	if (capturedAttachment?.kind === "document") {
		bodyParts.push(`## Captured document\n\n![[${capturedAttachment.filename}]]`);
	} else if (capturedAttachment?.kind === "audio") {
		// Audio notes keep both the transcript and the playable recording.
		bodyParts.push(toCollapsedCallout("Transcript", rawTranscript.trim()));
		bodyParts.push(`## Captured audio\n\n![[${capturedAttachment.filename}]]`);
	} else if (capturedAttachment) {
		bodyParts.push(`## Captured image\n\n![[${capturedAttachment.filename}]]`);
	} else {
		bodyParts.push(toCollapsedCallout("Transcript", rawTranscript.trim()));
	}

	const relatedLines: string[] = [];
	for (const tag of result.tags) relatedLines.push(`- [[${tag}]]`);
	for (const note of result.related_notes) relatedLines.push(`- [[${note}]]`);
	if (existingWikiLink) relatedLines.push(`- [[${existingWikiLink}]]`);
	bodyParts.push(`## Related\n\n${relatedLines.join("\n")}`);

	return fmLines.join("\n") + "\n" + bodyParts.join("\n\n") + "\n";
}

function findFirstHeading(markdown: string, headings: string[]): number {
	const indexes = headings
		.map((heading) => {
			const match = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").exec(markdown);
			return match ? match.index : -1;
		})
		.filter((idx) => idx >= 0);
	return indexes.length > 0 ? Math.min(...indexes) : -1;
}

// One-time migration: rewrites a legacy "## Transcript" heading into the
// collapsed callout format. Returns null when there is nothing to do -
// already migrated (no legacy heading left to match), or an image/PDF-only
// note that never had a Transcript section at all.
export function convertLegacyTranscriptToCallout(noteContent: string): string | null {
	const headingMatch = /^## Transcript\s*$/m.exec(noteContent);
	if (!headingMatch) return null;

	const before = noteContent.slice(0, headingMatch.index).trimEnd();
	const afterHeading = noteContent.slice(headingMatch.index + headingMatch[0].length);
	// Same boundary-finding approach as findFirstHeading above (a regex-
	// matched "##" line), generalized to "the next heading of any name"
	// since the section that follows Transcript varies (Captured audio,
	// or straight to Related).
	const nextHeadingMatch = /^##\s+\S.*$/m.exec(afterHeading);
	const body = (nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading).trim();
	const after = nextHeadingMatch ? afterHeading.slice(nextHeadingMatch.index).trim() : "";

	const callout = toCollapsedCallout("Transcript", body);
	return [before, callout, after].filter(Boolean).join("\n\n") + "\n";
}

function demoteSecondLevelHeadings(markdown: string): string {
	return markdown.replace(/^## /gm, "### ");
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildTagFileContent(tagName: string, date: string): string {
	return `---
type: tag
created: ${date}
---
# ${tagName}

One-line definition of what belongs under this tag.

## Notes with this tag
(Obsidian backlinks panel shows these automatically - leave this section empty)
`;
}

export interface TimelineEntry {
	date: string;
	title: string;
	oneLine: string;
}

// "## Glossary" of a wiki: one "### <category>" sub-heading per group, each
// with a | Term | Meaning | Status | table, groups in GLOSSARY_CATEGORIES
// order and terms alphabetical inside a group. Rows are keyed by term,
// case-insensitive. A table with no sub-heading (the 2.12 layout) parses
// into "Other".
const GLOSSARY_HEADING = "## Glossary";

export function normalizeGlossaryCategory(raw: string | undefined): GlossaryCategory {
	const wanted = (raw ?? "").trim().toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ");
	for (const category of GLOSSARY_CATEGORIES) {
		if (category.toLowerCase() === wanted) return category;
	}
	// Forgiving aliases for what a model is likely to write.
	if (/document|doc type|documents/.test(wanted)) return "Document types";
	if (/method|process|working|practice|approach/.test(wanted)) return "Way of working";
	if (/system|tool|platform|ui|api|component/.test(wanted)) return "Systems and tools";
	if (/data|vendor|dataset|schema/.test(wanted)) return "Data and vendors";
	if (/risk|governance|compliance|regulat|control|assessment/.test(wanted)) return "Governance and risk";
	if (/role|people|person|team/.test(wanted)) return "Roles";
	return "Other";
}

export function parseGlossary(wikiContent: string): GlossaryEntry[] {
	const idx = wikiContent.indexOf(GLOSSARY_HEADING);
	if (idx === -1) return [];
	const after = wikiContent.slice(idx + GLOSSARY_HEADING.length);
	const nextIdx = after.indexOf("\n## ");
	const section = nextIdx === -1 ? after : after.slice(0, nextIdx);
	const entries: GlossaryEntry[] = [];
	let category: GlossaryCategory = "Other";
	for (const line of section.split("\n")) {
		const trimmed = line.trim();
		const sub = trimmed.match(/^###\s+(.+)$/);
		if (sub) {
			category = normalizeGlossaryCategory(sub[1]);
			continue;
		}
		if (!trimmed.startsWith("|")) continue;
		const cells = trimmed
			.slice(1, trimmed.endsWith("|") ? -1 : undefined)
			.split("|")
			.map((c) => c.trim());
		if (cells.length < 2) continue;
		const [term, meaning, status = ""] = cells;
		if (!term || term.toLowerCase() === "term" || /^-+$/.test(term)) continue;
		entries.push({ term, meaning, category, status: status.toLowerCase() === "confirmed" ? "confirmed" : "guess" });
	}
	return entries;
}

function compareTerms(a: string, b: string): number {
	return a.localeCompare(b, undefined, { sensitivity: "base" });
}

// Existing rows win, always - a person may have corrected a meaning, moved
// a term to another group, or marked it confirmed, and a re-synthesis must
// never undo that. Proposed rows only add terms the table does not know
// yet, as guesses.
export function mergeGlossary(
	existing: GlossaryEntry[],
	proposed: { term: string; meaning: string; category?: string }[] | undefined
): GlossaryEntry[] {
	const known = new Set(existing.map((e) => e.term.toLowerCase()));
	const merged = existing.slice();
	for (const row of proposed ?? []) {
		const term = row.term.trim();
		const meaning = row.meaning.trim();
		if (!term || !meaning || known.has(term.toLowerCase())) continue;
		known.add(term.toLowerCase());
		merged.push({ term, meaning, category: normalizeGlossaryCategory(row.category), status: "guess" });
	}
	return merged.sort((a, b) => {
		const byCategory = GLOSSARY_CATEGORIES.indexOf(a.category) - GLOSSARY_CATEGORIES.indexOf(b.category);
		return byCategory !== 0 ? byCategory : compareTerms(a.term, b.term);
	});
}

function escapeTableCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

export function renderGlossary(entries: GlossaryEntry[]): string {
	if (entries.length === 0) return "";
	const parts: string[] = [
		`${GLOSSARY_HEADING}\n\nEdit a meaning, move a term to another group, or set its status to \`confirmed\`; Nous never rewrites a row that is already here.\n`,
	];
	for (const category of GLOSSARY_CATEGORIES) {
		const rows = entries.filter((e) => e.category === category).sort((a, b) => compareTerms(a.term, b.term));
		if (rows.length === 0) continue;
		const table = rows.map((e) => `| ${escapeTableCell(e.term)} | ${escapeTableCell(e.meaning)} | ${e.status} |`);
		parts.push(`\n### ${category}\n\n| Term | Meaning | Status |\n| --- | --- | --- |\n${table.join("\n")}\n`);
	}
	return `${parts.join("")}\n`;
}

// Titles already listed under a wiki's "## Sources" - the durable record of
// which notes the wiki has absorbed. Comparing note dates against the
// wiki's `updated` day missed every note from the same day as the last
// update, so those notes never reached Current state.
export function parseWikiSources(wikiContent: string): string[] {
	const idx = wikiContent.indexOf("## Sources");
	if (idx === -1) return [];
	const after = wikiContent.slice(idx + "## Sources".length);
	const nextIdx = after.indexOf("\n## ");
	const section = nextIdx === -1 ? after : after.slice(0, nextIdx);
	const titles: string[] = [];
	for (const match of section.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
		titles.push(match[1].trim());
	}
	return titles;
}

// The wiki's Open questions are the still-open set across meetings, not a
// log - past this many the list stops being read.
export const WIKI_OPEN_QUESTIONS_MAX = 8;

export function buildWikiMarkdown(
	topic: string,
	result: WikiSynthesisResult,
	timeline: TimelineEntry[],
	sources: string[],
	created: string,
	updated: string,
	glossary: GlossaryEntry[] = []
): string {
	const fm = [
		"---",
		"type: wiki",
		`topic: ${yamlString(topic)}`,
		`created: ${created}`,
		`updated: ${updated}`,
		`sources: ${sources.length}`,
		"---",
		"",
	].join("\n");

	const openQuestions =
		result.open_questions.length > 0
			? result.open_questions
					.slice(0, WIKI_OPEN_QUESTIONS_MAX)
					.map((q) => `- ${q}`)
					.join("\n")
			: "- (none currently)";

	const timelineLines = timeline
		.slice()
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((t) => `- ${t.date} - [[${t.title}]] - ${t.oneLine}`)
		.join("\n");

	const sourceLines = sources.map((s) => `- [[${s}]]`).join("\n");

	// Glossary first: a reader new to the topic needs the words before the
	// narrative, and it is the section a person edits by hand.
	return `${fm}# ${topic}\n\n${renderGlossary(glossary)}## Current state\n\n${result.current_state}\n\n## Open questions\n\n${openQuestions}\n\n## Timeline\n\n${timelineLines}\n\n## Sources\n\n${sourceLines}\n`;
}

export interface WinEntry {
	title: string;
	date: string;
	category: string;
	headcount: string;
	client: string;
	repo: string;
	metric: string;
}

// Deterministic, unlike buildWikiMarkdown - no synthesis needed, just
// grouping/sorting/formatting what's already in each note's frontmatter.
// Mirrors wiki-builder's Step 6 (src/skillTemplates.ts, CLI mode): always
// fully regenerated rather than incrementally updated, since nothing on
// the page is hand-written.
export function buildWinsMarkdown(entries: WinEntry[], updated: string): string {
	const byCategory = new Map<string, WinEntry[]>();
	for (const entry of entries) {
		if (!byCategory.has(entry.category)) byCategory.set(entry.category, []);
		byCategory.get(entry.category)!.push(entry);
	}

	const categories = Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length);

	const summaryLine = categories
		.map(([category, items]) => `${humanizeWinCategory(category)} (${items.length})`)
		.join(" · ");

	const sections = categories.map(([category, items]) => {
		const sorted = items.slice().sort((a, b) => b.date.localeCompare(a.date));
		const lines = sorted.map((item) => {
			const details = [item.client, item.repo, item.metric, item.headcount].filter(Boolean).join(", ");
			const suffix = details ? ` - ${details}` : "";
			return `- ${item.date} - [[${item.title}]]${suffix}`;
		});
		return `## ${humanizeWinCategory(category)}\n\n${lines.join("\n")}`;
	});

	const fm = ["---", "type: wins", `updated: ${updated}`, `count: ${entries.length}`, "---", ""].join("\n");
	return `${fm}# Wins\n\n${summaryLine}\n\n${sections.join("\n\n")}\n`;
}

function humanizeWinCategory(category: string): string {
	return category.charAt(0).toUpperCase() + category.slice(1);
}

// Notion's Markdown export suffixes every page and database row with a
// 32-char hex ID, space-separated from the title (`Meeting Notes
// 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md`). Strip it so the imported note's
// title reads the way it did in Notion.
const NOTION_ID_SUFFIX = / [0-9a-f]{32}$/i;

export function stripNotionIdSuffix(basename: string): string {
	const stripped = basename.replace(NOTION_ID_SUFFIX, "").trim();
	return stripped || basename;
}

export interface NoteMeta {
	filename: string;
	title: string;
	date: string;
	tags: string[];
}

export interface TopicCluster {
	tag: string;
	notes: NoteMeta[];
}

// Cluster by tag; fragments never count toward wiki eligibility.
export function clusterByTag(notes: NoteMeta[]): TopicCluster[] {
	const clusters = new Map<string, NoteMeta[]>();
	for (const note of notes) {
		if (note.tags.includes("fragment")) continue;
		for (const tag of note.tags) {
			if (!clusters.has(tag)) clusters.set(tag, []);
			clusters.get(tag)!.push(note);
		}
	}
	return Array.from(clusters.entries()).map(([tag, notes]) => ({
		tag,
		notes,
	}));
}
