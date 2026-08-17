import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	sanitizeFilename,
	meetingFilename,
	wikiFilename,
	extractFilenameDateHint,
	snippet,
	extractTranscriptSnippet,
	extractEnrichedSections,
	splitManualNotesFromTranscript,
	extractSummaryText,
	firstSentence,
	buildMeetingMarkdown,
	toCollapsedCallout,
	convertLegacyTranscriptToCallout,
	buildTagFileContent,
	buildWikiMarkdown,
	clusterByTag,
	isCaptureFile,
	meetingAttachmentFilename,
	arrayBufferToBase64,
} from "../src/logic.ts";
import type { EnrichResult, WikiSynthesisResult } from "../src/types.ts";

test("sanitizeFilename strips filesystem-unsafe characters", () => {
	assert.equal(sanitizeFilename('Client: "Acme" / Kickoff'), "Client- -Acme- - Kickoff");
});

test("meetingFilename combines date and sanitized title", () => {
	assert.equal(
		meetingFilename("2026-07-02", "Client Kickoff: Acme"),
		"2026-07-02 Client Kickoff- Acme.md"
	);
});

test("wikiFilename appends the Wiki suffix to avoid colliding with the tag note", () => {
	assert.equal(wikiFilename("dbt"), "dbt Wiki.md");
});

test("extractFilenameDateHint finds a leading YYYY-MM-DD", () => {
	assert.equal(extractFilenameDateHint("2026-07-02 13.45.00.md"), "2026-07-02");
	assert.equal(extractFilenameDateHint("random-capture.md"), null);
});

test("snippet strips frontmatter and truncates", () => {
	const body = `---\ntype: meeting\n---\n${"x".repeat(300)}`;
	const s = snippet(body, 200);
	assert.equal(s.length, 203); // 200 chars + "..."
	assert.ok(!s.includes("type: meeting"));
});

test("extractTranscriptSnippet pulls from ## Transcript, not the Summary", () => {
	const note = `---\ntype: meeting\n---\n\n## Summary\n\nThis is the summary text, not the transcript.\n\n## Transcript\n\nTom said hello and then we discussed the roadmap in detail.\n\n## Related\n\n- [[tag]]`;
	const s = extractTranscriptSnippet(note, 500);
	assert.ok(s.includes("Tom said hello"));
	assert.ok(!s.includes("This is the summary text"));
});

test("extractEnrichedSections stops before Transcript and Related", () => {
	const note = `---\ntype: meeting\n---\n\n## Summary\n\nSummary text.\n\n## Transcript\n\nRaw transcript that should not appear.\n\n## Related\n\n- [[tag]]`;
	const sections = extractEnrichedSections(note);
	assert.ok(sections.includes("Summary text."));
	assert.ok(!sections.includes("Raw transcript"));
	assert.ok(!sections.includes("[[tag]]"));
});

test("splitManualNotesFromTranscript separates typed meeting notes from the transcript", () => {
	const raw = `Meeting recording from 2026-08-12 10.00.

## Questions to ask

- [ ] Ask about budget

## Live notes

Need a follow-up owner.

## Transcript

Them: hello

Me: hi`;
	const split = splitManualNotesFromTranscript(raw);
	assert.match(split.manualNotes, /Ask about budget/);
	assert.match(split.manualNotes, /Need a follow-up owner/);
	assert.ok(!split.manualNotes.includes("Them: hello"));
	assert.match(split.transcript, /Meeting recording from/);
	assert.match(split.transcript, /Them: hello/);
	assert.ok(!split.transcript.includes("Ask about budget"));
});

test("extractSummaryText + firstSentence do not silently fall through on the heading newline", () => {
	// Regression test: firstSentence used to be applied directly to a blob
	// starting with "## Summary\n\n...", and because `.` doesn't match `\n`
	// without the dotAll flag, the sentence-ending regex could never cross
	// that first line break and fell back to returning the ENTIRE blob.
	const note = `---\ntype: meeting\n---\n\n## Summary\n\nFirst sentence here. Second sentence here.\n\n## Key points\n\n- a point`;
	const summary = extractSummaryText(note);
	assert.equal(summary, "First sentence here. Second sentence here.");
	const first = firstSentence(summary);
	assert.equal(first, "First sentence here.");
});

test("firstSentence handles text with embedded newlines", () => {
	const text = "This spans\ntwo lines. And then more.";
	assert.equal(firstSentence(text), "This spans two lines.");
});

