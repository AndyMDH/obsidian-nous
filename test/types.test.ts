import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DEFAULT_SETTINGS, MODEL_OPTIONS } from "../src/types.ts";

test("every default model appears in its provider's dropdown options", () => {
	for (const provider of ["anthropic", "openai", "gemini", "glm"] as const) {
		const ids = MODEL_OPTIONS[provider].map((o) => o.id);
		assert.ok(
			ids.includes(DEFAULT_SETTINGS.models[provider]),
			`${provider} default "${DEFAULT_SETTINGS.models[provider]}" missing from MODEL_OPTIONS`
		);
	}
});

test("model options have no duplicate ids within a provider", () => {
	for (const provider of ["anthropic", "openai", "gemini", "glm"] as const) {
		const ids = MODEL_OPTIONS[provider].map((o) => o.id);
		assert.equal(new Set(ids).size, ids.length, `${provider} has duplicate model ids`);
	}
});

// hasWhisperCli() in main.ts falls back to this default command whenever
// settings.whisperCliPath is blank ("whisper-cli --help"). If this default
// ever went blank too, the fallback command would become "" and every local
// voice-transcription readiness check would silently fail closed instead of
// reporting "whisper-cli missing" - the same class of "installed but not
// really" bug the model-file-only check used to have.
test("default settings ship a non-empty whisper-cli command", () => {
	assert.equal(DEFAULT_SETTINGS.whisperCliPath, "whisper-cli");
	assert.ok(DEFAULT_SETTINGS.whisperCliPath.trim().length > 0);
});
