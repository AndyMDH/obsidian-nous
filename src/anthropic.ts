// Anthropic Messages API adapter. HTTP is injected: the plugin wires
// Obsidian's requestUrl (a bare fetch would hit CORS), tests wire a mock.

import { LlmApiError, type LlmMessage, type LlmProvider, type LlmTool } from "./llmProvider.ts";

export interface HttpResponse {
	status: number;
	text: string;
}

export type HttpPost = (
	url: string,
	headers: Record<string, string>,
	body: string
) => Promise<HttpResponse>;

// Alias kept so existing imports of AnthropicTool still work.
export type AnthropicTool = LlmTool;

// Subclass so both instanceof checks (specific and generic) keep working.
export class AnthropicApiError extends LlmApiError {
	constructor(message: string, status: number, body: string) {
		super(message, status, body);
		this.name = "AnthropicApiError";
	}
}

export async function callClaudeTool<T>(
	httpPost: HttpPost,
	apiKey: string,
	model: string,
	system: string,
	message: LlmMessage,
	tool: AnthropicTool,
	maxTokens = 4096
): Promise<T> {
	if (!apiKey) {
		throw new Error(
			"No Anthropic API key configured. Set one in Cortex plugin settings."
		);
	}

	// Attachment before text - Anthropic's recommended order.
	const content = message.attachment
		? [
				{
					type: message.attachment.kind === "document" ? "document" : "image",
					source: {
						type: "base64",
						media_type: message.attachment.mediaType,
						data: message.attachment.base64Data,
					},
				},
				{ type: "text", text: message.text },
			]
		: message.text;

	const body = JSON.stringify({
		model,
		max_tokens: maxTokens,
		system,
		messages: [{ role: "user", content }],
		tools: [tool],
		tool_choice: { type: "tool", name: tool.name },
	});

	const res = await httpPost(
		"https://api.anthropic.com/v1/messages",
		{
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		body
	);

	if (res.status < 200 || res.status >= 300) {
		throw new AnthropicApiError(
			`Anthropic API returned ${res.status}`,
			res.status,
			res.text
		);
	}

	let parsed: {
		content?: { type: string; name?: string; input?: unknown }[];
		error?: { message?: string };
	};
	try {
		parsed = JSON.parse(res.text);
	} catch {
		throw new Error(`Anthropic API returned non-JSON response: ${res.text.slice(0, 200)}`);
	}

	const toolUse = parsed.content?.find(
		(block) => block.type === "tool_use" && block.name === tool.name
	);
	if (!toolUse) {
		throw new Error(
			`Anthropic API response did not include the expected ${tool.name} tool call.`
		);
	}

	return toolUse.input as T;
}

export class AnthropicProvider implements LlmProvider {
	private httpPost: HttpPost;
	private apiKey: string;
	private model: string;

	constructor(httpPost: HttpPost, apiKey: string, model: string) {
		this.httpPost = httpPost;
		this.apiKey = apiKey;
		this.model = model;
	}

	callTool<T>(system: string, message: LlmMessage, tool: LlmTool, maxTokens = 4096): Promise<T> {
		return callClaudeTool<T>(this.httpPost, this.apiKey, this.model, system, message, tool, maxTokens);
	}
}