function baseResult(overrides: Partial<EnrichResult> = {}): EnrichResult {
	return {
		type: "meeting",
		is_fragment: false,
		date: "2026-07-02",
		title: "Client Kickoff",
		attendees: ["Tom", "Andy"],
		source: "pasted",
		project: "Acme",
		tags: ["external", "project"],
		new_tag: null,
		is_duplicate: false,
		duplicate_of: null,
		summary: "Kickoff call summary.",
		key_points: ["Point one", "Point two"],
		decisions: ["Decision one"],
		action_items: ["Do the thing"],
		related_notes: ["Some Other Meeting"],
		...overrides,
	};
}

test("buildMeetingMarkdown produces the expected frontmatter field order", () => {
	const md = buildMeetingMarkdown(baseResult(), "raw transcript text", "2026-07-02T12:00:00.000Z", null);
	const fmBlock = md.split("---\n")[1];
	const fields = fmBlock
		.trim()
		.split("\n")
		.map((l) => l.split(":")[0]);
	assert.deepEqual(fields, [
		"type",
		"date",
		"title",
		"attendees",
		"source",
		"project",
		"tags",
		"status",
		"enriched_at",
	]);
});

test("buildMeetingMarkdown omits attendees for type: note", () => {
	const md = buildMeetingMarkdown(
		baseResult({ type: "note", attendees: [] }),
		"raw text",
		"2026-07-02T12:00:00.000Z",
		null
	);
	assert.ok(!md.includes("attendees:"));
});

test("buildMeetingMarkdown omits empty Decisions/Action items sections", () => {
	const md = buildMeetingMarkdown(
		baseResult({ decisions: [], action_items: [] }),
		"raw text",
		"2026-07-02T12:00:00.000Z",
		null
	);
	assert.ok(!md.includes("## Decisions"));
	assert.ok(!md.includes("## Action items"));
	assert.ok(md.includes("## Key points"));
});

test("buildMeetingMarkdown preserves the raw transcript verbatim", () => {
	const raw = "Tom: hello.   \n\nAndy: hi there.\n";
	const md = buildMeetingMarkdown(baseResult(), raw, "2026-07-02T12:00:00.000Z", null);
	assert.ok(md.includes("Tom: hello."));
	assert.ok(md.includes("Andy: hi there."));
});

