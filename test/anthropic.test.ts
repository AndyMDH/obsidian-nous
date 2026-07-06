import { test } from "node:test";
import { strict as assert } from "node:assert";
import { callClaudeTool, AnthropicApiError } from "../src/anthropic.ts";
import type { HttpPost } from "../src/anthropic.ts";

const TOOL = {
	name: "test_tool",
	description: "A test tool",
	input_schema: { type: "object", properties: {} },
};

test("callClaudeTool returns the parsed tool_use input on success", async () => {
	const mockPost: HttpPost = async () => ({
		status: 200,
		text: JSON.stringify({
			content: [{ type: "tool_use", name: "test_tool", input: { foo: "bar" } }],
		}),
	});
	const result = await callClaudeTool(mockPost, "key", "model", "sys", { text: "msg" }, TOOL);
	assert.deepEqual(result, { foo: "bar" });
});

test("callClaudeTool sends the right headers and forces the tool via tool_choice", async () => {
	let capturedHeaders: Record<string, string> = {};
	let capturedBody = "";
	const mockPost: HttpPost = async (_url, headers, body) => {
		capturedHeaders = headers;
		capturedBody = body;
		return {
			status: 200,
			text: JSON.stringify({
				content: [{ type: "tool_use", name: "test_tool", input: {} }],
			}),
		};
	};
	await callClaudeTool(mockPost, "my-key", "my-model", "sys", { text: "msg" }, TOOL);
	assert.equal(capturedHeaders["x-api-key"], "my-key");
	assert.equal(capturedHeaders["anthropic-version"], "2023-06-01");
	const parsedBody = JSON.parse(capturedBody);
	assert.equal(parsedBody.model, "my-model");
	assert.deepEqual(parsedBody.tool_choice, { type: "tool", name: "test_tool" });
});

test("callClaudeTool throws AnthropicApiError on a non-2xx response", async () => {
	const mockPost: HttpPost = async () => ({
		status: 429,
		text: JSON.stringify({ error: { message: "rate limited" } }),
	});
	await assert.rejects(
		() => callClaudeTool(mockPost, "key", "model", "sys", { text: "msg" }, TOOL),
		(err: unknown) => {
			assert.ok(err instanceof AnthropicApiError);
			assert.equal(err.status, 429);
			return true;
		}
	);
});

test("callClaudeTool throws when the response has no matching tool_use block", async () => {
	const mockPost: HttpPost = async () => ({
		status: 200,
		text: JSON.stringify({ content: [{ type: "text", text: "I refuse to use tools." }] }),
	});
	await assert.rejects(() => callClaudeTool(mockPost, "key", "model", "sys", { text: "msg" }, TOOL));
});

test("callClaudeTool puts the image block before the text block when an image is given", async () => {
	let capturedBody = "";
	const mockPost: HttpPost = async (_url, _headers, body) => {
		capturedBody = body;
		return {
			status: 200,
			text: JSON.stringify({ content: [{ type: "tool_use", name: "test_tool", input: {} }] }),
		};
	};
	await callClaudeTool(
		mockPost,
		"key",
		"model",
		"sys",
		{ text: "describe this", image: { mediaType: "image/png", base64Data: "abc123" } },
		TOOL
	);
	const parsedBody = JSON.parse(capturedBody);
	assert.deepEqual(parsedBody.messages[0].content, [
		{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
		{ type: "text", text: "describe this" },
	]);
});

test("callClaudeTool rejects before making a request when no API key is set", async () => {
	let called = false;
	const mockPost: HttpPost = async () => {
		called = true;
		return { status: 200, text: "{}" };
	};
	await assert.rejects(() => callClaudeTool(mockPost, "", "model", "sys", { text: "msg" }, TOOL));
	assert.equal(called, false);
});
