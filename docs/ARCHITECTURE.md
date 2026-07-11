# Noggin Architecture

This document describes the high-level architecture of the Obsidian Noggin plugin: the conceptual layers, how data flows between them, and the design principles that keep the system predictable.

For the implementation details — file structure, build process, provider adapters, and test strategy — see [`TECHNICAL.md`](TECHNICAL.md).

## What Noggin is

Noggin turns unstructured captures into a structured, interlinked knowledge graph inside an Obsidian vault. A capture can be:

- a typed or pasted note,
- a voice memo,
- a photo or screenshot,
- a PDF,
- a meeting transcript.

The plugin does not store its own data structures outside Obsidian. Everything is represented as ordinary Markdown files, folders, wikilinks, and YAML frontmatter.

## Conceptual layers

Noggin is organized into five layers. Each layer is a folder in the vault, and each layer has a single responsibility.

```
┌─────────────────────────────────────────────────────────────┐
│  00-Inbox    →   10-Notes    →   30-Wikis                   │
│   capture          enrich         synthesize                  │
│     ↑                ↑                                        │
│  20-Tags        40-Queries                                    │
│  vocabulary       ask                                         │
└─────────────────────────────────────────────────────────────┘
```

| Layer | Folder | Responsibility |
|---|---|---|
| **Capture** | `00-Inbox` | Accept raw, unprocessed material. |
| **Enrich** | `10-Notes` | Turn raw captures into structured, tagged, linked notes. |
| **Organize** | `20-Tags` | Maintain the controlled tag vocabulary. |
| **Synthesize** | `30-Wikis` | Build hub pages for topics that have enough notes. |
| **Query** | `40-Queries` | Answer natural-language questions against the graph. |

The layers are strict: a file in `00-Inbox` is never a final note, a note in `10-Notes` is never a wiki, and a wiki never mutates its source notes.

## Layer-to-layer transitions

### 1. Capture → Enrich (`00-Inbox` → `10-Notes`)

A capture lands in `00-Inbox` by one of several paths:

- **Quick capture**: the user opens the quick-capture modal and types or attaches a file.
- **Voice capture**: the plugin records from the microphone and drops a WebM/M4A file in the inbox.
- **Manual drop**: the user creates a file in `00-Inbox` directly, or a dictation tool writes there.
- **Auto-process**: the plugin watches `create` events and enriches new inbox files after a short settle delay.

The enrich step reads the inbox file, classifies it, and produces a structured note. The output is always a Markdown file in `10-Notes` with this frontmatter:

```yaml
---
type: meeting        # or "note"
date: YYYY-MM-DD
title: <concise title>
attendees: [...]     # omitted for type: note
source: voice        # voice | pasted | photo | document
project: <project or "internal">
tags: [tag-a, tag-b]
status: enriched
enriched_at: <ISO 8601>
---
```

The body contains:

- `## Summary`
- `## Key points`
- `## Decisions` (if any)
- `## Action items` as checkboxes (if any)
- `## Transcript` (original text, verbatim) OR `## Captured image/document/audio` with an embed
- `## Related` (tag notes, related meeting notes, existing wikis)

For images and PDFs, the binary file is moved (not copied) into `10-Notes` next to the new Markdown file. The original inbox file is removed. For text notes, the original inbox file is deleted after its content is preserved under `## Transcript`.

**Concurrency guard**: the plugin tracks in-flight file paths so the same file is not enriched twice simultaneously.

**Idempotency guard**: if a file already has `status: enriched` in its frontmatter, it is skipped. This makes re-running the pipeline safe.

### 2. Enrich → Organize (`10-Notes` ↔ `20-Tags`)

Tags are not freeform. The model is given the current list of tag-note filenames from `20-Tags` and must choose from that list. A new tag is only created if it is justified by three rules:

1. No existing tag covers the concept, even loosely.
2. The concept is central to the note.
3. At least two plausible future notes could use the tag.

When a new tag is created, a Markdown file is written to `20-Tags/<tag>.md` with a simple template and a `type: tag` frontmatter. This file then becomes part of the controlled vocabulary for future enrichments.

This design prevents tag sprawl and keeps the graph navigable.

### 3. Enrich → Synthesize (`10-Notes` → `30-Wikis`)

After enrichment, the plugin clusters notes by tag. A tag becomes a wiki candidate when it has at least a configurable threshold of non-fragment notes (default: 4).

If no wiki exists for that topic, a new hub page is created:

```yaml
---
type: wiki
topic: <tag>
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: <count>
---
# <Topic>

## Current state
<synthesized narrative>

## Open questions
- ...

## Timeline
- YYYY-MM-DD - [[note title]] - one-line summary

## Sources
- [[note title]]
```

