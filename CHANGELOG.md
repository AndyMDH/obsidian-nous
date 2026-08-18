# Changelog

## 2.8.5

- Removed the "Nous Recorder path" Advanced setting - it configured a
  binary Nous already builds and installs itself, to one fixed
  location, so overriding it only ever risked confusion, never helped.
- Removed the Settings tab's own "Speech model" install button. The
  wizard already offers the same one-click model download and
  whisper-cli install - having it in two places was two ways to fix
  the same thing. Skipped it during setup? Finish it later from
  Settings → Nous → "Rerun setup."

## 2.8.4

- Fixed the whisper-cli installer reporting "install finished, but
  still not runnable" even after a real, successful install - it was
  re-checking a leftover custom path instead of the standard location
  Homebrew actually installs to. A successful install now also clears
  a stale custom path automatically.

## 2.8.3

- Fixed a real bug behind the "washed out" Settings tab headings some
  users saw: a style meant only for older Obsidian versions was
  overriding Obsidian's own native heading style on newer ones.
  Section headings (Provider, Meeting capture, etc.) now render at
  full size and contrast everywhere.
- README tightened to shorter sentences and simpler words throughout.

## 2.8.2

- Local speech-to-text (whisper-cli) now installs with one click, no
  Terminal command needed - same as the model download already did,
  including a Cancel button.
- Cleaned up duplicated code found in a codebase-wide audit: shared
  helpers replace several copy-pasted blocks, two dead settings are
  gone, and a couple of stale mismatches between screens are fixed.

## 2.8.1

- Default local speech model dropped from ~1.6GB to ~466MB - much
  less to download. Anyone who already has the old model keeps using
  it; nothing breaks.
- The wizard's "What works now" screen is now "Setting up" and only
  lists what still needs attention.
- Dropped the "whisper-cli"/"whisper.cpp" jargon from every screen a
  user sees - one tool, two confusing names. Kept only in the
  deep-dive docs.
- Fixed two bugs in the dictation capture script: same-second
  captures no longer overwrite each other, and a broken vault path
  now saves a clear error to the Desktop instead of losing the
  capture.
- Fixed dropdown text contrast in dark mode.

## 2.8.0

- Mobile support removed - Nous is desktop only (macOS, Windows,
  Linux) now. Cleaning out the dead mobile-only code caught one real
  bug: a Windows or Linux user could hit a raw error instead of a
  clear message when converting a HEIC image.
- Reviewed the whole setup wizard as a brand-new user and fixed
  several rough spots: a back button that jumped two steps at once, a
  checklist that repeated itself, a "give up meeting capture for
  good" message that was really just "do it later," and a vault
  warning that wrapped badly.
- README restyled with a link row and a Features table.

## 2.7.6

- Fixed onboarding states that could disagree with themselves - for
  example, meeting capture could say "ready" and "just failed" on the
  same screen after a permission prompt failed.
- Capability checks (Claude Code, whisper-cli, the recorder) had no
  timeout and could leave the wizard spinning forever. Capped at 15
  seconds.
- A file dropped into the inbox mid-run could be silently skipped -
  now retried.
- Fixed several stale doc references and a few small visual
  mismatches between the wizard and Settings.

## 2.7.5

- Fixed several data-loss and race-condition bugs found in a full
  codebase sweep: same-day duplicate captures could overwrite each
  other, a colon in a note's title could corrupt that note's whole
  frontmatter, and a voice recording could become permanently
  unstoppable under rare timing.
- API mode now has the same protection against overlapping runs that
  CLI mode already had.

## 2.7.4

- Fixed notice-bubble spam: "waiting on speech-to-text" no longer
  repeats on every scan.
- Simplified notice text that repeated the same instruction twice.
- The pipeline log is now capped at 5,000 lines instead of growing
  forever.

## 2.7.3

- Fixed the quick tour's first step having no back button.

## 2.7.2

- Fixed voice setup showing "installed" when whisper-cli was actually
  still missing.
- Onboarding now warns before writing into a vault that already has
  content.
