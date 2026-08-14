export const DEFAULT_NATIVE_RECORDER_BIN = "nous-recorder";
export const NATIVE_RECORDER_RELEASE_REPO = "AndyMDH/obsidian-nous";
export const NATIVE_RECORDER_ASSET = "nous-recorder-macos-universal";
export const PENDING_NATIVE_RECORDING_FLAG = "nous_pending_native_recording";
export const LIVE_NATIVE_RECORDING_FLAG = "nous_live_native_recording";

export type NativeRecorderCommand = "status" | "start" | "stop";

export interface NativeRecorderStatus {
	recording: boolean;
	output: string | null;
}

export interface PendingNativeRecording {
	recordingDir: string;
	recordedAt: string;
}

export interface LiveNativeRecording {
	recordingDir: string | null;
	recordedAt: string;
	status: "recording";
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

export interface TranscriptSegment {
	from: number;
	text: string;
}

export interface TrackTranscript {
	text: string;
	segments: TranscriptSegment[] | null;
}

// Merge the two meeting tracks into one dialogue, ordered by when each
// segment was spoken, with consecutive same-speaker segments joined into a
// single line. Falls back to two labeled blocks when either track has no
// segment timing (cloud transcription returns plain text only).
export function interleaveMeetingTracks(
	sys: TrackTranscript | null,
	mic: TrackTranscript | null
): string {
	const sysText = sys?.text.trim() ?? "";
	const micText = mic?.text.trim() ?? "";

	if (sysText && micText && sys?.segments?.length && mic?.segments?.length) {
		const merged = [
			...sys.segments.map((segment) => ({ ...segment, label: "Them" })),
			...mic.segments.map((segment) => ({ ...segment, label: "Me" })),
		]
			.filter((segment) => segment.text.trim().length > 0)
			.sort((a, b) => a.from - b.from);
		const lines: string[] = [];
		let previousLabel: string | null = null;
		for (const segment of merged) {
			if (segment.label === previousLabel) {
				lines[lines.length - 1] += ` ${segment.text.trim()}`;
			} else {
				lines.push(`${segment.label}: ${segment.text.trim()}`);
				previousLabel = segment.label;
			}
		}
		return lines.join("\n\n");
	}

	const parts: string[] = [];
	if (sysText) parts.push(`Them: ${sysText}`);
	if (micText) parts.push(`Me: ${micText}`);
	return parts.join("\n\n");
}

export function buildLiveNativeRecordingNote(recordingDir: string | null, recordedAt: string): string {
	return `---
${LIVE_NATIVE_RECORDING_FLAG}: true
recording_dir: ${JSON.stringify(recordingDir ?? "")}
recorded_at: ${JSON.stringify(recordedAt)}
status: recording
---
# Meeting live note

## Questions to ask

- [ ]

## Live notes

## Transcript

Recording...
`;
}

export function parseLiveNativeRecordingNote(content: string): LiveNativeRecording | null {
	const frontmatter = extractFrontmatter(content);
	if (!frontmatter || !new RegExp(`^${LIVE_NATIVE_RECORDING_FLAG}:\\s*true\\s*$`, "m").test(frontmatter)) {
		return null;
	}

	const status = parseStringFrontmatterValue(frontmatter, "status");
	if (status !== "recording") return null;
	const recordedAt = parseStringFrontmatterValue(frontmatter, "recorded_at");
	if (!recordedAt) return null;
	return {
		recordingDir: parseStringFrontmatterValue(frontmatter, "recording_dir"),
		recordedAt,
		status,
	};
}

export function extractNativeRecordingManualNotes(content: string): string {
	const body = stripFrontmatter(content);
	const starts = [
		findMarkdownHeading(body, "Questions to ask"),
		findMarkdownHeading(body, "Live notes"),
		findMarkdownHeading(body, "Notes taken during meeting"),
	].filter((idx) => idx >= 0);
	if (starts.length === 0) return "";

	const start = Math.min(...starts);
	const ends = [
		findMarkdownHeading(body, "Transcript"),
		findMarkdownHeading(body, "Pending transcript"),
	].filter((idx) => idx > start);
	const end = ends.length > 0 ? Math.min(...ends) : body.length;
	return body.slice(start, end).trim();
}

export function buildCompletedNativeRecordingNote(
	recordedAt: string,
	transcript: string,
	manualNotes = ""
): string {
	const notes = meaningfulManualNotes(manualNotes) ? `${manualNotes.trim()}\n\n` : "";
	return `Meeting recording from ${recordedAt}, transcribed automatically (Me = my mic, Them = everyone else on the call).

${notes}## Transcript

${transcript.trim()}
`;
}

export function buildNativeRecordingProblemNote(
	recordedAt: string,
	problem: string,
	manualNotes = ""
): string {
	const notes = meaningfulManualNotes(manualNotes) ? `${manualNotes.trim()}\n\n` : "";
	return `Meeting recording from ${recordedAt} could not be finished automatically.

${problem}

${notes}## Transcript

(No transcript was created.)
`;
}

export function buildPendingNativeRecordingNote(
	recordingDir: string,
	recordedAt: string,
	manualNotes = ""
): string {
	const notes = meaningfulManualNotes(manualNotes) ? `\n${manualNotes.trim()}\n` : "";
	return `---
${PENDING_NATIVE_RECORDING_FLAG}: true
recording_dir: ${JSON.stringify(recordingDir)}
recorded_at: ${JSON.stringify(recordedAt)}
status: pending-transcription
---
# Meeting recording captured

Nous saved the meeting audio, but speech-to-text is not set up yet.

To finish this note, set up local whisper.cpp or add a Gemini/OpenAI key in Settings -> Nous, then run "Nous: Process inbox now".
${notes}
## Pending transcript

Recording folder: \`${recordingDir}\`
`;
}

export function parsePendingNativeRecordingNote(content: string): PendingNativeRecording | null {
	const frontmatter = extractFrontmatter(content);
	if (!frontmatter || !new RegExp(`^${PENDING_NATIVE_RECORDING_FLAG}:\\s*true\\s*$`, "m").test(frontmatter)) {
		return null;
	}

	const recordingDir = parseStringFrontmatterValue(frontmatter, "recording_dir");
	const recordedAt = parseStringFrontmatterValue(frontmatter, "recorded_at");
	if (!recordingDir || !recordedAt) return null;
	return { recordingDir, recordedAt };
}

export function hasMeaningfulNativeRecordingManualNotes(manualNotes: string): boolean {
	return meaningfulManualNotes(manualNotes);
}

function extractFrontmatter(content: string): string | null {
	const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/);
	return frontmatter ? frontmatter[1] : null;
}

function stripFrontmatter(content: string): string {
	return content.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function findMarkdownHeading(content: string, heading: string): number {
	const match = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").exec(content);
	return match ? match.index : -1;
}

function meaningfulManualNotes(manualNotes: string): boolean {
	return manualNotes
		.replace(/^#+\s+.+$/gm, "")
		.replace(/^- \[[ xX]\]\s*$/gm, "")
		.trim().length > 0;
}

function parseStringFrontmatterValue(frontmatter: string, key: string): string | null {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)\\s*$`, "m"));
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[1]) as unknown;
		return typeof parsed === "string" && parsed.trim().length > 0 ? parsed : null;
	} catch {
		const plain = match[1].trim();
		return plain.length > 0 ? plain : null;
	}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
