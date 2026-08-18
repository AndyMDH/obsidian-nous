# Nous Technical Guide

This document maps the implementation of the Obsidian Nous plugin. It complements [`ARCHITECTURE.md`](ARCHITECTURE.md), which describes the conceptual layers and data flow.

## Project layout

```
obsidian-nous/
├── main.ts                 # Obsidian plugin entry point; UI, settings, file I/O, orchestration
├── src/
│   ├── types.ts            # Settings schema, result types, model option lists
│   ├── logic.ts            # Pure helpers: filename builders, markdown builders, clustering
│   ├── prompts.ts          # System prompts and tool schemas for enrichment and wiki synthesis
│   ├── llmProvider.ts      # Shared LlmProvider interface and LlmApiError
│   ├── anthropic.ts        # Anthropic Messages API adapter
│   ├── openaiCompatible.ts # OpenAI-compatible adapter (OpenAI + Local)
│   ├── gemini.ts           # Gemini API adapter
│   ├── transcribe.ts       # Cloud audio transcription fallback (Gemini/OpenAI)
│   ├── realtimeTranscribe.ts # Live/streaming dictation (OpenAI Realtime API, beta, opt-in)
│   ├── nativeRecorder.ts   # Argument/status helpers for the macOS meeting recorder
│   ├── onboarding.ts       # First-run capture-prerequisite copy and checklist helpers
│   ├── cliRunner.ts        # Claude CLI arg builders, PATH helpers, log parsing
│   └── skillTemplates.ts   # SKILL.md templates injected into .claude/skills/
├── native/
│   └── nous-recorder/      # SwiftPM native macOS meeting recorder helper
├── test/                   # Node test-runner tests (no live API calls)
├── docs/
│   ├── ARCHITECTURE.md     # Conceptual layer model
│   └── TECHNICAL.md        # This file
├── esbuild.config.mjs      # Dev + production builds
├── package.json            # Scripts, dependencies
├── manifest.json           # Obsidian plugin manifest
└── tsconfig.json           # TypeScript config
```

## Build system

- **Bundler**: esbuild (`esbuild.config.mjs`).
- **Type checker**: `tsc -noEmit` (run in `npm run build`, not in dev).
- **Test runner**: Node.js built-in (`node --test`) with `--experimental-strip-types` so `.test.ts` files run without transpilation.
- **Linter**: ESLint with `typescript-eslint`.
- **Dev loop**: `npm run dev` rebuilds `main.js` on file changes.
- **Release build**: `npm run build` typechecks and emits a production `main.js`.

`main.js` is the bundled artifact Obsidian loads. It is gitignored and built by CI at release time (Obsidian installs plugins from release assets, not the repo tree).

## `main.ts`: the Obsidian facade

`NousPlugin` is the main class. It owns:

- **Lifecycle**: `onload()`, `loadSettings()`, `saveSettings()`.
- **Commands**: process inbox, build wikis, query vault, toggle voice capture, open setup wizard.
- **UI wiring**: settings tab (`NousSettingTab`), onboarding modal (`OnboardingModal`).
- **Execution routing**: decides whether to use API mode or CLI mode for each operation.
- **File I/O**: reads/writes notes, moves attachments, converts HEIC, transcribes audio, appends to `.nous/pipeline.log`.

### Commands added to Obsidian

| Command ID | Function |
|---|---|
| `process-inbox` | `processInbox()` — route to CLI or API enrichment. |
| `build-wikis` | `buildWikis()` — route to CLI or API wiki synthesis. |
| `query-vault` | `runVaultQuery()` — CLI-only natural-language search. |
| `toggle-voice-capture` | Records from microphone; stops on second invocation (or opens `LiveVoiceCaptureModal` instead, if live transcription is on). |
| `toggle-meeting-capture` | Starts/stops the native `nous-recorder` helper (macOS only). |
| `setup-wizard` | Opens `OnboardingModal`, starting at the welcome screen. |
| `show-tour` | Opens `OnboardingModal` straight at the tour, skipping setup. |

### Auto-processing

If `autoProcessOnCreate` is enabled, the plugin registers a `vault.on("create")` listener. When a file is created inside the inbox folder, it waits 2 seconds (to let dictation tools finish rewriting the file) and then runs `processInbox()`.

### Path and environment handling for CLI mode

Obsidian's Electron process starts with a minimal `PATH`. `cliEnv()` augments `PATH` with common install locations:

