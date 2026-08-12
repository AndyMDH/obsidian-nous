import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	NATIVE_RECORDER_ASSET,
	buildPendingNativeRecordingNote,
	nativeRecorderArgs,
	nativeRecorderReleaseAssetUrl,
	parsePendingNativeRecordingNote,
	parseNativeRecorderChecksum,
	parseNativeRecorderStatus,
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

test("parsePendingNativeRecordingNote ignores ordinary notes", () => {
	assert.equal(parsePendingNativeRecordingNote("---\ntype: meeting\n---\nbody"), null);
	assert.equal(parsePendingNativeRecordingNote("plain text"), null);
});
