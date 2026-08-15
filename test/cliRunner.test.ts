import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	augmentedPath,
	buildEnrichArgs,
	buildWikiArgs,
	cliErrorDetail,
	summarizeLogLines,
} from "../src/cliRunner.ts";

test("augmentedPath prepends Homebrew/local bin dirs and an optional extra dir", () => {
	const result = augmentedPath("/usr/bin:/bin", "/Users/andy", "/Users/andy/.local/share/claude/bin");
	assert.equal(
		result,
		"/Users/andy/.local/share/claude/bin:/opt/homebrew/bin:/usr/local/bin:/Users/andy/.local/bin:/usr/bin:/bin"
	);
});

test("augmentedPath omits the extra dir when not provided", () => {
	const result = augmentedPath("/usr/bin", "/Users/andy", null);
	assert.equal(result, "/opt/homebrew/bin:/usr/local/bin:/Users/andy/.local/bin:/usr/bin");
});

test("buildEnrichArgs interpolates the configured inbox folder into the prompt", () => {
	const args = buildEnrichArgs("00-Inbox");
	assert.ok(args.includes("Use the meeting-enricher skill to process all files in 00-Inbox/."));
	assert.ok(args.includes("--permission-mode"));
	assert.ok(args.includes("acceptEdits"));
});

test("buildWikiArgs interpolates the configured meetings folder into the prompt", () => {
	const args = buildWikiArgs("10-Meetings");
	assert.ok(
		args.includes("Use the wiki-builder skill to create or update wiki pages based on 10-Meetings/.")
	);
});

test("summarizeLogLines counts each event type independently", () => {
	const log = `2026-07-03T00:00:00Z ENRICHED: a.md - tags: [x]
2026-07-03T00:00:01Z ENRICHED: b.md - tags: [y]
2026-07-03T00:00:02Z NEW WIKI: topic - sources: 4
2026-07-03T00:00:03Z SKIPPED: c.md - empty file
2026-07-03T00:00:04Z run complete`;
	const summary = summarizeLogLines(log);
	assert.equal(summary.enriched, 2);
	assert.equal(summary.newWikis, 1);
	assert.equal(summary.updatedWikis, 0);
	assert.equal(summary.problems, 1);
});

test("summarizeLogLines returns all zeros for an empty-inbox run", () => {
	const summary = summarizeLogLines("2026-07-03T00:00:00Z inbox empty, nothing to do\n");
	assert.deepEqual(summary, { enriched: 0, newWikis: 0, updatedWikis: 0, problems: 0 });
});

test("cliErrorDetail prefers stderr, falls back to stdout, never returns blank", () => {
	assert.equal(cliErrorDetail({ code: 1, stdout: "out msg", stderr: "err msg" }), "err msg");
	assert.equal(cliErrorDetail({ code: 1, stdout: "Not logged in", stderr: "" }), "Not logged in");
	assert.equal(cliErrorDetail({ code: 1, stdout: "stdout msg", stderr: "   \n" }), "stdout msg");
	assert.equal(cliErrorDetail({ code: 1, stdout: "", stderr: "" }), "(no output)");
	assert.equal(cliErrorDetail({ code: 1, stdout: "x".repeat(400), stderr: "" }).length, 300);
});
