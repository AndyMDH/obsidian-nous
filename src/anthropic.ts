// Thin wrapper around the Anthropic Messages API. Takes an injected HTTP
// function rather than calling fetch/requestUrl directly, so this file has
// zero dependency on Obsidian's runtime and can be unit tested with a mock
// transport. The plugin wires this to Obsidian's `requestUrl` helper, which
// - unlike a bare `fetch()` from the renderer - is not subject to CORS, and
// is what actually makes calling api.anthropic.com directly from an Obsidian
// plugin possible at all.

export interface HttpResponse {
	status: number;
	text: string;
}

export type HttpPost = (
	url: string,
	headers: Record<string, string>,
	body: string
) => Promise<HttpResponse>;

export interface AnthropicTool {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export class AnthropicApiError extends Error {
	status: number;
	body: string;

	constructor(message: string, status: number, body: string) {
		super(message);
		this.name = "AnthropicApiError";
		this.status = status;
		this.body = body;
	}
}

export async function callClaudeTool<T>(
	httpPost: HttpPost,
	apiKey: string,
	model: string,
	system: string,
	userMessage: string,
	tool: AnthropicTool,
	maxTokens = 4096
): Promise<T> {
	if (!apiKey) {
		throw new Error(
			"No Anthropic API key configured. Set one in Cortex plugin settings."
		);
	}

	const body = JSON.stringify({
		model,
		max_tokens: maxTokens,
		system,
		messages: [{ role: "user", content: userMessage }],
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
