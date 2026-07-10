#!/usr/bin/env bash
set -uo pipefail

# Watches QuickRecorder's save folder for finished meeting recordings,
# transcribes them locally with whisper.cpp, and drops a speaker-labeled
# markdown transcript into the Cortex inbox (00-Raw) - Cortex enriches it
# from there like any other capture.
#
# Recording side: QuickRecorder bound to Opt+M (toggle). With
# "record microphone" on, an audio recording saves as a "….qma" folder
# holding two tracks: sys.m4a (everyone else on the call) and mic.m4a (you).
# The two tracks are transcribed separately and interleaved by timestamp as
# "Me:" / "Them:" lines. A recording made without the mic track is a single
# "Recording at ….m4a/.mp3/.flac/.ogg" file and is transcribed unlabeled.
#
# Failure handling is deliberately loud: every outcome (saved / empty /
# failed) posts a macOS notification, and a recording that can't be
# processed (e.g. corrupted by a mid-meeting crash) is moved to Failed/ so
# it can't block the queue and the audio is kept for manual recovery.
#
# Triggered by launchd (com.andy.meetingtranscribe): WatchPaths on the
# recordings folder plus a StartInterval sweep. Everything runs on-device -
# afconvert (built into macOS) for audio conversion, whisper.cpp for speech
# to text. Nothing is uploaded anywhere.

WATCH_DIR="${WATCH_DIR:-$HOME/Movies/MeetingRecordings}"
VAULT="${VAULT:-$HOME/Obsidian/YourVaultName}"
INBOX="$VAULT/${INBOX_FOLDER:-00-Inbox}"
MODEL="$HOME/.local/share/whisper-models/ggml-large-v3-turbo.bin"
VAD_MODEL="$HOME/.local/share/whisper-models/ggml-silero-v5.1.2.bin"
LOG="${LOG:-$HOME/.local/state/meeting-transcribe.log}"
PROCESSED="$WATCH_DIR/Processed"
FAILED="$WATCH_DIR/Failed"

WHISPER="$(command -v whisper-cli || true)"
[ -z "$WHISPER" ] && [ -x /opt/homebrew/bin/whisper-cli ] && WHISPER=/opt/homebrew/bin/whisper-cli

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

notify() {
  osascript -e 'on run argv
    display notification (item 1 of argv) with title "Cortex"
  end run' "$1" >/dev/null 2>&1 || true
}

mkdir -p "$(dirname "$LOG")" "$PROCESSED"

if [ -z "$WHISPER" ] || [ ! -f "$MODEL" ]; then
  log "SKIPPED: whisper-cli or model missing (whisper='$WHISPER', model exists: $([ -f "$MODEL" ] && echo yes || echo no))"
  exit 0
fi

# One run at a time - a second launchd trigger while a long transcription is
# in flight should just bail, the periodic sweep will catch anything new.
LOCK="$WATCH_DIR/.transcribe.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# A recording that can't be processed must not block the queue: park it in
# Failed/ (audio preserved for manual recovery) and say so out loud.
fail_item() {
  local item="$1" reason="$2" base
  base="$(basename "$item")"
  mkdir -p "$FAILED"
  mv "$item" "$FAILED/" 2>/dev/null || true
  log "ERROR: $base - $reason (moved to Failed/)"
  notify "Transcription FAILED for $base ($reason). Audio kept in MeetingRecordings/Failed."
}

# Convert any audio file to what whisper.cpp wants: 16kHz mono 16-bit WAV.
to_wav() { afconvert -f WAVE -d LEI16@16000 -c 1 "$1" "$2" 2>/dev/null; }

# Transcribe one wav to <out>.json (whisper.cpp segment JSON with ms offsets).
# VAD (voice activity detection) strips silent stretches before they reach
# the model - without it, Whisper invents phantom lines ("Thank you.") on
# silence, hold music, or typing noise.
transcribe() {
  local vad_args=()
  [ -f "$VAD_MODEL" ] && vad_args=(--vad --vad-model "$VAD_MODEL")
  "$WHISPER" -m "$MODEL" -f "$1" -l auto -oj -of "$2" "${vad_args[@]}" >/dev/null 2>&1 \
    && [ -f "$2.json" ]
}

