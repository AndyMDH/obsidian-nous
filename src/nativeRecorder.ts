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

// Fallback when the release matching the plugin version has no recorder
// asset (for example, a hand-published release) - the newest release always
// carries one because CI builds it on every tag.
export function nativeRecorderLatestAssetUrl(
	asset = NATIVE_RECORDER_ASSET,
	repo = NATIVE_RECORDER_RELEASE_REPO
): string {
	return `https://github.com/${repo}/releases/latest/download/${encodeURIComponent(asset)}`;
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

// Parsed timing.json written by the native helper: each track's first-buffer
// time in seconds on the shared stream clock. Used to re-align the two m4a
// files, whose internal timelines each start at their own first buffer (the
// mic can start seconds late while the user answers the TCC prompt).
export function trackStartDeltasMs(raw: string | null): { sys: number; mic: number } {
	if (!raw) return { sys: 0, mic: 0 };
	let sys: number | undefined;
	let mic: number | undefined;
	try {
		const parsed = JSON.parse(raw) as { sys?: unknown; mic?: unknown };
		if (typeof parsed.sys === "number" && Number.isFinite(parsed.sys)) sys = parsed.sys;
		if (typeof parsed.mic === "number" && Number.isFinite(parsed.mic)) mic = parsed.mic;
	} catch {
		return { sys: 0, mic: 0 };
	}
	const starts = [sys, mic].filter((v): v is number => v !== undefined);
	if (starts.length === 0) return { sys: 0, mic: 0 };
	const base = Math.min(...starts);
	return {
		sys: sys === undefined ? 0 : Math.max(0, Math.round((sys - base) * 1000)),
		mic: mic === undefined ? 0 : Math.max(0, Math.round((mic - base) * 1000)),
	};
}

export function shiftTrackSegments(track: TrackTranscript | null, deltaMs: number): TrackTranscript | null {
	if (!track?.segments || deltaMs === 0) return track;
	return { ...track, segments: track.segments.map((segment) => ({ ...segment, from: segment.from + deltaMs })) };
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

	// Both tracks but no timing: two labeled blocks. A single track gets no
	// speaker label at all - an in-person meeting arrives entirely through
	// the mic, and labeling the whole room "Me:" would be wrong.
	if (sysText && micText) {
		return `Them: ${sysText}\n\nMe: ${micText}`;
	}
	return sysText || micText;
}

// Hint lines from a briefly-shipped callout variant of the live note -
// still stripped from manual notes so those notes stay clean.
export const LIVE_NOTE_TYPING_HINT =
	"*Type questions and notes here during the call - everything is kept in the finished note.*";

export const LIVE_NOTE_HINT_LINES = [
	LIVE_NOTE_TYPING_HINT,
	// A briefly-shipped callout variant - still stripped from old notes.
	"> [!tip] This space is yours",
	"> Type questions, decisions, and thoughts here during the call - everything is kept in the finished note.",
];

export const LIVE_TRANSCRIPT_FILENAME = "live.jsonl";

// Renders the recorder's live JSONL stream into transcript text: committed
// lines in arrival order, then the newest partial per track. Speaker labels
// appear only when both tracks are present (same rule as the final pass).
export function renderLiveTranscript(raw: string): string {
	const finals: { track: string; text: string }[] = [];
	const partials: Record<string, string> = {};
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let event: { type?: unknown; track?: unknown; text?: unknown };
		try {
			event = JSON.parse(line) as { type?: unknown; track?: unknown; text?: unknown };
		} catch {
			continue;
		}
		if (typeof event.track !== "string" || typeof event.text !== "string" || event.text.length === 0) continue;
		if (event.type === "final") {
			finals.push({ track: event.track, text: event.text });
			delete partials[event.track];
		} else if (event.type === "partial") {
			partials[event.track] = event.text;
		}
	}
	const tracks = new Set([...finals.map((f) => f.track), ...Object.keys(partials)]);
	const both = tracks.has("sys") && tracks.has("mic");
	const label = (track: string) => (both ? (track === "mic" ? "Me: " : "Them: ") : "");
	const lines = finals.map((f) => `${label(f.track)}${f.text}`);
	for (const track of ["sys", "mic"]) {
		if (partials[track]) lines.push(`${label(track)}${partials[track]} …`);
	}
	return lines.join("\n\n");
}

export const LIVE_NOTE_NOTES_HEADING = "## Meeting notes";

// Deliberately minimal: no title header (the filename is the title), no
// pre-made checkboxes, no rendered hint (Obsidian un-renders callouts the
// moment the cursor touches them, right where the user types) - a
// self-explanatory heading with the cursor placed under it, and the
// transcript placeholder out of the way below.
export function buildLiveNativeRecordingNote(recordingDir: string | null, recordedAt: string): string {
	return `---
${LIVE_NATIVE_RECORDING_FLAG}: true
recording_dir: ${JSON.stringify(recordingDir ?? "")}
recorded_at: ${JSON.stringify(recordedAt)}
status: recording
cssclasses:
  - nous-live-note
---
${LIVE_NOTE_NOTES_HEADING}

${LIVE_NOTE_TYPING_HINT}




## Transcript

*Recording - the transcript appears here when you stop.*
`;
}

function stripLiveNoteHint(text: string): string {
	const hints = new Set(LIVE_NOTE_HINT_LINES.map((line) => line.trim()));
	return text
		.split("\n")
		.filter((line) => !hints.has(line.trim()))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
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
		findMarkdownHeading(body, "Meeting notes"),
		// Older live notes used these headings - keep recognizing them.
		findMarkdownHeading(body, "Notes"),
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
	return stripLiveNoteHint(body.slice(start, end)).trim();
}

export function buildCompletedNativeRecordingNote(
	recordedAt: string,
	transcript: string,
	manualNotes = ""
): string {
	const notes = meaningfulManualNotes(manualNotes) ? `${manualNotes.trim()}\n\n` : "";
	// The Me/Them legend only belongs on transcripts that use those labels -
	// a single-source recording (in-person meeting) has none.
	const legend = /^(Me|Them):/m.test(transcript)
		? " (Me = my mic, Them = everyone else on the call)"
		: "";
	return `Meeting recording from ${recordedAt}, transcribed automatically${legend}.

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
cssclasses:
  - nous-live-note
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
