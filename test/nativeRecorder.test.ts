import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	LIVE_NOTE_HINT_LINES,
	NATIVE_RECORDER_ASSET,
	buildCompletedNativeRecordingNote,
	buildLiveNativeRecordingNote,
	buildNativeRecordingProblemNote,
	buildPendingNativeRecordingNote,
	extractNativeRecordingManualNotes,
	hasMeaningfulNativeRecordingManualNotes,
	interleaveMeetingTracks,
	nativeRecorderArgs,
	nativeRecorderLatestAssetUrl,
	nativeRecorderReleaseAssetUrl,
	parseLiveNativeRecordingNote,
	parsePendingNativeRecordingNote,
	parseNativeRecorderChecksum,
	parseNativeRecorderStatus,
	shiftTrackSegments,
	trackStartDeltasMs,
} from "../src/nativeRecorder.ts";

test("nativeRecorderArgs passes the command and recordings directory", () => {
	assert.deepEqual(nativeRecorderArgs("start", "/tmp/Nous Recordings"), [
		"start",
		"--recordings-dir",
		"/tmp/Nous Recordings",
	]);
});

test("parseNativeRecorderStatus reads active recorder JSON", () => {
	assert.deepEqual(parseNativeRecorderStatus('{"recording":true,"output":"/tmp/a.qma"}'), {
		recording: true,
		output: "/tmp/a.qma",
	});
});

test("parseNativeRecorderStatus treats invalid output as idle", () => {
	assert.deepEqual(parseNativeRecorderStatus("not json"), { recording: false, output: null });
	assert.deepEqual(parseNativeRecorderStatus('{"recording":false,"output":""}'), {
		recording: false,
		output: null,
	});
});

test("nativeRecorderReleaseAssetUrl points at the versioned GitHub release asset", () => {
	assert.equal(
		nativeRecorderReleaseAssetUrl("2.0.7"),
		`https://github.com/AndyMDH/obsidian-nous/releases/download/2.0.7/${NATIVE_RECORDER_ASSET}`
	);
});

test("parseNativeRecorderChecksum accepts shasum-style output for the recorder asset", () => {
	const checksum = "a".repeat(64);
	assert.equal(parseNativeRecorderChecksum(`${checksum}  ${NATIVE_RECORDER_ASSET}\n`), checksum);
	assert.equal(parseNativeRecorderChecksum(`ignored\n${checksum}  *${NATIVE_RECORDER_ASSET}\n`), checksum);
	assert.equal(parseNativeRecorderChecksum(`${checksum}  something-else\n`), null);
});

test("pending native recording notes round-trip recording metadata", () => {
	const note = buildPendingNativeRecordingNote(
		"/Users/andy/Movies/NousRecordings/2026-08-12 10.00 Meeting recording.qma",
		"2026-08-12 10.00"
	);
	assert.deepEqual(parsePendingNativeRecordingNote(note), {
		recordingDir: "/Users/andy/Movies/NousRecordings/2026-08-12 10.00 Meeting recording.qma",
		recordedAt: "2026-08-12 10.00",
	});
	assert.match(note, /Process inbox now/);
});

