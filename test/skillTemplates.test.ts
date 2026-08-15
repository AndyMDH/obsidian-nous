import { test } from "node:test";
import { strict as assert } from "node:assert";
import { meetingEnricherSkill } from "../src/skillTemplates.ts";

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