- Onboarding now explains that the native recorder and the speech
  model are two separate installs.

## 2.7.1

- Fixed folders dropped into the inbox only being scanned one level
  deep - files nested inside a dropped folder were silently never
  processed.

## 2.7.0

Import notes from Notion:

- A new "Migrating from Notion?" card on the welcome screen (also an
  "Import from Notion" command, for anyone who already finished
  setup). Export your workspace from Notion as Markdown & CSV, unzip
  it, then pick the folder with a normal folder window - no need to
  drag it into your vault first. Desktop only.
- Each page's text lands in your inbox with Notion's ID suffix
  stripped from the title, then goes through the same enrichment
  every other capture gets - no separate import format to learn.
  Notion's page links and images don't carry over yet, just the
  words. Importing the same export twice skips pages already sitting
  in your inbox instead of duplicating them.

## 2.6.3

Addressed the plugin health scorecard's biggest finding: `:has()`
usage in `styles.css` went from 123 uses down to 0, all replaced with
plain classes set from JS instead of computed live by the selector
engine (Obsidian's scanner flags `:has()` as a real performance risk
- broad selector invalidation, re-evaluated on every DOM change).
Also fixed the `text-decoration` compatibility warning on underlined
links. No visible change - properties panel, note headings, and the
transcript callout all verified rendering identically to before.

## 2.6.2

Status bar recording/transcribing indicators use real icons and a
live timer now instead of emoji text - a pulsing-dot recording icon
with "REC 00:42", and a spinning icon while transcribing.

## 2.6.1

- Registered warm-paper's custom clip-n icons so they're available
  anywhere an icon-by-name is needed.
- Fixed the meeting capture ribbon/tour icon to match the theme spec
  (was "phone-call", now Lucide "audio-lines").

## 2.6.0

`#win` now works in API mode, not just CLI mode - auto-suggested
tagging, structured frontmatter extraction (category, headcount,
client, repo, metric), and a self-updating `Wins.md` all behave the
same regardless of which execution mode you use.

## 2.5.9

Addressed several findings from Obsidian's plugin health scorecard:

- Dropped `ui-monospace` from the mono font stack - a newer CSS
  generic keyword Obsidian's bundled Chromium doesn't support.
- Added `@codemirror/state`/`@codemirror/view` to `dependencies` -
  they're bundled into `main.js`, not just present transitively.
- Removed an unneeded `!important`.

## 2.5.8

- Shortened the plugin description shown in Community plugins - it
  wrapped onto several lines. Now one line, leads with using your
  vault as context for an AI assistant.

## 2.5.7

- Fixed select dropdown text (Provider, etc.) clipped at the top.

## 2.5.6

- Trimmed the tour's hotkey tip - it had grown to three sentences on
  a one-line screen.

## 2.5.5

- Finish screen now explains the tag list starts empty and grows as
  you capture.
- Tour points at Settings → Hotkeys for capture commands, with a note
  that Obsidian has to be focused for a hotkey to fire.
- Trimmed "or run free & local" to "or run local" on the connect
  screen.

## 2.5.4

New `#win` tag for tracking professional accomplishments (CLI mode
only for now):

- Auto-suggested/applied whenever a note describes a completed
  accomplishment, not just when typed explicitly.
- Extracts category (client work, training, internship, internal
  tool, open source, writing, certification, event, other) and any
  concrete numbers mentioned (headcount, client, repo, metric) into
  frontmatter - left blank rather than guessed when not stated.
- Self-updating `30-Wikis/Wins.md`, grouped by category with a count
  per category, newest first.
- New command "Log a win" drops a pre-tagged capture skeleton in the
  inbox and opens it.

## 2.5.3

- Welcome screen: "I want a free local model" and "I have an API key"
  led to the exact same form, just with a different provider
  preselected - merged into one card that opens a new choice screen
  first.

## 2.5.2

- Fixed the onboarding wizard rendering washed-out and barely legible
  in dark mode.
- Fixed dropdown selects (Provider, etc.) showing a tiled row of
  arrow icons instead of Obsidian's normal single dropdown arrow.