test("live native recording notes expose the in-meeting writing surface", () => {
	const note = buildLiveNativeRecordingNote(
		"/Users/andy/Movies/NousRecordings/2026-08-12 10.00 Meeting recording.qma",
		"2026-08-12 10.00"
	);
	assert.deepEqual(parseLiveNativeRecordingNote(note), {
		recordingDir: "/Users/andy/Movies/NousRecordings/2026-08-12 10.00 Meeting recording.qma",
		recordedAt: "2026-08-12 10.00",
		status: "recording",
	});
	assert.match(note, /## Meeting notes/);
	assert.match(note, /## Transcript/);
	// Minimal by design: no title header, no pre-made checkboxes, no callout
	// (Obsidian un-renders callouts under the cursor, right where you type).
	assert.ok(!note.includes("# Meeting live note"));
	assert.ok(!note.includes("- [ ]"));
	assert.ok(!note.includes("[!tip]"));
});

test("manual live notes are preserved across pending and completed native recording notes", () => {
	const liveNote = buildLiveNativeRecordingNote(null, "2026-08-12 10.00").replace(
		"## Meeting notes\n",
		"## Meeting notes\n\n- [ ] Ask about budget\n"
	);
	const manualNotes = extractNativeRecordingManualNotes(liveNote);
	assert.match(manualNotes, /Ask about budget/);
	assert.ok(!manualNotes.includes("the transcript appears here"));

	const pending = buildPendingNativeRecordingNote("/tmp/recording.qma", "2026-08-12 10.00", manualNotes);
	assert.match(pending, /Ask about budget/);
	assert.match(pending, /## Pending transcript/);
	assert.equal(parsePendingNativeRecordingNote(pending)?.recordingDir, "/tmp/recording.qma");

	const completed = buildCompletedNativeRecordingNote("2026-08-12 10.00", "Them: hello", manualNotes);
	assert.match(completed, /Ask about budget/);
	assert.match(completed, /## Transcript\n\nThem: hello/);
	assert.ok(!completed.includes("nous_live_native_recording"));
});

test("problem native recording notes are recoverable ordinary inbox notes", () => {
	const problem = buildNativeRecordingProblemNote(
		"2026-08-12 10.00",
		"Nous saved the meeting audio, but it did not produce a transcript.",
		"## Questions to ask\n\n- [ ] Ask about budget"
	);
	assert.match(problem, /Ask about budget/);
	assert.match(problem, /No transcript was created/);
	assert.equal(parseLiveNativeRecordingNote(problem), null);
	assert.equal(parsePendingNativeRecordingNote(problem), null);
	assert.equal(hasMeaningfulNativeRecordingManualNotes("## Questions to ask\n\n- [ ] "), false);
	assert.equal(hasMeaningfulNativeRecordingManualNotes("## Questions to ask\n\n- [ ] Ask about budget"), true);
});

test("parsePendingNativeRecordingNote ignores ordinary notes", () => {
	assert.equal(parsePendingNativeRecordingNote("---\ntype: meeting\n---\nbody"), null);
	assert.equal(parsePendingNativeRecordingNote("plain text"), null);
});

test("interleaveMeetingTracks orders segments by timestamp across tracks", () => {
	const transcript = interleaveMeetingTracks(
		{
			text: "How are you? Good to hear.",
			segments: [
				{ from: 0, text: "How are you?" },
				{ from: 5000, text: "Good to hear." },
			],
		},
		{ text: "Doing well, thanks.", segments: [{ from: 2000, text: "Doing well, thanks." }] }
	);
	assert.equal(transcript, "Them: How are you?\n\nMe: Doing well, thanks.\n\nThem: Good to hear.");
});

test("interleaveMeetingTracks joins consecutive same-speaker segments into one line", () => {
	const transcript = interleaveMeetingTracks(
		{
			text: "First point. Second point.",
			segments: [
				{ from: 0, text: "First point." },
				{ from: 1000, text: "Second point." },
			],
		},
		{ text: "Understood.", segments: [{ from: 9000, text: "Understood." }] }
	);
	assert.equal(transcript, "Them: First point. Second point.\n\nMe: Understood.");
});

test("interleaveMeetingTracks falls back to labeled blocks without segment timing", () => {
	const transcript = interleaveMeetingTracks(
		{ text: "Everything they said.", segments: null },
		{ text: "Everything I said.", segments: null }
	);
	assert.equal(transcript, "Them: Everything they said.\n\nMe: Everything I said.");
});

test("interleaveMeetingTracks handles a single track and empty input", () => {
	// A single source gets no speaker label - an in-person meeting arrives
	// entirely through the mic.
	assert.equal(
		interleaveMeetingTracks({ text: "Solo system audio.", segments: [{ from: 0, text: "Solo system audio." }] }, null),
		"Solo system audio."
	);
	assert.equal(interleaveMeetingTracks(null, { text: "Just the room.", segments: null }), "Just the room.");
	assert.equal(interleaveMeetingTracks(null, null), "");
	assert.equal(interleaveMeetingTracks({ text: "  ", segments: [] }, null), "");
});

test("interleaveMeetingTracks degrades to blocks when only one track has timing", () => {
	// Reachable when one track transcribed locally (segments) and the other
	// fell back to a cloud key (no segment timing).
	const transcript = interleaveMeetingTracks(
		{ text: "Local track.", segments: [{ from: 0, text: "Local track." }] },
		{ text: "Cloud track.", segments: null }
	);
	assert.equal(transcript, "Them: Local track.\n\nMe: Cloud track.");
});

test("interleaveMeetingTracks with all-zero offsets collapses to the block layout", () => {
	// Whisper JSON without usable offsets maps every segment to from: 0 -
	// stable sort keeps each track contiguous, Them first.
	const transcript = interleaveMeetingTracks(
		{
			text: "A B",
			segments: [
				{ from: 0, text: "A" },
				{ from: 0, text: "B" },
			],
		},
		{ text: "C", segments: [{ from: 0, text: "C" }] }
	);
	assert.equal(transcript, "Them: A B\n\nMe: C");
});

test("trackStartDeltasMs re-anchors both tracks to the earlier start", () => {
	assert.deepEqual(trackStartDeltasMs('{"sys": 100.0, "mic": 105.5}'), { sys: 0, mic: 5500 });
	assert.deepEqual(trackStartDeltasMs('{"sys": 100.0}'), { sys: 0, mic: 0 });
	assert.deepEqual(trackStartDeltasMs(null), { sys: 0, mic: 0 });
	assert.deepEqual(trackStartDeltasMs("not json"), { sys: 0, mic: 0 });
	assert.deepEqual(trackStartDeltasMs('{"sys": "bad", "mic": 5}'), { sys: 0, mic: 0 });
});

test("shiftTrackSegments offsets segment timing but leaves text and null tracks alone", () => {
	const track = { text: "Hi", segments: [{ from: 1000, text: "Hi" }] };
	assert.deepEqual(shiftTrackSegments(track, 5500), { text: "Hi", segments: [{ from: 6500, text: "Hi" }] });
	assert.deepEqual(shiftTrackSegments(track, 0), track);
	assert.equal(shiftTrackSegments(null, 5500), null);
	const cloud = { text: "Hi", segments: null };
	assert.equal(shiftTrackSegments(cloud, 5500), cloud);
});

test("legacy hint callouts are stripped from manual notes; typing survives", () => {
	// A note created by the briefly-shipped callout variant.
	const legacy = buildLiveNativeRecordingNote(null, "2026-08-15 11.00").replace(
		"## Meeting notes\n",
		`## Meeting notes\n\n${LIVE_NOTE_HINT_LINES.join("\n")}\n\n- [ ] Ask about budget\n`
	);
	const manualNotes = extractNativeRecordingManualNotes(legacy);
	assert.match(manualNotes, /Ask about budget/);
	assert.ok(!manualNotes.includes("[!tip]"));

	// Untouched minimal note: heading alone is not meaningful content.
	const untouched = extractNativeRecordingManualNotes(buildLiveNativeRecordingNote(null, "2026-08-15 11.00"));
	assert.equal(hasMeaningfulNativeRecordingManualNotes(untouched), false);
});

test("nativeRecorderLatestAssetUrl points at the newest release asset", () => {
	assert.equal(
		nativeRecorderLatestAssetUrl(),
		`https://github.com/AndyMDH/obsidian-nous/releases/latest/download/${NATIVE_RECORDER_ASSET}`
	);
});

test("live and pending notes carry the styling class; completed notes do not", () => {
	assert.match(buildLiveNativeRecordingNote(null, "2026-08-15 12.00"), /cssclasses:\n {2}- nous-live-note/);
	assert.match(buildPendingNativeRecordingNote("/tmp/r.qma", "2026-08-15 12.00"), /cssclasses:\n {2}- nous-live-note/);
	assert.ok(!buildCompletedNativeRecordingNote("2026-08-15 12.00", "Them: hi").includes("cssclasses"));
});


test("the Me/Them legend appears only on labeled transcripts", () => {
	assert.match(buildCompletedNativeRecordingNote("2026-08-15 15.00", "Them: hi\n\nMe: hello"), /Me = my mic/);
	assert.ok(!buildCompletedNativeRecordingNote("2026-08-15 15.00", "One voice, one room.").includes("Me = my mic"));
});

