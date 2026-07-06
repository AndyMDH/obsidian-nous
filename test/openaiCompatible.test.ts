import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { HttpPost } from "../src/anthropic.ts";
import { LlmApiError } from "../src/llmProvider.ts";
import { OpenAiCompatibleProvider } from "../src/openaiCompatible.ts";

const TOOL = {
	name: "test_tool",
	description: "A test tool",
	input_schema: { type: "object", properties: {} },
};

test("callTool parses the tool call arguments (a JSON string) on success", async () => {
	const mockPost: HttpPost = async () => ({
		status: 200,
		text: JSON.stringify({
			choices: [
				{
					message: {
						tool_calls: [
							{ function: { name: "test_tool", arguments: JSON.stringify({ foo: "bar" }) } },
						],
					},
				},
			],
		}),
	});
	const provider = new OpenAiCompatibleProvider(mockPost, "key", "model", "https://api.openai.com/v1");
	const result = await provider.callTool("sys", { text: "msg" }, TOOL);
	assert.deepEqual(result, { foo: "bar" });
});

test("callTool sends a data-URI image_url block alongside the text when an image is given", async () => {
	let capturedBody = "";
	const mockPost: HttpPost = async (_url, _headers, body) => {
		capturedBody = body;
		return {
			status: 200,
			text: JSON.stringify({
				choices: [{ message: { tool_calls: [{ function: { name: "test_tool", arguments: "{}" } }] } }],
			}),
		};
	};
	const provider = new OpenAiCompatibleProvider(mockPost, "key", "model", "https://api.openai.com/v1");
	await provider.callTool(
		"sys",
		{ text: "describe this", image: { mediaType: "image/png", base64Data: "abc123" } },
		TOOL
	);
	const parsedBody = JSON.parse(capturedBody);
	assert.deepEqual(parsedBody.messages[1].content, [
		{ type: "text", text: "describe this" },
		{ type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
	]);
});

test("callTool sends bearer auth and forces the tool via tool_choice", async () => {
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
				choices: [{ message: { tool_calls: [{ function: { name: "test_tool", arguments: "{}" } }] } }],
			}),
		};
	};
	const provider = new OpenAiCompatibleProvider(mockPost, "my-key", "my-model", "https://api.openai.com/v1");
	await provider.callTool("sys", { text: "msg" }, TOOL);
	assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
	assert.equal(capturedHeaders["authorization"], "Bearer my-key");
	const parsedBody = JSON.parse(capturedBody);
	assert.equal(parsedBody.model, "my-model");
	assert.deepEqual(parsedBody.tool_choice, { type: "function", function: { name: "test_tool" } });
});

test("callTool omits the authorization header when no API key is set (local models)", async () => {
	let capturedHeaders: Record<string, string> = {};
	const mockPost: HttpPost = async (_url, headers) => {
		capturedHeaders = headers;
		return {
			status: 200,
			text: JSON.stringify({
				choices: [{ message: { tool_calls: [{ function: { name: "test_tool", arguments: "{}" } }] } }],
			}),
		};
	};
	const provider = new OpenAiCompatibleProvider(mockPost, "", "llama3.1", "http://localhost:11434/v1");
	await provider.callTool("sys", { text: "msg" }, TOOL);
	assert.equal("authorization" in capturedHeaders, false);
});

test("callTool strips a trailing slash from the base URL", async () => {
	let capturedUrl = "";
	const mockPost: HttpPost = async (url) => {
		capturedUrl = url;
		return {
			status: 200,
			text: JSON.stringify({
				choices: [{ message: { tool_calls: [{ function: { name: "test_tool", arguments: "{}" } }] } }],
			}),
		};
	};
	const provider = new OpenAiCompatibleProvider(mockPost, "key", "model", "http://localhost:11434/v1/");
	await provider.callTool("sys", { text: "msg" }, TOOL);
	assert.equal(capturedUrl, "http://localhost:11434/v1/chat/completions");
});

test("callTool throws LlmApiError on a non-2xx response", async () => {
	const mockPost: HttpPost = async () => ({
		status: 500,
		text: JSON.stringify({ error: "boom" }),
	});
	const provider = new OpenAiCompatibleProvider(mockPost, "key", "model", "https://api.openai.com/v1");
	await assert.rejects(
		() => provider.callTool("sys", { text: "msg" }, TOOL),
		(err: unknown) => {
			assert.ok(err instanceof LlmApiError);
			assert.equal(err.status, 500);
			return true;
		}
	);
});

test("callTool throws when the response has no matching tool call", async () => {
	const mockPost: HttpPost = async () => ({
		status: 200,
		text: JSON.stringify({ choices: [{ message: {} }] }),
	});
	const provider = new OpenAiCompatibleProvider(mockPost, "key", "model", "https://api.openai.com/v1");
	await assert.rejects(() => provider.callTool("sys", { text: "msg" }, TOOL));
});
