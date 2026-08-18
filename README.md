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
thought, a voice memo, a call, a photo, or a PDF.

Nous can write your notes through the Claude Code app, a direct API key, or
a free local model in Ollama. Only local speech-to-text and Ollama keep
your notes on your machine. The Claude Code app and a direct API key both
send your notes to that provider.

Tags and links turn scattered captures into one connected picture, with no
manual sorting. A tag groups every note on the same topic. A link connects
a note to the notes near it, so you can trace an idea across time. Once a
topic has enough notes, Nous writes one wiki page that pulls them together,
and keeps it current as you capture more.

Notes get a clean, editorial look by default - see
[the Nous look](docs/USAGE.md#the-nous-look). You can also point Claude
Code at your vault, so every coding project gets your tagged notes as
background context, for free -
[why this works](https://xebia.com/blog/personal-rag-without-the-drag/).

**Works on:** Mac, Windows, and Linux computers. Meeting capture needs a
Mac.

## Contents

- [Get started](#get-started)
- [How it works](#how-it-works)
- [Documentation](#documentation)
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

## Documentation

Install and Tutorial links are at the top of this page. Two more docs go
deeper:

| | |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The design behind Nous — layers, data flow, and choices. |
| [`docs/TECHNICAL.md`](docs/TECHNICAL.md) | A map of the code, for contributors. |

For build commands and the release process, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
