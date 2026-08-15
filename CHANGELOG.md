# Changelog

## 2.1.0

The meeting-capture release. Everything below shipped since 2.0.4.

### Live meeting notes

- The phone button (or your hotkey) opens a live note the moment recording
  starts. It has one **Meeting notes** section with the cursor placed under
  it - type questions and thoughts during the call.
- Everything you type is kept verbatim in the finished note, above the
  transcript.
- The live note shows its state: tangerine section headings while the
  recording or transcription is in flight, a red pulse in the status bar
  while the mic is live, and one toast when the finished note is ready.

### Better transcripts

- The two meeting tracks (your mic, everyone else) now merge into one
  `Me:` / `Them:` dialogue in time order, not two separate blocks.
- The helper records each track's start time, so a mic that starts late
  (for example, during the first permission prompt) cannot skew the
  dialogue order.
- A silent or failed track no longer costs the whole meeting - Nous keeps
  whatever transcribed.
- Long meetings transcribe from disk, not from memory. A one-hour
  recording no longer risks an Obsidian crash.

### Easier setup

- The wizard and Settings → Voice capture now have a **Download model**
  button: one click streams the local speech model, verifies its checksum,
  and installs it. No terminal needed for the model half of voice setup.
- The wizard's three backend choices are clickable cards with a
  recommended default.
- The settings tab shows the plugin version with links to the docs and
  issue tracker.
- The recorder installer falls back to the newest release when the
  version-matched release has no recorder asset.

### Quieter, clearer notifications

- State lives in the status bar (recording, then transcribing). Toasts are
  reserved for the finished result, for errors, and for the start of a
  recording - that last one on purpose: you must always know when the mic
  is live.
- Error toasts are one short line each. The detail goes to
  `.nous/pipeline.log`.
- Skips and errors are counted apart: an empty stub no longer produces the
  same alarm as a real failure.

### Reliability fixes

- CLI mode works again: a subprocess-environment change had removed the
  variable that `claude` needs for its credential lookup, so every
  enrichment failed with an unlogged "Not logged in". Fixed, and error
  logging now captures both output streams.
- The native recorder starts correctly when launched by bare name - it
  previously failed with "The file nous-recorder doesn't exist".
- Handled recordings move to `NousRecordings/Processed/` (purged after 30
  days), so the forgot-to-record watchdog cannot fire on a recording that
  was already handled.
- Empty capture stubs move to `duplicates/` on first skip instead of being
  re-skipped on every run.
- Mic capture needs macOS 15 or later; on macOS 14 the transcript is
  `Them:`-only. This is now logged and documented.

### Looks

- New identity: editorial diagram style, tangerine accent, a friendly
  lowercase-n logo, and an animated demo of the capture cycle in the
  README.