test("buildMeetingMarkdown keeps typed meeting notes above Transcript", () => {
	const md = buildMeetingMarkdown(
		baseResult(),
		"Them: roadmap update.",
		"2026-07-02T12:00:00.000Z",
		null,
		undefined,
		"## Questions to ask\n\n- [ ] Ask about budget\n\n## Live notes\n\nNeed a follow-up owner."
	);
	const notesIdx = md.indexOf("## Notes taken during meeting");
	const transcriptIdx = md.indexOf("[!transcript]- Transcript");
	assert.ok(notesIdx > -1);
	assert.ok(transcriptIdx > notesIdx);
	assert.match(md, /### Questions to ask/);
	assert.match(md, /Ask about budget/);
	assert.ok(!md.slice(transcriptIdx).includes("Ask about budget"));
});

test("buildMeetingMarkdown Related section includes tags, related notes, and wiki link only when present", () => {
	const withoutWiki = buildMeetingMarkdown(baseResult(), "raw", "2026-07-02T12:00:00.000Z", null);
	assert.ok(withoutWiki.includes("- [[external]]"));
	assert.ok(withoutWiki.includes("- [[project]]"));
	assert.ok(withoutWiki.includes("- [[Some Other Meeting]]"));
	assert.ok(!withoutWiki.includes("Wiki]]"));

	const withWiki = buildMeetingMarkdown(baseResult(), "raw", "2026-07-02T12:00:00.000Z", "Acme Wiki");
	assert.ok(withWiki.includes("- [[Acme Wiki]]"));
});

test("toCollapsedCallout quotes each body line, using a bare '>' for blank lines", () => {
	const callout = toCollapsedCallout("Transcript", "line one\n\nline two");
	assert.equal(callout, "> [!transcript]- Transcript\n> line one\n>\n> line two");
});

test("buildMeetingMarkdown output round-trips through extractTranscriptSnippet and extractEnrichedSections", () => {
	const raw = "Tom: hello.\n\nAndy: hi there.";
	const md = buildMeetingMarkdown(baseResult(), raw, "2026-07-02T12:00:00.000Z", null);
	assert.ok(md.includes("> [!transcript]- Transcript"));

	const snippetText = extractTranscriptSnippet(md, 500);
	assert.ok(snippetText.includes("Tom: hello."));
	assert.ok(snippetText.includes("Andy: hi there."));
	assert.ok(!snippetText.includes("> Tom"));

	const sections = extractEnrichedSections(md);
	assert.ok(sections.includes("Kickoff call summary."));
	assert.ok(!sections.includes("Tom: hello."));
	assert.ok(!sections.includes("[[external]]"));
});

test("legacy '## Transcript' notes still parse correctly through extractTranscriptSnippet and extractEnrichedSections", () => {
	const note = `---\ntype: meeting\n---\n\n## Summary\n\nThis is the summary text, not the transcript.\n\n## Transcript\n\nTom said hello and then we discussed the roadmap in detail.\n\n## Related\n\n- [[tag]]`;
	const snippetText = extractTranscriptSnippet(note, 500);
	assert.ok(snippetText.includes("Tom said hello"));
	assert.ok(!snippetText.includes("This is the summary text"));

	const sections = extractEnrichedSections(note);
	assert.ok(sections.includes("This is the summary text"));
	assert.ok(!sections.includes("Tom said hello"));
	assert.ok(!sections.includes("[[tag]]"));
});

test("legacy '[!note]- Transcript' callouts (pre-rename) still parse correctly through extractTranscriptSnippet and extractEnrichedSections", () => {
	const note = `---\ntype: meeting\n---\n\n## Summary\n\nThis is the summary text, not the transcript.\n\n> [!note]- Transcript\n> Tom said hello and then we discussed the roadmap in detail.\n\n## Related\n\n- [[tag]]`;
	const snippetText = extractTranscriptSnippet(note, 500);
	assert.ok(snippetText.includes("Tom said hello"));
	assert.ok(!snippetText.includes("This is the summary text"));

	const sections = extractEnrichedSections(note);
	assert.ok(sections.includes("This is the summary text"));
	assert.ok(!sections.includes("Tom said hello"));
	assert.ok(!sections.includes("[[tag]]"));
});

test("convertLegacyTranscriptToCallout converts a legacy '## Transcript' heading to a collapsed callout", () => {
	const legacy = `---\ntype: meeting\n---\n\n## Summary\n\nKickoff call summary.\n\n## Key points\n\n- Point one\n- Point two\n\n## Transcript\n\nTom: hello.\n\nAndy: hi there.\n\n## Related\n\n- [[external]]\n- [[project]]`;
	const converted = convertLegacyTranscriptToCallout(legacy);
	assert.ok(converted !== null);
	assert.ok(converted.includes("> [!transcript]- Transcript"));
	assert.ok(converted.includes("> Tom: hello."));
	assert.ok(converted.includes("> Andy: hi there."));
	assert.ok(!converted.includes("## Transcript"));
	// Everything outside the Transcript section is untouched.
	assert.ok(converted.includes("## Summary\n\nKickoff call summary."));
	assert.ok(converted.includes("## Key points\n\n- Point one\n- Point two"));
	assert.ok(converted.includes("## Related\n\n- [[external]]\n- [[project]]"));
});

test("convertLegacyTranscriptToCallout is a no-op on an already-migrated note", () => {
	const migrated = buildMeetingMarkdown(baseResult(), "Tom: hello.", "2026-07-02T12:00:00.000Z", null);
	assert.equal(convertLegacyTranscriptToCallout(migrated), null);
});

test("convertLegacyTranscriptToCallout is a no-op on an image/PDF note with no transcript", () => {
	const md = buildMeetingMarkdown(
		baseResult({ source: "photo" }),
		"",
		"2026-07-06T12:00:00.000Z",
		null,
		{ filename: "2026-07-06 Whiteboard Sketch.png", kind: "image" }
	);
	assert.equal(convertLegacyTranscriptToCallout(md), null);
});

test("buildTagFileContent matches the seed tag template shape", () => {
	const content = buildTagFileContent("external", "2026-07-02");
	assert.ok(content.includes("type: tag"));
	assert.ok(content.includes("created: 2026-07-02"));
	assert.ok(content.includes("# external"));
});

test("buildWikiMarkdown sorts timeline entries chronologically regardless of input order", () => {
	const result: WikiSynthesisResult = { current_state: "State.", open_questions: [] };
	const md = buildWikiMarkdown(
		"Acme",
		result,
		[
			{ date: "2026-07-02", title: "Second", oneLine: "Second thing happened." },
			{ date: "2026-06-01", title: "First", oneLine: "First thing happened." },
		],
		["First", "Second"],
		"2026-06-01",
		"2026-07-02"
	);
	const firstIdx = md.indexOf("First thing happened");
	const secondIdx = md.indexOf("Second thing happened");
	assert.ok(firstIdx < secondIdx, "earlier timeline entry should appear first");
});

test("buildWikiMarkdown shows a placeholder when there are no open questions", () => {
	const result: WikiSynthesisResult = { current_state: "State.", open_questions: [] };
	const md = buildWikiMarkdown("Acme", result, [], [], "2026-06-01", "2026-07-02");
	assert.ok(md.includes("(none currently)"));
});

test("isCaptureFile accepts md/txt/images/pdf and rejects everything else", () => {
	assert.ok(isCaptureFile("md"));
	assert.ok(isCaptureFile("txt"));
	assert.ok(isCaptureFile("png"));
	assert.ok(isCaptureFile("JPG")); // case-insensitive
	assert.ok(isCaptureFile("jpeg"));
	assert.ok(isCaptureFile("webp"));
	assert.ok(isCaptureFile("heic"));
	assert.ok(isCaptureFile("HEIF")); // case-insensitive
	assert.ok(isCaptureFile("pdf"));
	assert.ok(isCaptureFile("PDF")); // case-insensitive
	assert.ok(!isCaptureFile("gif"));
});

test("meetingAttachmentFilename combines date, sanitized title, and the original extension", () => {
	assert.equal(
		meetingAttachmentFilename("2026-07-06", "Whiteboard: Sketch", "png"),
		"2026-07-06 Whiteboard- Sketch.png"
	);
	assert.equal(
		meetingAttachmentFilename("2026-07-06", "Q2 Report", "pdf"),
		"2026-07-06 Q2 Report.pdf"
	);
});

test("arrayBufferToBase64 round-trips through atob", () => {
	const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
	const encoded = arrayBufferToBase64(bytes.buffer);
	assert.equal(encoded, "SGVsbG8=");
	assert.equal(atob(encoded), "Hello");
});

test("arrayBufferToBase64 handles buffers larger than one chunk", () => {
	const bytes = new Uint8Array(0x8000 + 10).fill(65); // > chunk size, all "A"
	const encoded = arrayBufferToBase64(bytes.buffer);
	assert.equal(atob(encoded).length, bytes.length);
});

test("buildMeetingMarkdown embeds the image and omits Transcript when capturedAttachment is an image", () => {
	const md = buildMeetingMarkdown(
		baseResult({ source: "photo" }),
		"",
		"2026-07-06T12:00:00.000Z",
		null,
		{ filename: "2026-07-06 Whiteboard Sketch.png", kind: "image" }
	);
	assert.ok(md.includes("## Captured image"));
	assert.ok(md.includes("![[2026-07-06 Whiteboard Sketch.png]]"));
	assert.ok(!md.includes("## Transcript"));
});

test("buildMeetingMarkdown embeds the document and omits Transcript when capturedAttachment is a document", () => {
	const md = buildMeetingMarkdown(
		baseResult({ source: "document" }),
		"",
		"2026-07-06T12:00:00.000Z",
		null,
		{ filename: "2026-07-06 Q2 Report.pdf", kind: "document" }
	);
	assert.ok(md.includes("## Captured document"));
	assert.ok(md.includes("![[2026-07-06 Q2 Report.pdf]]"));
	assert.ok(!md.includes("## Transcript"));
});

test("clusterByTag excludes fragment-tagged notes from eligibility counting", () => {
	const clusters = clusterByTag([
		{ filename: "a", title: "A", date: "2026-07-01", tags: ["internal"] },
		{ filename: "b", title: "B", date: "2026-07-02", tags: ["internal", "fragment"] },
		{ filename: "c", title: "C", date: "2026-07-03", tags: ["internal"] },
	]);
	const internal = clusters.find((c) => c.tag === "internal");
	assert.ok(internal);
	assert.equal(internal.notes.length, 2);
	assert.ok(!internal.notes.some((n) => n.filename === "b"));
});
