import type { EnrichResult, WikiSynthesisResult } from "./types.ts";

export function sanitizeFilename(title: string): string {
	return title.replace(/[\\/:*?"<>|]/g, "-").trim();
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

// Buffer.from doesn't exist on mobile - chunked btoa works everywhere.
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

// First ~200 chars of raw body, frontmatter stripped.
export function snippet(body: string, maxChars = 200): string {
	return truncate(body.replace(/^---\n[\s\S]*?\n---\n/, ""), maxChars);
}

// Callout marker for the collapsed Transcript section - present in every
// note written since the collapsed-transcript change; legacy notes still
// have the plain "## Transcript" heading until migrated (or forever, if a
// user skips the migration command).
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
		`title: ${result.title}`,
	];
	if (result.type === "meeting") {
		fmLines.push(`attendees: [${result.attendees.join(", ")}]`);
	}
	fmLines.push(
		`source: ${result.source}`,
		`project: ${result.project}`,
		`tags: [${result.tags.join(", ")}]`,
		`status: enriched`,
		`enriched_at: ${enrichedAt}`,
		"---",
		""
	);

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
	if (result.action_items.length > 0) {
		bodyParts.push(
			`## Action items\n\n${result.action_items.map((a) => `- [ ] ${a}`).join("\n")}`
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

export function buildWikiMarkdown(
	topic: string,
	result: WikiSynthesisResult,
	timeline: TimelineEntry[],
	sources: string[],
	created: string,
	updated: string
): string {
	const fm = [
		"---",
		"type: wiki",
		`topic: ${topic}`,
		`created: ${created}`,
		`updated: ${updated}`,
		`sources: ${sources.length}`,
		"---",
		"",
	].join("\n");

	const openQuestions =
		result.open_questions.length > 0
			? result.open_questions.map((q) => `- ${q}`).join("\n")
			: "- (none currently)";

	const timelineLines = timeline
		.slice()
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((t) => `- ${t.date} - [[${t.title}]] - ${t.oneLine}`)
		.join("\n");

	const sourceLines = sources.map((s) => `- [[${s}]]`).join("\n");

	return `${fm}# ${topic}\n\n## Current state\n\n${result.current_state}\n\n## Open questions\n\n${openQuestions}\n\n## Timeline\n\n${timelineLines}\n\n## Sources\n\n${sourceLines}\n`;
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
