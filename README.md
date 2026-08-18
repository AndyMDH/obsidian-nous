<p align="center">
  <img src="assets/logo.svg" alt="Nous logo — a clip-n: a lowercase n whose right leg bends back up like paperclip wire, light on a moss squircle" width="112">
</p>

<h1 align="center">Nous</h1>

<p align="center">
  <em>Nous</em> — Greek <em>νοῦς</em>, "mind." Capture anything. Get a tagged,
  linked knowledge graph back — automatically, with no command to run.
</p>

<p align="center">
  <a href="https://obsidian.md/plugins?id=nous">Install</a> ·
  <a href="docs/TUTORIAL.md">Tutorial</a> ·
  <a href="docs/USAGE.md">Docs</a> ·
  <a href="https://github.com/AndyMDH/obsidian-nous/issues">Issues</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://obsidian.md/plugins?id=nous"><img alt="Get it from Obsidian" src="https://img.shields.io/badge/Obsidian-Get%20the%20plugin-4C5138?logo=obsidian&logoColor=white"></a>
  <a href="https://obsidian.md/plugins?id=nous"><img alt="Obsidian downloads" src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=4C5138&label=downloads&query=%24%5B%27nous%27%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json"></a>
  <a href="https://github.com/AndyMDH/obsidian-nous/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/AndyMDH/obsidian-nous?color=4C5138&label=stars"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-4C5138"></a>
  <a href="https://github.com/AndyMDH/obsidian-nous/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/AndyMDH/obsidian-nous?color=4C5138&label=version"></a>
  <a href="https://github.com/AndyMDH/obsidian-nous/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/AndyMDH/obsidian-nous/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Last commit" src="https://img.shields.io/github/last-commit/AndyMDH/obsidian-nous?color=4C5138">
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-4C5138.svg"></a>
</p>

<p align="center">
  <img alt="Animated demo of one capture cycle: a live note opens while recording, the user types a question under Meeting notes, the transcript fills in as a Me/Them dialogue on stop, and the note comes back tagged and linked." src="assets/demo.svg">
</p>

Nous turns each capture — a thought, a voice memo, a call, a photo, a PDF —
into a tagged, linked note. Once a topic has enough notes, Nous writes it a
self-updating wiki page. Nous is local-first: Claude Code CLI, local
speech-to-text, and Ollama keep your data on your machine. A direct API key
is optional.

**Works on:** Desktop only (macOS, Windows, Linux). Meeting capture is
macOS-only.

## Contents

- [Features](#features)
- [Install](#install)
- [Quickstart](#quickstart)
- [How it works, briefly](#how-it-works-briefly)
- [Documentation](#documentation)
- [For developers](#for-developers)
- [License](#license)

## Features

| | | |
|---|---|---|
| 🎙️ | **Capture anything** | Type, paste, drop a file, or record a voice note or a meeting (macOS). |
| 🏷️ | **Automatic tags** | Every capture gets tags from a fixed list. You sort nothing by hand. |
| 🔗 | **Automatic links** | Related notes connect to each other on their own. |
| 📖 | **Self-updating wikis** | Once a topic has enough notes, Nous writes and keeps a wiki page for it. |
| 🔒 | **Local-first** | Claude Code CLI, local speech-to-text, and Ollama keep data on your machine. API keys are optional. |
| 🎨 | **An editorial look, on by default** | A clean header and a folded transcript replace the raw properties table - see [the Nous look](docs/USAGE.md#the-nous-look). |
| 🧠 | **Your vault as AI context** | Point Claude Code's `~/.claude/CLAUDE.md` at your vault, and every project gets your tagged notes as context, free. [Why this works](https://xebia.com/blog/personal-rag-without-the-drag/). |

## Install

1. In Obsidian, open **Settings → Community plugins**. Turn community plugins on.
2. Click **Browse**, search **"Nous"**, click **Install**, then **Enable**.

Or open [Nous's page on Obsidian's site](https://obsidian.md/plugins?id=nous) directly.

## Quickstart

**1. Enable Nous.** A setup wizard opens on its own. Pick how Nous writes
notes: a Claude subscription, an API key, or a free local model. Voice notes
and meeting capture are optional, each a one-click install - skip either for
now. Meeting capture installs later from Settings → Nous; voice notes finish
through "Rerun setup," in the same place.

<p align="center">
  <img alt="Obsidian's settings window: Nous in the left sidebar under Community plugins, with Execution mode, Provider, and Model settings in the main pane." src="assets/settings-nav.svg">
</p>

**2. Capture something.** Click 🎙️ for a voice note, 📞 for a meeting
(macOS), or drop anything else into `00-Inbox`. Each is also an Obsidian
command - bind one to a hotkey in **Settings → Hotkeys**, search "Nous".

**3. That is all.** Within seconds, Nous tags, summarizes, and links your
capture in `10-Notes`. Once a topic has 4 or more notes, Nous writes it a
wiki page in `30-Wikis`. Obsidian must stay open to run - new captures wait
in `00-Inbox` until you open it.

## How it works, briefly

<p align="center">
  <img alt="Capture anything into 00-Inbox; Nous turns it into a tagged, linked note in 10-Notes; topics with 4+ notes get a wiki page in 30-Wikis." src="assets/pipeline.svg">
</p>

- **Voice transcription** has two paths: a Gemini or OpenAI key (nothing to
  install), or fully private on-device [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
  (two-click install, your voice never leaves your Mac).
- **Meeting capture** uses the native `nous-recorder` helper (one-click
  install). A live note opens while it records. An online call becomes a
  `Me:`/`Them:` dialogue; an in-person meeting becomes one room transcript.
- **Privacy**: Nous sends only your captured notes and tag names to the
  provider you chose. Local mode sends nothing anywhere. No telemetry.
- **Limits**: a group call shows all other participants as one `Them:`
  speaker. Mic capture needs macOS 15+. Live voice transcription (beta)
  needs an OpenAI key.

Full detail → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`docs/USAGE.md`](docs/USAGE.md).

## Documentation

| | |
|---|---|
| [`docs/TUTORIAL.md`](docs/TUTORIAL.md) | A slow, step-by-step walkthrough of your first hour with Nous. |
| [`docs/USAGE.md`](docs/USAGE.md) | Every provider, hotkey, and troubleshooting step. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The conceptual model — layers, data flow, design principles. |
| [`docs/TECHNICAL.md`](docs/TECHNICAL.md) | Code map and implementation detail, for contributors. |

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
