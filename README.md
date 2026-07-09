# Cortex

Capture anything — a dictated thought, pasted meeting notes, a photo, a PDF —
and Cortex turns it into a tagged, linked knowledge graph inside Obsidian.
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

All settings live inside Obsidian (nothing to configure on your computer
itself). Open **Obsidian's settings** — the gear icon bottom-left, or
`Cmd/Ctrl+,` — and click **Cortex** in the left sidebar. One choice to make:

- **Claude subscription (Pro/Max)?** Set **Execution mode** to
  "Claude Code CLI". Done.
- **API key instead?** Set it to "Direct API key", pick your **Provider**,
  and paste your key (or your base URL, for a local model). Done.

Everything else has a sensible default.

## Use it

Drop anything into the **`00-Inbox`** folder:

- **Text** — type or paste a note (`Cmd/Ctrl+N`), or go hands-free by
  pointing your dictation app's "run a script" option at
  [`examples/dictation-capture.sh`](examples/dictation-capture.sh)
- **Photos & screenshots** — `.png`, `.jpg`, `.webp`, `.heic` (to auto-capture
  Mac screenshots, see [`examples/`](examples/))
- **PDFs**

Within seconds, Cortex tags it, summarizes it, links it to related notes,
and files it in **`10-Notes`** — your original text or image preserved
inside. Topics with 4+ notes get a wiki page in **`30-Wikis`** (or force one
anytime: command palette → "Cortex: Build/update wikis now").

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
- **One image or PDF per note.** HEIC photos need macOS to convert; PDFs
  need Anthropic, Gemini, or CLI mode.
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
