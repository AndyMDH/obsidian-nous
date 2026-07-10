<p align="center">
  <img src="assets/logo.svg" alt="Cortex logo — a knowledge graph forming a brain" width="112">
</p>

<h1 align="center">Cortex</h1>

Capture anything — a typed thought, a voice memo, pasted meeting notes, a
photo, a PDF — and Cortex turns it into a tagged, linked knowledge graph
inside Obsidian.
Every capture gets summarized and connected to related notes automatically,
and once a topic has enough notes behind it, Cortex writes a wiki page
pulling everything together.

No coding needed. Everything happens inside Obsidian.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/pipeline-dark.svg">
  <img alt="Capture anything into 00-Inbox; Cortex turns it into a tagged, linked note in 10-Notes; topics with 4+ notes get a wiki page in 30-Wikis." src="assets/pipeline-light.svg">
</picture>

## What you need

- [Obsidian](https://obsidian.md) (free)
- One of these:
  - A **Claude subscription** (Pro or Max), plus
    [Claude Code](https://docs.claude.com/claude-code) installed once
  - An **API key** from Anthropic, OpenAI, or Gemini
  - A **local model** (e.g. [Ollama](https://ollama.com)) — free, nothing
    ever leaves your machine

## Install

1. In Obsidian: **Settings → Community plugins**, turn community plugins on.
2. Install and enable the **BRAT** plugin from the Community plugins browser.
3. Command palette (`Cmd/Ctrl+P`) → **"BRAT: Add a beta plugin"** → paste
   `AndyMDH/obsidian-cortex`.
4. Back in **Settings → Community plugins**, turn **Cortex** on.

BRAT keeps Cortex updated automatically from then on.

## Set up

**A setup wizard opens the first time you enable Cortex** — it walks you
through the one choice below, checks the connection, and can drop a sample
note into your inbox so you watch your first enrichment happen. (Rerun it
anytime: command palette → "Cortex: Open setup wizard".)

Prefer doing it by hand? All settings live inside Obsidian (nothing to
configure on your computer itself). Open **Obsidian's settings** — the gear
icon bottom-left, or `Cmd/Ctrl+,` — and click **Cortex** in the left
sidebar. One choice to make:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/settings-nav-dark.svg">
  <img alt="Obsidian's settings window: Cortex in the left sidebar under Community plugins, with Execution mode, Provider, and Model settings in the main pane." src="assets/settings-nav-light.svg">
</picture>

- **Claude subscription (Pro/Max)?** Set **Execution mode** to
  "Claude Code CLI". Done.
- **API key instead?** Set it to "Direct API key", pick your **Provider**,
  and paste your key (or your base URL, for a local model). Done.

Everything else has a sensible default, and a **Test connection** button in
the same panel confirms your choice works before you capture anything.

## Use it

The fastest way in: click the **➕ quick capture** icon in the left sidebar
(or command palette → "Cortex: Quick capture") — type, paste, or attach an
image/PDF/voice memo, hit Capture, done. Or drop anything straight into the
**`00-Inbox`** folder — same result:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/capture-ways-dark.svg">
  <img alt="Type/paste, voice memo, photo/screenshot, or PDF — all land in 00-Inbox, and Cortex turns each into a tagged, summarized, linked note." src="assets/capture-ways-light.svg">
</picture>

- **Type or paste** — quick capture, or a note (`Cmd/Ctrl+N`) in `00-Inbox`
- **Voice** — press a hotkey, talk, press again (setup below)
- **Photos & screenshots** — `.png`, `.jpg`, `.webp`, `.heic` (to auto-capture
  Mac screenshots, see [`examples/`](examples/))
- **PDFs**

Within seconds, Cortex tags it, summarizes it, links it to related notes,
and files it in **`10-Notes`** — your original text, image, or recording
preserved inside. Topics with 4+ notes get a wiki page in **`30-Wikis`** (or
force one anytime: command palette → "Cortex: Build/update wikis now").

### Capture by voice

One-time setup: **Settings → Hotkeys**, search **"Cortex: Toggle voice
capture"**, give it a key (say `Alt+Space`). From then on:

**Press the key, talk, press it again.** That's the whole thing — the
recording drops into the inbox and comes back as a tagged, summarized note
with the audio still playable inside. No buttons, no windows.

(No hotkey assigned? Run the same command from the palette. Any audio file
dropped in `00-Inbox` works too — including recordings made in the Obsidian
**mobile** app on the go.)

One requirement: transcription (speech → text) runs through **Gemini or
OpenAI**, so an API key for one of them must be set in Cortex's settings —
even in Claude Code mode, where it's used *only* for transcription. (Claude
has no audio API yet.)

<details>
<summary><strong>Power option: a system-wide dictation hotkey</strong></summary>

If you want push-to-talk capture from anywhere on your machine (not just
inside Obsidian), a dictation app that can "run a script with the
transcript" — like [Handy](https://handy.computer), free and offline — can
pipe transcripts straight into your inbox: point its external-script setting
at [`examples/dictation-capture.sh`](examples/dictation-capture.sh) and edit
the two variables at the top. Note that setting is usually all-or-nothing:
once on, the app stops typing transcripts into other apps.
</details>

### Record meetings (macOS)

Calls with other people need system-audio capture, which no Obsidian plugin
can do — so this one lives just outside the plugin: press **⌥M** when the
meeting starts, again when it ends, and a speaker-labeled transcript lands
in your inbox and comes out enriched. Fully local (free open-source recorder
plus on-device Whisper — no API key, nothing uploaded). One-time setup in
[`examples/meeting-capture/`](examples/meeting-capture/).

Want Cortex to use a specific tag — a client, a project? Add a file with
that name in **`20-Tags`** and it'll prefer it over inventing its own.

### Ask your vault questions

Command palette → **"Cortex: Query vault"** — ask in plain language ("what
did we decide about the Q3 roadmap?") and get a direct, cited answer saved
to `40-Queries`. Needs CLI execution mode.

## If something breaks

- **Nothing happened?** Command palette → "Cortex: Process inbox now" and
  watch for an error notification.
- **"Claude not found" (CLI mode)?** Run `which claude` in Terminal and
  paste the result into the **Claude CLI path** field in Obsidian's Cortex
  settings.
- **Logs**: `.cortex/pipeline.log` (hidden file in your vault) records every
  run and error.

## Good to know

- **Obsidian must be open** — captures wait in `00-Inbox` until it is, then
  get processed.
- **CLI mode is desktop-only**; use Direct API key mode on mobile.
- **One image, PDF, or recording per note.** HEIC photos need macOS to
  convert; PDFs need Anthropic, Gemini, or CLI mode; audio needs a Gemini or
  OpenAI key for transcription.
- **API keys are stored in plain text** in your vault's settings file —
  keep the vault out of shared backups.
- **Privacy**: only your captured notes, tag names, and recent note titles
  are ever sent to the provider you chose. Local mode sends nothing
  anywhere. No telemetry, ever.

## For developers

```bash
npm install
npm run dev      # rebuild as you edit
npm run build    # typecheck + final main.js
npm test         # no live API/CLI calls
```

Core logic lives in `src/` with no Obsidian dependency (tested with Node's
test runner); `main.ts` wires it to the real app.

## License

MIT — see [LICENSE](LICENSE).
