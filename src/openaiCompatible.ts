// Adapter for anything speaking OpenAI's Chat Completions + function-calling
// shape: OpenAI itself, Ollama, Groq, OpenRouter - swap baseUrl/apiKey/model.

import type { HttpPost } from "./anthropic.ts";
import { LlmApiError, type LlmMessage, type LlmProvider, type LlmTool } from "./llmProvider.ts";

export class OpenAiCompatibleProvider implements LlmProvider {
	private httpPost: HttpPost;
	private apiKey: string;
	private model: string;
	private baseUrl: string;

	constructor(httpPost: HttpPost, apiKey: string, model: string, baseUrl: string) {
		this.httpPost = httpPost;
		this.apiKey = apiKey;
		this.model = model;
		this.baseUrl = baseUrl.replace(/\/+$/, "");
	}

	async callTool<T>(system: string, message: LlmMessage, tool: LlmTool, maxTokens = 4096): Promise<T> {
		// No reliable PDF convention across arbitrary OpenAI-compatible
		// backends - fail fast instead of silently mishandling the document.
		if (message.attachment?.kind === "document") {
			// Plain Error (not LlmApiError) so the message surfaces to the user as-is.
			throw new Error(
				"This provider does not support PDF/document ingestion in Cortex - switch to Anthropic or Gemini in plugin settings, or use CLI execution mode."
			);
		}

		const userContent = message.attachment
			? [
					{ type: "text", text: message.text },
					{
						type: "image_url",
						image_url: {
							url: `data:${message.attachment.mediaType};base64,${message.attachment.base64Data}`,
						},
					},
				]
			: message.text;

		const body = JSON.stringify({
			model: this.model,
			max_tokens: maxTokens,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: userContent },
			],
			tools: [
				{
					type: "function",
					function: {
						name: tool.name,
						description: tool.description,
						parameters: tool.input_schema,
					},
				},
			],
			tool_choice: { type: "function", function: { name: tool.name } },
		});

		const headers: Record<string, string> = { "content-type": "application/json" };
		if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

		const res = await this.httpPost(`${this.baseUrl}/chat/completions`, headers, body);

		if (res.status < 200 || res.status >= 300) {
			throw new LlmApiError(
				`OpenAI-compatible endpoint returned ${res.status}`,
				res.status,
				res.text
			);
		}

		let parsed: {
			choices?: {
				message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] };
			}[];
		};
		try {
			parsed = JSON.parse(res.text);
		} catch {
			throw new Error(
				`OpenAI-compatible endpoint returned non-JSON response: ${res.text.slice(0, 200)}`
			);
		}

		const toolCall = parsed.choices?.[0]?.message?.tool_calls?.find(
			(tc) => tc.function?.name === tool.name
		);
		if (!toolCall?.function?.arguments) {
			throw new Error(
				`OpenAI-compatible response did not include the expected ${tool.name} tool call.`
			);
		}

		try {
			return JSON.parse(toolCall.function.arguments) as T;
		} catch {
			throw new Error(
				`OpenAI-compatible tool call arguments were not valid JSON: ${toolCall.function.arguments.slice(0, 200)}`
			);
		}
	}
}