If a wiki already exists and new notes have been added since its `updated` date, the wiki is rewritten: `## Current state` is re-synthesized from scratch, `## Timeline` and `## Sources` are appended to (never truncated), and `updated` is bumped.

After a wiki is created or updated, the plugin walks every source note and adds `[[<Topic> Wiki]]` to its `## Related` section. Wiki filenames deliberately include a ` Wiki` suffix to avoid colliding with tag notes on case-insensitive filesystems.

**Fragment exclusion**: notes tagged `fragment` are enriched and moved to `10-Notes`, but they do not count toward wiki thresholds.

### 4. Every layer → Query (`40-Queries`)

The query layer is read-only. It answers natural-language questions by searching `30-Wikis`, `10-Notes`, and `20-Tags`, then writes the answer to `40-Queries/<timestamp> <question slug>.md` with citations as wikilinks.

This layer is currently only available in CLI execution mode because it requires open-ended search and synthesis rather than a fixed tool schema.

## Execution modes

The same layer model is implemented through two different execution engines.

### API mode

The plugin calls a remote or local LLM API directly.

- **Providers**: Anthropic, OpenAI, Gemini, or any OpenAI-compatible local server.
- **Model invocation**: one tool-call request per file or wiki topic.
- **Pros**: works on mobile (except Local), no external CLI dependency, deterministic prompts.
- **Cons**: requires an API key; audio transcription falls back to Gemini or OpenAI (even if enrichment uses another provider) whenever local whisper.cpp isn't installed.

### CLI mode

The plugin shells out to the `claude` CLI (Claude Code) and provides instructions via Markdown skill files written into `.claude/skills/`.

- **Skills**: `meeting-enricher`, `wiki-builder`, `vault-query`.
- **Model invocation**: Claude Code uses its own tools (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`) to act on the vault.
- **Pros**: reuses an existing Claude subscription, richer reasoning for complex tasks, no separate API billing.
- **Cons**: desktop-only; requires Claude Code installed and reachable from Obsidian's PATH.

Both modes produce the same folder structure and the same Markdown shape. The execution mode is a hidden implementation detail from the vault's perspective.

## Data flow diagram

```
User input
    │
    ├─► Quick capture / voice / drop / dictation tool
    │
    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 00-Inbox    │────▶│ Enrich step │────▶│ 10-Notes    │
│ (raw files) │     │ (classify,  │     │ (structured,│
└─────────────┘     │  summarize, │     │  tagged,    │
                    │  tag, link) │     │  linked)    │
                    └──────┬──────┘     └──────┬──────┘
                           │                     │
                           ▼                     ▼
                    ┌─────────────┐      ┌─────────────┐
                    │ 20-Tags     │      │ Wiki step   │
                    │ (controlled │      │ (cluster,   │
                    │  vocabulary)│      │  synthesize)│
                    └─────────────┘      └──────┬──────┘
                                                │
                                                ▼
                                         ┌─────────────┐
                                         │ 30-Wikis    │
                                         │ (hub pages) │
                                         └─────────────┘

┌─────────────┐
│ 40-Queries  │ ◄──── read-only search across 10-Notes, 20-Tags, 30-Wikis
└─────────────┘
```

## Key design principles

1. **Plain files, no hidden database.** Every artifact is a Markdown file with YAML frontmatter. You can edit, move, or delete anything with normal Obsidian tools.
2. **Controlled vocabulary.** Tags are governed by `20-Tags/*.md` files. The model must justify creating a new one.
3. **Single tool-call enrichment.** Each enrichment is one model round-trip with a forced tool response. There is no agentic loop for the core pipeline.
4. **Idempotency.** `status: enriched` and log-based summaries make repeated runs safe.
5. **Hub-and-spoke linking.** Tag notes and wiki pages are hubs; meeting notes are spokes. Wikilinks are the edges.
6. **Preserve source material.** The original transcript, image, PDF, or audio is always kept, either verbatim under `## Transcript` or as an embedded file in `10-Notes`.
7. **Execution-mode agnosticism.** The same folder schema and file shape result from both CLI and API modes.

## Privacy and security model

- In **API mode**, captures, tag names, and recent note titles are sent to the chosen provider.
- In **CLI mode**, the same data is processed by the Claude Code CLI under its own terms.
- In **Local mode**, nothing leaves the machine.
- API keys are stored in Obsidian's plugin data file (`data.json`) inside the vault, in plain text. Do not sync the vault to untrusted locations.
- No telemetry is collected by the plugin.
