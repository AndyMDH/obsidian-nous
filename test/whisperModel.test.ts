import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	WHISPER_MODEL_SOURCES,
	downloadProgressText,
	formatBytes,
	parseLfsPointer,
} from "../src/whisperModel.ts";

test("parseLfsPointer reads oid and size from a git-lfs pointer file", () => {
	const pointer = parseLfsPointer(
		"version https://git-lfs.github.com/spec/v1\noid sha256:" + "a".repeat(64) + "\nsize 1624555275\n"
	);
	assert.deepEqual(pointer, { sha256: "a".repeat(64), size: 1624555275 });
});

test("parseLfsPointer rejects malformed pointers", () => {
	assert.equal(parseLfsPointer("not a pointer"), null);
	assert.equal(parseLfsPointer("oid sha256:tooshort\nsize 5\n"), null);
	assert.equal(parseLfsPointer("oid sha256:" + "a".repeat(64) + "\nsize -3\n"), null);
	assert.equal(parseLfsPointer("oid sha256:" + "a".repeat(64) + "\n"), null);
});

test("downloadProgressText reports percent of a known total and bytes otherwise", () => {
	assert.equal(
		downloadProgressText("ggml-large-v3-turbo.bin", 812_000_000, 1_624_000_000),
		"Nous: downloading ggml-large-v3-turbo.bin… 50% of 1.6 GB"
	);
	assert.match(downloadProgressText("m.bin", 5_000_000, 0), /5 MB/);
});

test("formatBytes picks a sensible unit", () => {
	assert.equal(formatBytes(1_624_555_275), "1.6 GB");
	assert.equal(formatBytes(885_098), "885 KB");
	assert.equal(formatBytes(4_200), "4 KB");
});

test("exactly one whisper model source is required", () => {
	assert.equal(WHISPER_MODEL_SOURCES.filter((s) => s.required).length, 1);
	for (const source of WHISPER_MODEL_SOURCES) {
		assert.match(source.pointerUrl, /^https:\/\/huggingface\.co\/.+\/raw\/main\//);
		assert.match(source.downloadUrl, /^https:\/\/huggingface\.co\/.+\/resolve\/main\//);
	}
});
