import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { HttpPost } from "../src/anthropic.ts";
import { LlmApiError } from "../src/llmProvider.ts";
import { GeminiProvider } from "../src/gemini.ts";

const TOOL = {
	name: "test_tool",
	description: "A test tool",
	input_schema: { type: "object", properties: {} },
};

test("callTool returns the functionCall args (already an object) on success", async () => {
	const mockPost: HttpPost = async () => ({
		status: 200,
		text: JSON.stringify({
			candidates: [
				{ content: { parts: [{ functionCall: { name: "test_tool", args: { foo: "bar" } } }] } },
			],
		}),
	});
	const provider = new GeminiProvider(mockPost, "key", "model");
	const result = await provider.callTool("sys", { text: "msg" }, TOOL);
	assert.deepEqual(result, { foo: "bar" });
});

test("callTool sends an inline_data part alongside the text when an image is given", async () => {
	let capturedBody = "";
	const mockPost: HttpPost = async (_url, _headers, body) => {
		capturedBody = body;
		return {
			status: 200,
			text: JSON.stringify({
				candidates: [{ content: { parts: [{ functionCall: { name: "test_tool", args: {} } }] } }],
			}),
		};
	};
	const provider = new GeminiProvider(mockPost, "key", "model");
	await provider.callTool(
		"sys",
		{ text: "describe this", image: { mediaType: "image/png", base64Data: "abc123" } },
		TOOL
	);
	const parsedBody = JSON.parse(capturedBody);
	assert.deepEqual(parsedBody.contents[0].parts, [
		{ text: "describe this" },
		{ inline_data: { mime_type: "image/png", data: "abc123" } },
	]);
});

test("callTool sends the API key as a header and forces the tool via tool_config", async () => {
	let capturedHeaders: Record<string, string> = {};
	let capturedUrl = "";
	let capturedBody = "";
	const mockPost: HttpPost = async (url, headers, body) => {
		capturedUrl = url;
		capturedHeaders = headers;
		capturedBody = body;
		return {
			status: 200,
			text: JSON.stringify({
				candidates: [{ content: { parts: [{ functionCall: { name: "test_tool", args: {} } }] } }],
			}),
		};
	};
	const provider = new GeminiProvider(mockPost, "my-key", "gemini-3-pro-preview");
	await provider.callTool("sys", { text: "msg" }, TOOL);
	assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent");
	assert.equal(capturedHeaders["x-goog-api-key"], "my-key");
	assert.equal(capturedUrl.includes("key="), false); // key must not leak into the URL
	const parsedBody = JSON.parse(capturedBody);
	assert.deepEqual(parsedBody.tool_config, {
		function_calling_config: { mode: "ANY", allowed_function_names: ["test_tool"] },
	});
});

test("callTool rejects before making a request when no API key is set", async () => {
	let called = false;
	const mockPost: HttpPost = async () => {
		called = true;
		return { status: 200, text: "{}" };
	};
	const provider = new GeminiProvider(mockPost, "", "model");
	await assert.rejects(() => provider.callTool("sys", { text: "msg" }, TOOL));
	assert.equal(called, false);
});

test("callTool throws LlmApiError on a non-2xx response", async () => {
	const mockPost: HttpPost = async () => ({
		status: 429,
		text: JSON.stringify({ error: "rate limited" }),
	});
	const provider = new GeminiProvider(mockPost, "key", "model");
	await assert.rejects(
		() => provider.callTool("sys", { text: "msg" }, TOOL),
		(err: unknown) => {
			assert.ok(err instanceof LlmApiError);
			assert.equal(err.status, 429);
			return true;
		}
	);
});

test("callTool throws when the response has no matching functionCall", async () => {
	const mockPost: HttpPost = async () => ({
		status: 200,
		text: JSON.stringify({ candidates: [{ content: { parts: [{ text: "no tool call" }] } }] }),
	});
	const provider = new GeminiProvider(mockPost, "key", "model");
	await assert.rejects(() => provider.callTool("sys", { text: "msg" }, TOOL));
});
