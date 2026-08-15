<p align="center">
  <img src="assets/logo.svg" alt="Nous logo — a rounded lowercase n with a tangerine thought-spark" width="112">
</p>

<h1 align="center">Nous</h1>

<p align="center">
  <em>Nous</em> — Greek <em>νοῦς</em>, "mind." Capture anything. Get a tagged,
  linked knowledge graph back — automatically.
</p>

<p align="center">
  Most similar tools make you trigger tagging, linking, or wiki-building by
  hand, one step at a time. Nous runs the whole pipeline live in the
  background as you capture — tagging, linking, and synthesizing a
  self-updating wiki page once a topic earns one, no command to run.
</p>

<p align="center">
  <a href="https://obsidian.md/plugins?id=nous"><img alt="Get it from Obsidian" src="https://img.shields.io/badge/Obsidian-Get%20the%20plugin-EB6C36?logo=obsidian&logoColor=white"></a>
  <!-- TODO: swap back to the dynamic downloads badge once "nous" has an
       entry in obsidianmd/obsidian-releases community-plugin-stats.json -
       it doesn't yet, so the dynamic query badge renders broken. -->
  <img alt="New Obsidian plugin" src="https://img.shields.io/badge/Obsidian-new%20plugin-EB6C36?logo=obsidian&logoColor=white">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-EB6C36"></a>
  <a href="https://github.com/AndyMDH/obsidian-nous/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/AndyMDH/obsidian-nous?color=EB6C36&label=version"></a>
  <a href="https://github.com/AndyMDH/obsidian-nous/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/AndyMDH/obsidian-nous/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Last commit" src="https://img.shields.io/github/last-commit/AndyMDH/obsidian-nous?color=EB6C36">
</p>

<p align="center">
  <img alt="Animated demo of one capture cycle: a live note opens while recording, the user types a question under Meeting notes, the transcript fills in as a Me/Them dialogue on stop, and the note comes back tagged and linked." src="assets/demo.svg">
</p>

Nous turns each capture — a typed thought, a voice memo, a call, a photo, a
PDF — into a summarized note, tagged from a controlled vocabulary and linked
to related notes. When a topic has enough notes, Nous writes a self-updating
wiki page that collects them. And it is local-first: Claude Code CLI, local
whisper.cpp, and Ollama send nothing off your machine — direct API keys are
opt-in.

**Works on:** Desktop (macOS, Windows, Linux) and Mobile (API-key or local-model
mode). Meeting capture is macOS-only. Live voice transcription (beta) is
desktop-only.

## Your vault as AI context

A Nous vault is not only for reading back. Real tags and linked wikis are
great context for AI coding assistants - much better than a pile of raw
notes. Add one line to Claude Code's global `~/.claude/CLAUDE.md`, for
example "My notes live in `~/path/to/vault` - check
`10-Notes`/`20-Tags`/`30-Wikis` for background". Then every project gets
that context automatically, with no extra setup.

The reasoning behind this vault structure is in
[Personal RAG Without the Drag](https://xebia.com/blog/personal-rag-without-the-drag/) -
why agentic search over an organized vault beats embedding pipelines for
personal notes.

## Install

1. In Obsidian, open **Settings → Community plugins**. Turn community plugins on.
2. Click **Browse** and search for **"Nous"**. Click **Install**, then **Enable**.

Or open [Nous's page on Obsidian's site](https://obsidian.md/plugins?id=nous) directly.

## Quickstart

**1. Enable Nous** — a setup wizard opens automatically. Choose how Nous
writes notes: a Claude subscription, a free local model, or an API key. Then
the wizard checks the optional voice and meeting setup.

<p align="center">
  <img alt="Obsidian's settings window: Nous in the left sidebar under Community plugins, with Execution mode, Provider, and Model settings in the main pane." src="assets/settings-nav.svg">
</p>

**2. Capture something.** There are four ways in, all in the left sidebar.
The 🎙️ and 📞 buttons toggle: click to start, talk, then click again to stop.
Each action is also a real Obsidian command - open **Settings → Hotkeys**,
search for "Nous", and bind the ones that you use often.

| | | |
|---|---|---|
| ➕ | Type, paste, or attach a file | command palette → "Nous: Quick capture" |
| 🎙️ | Voice note | click the mic |
| 📞 | Meeting (macOS) | click the phone - on a call or in person. A live note opens for your questions |
| 📥 | Anything else | drop it straight into `00-Inbox` |

*Dictate from anywhere (optional)*: a system-wide dictation app such as
[Handy](https://github.com/cjpais/Handy) can drop transcripts into the inbox
when Obsidian is closed - see the [usage docs](docs/USAGE.md) for the
one-line capture script.

**3. That is all.** Within seconds, Nous tags, summarizes, and links your
capture in **`10-Notes`**. The original text, image, or recording stays
inside the note. When a topic has 4 or more notes, Nous writes a wiki page
for it in **`30-Wikis`**. Obsidian must be open for this to run - new
captures wait in `00-Inbox` until you open it.

*Do you already have a vault structure?* The folder names
(`00-Inbox`/`10-Notes`/`20-Tags`/`30-Wikis`) are only defaults. You can
change each one in Settings → Nous.

## How it works, briefly

<p align="center">
  <img alt="Capture anything into 00-Inbox; Nous turns it into a tagged, linked note in 10-Notes; topics with 4+ notes get a wiki page in 30-Wikis." src="assets/pipeline.svg">
</p>

- **Voice transcription has two paths.** With a Gemini or OpenAI key, there
  is nothing to install - the key is used only for speech-to-text. For the
  fully private path, [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
  runs on your Mac and your voice never leaves it: setup downloads the
  speech model in one click, and `brew install whisper-cpp` is the one
  terminal command in the whole product.
- **The native `nous-recorder` helper records meetings on macOS** (setup
  installs it). When the recording starts, Nous opens a live note for your
  questions. When you stop, an online call becomes a `Me:`/`Them:`
  dialogue; an in-person meeting becomes one unlabeled room transcript.
  Details are in the [usage docs](docs/USAGE.md).
- **Privacy**: Nous sends only your captured notes and tag names to the
  provider that you chose. Local mode sends nothing anywhere. There is no
  telemetry.
- **Limitations**: a group call shows all other participants as one
  `Them:` speaker. Mic capture needs macOS 15 or later. Live voice
  transcription (beta) needs an OpenAI key and desktop.

Full pipeline detail → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Documentation

| | |
|---|---|
| [`docs/TUTORIAL.md`](docs/TUTORIAL.md) | A slow, step-by-step walkthrough of your first hour with Nous. |
| [`docs/USAGE.md`](docs/USAGE.md) | Every provider, hotkey, and troubleshooting step. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The conceptual model — layers, data flow, design principles. |
| [`docs/TECHNICAL.md`](docs/TECHNICAL.md) | Code map and implementation detail, for contributors. |

[Obsidian LLM Wiki](https://github.com/green-dalii/obsidian-llm-wiki) lists
Nous as a companion plugin for local voice and meeting capture - the two
plugins are independent and can share a vault.

## For developers

```bash
npm install && npm run build && npm test
npm run build:recorder
npm run build:recorder:universal && npm run package:recorder
```

Core logic lives in `src/` and has no Obsidian dependency. `main.ts`
connects it to the app. The native macOS meeting helper lives in
`native/nous-recorder/`.

## License

MIT — see [LICENSE](LICENSE).
