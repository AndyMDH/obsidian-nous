import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	MEETING_RECORDER_MISSING_NOTICE,
	ONBOARDING_PREREQUISITES_TEXT,
	VOICE_CAPTURE_SETTINGS_DESC,
	VOICE_TRANSCRIPTION_SETUP_NOTICE,
	capturePrerequisitesContinueText,
	capturePrerequisiteItems,
	hasGeminiOrOpenAiTranscriptionKey,
	nativeRecorderReadinessText,
	onboardingFinishIntro,
	onboardingFinishNextActions,
	onboardingFinishTitle,
	shouldOfferNativeRecorderInstall,
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
		VOICE_CAPTURE_SETTINGS_DESC,
		VOICE_TRANSCRIPTION_SETUP_NOTICE,
	]) {
		assert.match(text, /speech-to-text|whisper\.cpp|Gemini\/OpenAI|Gemini or OpenAI/);
	}
	assert.match(VOICE_TRANSCRIPTION_SETUP_NOTICE, /No recording started/);
});

test("new-user copy sends meeting capture to the native recorder first", () => {
	for (const text of [
		ONBOARDING_PREREQUISITES_TEXT,
		MEETING_RECORDER_MISSING_NOTICE,
	]) {
		assert.match(text, /native|nous-recorder|Nous Recorder/);
	}
	assert.match(ONBOARDING_PREREQUISITES_TEXT, /saves the recording|finishes it later/);
	assert.match(MEETING_RECORDER_MISSING_NOTICE, /click Install/i);
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
	assert.match(items[2].desc, /native Nous Recorder/);
	assert.match(items[2].desc, /Click Install below/);
});

test("capture prerequisite checklist distinguishes native recorder readiness", () => {
	const nativeItems = capturePrerequisiteItems({ voiceReady: true, meeting: "ready-native" });
	assert.equal(nativeItems[2].warning, false);
	assert.match(nativeItems[2].desc, /live note/);

	const nativeNoTranscriptionItems = capturePrerequisiteItems({ voiceReady: false, meeting: "ready-native" });
	assert.equal(nativeNoTranscriptionItems[2].warning, false);
	assert.match(nativeNoTranscriptionItems[2].desc, /Ready to record/);
	assert.match(nativeNoTranscriptionItems[2].desc, /wait in the inbox/);
});

test("native recorder install is offered only when the native recorder is missing", () => {
	assert.equal(shouldOfferNativeRecorderInstall({ voiceReady: true, meeting: "needs-recorder" }), true);
	assert.equal(shouldOfferNativeRecorderInstall({ voiceReady: true, meeting: "ready-native" }), false);
	assert.equal(shouldOfferNativeRecorderInstall({ voiceReady: true, meeting: "unsupported" }), false);

	assert.equal(
		capturePrerequisitesContinueText({ voiceReady: true, meeting: "needs-recorder" }),
		"Continue without meeting capture"
	);
	assert.equal(capturePrerequisitesContinueText({ voiceReady: true, meeting: "ready-native" }), "Continue");
});

test("capture prerequisite checklist treats non-macOS meeting capture as unavailable, not broken", () => {
	const items = capturePrerequisiteItems({ voiceReady: true, meeting: "unsupported" });
	assert.equal(items[1].warning, false);
	assert.match(items[1].desc, /Ready/);
	assert.equal(items[2].warning, false);
	assert.match(items[2].desc, /macOS only/);
});

test("finish screen stays truthful when optional capture setup is missing", () => {
	const missingBoth = { voiceReady: false, meeting: "needs-recorder" } as const;
	assert.equal(onboardingFinishTitle(missingBoth), "Text capture is ready");
	assert.match(onboardingFinishIntro(missingBoth, "00-Inbox", "10-Notes"), /Text, images, and PDFs are ready/);
	assert.doesNotMatch(onboardingFinishIntro(missingBoth, "00-Inbox", "10-Notes"), /voice notes, or meeting recordings/);
	assert.deepEqual(
		onboardingFinishNextActions(missingBoth).map((item) => [item.name, item.warning]),
		[
			["Voice notes", true],
			["Meeting capture", true],
			["Hotkeys", false],
			["Dictate from anywhere (optional)", false],
		]
	);

	const ready = { voiceReady: true, meeting: "ready-native" } as const;
	assert.equal(onboardingFinishTitle(ready), "Nous is ready");
	assert.match(onboardingFinishIntro(ready, "00-Inbox", "10-Notes"), /voice notes, or meeting recordings/);
	// Even a fully-ready setup gets the non-warning tips (hotkeys, optional
	// system-wide dictation) - never a warning.
	assert.deepEqual(
		onboardingFinishNextActions(ready).map((item) => [item.name, item.warning]),
		[
			["Hotkeys", false],
			["Dictate from anywhere (optional)", false],
		]
	);
});

test("native recorder readiness text exposes status and next action", () => {
	assert.match(
		nativeRecorderReadinessText({
			state: "missing",
			command: "nous-recorder",
			version: null,
			detail: "",
		}),
		/Not installed.*Click Install/
	);
	assert.match(
		nativeRecorderReadinessText({
			state: "needs-permission",
			command: "/vault/.obsidian/plugins/nous/bin/nous-recorder",
			version: "nous-recorder 0.1.0",
			detail: "Allow microphone and screen/audio recording permissions.",
		}),
		/last start failed.*Try the phone button again/
	);
});