- `/opt/homebrew/bin`
- `/usr/local/bin`
- `~/.local/bin`
- an optional extra directory if configured

The rest of the subprocess environment is a named allowlist, not the parent
env: `HOME`, `USER`/`LOGNAME` (required — `claude`'s Keychain credential
lookup fails without `USER`), locale/terminal vars, and `ANTHROPIC_*` /
`CLAUDE_*`. Nothing else from the parent environment is forwarded.

`getVaultBasePath()` uses `FileSystemAdapter.getBasePath()` to get the real filesystem path of the vault, which is required as the working directory for the `claude` CLI.

## Core modules in `src/`

### `types.ts`

Defines the settings schema and result types.

Key types:

- `NousSettings`: all user-configurable state, including execution mode, provider, API keys, models, folder names, thresholds, and onboarding flag.
- `ExecutionMode`: `"api" | "cli"`.
- `ApiProvider`: `"anthropic" | "openai" | "gemini" | "glm" | "local"`.
- `EnrichResult`: structured output from the enrichment model.
- `WikiSynthesisResult`: structured output from the wiki synthesis model.
- `NoteIndexEntry`: compact metadata passed to the model for duplicate detection and related-note linking.

`DEFAULT_SETTINGS` and `MODEL_OPTIONS` drive the settings UI dropdowns.

### `logic.ts`

Pure, Obsidian-independent helpers.

Important functions:

- `meetingFilename(date, title)` / `wikiFilename(topic)` — deterministic filenames.
- `buildMeetingMarkdown(result, rawTranscript, enrichedAt, ...)` — assembles the enriched note from an `EnrichResult`.
- `buildWikiMarkdown(topic, result, timeline, sources, created, updated)` — assembles a wiki hub page.
- `buildTagFileContent(tagName, date)` — template for a new tag note.
- `clusterByTag(notes)` — groups notes by tag, excluding `fragment` notes.
- `extractEnrichedSections(noteContent)` — strips transcript/related sections so wiki synthesis only sees structured content.
- `extractTranscriptSnippet(noteContent)` — used for duplicate detection in API mode.
- `arrayBufferToBase64(buffer)` — chunked btoa encoder; `src/logic.ts` has no Obsidian/Node dependency, so this uses the browser-standard `btoa` rather than `Buffer.from`.

### `prompts.ts`

Contains the system prompts and JSON tool schemas.

- `enrichSystemPrompt(tagRegistry)` — instructions for classifying, tagging, summarizing, duplicate detection, and related-note linking.
- `ENRICH_TOOL` — JSON schema for the `enrich_note` tool call.
- `wikiSystemPrompt(topic, isUpdate)` — instructions for synthesizing a wiki hub.
- `WIKI_TOOL` — JSON schema for the `synthesize_wiki` tool call.

The prompts are reused across providers; each provider adapter maps the generic tool schema to its own API format.

### `llmProvider.ts`

The shared contract for API-mode providers.

```ts
export interface LlmProvider {
  callTool<T>(
    system: string,
    message: LlmMessage,
    tool: LlmTool,
    maxTokens?: number
  ): Promise<T>;
}
```

`LlmApiError` carries the HTTP status and response body so callers can show meaningful error messages.

### Provider adapters

Each adapter translates the generic `callTool<T>` contract into provider-specific HTTP requests and parses the tool-call response.

- **`anthropic.ts`**: Anthropic Messages API with `tool_use` blocks. Uses `requestUrl` for transport; the `HttpPost` type is injected for testability.
- **`openaiCompatible.ts`**: OpenAI Chat Completions and any OpenAI-compatible server (used for both `openai` and `local` providers). Tool calls are extracted from `choices[0].message.tool_calls`.
- **`gemini.ts`**: Google Gemini API. Maps tool schema to Gemini's function-calling format and extracts the function call from the response.

`getLlmProvider()` in `main.ts` instantiates the correct adapter based on `settings.apiProvider`.

### `transcribe.ts`

Audio transcription is provider-specific because not all LLM APIs support audio input.

- `transcribeWithGemini()` — sends audio as base64 content.
- `transcribeWithOpenAi()` — sends audio via multipart/form-data.
- `audioMimeType(extension)` — maps file extensions to MIME types.

In API mode, `processFile()` calls transcription before enrichment. In CLI mode, `transcribeInboxAudioForCli()` runs first and leaves a text note in the inbox for the skill to process.

