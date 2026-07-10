import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	audioMimeType,
	buildMultipartBody,
	transcribeWithGemini,
	transcribeWithOpenAi,
} from "../src/transcribe.ts";
import { LlmApiError } from "../src/llmProvider.ts";

test("audioMimeType maps common extensions", () => {
	assert.equal(audioMimeType("m4a"), "audio/mp4");
	assert.equal(audioMimeType("M4A"), "audio/mp4");
	assert.equal(audioMimeType("mp3"), "audio/mpeg");
	assert.equal(audioMimeType("webm"), "audio/webm");
	assert.equal(audioMimeType("wav"), "audio/wav");
});

test("transcribeWithGemini sends audio inline and returns joined text", async () => {
	let capturedUrl = "";
	let capturedBody: Record<string, unknown> = {};
	const httpPost = async (url: string, _headers: Record<string, string>, body: string) => {
		capturedUrl = url;
		capturedBody = JSON.parse(body);
		return {
			status: 200,
			text: JSON.stringify({
				candidates: [{ content: { parts: [{ text: "Hello " }, { text: "world." }] } }],
			}),
		};
	};

	const result = await transcribeWithGemini(httpPost, "key", "audio/mp4", "QUJD");
	assert.equal(result, "Hello world.");
	assert.ok(capturedUrl.includes("gemini-2.5-flash:generateContent"));
	const parts = (capturedBody.contents as { parts: Record<string, unknown>[] }[])[0].parts;
	assert.deepEqual(parts[1], { inline_data: { mime_type: "audio/mp4", data: "QUJD" } });
	// Transcription must not force a tool call
	assert.equal(capturedBody.tools, undefined);
});

test("transcribeWithGemini throws LlmApiError on non-2xx", async () => {
	const httpPost = async () => ({ status: 403, text: "denied" });
	await assert.rejects(
		() => transcribeWithGemini(httpPost, "key", "audio/mp4", "QUJD"),
		(e: unknown) => e instanceof LlmApiError && e.status === 403
	);
});

test("transcribeWithGemini throws on empty transcript", async () => {
	const httpPost = async () => ({
		status: 200,
		text: JSON.stringify({ candidates: [{ content: { parts: [{ text: "  " }] } }] }),
	});
	await assert.rejects(() => transcribeWithGemini(httpPost, "key", "audio/mp4", "QUJD"), /empty transcript/);
});

test("buildMultipartBody produces valid multipart structure", () => {
	const data = new TextEncoder().encode("AUDIOBYTES");
	const body = buildMultipartBody(
		"BOUNDARY",
		{ model: "whisper-1" },
		{ fieldName: "file", filename: "note.m4a", mediaType: "audio/mp4", data }
	);
	const text = new TextDecoder().decode(body);
	assert.ok(text.includes('name="model"\r\n\r\nwhisper-1'));
	assert.ok(text.includes('name="file"; filename="note.m4a"'));
	assert.ok(text.includes("Content-Type: audio/mp4"));
	assert.ok(text.includes("AUDIOBYTES"));
	assert.ok(text.endsWith("--BOUNDARY--\r\n"));
});

test("transcribeWithOpenAi posts multipart and parses text", async () => {
	let capturedHeaders: Record<string, string> = {};
	let capturedBody = new ArrayBuffer(0);
	const httpPostBinary = async (
		_url: string,
		headers: Record<string, string>,
		body: ArrayBuffer
	) => {
		capturedHeaders = headers;
		capturedBody = body;
		return { status: 200, text: JSON.stringify({ text: "  A voice memo.  " }) };
	};

	const result = await transcribeWithOpenAi(
		httpPostBinary,
		"sk-test",
		"audio/mp4",
		new TextEncoder().encode("BYTES"),
		"note.m4a"
	);
	assert.equal(result, "A voice memo.");
	assert.equal(capturedHeaders.authorization, "Bearer sk-test");
	assert.ok(capturedHeaders["content-type"].startsWith("multipart/form-data; boundary="));
	const boundary = capturedHeaders["content-type"].split("boundary=")[1];
	assert.ok(new TextDecoder().decode(capturedBody).includes(`--${boundary}--`));
});

test("transcribeWithOpenAi throws LlmApiError on non-2xx", async () => {
	const httpPostBinary = async () => ({ status: 401, text: "bad key" });
	await assert.rejects(
		() =>
			transcribeWithOpenAi(httpPostBinary, "sk", "audio/mp4", new Uint8Array(1), "a.m4a"),
		(e: unknown) => e instanceof LlmApiError && e.status === 401
	);
});
