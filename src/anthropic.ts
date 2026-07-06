// Thin wrapper around the Anthropic Messages API. Takes an injected HTTP
// function rather than calling fetch/requestUrl directly, so this file has
// zero dependency on Obsidian's runtime and can be unit tested with a mock
// transport. The plugin wires this to Obsidian's `requestUrl` helper, which
// - unlike a bare `fetch()` from the renderer - is not subject to CORS, and
// is what actually makes calling api.anthropic.com directly from an Obsidian
// plugin possible at all.

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

// Same shape as LlmTool - kept as its own export so existing call sites and
// tests that import AnthropicTool don't need to change.
export type AnthropicTool = LlmTool;

// A subclass rather than a bare alias so existing `instanceof AnthropicApiError`
// checks (including in tests) keep working, while call sites that only know
// about the generic LlmProvider interface can catch `instanceof LlmApiError`
// regardless of which provider actually threw.
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

	// Image block before text - Anthropic's own recommended order for a
	// single image, for better attention/quality on the accompanying prompt.
	const content = message.image
		? [
				{
					type: "image",
					source: {
						type: "base64",
						media_type: message.image.mediaType,
						data: message.image.base64Data,
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
