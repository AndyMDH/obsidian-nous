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

// Natively viewable in Obsidian and accepted as-is by every provider's vision
// API - no conversion needed. Not GIF (animated-frame ambiguity, inconsistent
// provider support) - disclosed limitation, no conversion step for that one.
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

// HEIC/HEIF: Obsidian's Electron/Chromium preview can't render these at all
// (no native HEIC decoder - the reason HEIC-preview community plugins exist),
// and Anthropic/OpenAI's vision APIs reject them outright regardless. Always
// converted to JPEG before storage or any provider call - see
// convertHeicToJpeg in main.ts (API mode) and the CLI skill's own sips step.
export const HEIC_EXTENSIONS = ["heic", "heif"];

// Anthropic and Gemini both accept a PDF as a native document input (no
// conversion needed, unlike HEIC). OpenAI-compatible/local providers don't
// support it through this plugin - see the guard in openaiCompatible.ts.
export const PDF_EXTENSIONS = ["pdf"];

// What Obsidian's built-in Audio recorder core plugin produces (webm on
// desktop, m4a on iOS) plus the common formats a user might drop in by hand.
// Audio is transcribed first (see transcribe.ts), then enriched as text - so
// unlike images/PDFs this works in every execution mode, including CLI.
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

// Portable byte -> base64 (works in the Electron renderer, a mobile webview,
// and Node's test runner) - not Buffer.from(), which doesn't exist on mobile.
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

// First ~200 chars of raw body, frontmatter stripped. Used for a freshly
// captured inbox file, which has no ## Transcript heading of its own yet.
export function snippet(body: string, maxChars = 200): string {
	return truncate(body.replace(/^---\n[\s\S]*?\n---\n/, ""), maxChars);
}

// Mirrors meeting-enricher Step 0's duplicate check: compares against the
// raw transcript text of existing notes specifically (not their generated
// Summary prose, which won't character-match a re-pasted duplicate even when
// it's the same meeting) - so this pulls from ## Transcript, not the top of
// the file. Also doubles as the related-note hint in the same index entry.
export function extractTranscriptSnippet(noteContent: string, maxChars = 200): string {
	const idx = noteContent.indexOf("## Transcript");
	const text =
		idx === -1
			? noteContent.replace(/^---\n[\s\S]*?\n---\n/, "")
			: noteContent.slice(idx + "## Transcript".length);
	return truncate(text, maxChars);
}

// Pulls just the Summary/Key points/Decisions/Action items sections back out
// of an already-enriched note, for feeding into the wiki synthesis prompt
// without spending tokens on the raw transcript underneath.
export function extractEnrichedSections(noteContent: string): string {
	const afterFrontmatter = noteContent.replace(/^---\n[\s\S]*?\n---\n/, "");
	const transcriptIdx = afterFrontmatter.indexOf("## Transcript");
	const relatedIdx = afterFrontmatter.indexOf("## Related");
	let end = afterFrontmatter.length;
	if (transcriptIdx !== -1) end = Math.min(end, transcriptIdx);
	if (relatedIdx !== -1) end = Math.min(end, relatedIdx);
	return afterFrontmatter.slice(0, end).trim();
}

// Pulls just the Summary paragraph out of an enriched note - used so
// firstSentence() below has clean prose to work with instead of a heading
// ("## Summary") that has no sentence-ending punctuation on its own line.
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
	// Collapse whitespace first: `.` doesn't match newlines without the `s`
	// flag, so a match spanning a line break would otherwise silently fail
	// and fall through to returning the entire input untrimmed.
	const collapsed = text.trim().replace(/\s+/g, " ");
	const match = collapsed.match(/^.*?[.!?](?=\s|$)/);
	return (match ? match[0] : collapsed).trim();
}

export interface CapturedAttachment {
	filename: string;
	kind: "image" | "document" | "audio";
}

export function buildMeetingMarkdown(
	result: EnrichResult,
	rawTranscript: string,
	enrichedAt: string,
	existingWikiLink: string | null,
	capturedAttachment?: CapturedAttachment
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

	if (capturedAttachment?.kind === "document") {
		bodyParts.push(`## Captured document\n\n![[${capturedAttachment.filename}]]`);
	} else if (capturedAttachment?.kind === "audio") {
		// Audio keeps both: the transcript (searchable, feeds wikis) and the
		// original recording, playable inline.
		bodyParts.push(`## Transcript\n\n${rawTranscript.trim()}`);
		bodyParts.push(`## Captured audio\n\n![[${capturedAttachment.filename}]]`);
	} else if (capturedAttachment) {
		bodyParts.push(`## Captured image\n\n![[${capturedAttachment.filename}]]`);
	} else {
		bodyParts.push(`## Transcript\n\n${rawTranscript.trim()}`);
	}

	const relatedLines: string[] = [];
	for (const tag of result.tags) relatedLines.push(`- [[${tag}]]`);
	for (const note of result.related_notes) relatedLines.push(`- [[${note}]]`);
	if (existingWikiLink) relatedLines.push(`- [[${existingWikiLink}]]`);
	bodyParts.push(`## Related\n\n${relatedLines.join("\n")}`);

	return fmLines.join("\n") + "\n" + bodyParts.join("\n\n") + "\n";
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

// Mirrors wiki-builder Step 1: cluster by tag, fragments excluded from
// eligibility counting even though they still live in the meetings folder.
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