- Fixed stray divider lines on the "Connect a provider" screen.
- Fixed the Base URL field truncating long values in the settings tab.
- Fixed "Meeting capture" rendering as an empty heading with nothing
  under it unless Advanced settings was turned on.

## 2.5.1

- Fixed the welcome screen's mode cards ("I have a Claude
  subscription", etc.) showing no hover highlight at all.

## 2.5.0

Full visual rebrand: warm paper design (moss accent, new Clip-n logo,
editorial typography). See `docs/NOUS-REDESIGN.md` for the spec.

- Nous no longer forces its own color palette. Every surface it draws -
  the onboarding wizard, notices, the settings tab, styled-note
  output - now pulls its colors from your active Obsidian theme and
  accent color instead.
- Settings tab: real grouped cards (Provider, Meeting capture, Voice
  capture, Vault) instead of a flat list with headings, plus clearer
  toggle contrast and shorter descriptions.
- New optional companion theme, "Warm Paper" - the moss palette Nous
  used to force on everyone, now a separate theme you opt into. One
  click from the onboarding wizard's welcome screen installs and
  switches to it (`AndyMDH/warm-paper`).
- Fixed several bugs the theme-adaptive change introduced: invisible
  white-on-white text on filled buttons and the recommended mode
  card, a "What works now" back button that silently re-ran the
  connection check and bounced right back instead of going back, and
  a stuck internal lock that could silently block every future
  automatic and manual "process inbox" for the rest of the session if
  one CLI run ever hung.
- README, logo, and illustrations updated to match.

## 2.4.3

- Transcript sections now render as a collapsed callout instead of a
  plain heading, so a long transcript doesn't dominate the note. A
  one-time command converts notes written before this change.
- Quick capture is removed. Type or paste into a note in the inbox
  instead - one less way in to maintain, same result.
- Onboarding wizard: a full skip from the welcome screen now seeds the
  vault folders like every other exit path did already. Finishing the
  wizard always drops and enriches a sample note, not just the optional
  tour - you see the capture -> enrichment loop happen either way. Added
  a "Show quick tour" command to revisit the walkthrough without
  redoing provider setup. Fixed the provider-connection screen missing
  its progress dots, a missing intro line on the same screen, and a
  capture-status screen that could show two rows both saying "it works."
- `30-Wikis` gets a placeholder note explaining it starts empty until a
  tag has enough notes - it looked broken before.

## 2.3.3

Live meeting transcription (2.3.0-2.3.2) is removed. The feature fought
macOS permission attribution and introduced process-management risk to
the one flow that must never break - recording. Meetings work as in
2.2.x: record, stop, whisper transcribes, the note comes back enriched.
The stop-path hardening from 2.3.2 stays.

## 2.3.0

Live meeting transcription, fully on-device.

- While a meeting records, the transcript streams into the live note as
  people talk - committed lines plus the sentence in progress. Built on
  Apple's built-in speech engine: nothing to install, nothing sent
  anywhere. macOS asks once for speech recognition permission.
- The live text is a fast draft. On stop, the whisper pass replaces it
  with the final transcript, exactly as before.
- Degrades safely: no permission or no on-device model means no live
  view, and the recording is untouched.
- Each tour step now says when to use it, and in-person meetings produce
  an unlabeled room transcript instead of a wrong "Me:" label.

## 2.2.0

The onboarding release.

- The wizard shows its progress: four steps, dots on every screen, the
  Nous mark on the welcome screen, and a check mark on the finish screen.
- The connection check runs itself when the screen opens and moves on by
  itself when it passes. If Claude Code is missing, the wizard shows the
  install command with a Copy button.
- A click-through 60-second tour drives the real features: drop a sample
  note, open quick capture, start a voice recording.
- Every wizard screen is one line of text plus its controls. Setup
  notices carry an "Open Nous settings" link, and a command palette
  entry jumps to the settings tab.
- Brand pass: tangerine buttons, cards, and progress dots in all Nous
  modals.

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
