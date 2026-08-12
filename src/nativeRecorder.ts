export const DEFAULT_NATIVE_RECORDER_BIN = "nous-recorder";
export const NATIVE_RECORDER_RELEASE_REPO = "AndyMDH/obsidian-nous";
export const NATIVE_RECORDER_ASSET = "nous-recorder-macos-universal";
export const PENDING_NATIVE_RECORDING_FLAG = "nous_pending_native_recording";

export type NativeRecorderCommand = "status" | "start" | "stop";

export interface NativeRecorderStatus {
	recording: boolean;
	output: string | null;
}

export interface PendingNativeRecording {
	recordingDir: string;
	recordedAt: string;
}

export function nativeRecorderArgs(command: NativeRecorderCommand, recordingsDir: string): string[] {
	return [command, "--recordings-dir", recordingsDir];
}

export function parseNativeRecorderStatus(stdout: string): NativeRecorderStatus {
	try {
		const parsed = JSON.parse(stdout.trim()) as { recording?: unknown; output?: unknown };
		return {
			recording: parsed.recording === true,
			output: typeof parsed.output === "string" && parsed.output.length > 0 ? parsed.output : null,
		};
	} catch {
		return { recording: false, output: null };
	}
}

export function nativeRecorderReleaseAssetUrl(
	version: string,
	asset = NATIVE_RECORDER_ASSET,
	repo = NATIVE_RECORDER_RELEASE_REPO
): string {
	return `https://github.com/${repo}/releases/download/${encodeURIComponent(version)}/${encodeURIComponent(asset)}`;
}

export function parseNativeRecorderChecksum(text: string, asset = NATIVE_RECORDER_ASSET): string | null {
	for (const line of text.split(/\r?\n/)) {
		const match = line.trim().match(/^([a-fA-F0-9]{64})(?:\s+\*?(.+))?$/);
		if (!match) continue;
		const filename = match[2]?.trim();
		if (!filename || filename === asset) return match[1].toLowerCase();
	}
	return null;
}

export function buildPendingNativeRecordingNote(recordingDir: string, recordedAt: string): string {
	return `---
${PENDING_NATIVE_RECORDING_FLAG}: true
recording_dir: ${JSON.stringify(recordingDir)}
recorded_at: ${JSON.stringify(recordedAt)}
status: pending-transcription
---
# Meeting recording captured

Nous saved the meeting audio, but speech-to-text is not set up yet.

To finish this note, set up local whisper.cpp or add a Gemini/OpenAI key in Settings -> Nous, then run "Nous: Process inbox now".

Recording folder: \`${recordingDir}\`
`;
}

export function parsePendingNativeRecordingNote(content: string): PendingNativeRecording | null {
	const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/);
	if (!frontmatter || !new RegExp(`^${PENDING_NATIVE_RECORDING_FLAG}:\\s*true\\s*$`, "m").test(frontmatter[1])) {
		return null;
	}

	const recordingDir = parseJsonFrontmatterValue(frontmatter[1], "recording_dir");
	const recordedAt = parseJsonFrontmatterValue(frontmatter[1], "recorded_at");
	if (!recordingDir || !recordedAt) return null;
	return { recordingDir, recordedAt };
}

function parseJsonFrontmatterValue(frontmatter: string, key: string): string | null {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)\\s*$`, "m"));
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[1]) as unknown;
		return typeof parsed === "string" && parsed.trim().length > 0 ? parsed : null;
	} catch {
		return null;
	}
}
