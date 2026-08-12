import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	MEETING_RECORDER_MISSING_NOTICE,
	ONBOARDING_FINISH_PREREQUISITES_TEXT,
	ONBOARDING_PREREQUISITES_TEXT,
	VOICE_CAPTURE_SETTINGS_DESC,
	VOICE_TRANSCRIPTION_SETUP_NOTICE,
	capturePrerequisiteItems,
	hasGeminiOrOpenAiTranscriptionKey,
} from "../src/onboarding.ts";

test("voice transcription fallback accepts only Gemini or OpenAI keys", () => {
	assert.equal(hasGeminiOrOpenAiTranscriptionKey({ gemini: "", openai: "" }), false);
	assert.equal(hasGeminiOrOpenAiTranscriptionKey({ gemini: "   ", openai: "" }), false);
	assert.equal(hasGeminiOrOpenAiTranscriptionKey({ gemini: "gemini-key", openai: "" }), true);
	assert.equal(hasGeminiOrOpenAiTranscriptionKey({ gemini: "", openai: "openai-key" }), true);
});

test("new-user copy says voice notes need speech-to-text setup", () => {
	for (const text of [
		ONBOARDING_PREREQUISITES_TEXT,
		ONBOARDING_FINISH_PREREQUISITES_TEXT,
		VOICE_CAPTURE_SETTINGS_DESC,
		VOICE_TRANSCRIPTION_SETUP_NOTICE,
	]) {
		assert.match(text, /speech-to-text|whisper\.cpp|Gemini\/OpenAI|Gemini or OpenAI/);
	}
	assert.match(VOICE_TRANSCRIPTION_SETUP_NOTICE, /No recording started/);
});

test("new-user copy says meeting capture prefers the native recorder with QuickRecorder fallback", () => {
	for (const text of [
		ONBOARDING_PREREQUISITES_TEXT,
		ONBOARDING_FINISH_PREREQUISITES_TEXT,
		MEETING_RECORDER_MISSING_NOTICE,
	]) {
		assert.match(text, /native|nous-recorder|Nous Recorder/);
		assert.match(text, /QuickRecorder/);
		assert.match(text, /fallback|not part of macOS/i);
	}
});

test("capture prerequisite checklist marks missing optional capture setup", () => {
	const items = capturePrerequisiteItems({ voiceReady: false, meeting: "needs-recorder" });
	assert.deepEqual(
		items.map((item) => [item.name, item.warning]),
		[
			["Text, images, and PDFs", false],
			["Voice notes", true],
			["Meeting capture", true],
		]
	);
	assert.match(items[1].desc, /will not start recording/);
	assert.match(items[2].desc, /native nous-recorder helper/);
	assert.match(items[2].desc, /QuickRecorder is not part of macOS/);
});

test("capture prerequisite checklist distinguishes native recorder from QuickRecorder fallback", () => {
	const nativeItems = capturePrerequisiteItems({ voiceReady: true, meeting: "ready-native" });
	assert.equal(nativeItems[2].warning, false);
	assert.match(nativeItems[2].desc, /native Nous Recorder/);

	const quickRecorderItems = capturePrerequisiteItems({ voiceReady: true, meeting: "ready-quickrecorder" });
	assert.equal(quickRecorderItems[2].warning, false);
	assert.match(quickRecorderItems[2].desc, /QuickRecorder fallback/);
});

test("capture prerequisite checklist treats non-macOS meeting capture as unavailable, not broken", () => {
	const items = capturePrerequisiteItems({ voiceReady: true, meeting: "unsupported" });
	assert.equal(items[1].warning, false);
	assert.match(items[1].desc, /Ready/);
	assert.equal(items[2].warning, false);
	assert.match(items[2].desc, /macOS only/);
});
