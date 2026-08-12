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
	assert.match(skill, /plugin itself must transcribe/);
});
