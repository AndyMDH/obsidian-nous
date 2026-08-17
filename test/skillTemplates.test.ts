import { test } from "node:test";
import { strict as assert } from "node:assert";
import { meetingEnricherSkill, wikiBuilderSkill } from "../src/skillTemplates.ts";

const folders = {
	inbox: "00-Inbox",
	meetings: "10-Notes",
	wikis: "30-Wikis",
	tags: "20-Tags",
};

test("meeting enricher skill skips pending native recording placeholders", () => {
	const skill = meetingEnricherSkill(folders);
	assert.match(skill, /nous_pending_native_recording: true/);
	assert.match(skill, /nous_live_native_recording: true/);
	assert.match(skill, /plugin itself must transcribe/);
});

test("meeting enricher skill preserves typed live meeting notes separately", () => {
	const skill = meetingEnricherSkill(folders);
	assert.match(skill, /## Notes taken during meeting/);
	assert.match(skill, /`## Notes`/);
	assert.match(skill, /typed by the user during the meeting/);
});

test("meeting enricher skill auto-suggests the win tag and extracts win fields", () => {
	const skill = meetingEnricherSkill(folders);
	assert.match(skill, /win.*is a recognized system tag/s);
	assert.match(skill, /even if.*the user never typed.*#win/s);
	assert.match(skill, /win_category:/);
	assert.match(skill, /win_headcount:/);
	assert.match(skill, /win_client:/);
	assert.match(skill, /win_repo:/);
	assert.match(skill, /win_metric:/);
	assert.match(skill, /Leave a field\s+blank rather than guessing/);
});

test("wiki builder skill maintains a grouped, counted Wins.md page", () => {
	const skill = wikiBuilderSkill(folders);
	assert.match(skill, /30-Wikis\/Wins\.md/);
	assert.match(skill, /Group entries by `win_category`/);
	assert.match(skill, /sort newest-first/);
	assert.match(skill, /fully regenerated/);
});
