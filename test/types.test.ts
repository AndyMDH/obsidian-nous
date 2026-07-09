import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DEFAULT_SETTINGS, MODEL_OPTIONS } from "../src/types.ts";

test("every default model appears in its provider's dropdown options", () => {
	for (const provider of ["anthropic", "openai", "gemini"] as const) {
		const ids = MODEL_OPTIONS[provider].map((o) => o.id);
		assert.ok(
			ids.includes(DEFAULT_SETTINGS.models[provider]),
			`${provider} default "${DEFAULT_SETTINGS.models[provider]}" missing from MODEL_OPTIONS`
		);
	}
});

test("model options have no duplicate ids within a provider", () => {
	for (const provider of ["anthropic", "openai", "gemini"] as const) {
		const ids = MODEL_OPTIONS[provider].map((o) => o.id);
		assert.equal(new Set(ids).size, ids.length, `${provider} has duplicate model ids`);
	}
});
