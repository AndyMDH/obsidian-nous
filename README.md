<p align="center">
  <img src="assets/logo.svg" alt="Nous logo — a clip-n: a lowercase n whose right leg bends back up like paperclip wire, light on a moss squircle" width="112">
</p>

<h1 align="center">Nous</h1>

<p align="center">
  <em>Nous</em> — Greek <em>νοῦς</em>, "mind." Capture anything. Get tagged,
  linked notes back. You run no command.
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

Nous turns anything you capture into a tagged note. A capture can be a
thought, a voice memo, a call, a photo, or a PDF. Nous links each new note
to related notes on its own. Once a topic has enough notes, Nous writes a
wiki page for it and keeps that page current.

Nous keeps your data on your machine by default. It works with the Claude
Code app, local speech-to-text, or Ollama. An API key is optional.

**Works on:** Mac, Windows, and Linux computers. Meeting capture needs a
Mac.

## Contents

- [Get started](#get-started)
- [Features](#features)
- [How it works](#how-it-works)
- [Documentation](#documentation)
- [For developers](#for-developers)
- [License](#license)

## Get started

Just go through the wizard. It walks you through every step below.

**1. Install Nous.**

1. Open Obsidian.
2. Go to Settings, then Community plugins.
3. Turn on community plugins.
4. Click Browse.
5. Search for "Nous."
6. Click Install, then click Enable.

**2. Go through the wizard.**

A wizard opens on its own. Follow it, screen by screen.

1. Pick how Nous writes your notes. Choose a Claude subscription, an API
   key, or a free local model.
2. The wizard offers two more setups: voice notes and meeting capture.
   Each needs one click to install. You can skip both for now and finish
   them later, in Settings → Nous.

<p align="center">
  <img alt="The Nous setup wizard's welcome screen, with mode cards for a Claude subscription, an API key or local model, and importing from Notion." src="assets/wizard-welcome.png" width="320">
</p>

**3. Capture something.**

- Click the microphone icon for a voice note.
- Click the phone icon for a meeting. Mac only.
- Drop any other file into the `00-Inbox` folder.

**4. Check your note.**

Wait a few seconds. Open the `10-Notes` folder. Your new note is there,
tagged and linked to related notes.

*Note: Obsidian must stay open for Nous to work. If Obsidian is closed, a
new capture waits in `00-Inbox` until you open it again.*

## Features

| | | |
|---|---|---|
| 🎙️ | **Capture anything** | Type, paste, drop a file, or record a voice note or a meeting. Meeting capture is Mac only. |
| 🏷️ | **Automatic tags** | Every capture gets tags from a fixed list. You sort nothing by hand. |
| 🔗 | **Automatic links** | Related notes connect to each other on their own. |
| 📖 | **Self-updating wikis** | Once a topic has enough notes, Nous writes and keeps a wiki page for it. |
| 🔒 | **Local-first** | The Claude Code app, local speech-to-text, and Ollama keep data on your machine. An API key is optional. |
| 🎨 | **A clean look, on by default** | A clean header and a folded transcript replace the raw properties list. See [the Nous look](docs/USAGE.md#the-nous-look). |
| 🧠 | **Your vault as AI context** | Point Claude Code at your vault. Every project then knows about your tagged notes, for free. [Why this works](https://xebia.com/blog/personal-rag-without-the-drag/). |

## How it works

<p align="center">
  <img alt="Capture anything into 00-Inbox; Nous turns it into a tagged, linked note in 10-Notes; topics with 4+ notes get a wiki page in 30-Wikis." src="assets/pipeline.svg">
</p>

- **Voice notes** turn to text in one of two ways. With a Gemini or OpenAI
  key, Nous needs no extra install. Without a key,
  [whisper.cpp](https://github.com/ggml-org/whisper.cpp) does the work on
  your Mac instead, and your voice never leaves your computer. This way
  needs a two-click install.
- **Meeting capture** uses a small helper program, `nous-recorder`. It
  needs one click to install. A live note opens while Nous records. When
  you stop, an online call becomes a `Me:`/`Them:` dialogue. An in-person
  meeting becomes one plain transcript.
- **Privacy.** Nous sends only your captured notes and tag names to the
  provider you picked. Local mode sends nothing anywhere. Nous collects no
  usage data.
- **Limits.** In a group call, Nous shows every other speaker as one
  `Them:` voice. Meeting capture needs macOS 15 or later. Live voice
  transcription is a beta feature and needs an OpenAI key.

For more detail, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) or
[`docs/USAGE.md`](docs/USAGE.md).

## Documentation

| | |
|---|---|
| [`docs/TUTORIAL.md`](docs/TUTORIAL.md) | A slow, step-by-step walkthrough of your first hour with Nous. |
| [`docs/USAGE.md`](docs/USAGE.md) | Every provider, hotkey, and troubleshooting step. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The design behind Nous — layers, data flow, and choices. |
| [`docs/TECHNICAL.md`](docs/TECHNICAL.md) | A map of the code, for contributors. |

## For developers

```bash
npm install && npm run build && npm test
npm run build:recorder
npm run build:recorder:universal && npm run package:recorder
```

Core logic lives in `src/` and needs no Obsidian dependency. `main.ts`
connects it to the app. The native Mac meeting helper lives in
`native/nous-recorder/`.

## License

MIT — see [LICENSE](LICENSE).