# Merge one or two whisper JSONs into transcript text on stdout.
# Usage: merge_json sys.json [mic.json]  (two args -> Them:/Me: labels)
merge_json() {
  python3 - "$@" <<'PY'
import json, sys

def segs(path, label):
    with open(path) as f:
        data = json.load(f)
    out = []
    for s in data.get("transcription", []):
        text = s.get("text", "").strip()
        if not text:
            continue
        out.append((s["offsets"]["from"], label, text))
    return out

files = sys.argv[1:]
if len(files) == 2:
    merged = segs(files[0], "Them") + segs(files[1], "Me")
else:
    merged = segs(files[0], None)
merged.sort(key=lambda t: t[0])

lines, prev = [], None
for _, label, text in merged:
    if label is None:
        lines.append(text)
    elif label == prev:
        lines[-1] += " " + text
    else:
        lines.append(f"{label}: {text}")
        prev = label
print("\n\n".join(lines))
PY
}

process_item() {
  local item="$1" base stamp tmp out transcript
  base="$(basename "$item")"

  # Still being written? lsof alone misses QuickRecorder's write pattern,
  # so also require a minute of quiet - the periodic sweep retries until
  # the recording has settled.
  if lsof +D "$item" >/dev/null 2>&1 || lsof "$item" >/dev/null 2>&1; then
    return 0
  fi
  if [ -n "$(find "$item" -mmin -1 -print -quit 2>/dev/null)" ]; then
    return 0
  fi

  stamp="$(stat -f '%Sm' -t '%Y-%m-%d %H.%M' "$item")"
  tmp="$(mktemp -d)"
  transcript=""

  if [ -d "$item" ]; then
    local sys_track mic_track
    sys_track="$(find "$item" -name 'sys.*' -print -quit)"
    mic_track="$(find "$item" -name 'mic.*' -print -quit)"
    if [ -z "$sys_track" ]; then
      rm -rf "$tmp"; fail_item "$item" "no system-audio track found"; return 0
    fi
    if ! to_wav "$sys_track" "$tmp/sys.wav"; then
      rm -rf "$tmp"; fail_item "$item" "audio conversion failed - recording may be corrupt"; return 0
    fi
    if ! transcribe "$tmp/sys.wav" "$tmp/sys"; then
      rm -rf "$tmp"; fail_item "$item" "whisper failed on system track"; return 0
    fi
    if [ -n "$mic_track" ] && to_wav "$mic_track" "$tmp/mic.wav" && transcribe "$tmp/mic.wav" "$tmp/mic"; then
      transcript="$(merge_json "$tmp/sys.json" "$tmp/mic.json")"
    else
      # A broken mic track shouldn't cost the whole meeting - fall back to
      # the system track alone (unlabeled) and note it.
      [ -n "$mic_track" ] && log "WARN: $base mic track unusable, transcribed system audio only"
      transcript="$(merge_json "$tmp/sys.json")"
    fi
  else
    if ! to_wav "$item" "$tmp/audio.wav"; then
      rm -rf "$tmp"; fail_item "$item" "audio conversion failed - recording may be corrupt"; return 0
    fi
    if ! transcribe "$tmp/audio.wav" "$tmp/audio"; then
      rm -rf "$tmp"; fail_item "$item" "whisper failed"; return 0
    fi
    transcript="$(merge_json "$tmp/audio.json")"
  fi
  rm -rf "$tmp"

  if [ -z "$transcript" ]; then
    log "SKIPPED: $base produced an empty transcript (silence?), moved to Processed without a note"
    notify "Recording $base had no detectable speech - no note was created."
    mv "$item" "$PROCESSED/"
    return 0
  fi

  out="$INBOX/$stamp Meeting transcript.md"
  # Two recordings ending the same minute must not overwrite each other.
  local n=2
  while [ -e "$out" ]; do
    out="$INBOX/$stamp Meeting transcript $n.md"
    n=$((n + 1))
  done
  printf 'Meeting recording from %s, transcribed automatically (Me = my mic, Them = everyone else on the call).\n\n%s\n' \
    "$stamp" "$transcript" > "$out"
  mv "$item" "$PROCESSED/"
  log "TRANSCRIBED: $base -> $(basename "$out")"
  notify "Meeting transcript saved to inbox: $(basename "$out")"
}

shopt -s nullglob
for item in "$WATCH_DIR"/*.qma "$WATCH_DIR"/"Recording at "*.m4a "$WATCH_DIR"/"Recording at "*.mp3 "$WATCH_DIR"/"Recording at "*.flac "$WATCH_DIR"/"Recording at "*.ogg; do
  process_item "$item"
done

# Transcripts live in the vault forever; the audio itself only needs to stick
# around long enough to re-listen if a transcript looks off (~30-60MB/hour).
# Failed/ is never auto-cleaned - those need a human look first.
find "$PROCESSED" -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} + 2>/dev/null || true
