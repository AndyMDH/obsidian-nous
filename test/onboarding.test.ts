import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	MEETING_RECORDER_MISSING_NOTICE,
	capturePrerequisitesContinueText,
	capturePrerequisiteItems,
	hasGeminiOrOpenAiTranscriptionKey,
	nativeRecorderReadinessText,
	onboardingFinishTitle,
	shouldOfferNativeRecorderInstall,
} from "../src/onboarding.ts";

test("voice transcription fallback accepts only Gemini or OpenAI keys", () => {
	assert.equal(hasGeminiOrOpenAiTranscriptionKey({ gemini: "", openai: "" }), false);
	assert.equal(hasGeminiOrOpenAiTranscriptionKey({ gemini: "   ", openai: "" }), false);
	assert.equal(hasGeminiOrOpenAiTranscriptionKey({ gemini: "gemini-key", openai: "" }), true);
	assert.equal(hasGeminiOrOpenAiTranscriptionKey({ gemini: "", openai: "openai-key" }), true);
});

// Regression guard: this notice is shown via settingsNotice(), which already
// appends its own clickable "Open Nous settings" link - the text must not
// re-spell the click-path too, or the same bubble says "go here" twice.
test("meeting recorder missing notice stays terse - settingsNotice's own link handles navigation", () => {
	assert.equal(MEETING_RECORDER_MISSING_NOTICE, "Meeting recorder isn't installed yet.");
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
	assert.match(items[1].desc, /speech-to-text/i);
	assert.match(items[2].desc, /native recorder/i);
	assert.match(items[2].desc, /click Install below/);
});

// Regression guard for the whisper-cli fix: Settings/onboarding used to call
// voice notes "ready" (or imply so) once the model file was downloaded, even
// though whisper-cli ("brew install whisper-cpp") was still missing. The fix
// made every "not ready" message name *both* pieces so the user never sees a
// premature "installed" claim. voiceReady itself stays a single boolean here
// (the two-piece check lives in main.ts's hasAudioTranscriptionBackend(),
// which isn't unit-testable without spawning a process) - what's testable,
// and what must never regress, is that the copy shown for "not ready" keeps
// signaling two separate steps, not just the model download (the model
// alone was the exact silent-success bug this screen used to have).
test("voice notes not-ready copy names two steps, not just the model download", () => {
	const items = capturePrerequisiteItems({ voiceReady: false, meeting: "unsupported" });
	assert.equal(items[1].warning, true);
	assert.match(items[1].desc, /two/i);
	assert.match(items[1].desc, /install/i);
});

test("voice notes not-ready copy is the exact short two-step message (catches silent reverts to a one-piece check)", () => {
	const items = capturePrerequisiteItems({ voiceReady: false, meeting: "unsupported" });
	assert.equal(items[1].desc, "Needs speech-to-text - two one-click installs, no Terminal.");
});

test("capture prerequisite checklist distinguishes native recorder readiness", () => {
	const nativeItems = capturePrerequisiteItems({ voiceReady: true, meeting: "ready-native" });
	assert.equal(nativeItems[2].warning, false);
	assert.equal(nativeItems[2].desc, "Ready.");

	const nativeNoTranscriptionItems = capturePrerequisiteItems({ voiceReady: false, meeting: "ready-native" });
	assert.equal(nativeNoTranscriptionItems[2].warning, false);
	assert.match(nativeNoTranscriptionItems[2].desc, /Ready to record/);
	assert.match(nativeNoTranscriptionItems[2].desc, /wait in the inbox/);
});

// Regression guard: getCapturePrerequisiteStatus() used to report
// meeting: "ready-native" whenever the recorder's "status" subcommand
// exited 0, even right after a "start" attempt had just failed on a macOS
// permission prompt - that failure was tracked separately, so the numbered
// checklist said "Ready to record" while the detailed recorder row right
// below it, on the same screen, said the opposite ("last start failed").
// "needs-permission" exists so both rows agree.
test("meeting capture checklist reflects a failed permission prompt, not a bare 'ready'", () => {
	const items = capturePrerequisiteItems({ voiceReady: true, meeting: "needs-permission" });
	assert.equal(items[2].warning, true);
	assert.match(items[2].desc, /mic\/screen recording permissions/i);

	assert.equal(shouldOfferNativeRecorderInstall({ voiceReady: true, meeting: "needs-permission" }), false);
});

test("native recorder install is offered only when the native recorder is missing", () => {
	assert.equal(shouldOfferNativeRecorderInstall({ voiceReady: true, meeting: "needs-recorder" }), true);
	assert.equal(shouldOfferNativeRecorderInstall({ voiceReady: true, meeting: "ready-native" }), false);
	assert.equal(shouldOfferNativeRecorderInstall({ voiceReady: true, meeting: "unsupported" }), false);

	assert.equal(
		capturePrerequisitesContinueText({ voiceReady: true, meeting: "needs-recorder" }),
		"Continue - set up meeting capture later"
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

test("finish screen title stays truthful when optional capture setup is missing", () => {
	const missingBoth = { voiceReady: false, meeting: "needs-recorder" } as const;
	assert.equal(onboardingFinishTitle(missingBoth), "Text capture is ready");

	const ready = { voiceReady: true, meeting: "ready-native" } as const;
	assert.equal(onboardingFinishTitle(ready), "Nous is ready");
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
		/last start failed.*check mic\/screen recording permissions/
	);
});
