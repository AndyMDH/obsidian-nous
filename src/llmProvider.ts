// Shared interface every model-provider adapter implements.

export interface LlmTool {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export class LlmApiError extends Error {
	status: number;
	body: string;

	constructor(message: string, status: number, body: string) {
		super(message);
		this.name = "LlmApiError";
		this.status = status;
		this.body = body;
	}
}

export interface AttachmentInput {
	kind: "image" | "document"; // "document" is currently PDF-only
	mediaType: string; // e.g. "image/png" or "application/pdf"
	base64Data: string;
}

export interface LlmMessage {
	text: string;
	attachment?: AttachmentInput;
}

export interface LlmProvider {
	callTool<T>(
		system: string,
		message: LlmMessage,
		tool: LlmTool,
		maxTokens?: number
	): Promise<T>;
}
