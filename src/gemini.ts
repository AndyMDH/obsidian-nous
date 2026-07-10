// Gemini API adapter - its own request/response shape, hence its own file.

import type { HttpPost } from "./anthropic.ts";
import { LlmApiError, type LlmMessage, type LlmProvider, type LlmTool } from "./llmProvider.ts";

export class GeminiProvider implements LlmProvider {
	private httpPost: HttpPost;
	private apiKey: string;
	private model: string;

	constructor(httpPost: HttpPost, apiKey: string, model: string) {
		this.httpPost = httpPost;
		this.apiKey = apiKey;
		this.model = model;
	}

	async callTool<T>(system: string, message: LlmMessage, tool: LlmTool, maxTokens = 4096): Promise<T> {
		if (!this.apiKey) {
			throw new Error("No Gemini API key configured. Set one in Cortex plugin settings.");
		}

		// inline_data handles images and PDFs alike - no per-kind branching.
		const parts: Record<string, unknown>[] = [{ text: message.text }];
		if (message.attachment) {
			parts.push({
				inline_data: { mime_type: message.attachment.mediaType, data: message.attachment.base64Data },
			});
		}

		const body = JSON.stringify({
			system_instruction: { parts: [{ text: system }] },
			contents: [{ role: "user", parts }],
			tools: [
				{
					function_declarations: [
						{ name: tool.name, description: tool.description, parameters: tool.input_schema },
					],
				},
			],
			tool_config: {
				function_calling_config: { mode: "ANY", allowed_function_names: [tool.name] },
			},
			generationConfig: { maxOutputTokens: maxTokens },
		});

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
		const res = await this.httpPost(
			url,
			{ "content-type": "application/json", "x-goog-api-key": this.apiKey },
			body
		);

		if (res.status < 200 || res.status >= 300) {
			throw new LlmApiError(`Gemini API returned ${res.status}`, res.status, res.text);
		}

		let parsed: {
			candidates?: { content?: { parts?: { functionCall?: { name?: string; args?: unknown } }[] } }[];
		};
		try {
			parsed = JSON.parse(res.text);
		} catch {
			throw new Error(`Gemini API returned non-JSON response: ${res.text.slice(0, 200)}`);
		}

		const part = parsed.candidates?.[0]?.content?.parts?.find(
			(p) => p.functionCall?.name === tool.name
		);
		if (!part?.functionCall) {
			throw new Error(`Gemini response did not include the expected ${tool.name} function call.`);
		}

		return part.functionCall.args as T;
	}
}
