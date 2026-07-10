// Speech-to-text for audio captures. Transcription is a separate step from
// enrichment: the audio becomes plain text first, then flows through the
// normal text-enrichment path - which is what makes voice capture work in
// every execution mode (including CLI, where the claude binary itself can't
// read audio). Anthropic has no audio API, so transcription always goes
// through Gemini (native audio input) or OpenAI (dedicated transcription
// endpoint), whichever key is available.

import type { HttpPost, HttpResponse } from "./anthropic.ts";
import { LlmApiError } from "./llmProvider.ts";

// Same injected-transport pattern as HttpPost, but with a binary body -
// OpenAI's transcription endpoint takes multipart/form-data, not JSON.
export type HttpPostBinary = (
	url: string,
	headers: Record<string, string>,
	body: ArrayBuffer
) => Promise<HttpResponse>;

export function audioMimeType(extension: string): string {
	const ext = extension.toLowerCase();
	if (ext === "m4a") return "audio/mp4";
	if (ext === "mp3") return "audio/mpeg";
	return `audio/${ext}`; // webm, wav, ogg, flac map 1:1
}

const TRANSCRIBE_PROMPT =
	"Transcribe this audio recording verbatim. Output only the transcript text - no preamble, no timestamps, no speaker labels unless multiple speakers are clearly distinguishable (then label them Speaker 1, Speaker 2, ...). Transcribe in the language spoken.";

// Fixed inexpensive default rather than the user's configured chat model -
// transcription doesn't benefit from a bigger model, and the configured one
// may not accept audio at all.
export const GEMINI_TRANSCRIBE_MODEL = "gemini-2.5-flash";
export const OPENAI_TRANSCRIBE_MODEL = "whisper-1";

export async function transcribeWithGemini(
	httpPost: HttpPost,
	apiKey: string,
	mediaType: string,
	base64Data: string,
	model = GEMINI_TRANSCRIBE_MODEL
): Promise<string> {
	const body = JSON.stringify({
		contents: [
			{
				role: "user",
				parts: [{ text: TRANSCRIBE_PROMPT }, { inline_data: { mime_type: mediaType, data: base64Data } }],
			},
		],
	});
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
	const res = await httpPost(
		url,
		{ "content-type": "application/json", "x-goog-api-key": apiKey },
		body
	);
	if (res.status < 200 || res.status >= 300) {
		throw new LlmApiError(`Gemini transcription returned ${res.status}`, res.status, res.text);
	}
	let parsed: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
	try {
		parsed = JSON.parse(res.text);
	} catch {
		throw new Error(`Gemini transcription returned non-JSON response: ${res.text.slice(0, 200)}`);
	}
	const text = (parsed.candidates?.[0]?.content?.parts ?? [])
		.map((p) => p.text ?? "")
		.join("")
		.trim();
	if (!text) throw new Error("Gemini transcription returned an empty transcript.");
	return text;
}

// Minimal multipart/form-data encoder - just what the transcription endpoint
// needs (text fields + one binary file part), portable across Electron,
// mobile webview, and Node's test runner (no FormData/Blob dependency, which
// Obsidian's requestUrl can't serialize anyway).
export function buildMultipartBody(
	boundary: string,
	fields: Record<string, string>,
	file: { fieldName: string; filename: string; mediaType: string; data: Uint8Array }
): ArrayBuffer {
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];
	for (const [name, value] of Object.entries(fields)) {
		parts.push(
			encoder.encode(
				`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
			)
		);
	}
	parts.push(
		encoder.encode(
			`--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.mediaType}\r\n\r\n`
		)
	);
	parts.push(file.data);
	parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out.buffer as ArrayBuffer;
}

export async function transcribeWithOpenAi(
	httpPostBinary: HttpPostBinary,
	apiKey: string,
	mediaType: string,
	audioBytes: Uint8Array,
	filename: string,
	model = OPENAI_TRANSCRIBE_MODEL
): Promise<string> {
	const boundary = `cortex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	const body = buildMultipartBody(
		boundary,
		{ model, response_format: "json" },
		{ fieldName: "file", filename, mediaType, data: audioBytes }
	);
	const res = await httpPostBinary(
		"https://api.openai.com/v1/audio/transcriptions",
		{
			authorization: `Bearer ${apiKey}`,
			"content-type": `multipart/form-data; boundary=${boundary}`,
		},
		body
	);
	if (res.status < 200 || res.status >= 300) {
		throw new LlmApiError(`OpenAI transcription returned ${res.status}`, res.status, res.text);
	}
	let parsed: { text?: string };
	try {
		parsed = JSON.parse(res.text);
	} catch {
		throw new Error(`OpenAI transcription returned non-JSON response: ${res.text.slice(0, 200)}`);
	}
	const text = (parsed.text ?? "").trim();
	if (!text) throw new Error("OpenAI transcription returned an empty transcript.");
	return text;
}