### `realtimeTranscribe.ts`

Live/streaming dictation, opt-in and desktop-only (beta): while `toggleVoiceCapture()`'s `LiveVoiceCaptureModal` (`main.ts`) is recording, this module streams microphone audio to OpenAI's Realtime API over a WebSocket and surfaces incremental transcript text as it arrives, instead of waiting until the recording stops.

Kept DOM-free and network-free at this level (no `WebSocket` import) so it's unit-testable under the plain Node test runner - `RealtimeTranscriber` takes an injected `wsFactory`; the real factory in `main.ts` lazily `import("ws")`s the npm `ws` package (bundled by esbuild, unlike the Node-builtin `child_process`/`fs`/`os`/`path` handled by `loadNodeModules()` - see the comment above `loadWsModule()` in `main.ts` for why that's a different lazy-loading trick).

- `float32ToPcm16Base64()` / `downsampleTo()` - Web Audio's Float32 samples -> the base64 PCM16 wire format the Realtime API expects.
- `buildTranscriptionSessionUpdate()` / `buildAppendAudioMessage()` - client event builders.
- `parseRealtimeEvent()` - discriminated union over server events (`delta` / `completed` / `error` / `unknown`); unrecognized event types (e.g. `session.created`) are `unknown`, not errors.
- `class RealtimeTranscriber` - owns one WebSocket connection: sends session config on open (model `gpt-4o-mini-transcribe`, `turn_detection: server_vad` with a widened `silence_duration_ms` so ordinary dictation pauses don't prematurely finalize a segment), forwards audio chunks, and dispatches `onPartial`/`onSegmentDone`/`onError`. Holds no transcript state itself - the modal accumulates segments.

This is strictly a safety-net-backed addition: `LiveVoiceCaptureModal` always starts the existing, unmodified `MediaRecorder` first, and only layers the Realtime connection on top of it. Any live-transcription failure (connect timeout, mid-stream drop, no key) tears down just the WS/AudioWorklet/AudioContext side; the recording itself is untouched and falls through to the unchanged batch `transcribeAudio()` path below on stop.

### `nativeRecorder.ts` and `native/nous-recorder`

Native meeting capture is split deliberately:

- `src/nativeRecorder.ts` is pure TypeScript: CLI arguments for
  `status` / `start` / `stop`, JSON status parsing, the live/pending/completed
  meeting-note builders, and transcript assembly (`interleaveMeetingTracks`,
  `trackStartDeltasMs`).
- `native/nous-recorder` is a SwiftPM executable. It uses ScreenCaptureKit to
  record system audio and microphone audio into a timestamped `.qma` folder
  containing `sys.m4a` and `mic.m4a`, plus a small state file in
  `~/Movies/NousRecordings`.

`main.ts` prefers the native helper for the phone button. If `status` cannot
run, the setup wizard/settings can download the matching release asset,
verify its SHA-256 sidecar, install it into the vault's plugin folder, and
retry from that managed path. If the helper is still unavailable, meeting
capture stays unavailable until the native recorder is installed. When the
native helper starts, the plugin creates and opens a live inbox note using
`buildLiveNativeRecordingNote()`: one `## Meeting notes` section with a
stripped-on-completion typing hint, hidden Properties (via
`cssclasses: nous-live-note` and the plugin stylesheet), and the cursor
placed in the writing space. No transcript is shown while recording — only
the typed notes area is live. The transcript appears once, after Stop, when
whisper finishes.

When the helper stops, the plugin transcribes each track independently (a
failed or silent track is logged as a `WARN:` and skipped, not fatal), then
merges them into a chronological `Me:`/`Them:` dialogue using whisper's
per-segment offsets, re-anchored with the helper's `timing.json` so a
late-starting mic doesn't skew the ordering. Cloud transcription has no
segment timing, so those tracks degrade to one labeled block each. A
single-source recording (an in-person meeting) gets no speaker labels.
Handled recordings move to `NousRecordings/Processed/` (purged after 30
days) so the nudge watchdog never fires on them. If a live note exists, the plugin replaces that same note
with normal inbox text from `buildCompletedNativeRecordingNote()`, preserving
typed questions/notes and removing the live-control frontmatter before
enrichment. If speech-to-text is not ready, that same live note becomes a
pending native recording note. API mode retries it in `processFile()`. CLI
mode retries it before running the Claude skill. The skill template also skips
pending and live native recording notes so Claude does not enrich a placeholder
or an active recording.

### `cliRunner.ts`

Pure helpers for CLI mode. No Obsidian dependency.

- `augmentedPath()` — prepends common binary directories to `PATH`.
- `buildEnrichArgs()`, `buildWikiArgs()`, `buildQueryArgs()` — construct `claude` CLI argument arrays.
- `summarizeLogLines()` — parses `.nous/pipeline.log` after a CLI run to count enriched notes and new/updated wikis.

`CliExec` is a function type; the real implementation in `main.ts` wraps Node's `child_process.execFile`. The type is injected so tests can stub it.

### `skillTemplates.ts`

Generates Markdown skill files that are written into `.claude/skills/` when CLI mode is first used:

- `meeting-enricher` — full inbox-to-notes enrichment instructions.
- `wiki-builder` — clustering, threshold checks, wiki creation/update, backlinking.
- `vault-query` — read-only search and answer instructions.

Folder names are interpolated from settings so the skills match the user's configured folder names.

## File processing pipeline in detail

### API mode enrichment (`processFile()`)

1. Read the inbox file.
2. Convert HEIC to JPEG via macOS `sips` (desktop only).
3. Transcribe audio if needed - first checks the in-memory `liveTranscripts` map (path -> transcript, populated by `saveVoiceRecording()` when live transcription succeeded) and uses/deletes that entry if present, otherwise calls `transcribeAudio()` as before. `transcribeInboxAudioForCli()` does the same check before its own `transcribeAudio()` call.
4. Build an attachment payload for images/PDFs (base64 + MIME type).
5. Fetch the tag registry and a compact index of recent notes.
6. Call `LlmProvider.callTool<EnrichResult>(...)` with the enrichment prompt.
7. If `is_duplicate`, move the inbox file to `00-Inbox/duplicates/`.
8. If `new_tag`, create `20-Tags/<tag>.md`.
9. Find any existing wiki link for the returned tags.
10. Build the final Markdown with `buildMeetingMarkdown()`.
11. Create the note in `10-Notes` and move/delete the original inbox file.
12. Append a structured line to `.nous/pipeline.log`.

### API mode wiki build (`buildWikisViaApi()`)

1. Read all note frontmatter from `10-Notes`.
2. `clusterByTag()` groups notes by tag, excluding fragments.
3. For each cluster:
   - If no wiki exists and the note count ≥ `wikiThreshold`, call `createWiki()`.
   - If a wiki exists and new notes arrived after its `updated` date, call `updateWiki()`.
4. `createWiki()` / `updateWiki()` read source bodies, call the model with `WIKI_TOOL`, and write the wiki Markdown.
5. `linkWikiIntoSources()` adds `[[<Topic> Wiki]]` to each source note's `## Related` section.

### CLI mode pipeline (`processInboxViaCli()`)

1. Guard: desktop only.
2. Transcribe any audio files in the inbox first (the `claude` binary cannot read audio).
3. Transcribe any pending native recorder notes that can now be processed.
4. Ensure skills are installed in `.claude/skills/`.
5. Run `claude -p "Use the meeting-enricher skill..." --allowedTools Read,Write,Edit,Glob,Grep,Bash --permission-mode acceptEdits`.
6. Run the wiki-builder skill similarly.
7. Parse `.nous/pipeline.log` to report results.

## Settings and configuration

Settings are persisted by Obsidian via `this.loadData()` / `this.saveData()` into `.obsidian/plugins/nous/data.json`.

| Setting | Meaning |
|---|---|
| `executionMode` | `"cli"` or `"api"`. |
| `apiProvider` | Active provider when `executionMode` is `"api"`. |
| `apiKeys` | API keys for each provider (plain text in `data.json`). |
| `models` | Model ID per provider. |
| `glmBaseUrl` | Endpoint for GLM (Z.ai). |
| `localBaseUrl` | Endpoint for local OpenAI-compatible servers. |
| `claudeCliPath` | Path or command for the `claude` CLI. |
| `whisperCliPath` / `whisperModelPath` | Local whisper.cpp binary/model paths for voice transcription (macOS). |
| `liveTranscriptionEnabled` | Opt-in, desktop-only live/streaming dictation via OpenAI's Realtime API. |
| `inboxFolder` / `meetingsFolder` / `wikisFolder` / `tagsFolder` / `queriesFolder` | Folder names for each layer - see `ARCHITECTURE.md`. |
| `wikiThreshold` | Minimum non-fragment notes before a wiki is created. |
| `dedupLookback` | Number of recent notes to include in the duplicate-detection index. |
| `autoProcessOnCreate` | Whether to enrich new inbox files automatically. |
| `onboarded` | Whether the first-run wizard has been completed. |

The settings UI in `NousSettingTab` is built dynamically: it shows/hides fields
based on execution mode and provider, includes a **Test connection** button,
and hides rarely-touched fields (CLI/recorder/whisper paths, folder names, thresholds)
behind an **Advanced settings** toggle - only the essentials show by default.

## Testing strategy

Tests are in `test/*.test.ts` and run with Node's built-in test runner.

- `logic.test.ts` — pure helpers, markdown builders, clustering.
- `types.test.ts` — defaults and settings validation.
- `cliRunner.test.ts` — PATH augmentation, arg builders, log summarization.
- `anthropic.test.ts`, `openaiCompatible.test.ts`, `gemini.test.ts` — provider adapters with stubbed HTTP.
- `transcribe.test.ts` — audio transcription helpers with stubbed HTTP.
- `nativeRecorder.test.ts` — recorder CLI args/status, meeting-note builders, transcript interleaving.
- `onboarding.test.ts` — setup-wizard readiness states.
- `realtimeTranscribe.test.ts` — live-transcription session protocol.
- `skillTemplates.test.ts` — generated CLI skill files.
- `whisperModel.test.ts` — speech-model download helpers (LFS pointer parsing, progress text).

The tests do not make live API calls. `HttpPost` and `CliExec` are injected so tests can provide canned responses.

Run tests with:

```bash
npm test
```

## Error handling and logging

Errors are surfaced in two ways:

1. **Obsidian notices** — short-lived toast notifications for user-facing failures.
2. **`.nous/pipeline.log`** — append-only log inside the vault with ISO timestamps and structured events:
   - `ENRICHED: <filename> - tags: [...] - project: <project>`
   - `NEW WIKI: <topic> - sources: <count>`
   - `UPDATED WIKI: <topic> - sources: <count>`
   - `DUPLICATE: <filename> matches <note>`
   - `NEW TAG: <tag> - <justification>`
   - `ERROR: <context> - <message>`
   - `TRANSCRIBED: <audio> -> <note>`
   - `PENDING: <recording> needs speech-to-text setup -> <note>`
   - `LIVE NOTE: native meeting recording -> <note>`
   - `RECOVERED: live native meeting note kept without transcript -> <note>`
   - `WARN: <context>` / `SKIPPED: <context>`

API errors are wrapped in `LlmApiError` so the HTTP status and truncated response body can be logged.

## Extension points

If you want to change how Nous behaves, these are the typical seams:

| Change | Where to look |
|---|---|
| New capture source or file type | `logic.ts` extension lists; `processFile()` file-type branches in `main.ts`. |
| Different output Markdown shape | `buildMeetingMarkdown()` / `buildWikiMarkdown()` in `logic.ts`; frontmatter order matters. |
| New model provider | Implement `LlmProvider` in a new file and add it to `getLlmProvider()` and `types.ts`. |
| Different tagging rules | `enrichSystemPrompt()` in `prompts.ts` and the `meeting-enricher` skill in `skillTemplates.ts`. |
| Different wiki threshold behavior | `buildWikisViaApi()` and the `wiki-builder` skill. |
| New query behavior | The `vault-query` skill; currently CLI-only because it needs open-ended reasoning. |
| New settings | Add to `NousSettings` and `DEFAULT_SETTINGS` in `types.ts`, then render in `NousSettingTab`. |

## Important implementation notes

- **Desktop-only** (`isDesktopOnly: true` in `manifest.json`): HEIC conversion, CLI mode, and the native meeting recorder all shell out to local binaries, which need a real filesystem and process access.
- **Audio always needs Gemini/OpenAI**: Anthropic does not offer an audio transcription API, so even CLI mode falls back to a direct API key for speech-to-text.
- **No agentic loop**: each enrichment and wiki call is a single tool-call request. The model does not iterate.
- **Case-insensitive filesystem safety**: wiki files use a ` Wiki` suffix to avoid filename collisions with tag notes.
- **Plain-text keys**: API keys are stored in Obsidian's plugin data file without encryption. Keep the vault out of untrusted sync.
