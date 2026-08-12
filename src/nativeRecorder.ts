export const DEFAULT_NATIVE_RECORDER_BIN = "nous-recorder";
export const NATIVE_RECORDER_RELEASE_REPO = "AndyMDH/obsidian-nous";
export const NATIVE_RECORDER_ASSET = "nous-recorder-macos-universal";

export type NativeRecorderCommand = "status" | "start" | "stop";

export interface NativeRecorderStatus {
	recording: boolean;
	output: string | null;
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
