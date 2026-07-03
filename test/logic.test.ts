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
	extractSummaryText,
	firstSentence,
	buildMeetingMarkdown,
	buildTagFileContent,
	buildWikiMarkdown,
	clusterByTag,
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

test("buildMeetingMarkdown Related section includes tags, related notes, and wiki link only when present", () => {
	const withoutWiki = buildMeetingMarkdown(baseResult(), "raw", "2026-07-02T12:00:00.000Z", null);
	assert.ok(withoutWiki.includes("- [[external]]"));
	assert.ok(withoutWiki.includes("- [[project]]"));
	assert.ok(withoutWiki.includes("- [[Some Other Meeting]]"));
	assert.ok(!withoutWiki.includes("Wiki]]"));

	const withWiki = buildMeetingMarkdown(baseResult(), "raw", "2026-07-02T12:00:00.000Z", "Acme Wiki");
	assert.ok(withWiki.includes("- [[Acme Wiki]]"));
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

test("clusterByTag excludes fragment-tagged notes from eligibility counting", () => {
	const clusters = clusterByTag([
		{ filename: "a", title: "A", date: "2026-07-01", tags: ["internal"] },
		{ filename: "b", title: "B", date: "2026-07-02", tags: ["internal", "fragment"] },
		{ filename: "c", title: "C", date: "2026-07-03", tags: ["internal"] },
	]);
	const internal = clusters.find((c) => c.tag === "internal");
	assert.ok(internal);
	assert.equal(internal!.notes.length, 2);
	assert.ok(!internal!.notes.some((n) => n.filename === "b"));
});
