// Pure helpers for the one-click speech-model download. The streaming
// download itself (Node https, desktop-only) lives in main.ts.

export const WHISPER_MODELS_DIR_SEGMENTS = [".local", "share", "whisper-models"];

export interface WhisperModelSource {
	filename: string;
	// Small git-lfs pointer file: parsed for the expected sha256 + size so the
	// download can be verified without hardcoding a hash that rots.
	pointerUrl: string;
	downloadUrl: string;
	required: boolean;
}

export const WHISPER_MODEL_SOURCES: WhisperModelSource[] = [
	{
		filename: "ggml-large-v3-turbo.bin",
		pointerUrl: "https://huggingface.co/ggerganov/whisper.cpp/raw/main/ggml-large-v3-turbo.bin",
		downloadUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
		required: true,
	},
	{
		// Voice-activity detection: strips silence so whisper doesn't invent
		// phantom lines. Small and optional - a failed download is non-fatal.
		filename: "ggml-silero-v5.1.2.bin",
		pointerUrl: "https://huggingface.co/ggml-org/whisper-vad/raw/main/ggml-silero-v5.1.2.bin",
		downloadUrl: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
		required: false,
	},
];

export interface LfsPointer {
	sha256: string;
	size: number;
}

export function parseLfsPointer(text: string): LfsPointer | null {
	const oid = text.match(/^oid sha256:([a-f0-9]{64})\s*$/m);
	const size = text.match(/^size (\d+)\s*$/m);
	if (!oid || !size) return null;
	const bytes = Number(size[1]);
	if (!Number.isFinite(bytes) || bytes <= 0) return null;
	return { sha256: oid[1], size: bytes };
}

export function formatBytes(bytes: number): string {
	if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
	if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
	return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function downloadProgressText(filename: string, received: number, total: number): string {
	if (total <= 0) return `Nous: downloading ${filename}… ${formatBytes(received)}`;
	const percent = Math.min(100, Math.floor((received / total) * 100));
	return `Nous: downloading ${filename}… ${percent}% of ${formatBytes(total)}`;
}
