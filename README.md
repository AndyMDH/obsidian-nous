# Cortex (Obsidian plugin)

The native Obsidian version of [Cortex](https://github.com/AndyMDH/cortex): turns
dictated or pasted notes into a linked, tagged knowledge graph, right inside
Obsidian. Everything lives in one settings panel - no terminal required to
use it day to day.

Same folder layout and note schema as the original bash-based Cortex
(`00-Inbox` → `10-Meetings` → `20-Wikis`, `30-Tags` as a tag registry), so an
existing Cortex vault can adopt this plugin without migrating any data.

## Two execution modes

Pick whichever matches how you pay for Claude - switch any time in Settings → Cortex.

- **Claude Code CLI (default)** - shells out to `claude -p`, using whatever
  auth Claude Code already has, subscription or API key. No separate billing.
  The plugin writes the same `SKILL.md` prompts the bash version uses into
  your vault's `.claude/skills/` folder and lets Claude Code's own agentic
  Read/Write/Bash loop do the work - same robustness as the original, just
  triggered from inside Obsidian instead of a terminal or `launchd`. Desktop
  only, and requires [Claude Code](https://docs.claude.com/claude-code)
  installed and authenticated.
- **Direct API key** - the plugin calls the Anthropic API itself, no CLI
  involved. Works on mobile too, and reacts within seconds of a capture
  instead of needing a full inbox scan. Requires a separate
  [Anthropic API key](https://console.anthropic.com/settings/keys), billed
  per token - **not** the same thing as a Claude Pro/Max subscription or an
  existing Claude Code login, and not covered by either.

If you already have Claude Code set up for the bash version of Cortex, CLI
mode is very likely what you want - same cost as what you're already paying.

## Privacy & permissions

Disclosed up front, per Obsidian's developer policy:

- **Remote service used**: the [Anthropic API](https://www.anthropic.com/) (`api.anthropic.com`).
  In CLI mode this call is made by the Claude Code CLI, not the plugin
  itself; in API mode the plugin calls it directly. Either way, the only
  data sent is the content of your captured notes (plus tag names and a
  short index of recent note titles/snippets, for tagging and duplicate
  detection) - nothing else in your vault is transmitted.
- **File access outside the vault**: none. The plugin only reads/writes
  files inside the current vault.
- **Local process execution**: CLI mode spawns the `claude` CLI (a separate
  program you installed yourself) as a child process, scoped to your vault's
  folder, using the `--allowedTools Read,Write,Edit,Glob,Grep,Bash` and
  `--permission-mode acceptEdits` flags so it can read/write your notes
  without an interactive confirmation prompt per file. No other command is
  ever executed. API mode does not spawn any process.
- **Telemetry**: none, client- or server-side.

## Requirements

- Obsidian
- CLI mode: [Claude Code](https://docs.claude.com/claude-code), installed and
  authenticated, on desktop
- API mode: an [Anthropic API key](https://console.anthropic.com/settings/keys)

## Install

Not on the Community Plugins list. Two options:

**BRAT (recommended)** - install the [BRAT](https://github.com/TfTHacker/obsidian42-brat)
community plugin, then "Add beta plugin" → `AndyMDH/obsidian-cortex`. BRAT
handles updates for you.

**Manual** - download `main.js`, `manifest.json`, and `styles.css` (if
present) from the [latest release](https://github.com/AndyMDH/obsidian-cortex/releases),
and copy them into `<vault>/.obsidian/plugins/cortex/`. Then enable "Cortex"
in Settings → Community plugins.

After enabling, open Settings → Cortex to pick a mode and (for CLI mode) confirm
the `claude` CLI path, or (for API mode) paste in your API key.

## How it works

```
dictate/paste -> 00-Inbox/ -> enrich -> 10-Meetings/ -> wiki-builder -> 20-Wikis/
```

- **Enrichment**: a new note in `00-Inbox/` gets tagged (from your controlled
  registry in `30-Tags/`, so no tag sprawl), summarized into Summary/Key
  points/Decisions/Action items, and linked to related notes - your raw text
  is always preserved verbatim underneath, never regenerated.
- **Wikis**: once a tag has enough non-fragment notes behind it (default: 4),
  a synthesized narrative wiki page appears in `20-Wikis/`, and every source
  note gets a backlink to it - turning what would be a hairball of
  meeting-to-meeting links into a readable hub-and-spoke graph.
- **Trigger**: CLI mode reacts to new captures via a full inbox scan (near
  the capture, and every time Obsidian starts, to catch anything missed while
  it was closed); API mode reacts within seconds of a single new file. Manual
  trigger any time either way: ribbon icon, or command palette → "Cortex:
  Process inbox now" / "Cortex: Build/update wikis now".
- A `.cortex/pipeline.log` file in your vault logs every enrichment,
  duplicate, new tag, and wiki event in both modes, so you can see what
  happened without re-reading every note.

## Settings

Execution mode, wiki threshold, auto-process on capture (on/off), and the
four folder paths apply to both modes. CLI mode additionally has the Claude
CLI path; API mode additionally has the API key, model, and duplicate-check
lookback (how many recent notes to compare new captures against).

## Limitations, honestly

- **Obsidian has to be running** to catch a new capture, in either mode.
  There's no background daemon like the bash version's `launchd` job - the
  startup catch-up scan is the safety net, not a guarantee of same-day
  processing if Obsidian stays closed.
- **CLI mode is desktop only** and needs Claude Code installed separately -
  it's a thinner wrapper around the same terminal tool, not a replacement
  for it. GUI apps like Obsidian often start with a slimmer `PATH` than your
  terminal, so if the plugin can't find `claude`, set the full path in
  settings (`which claude` in your terminal will tell you what to use).
- **API mode's key lives in plaintext** in this vault's
  `.obsidian/plugins/cortex/data.json`. Keep this vault out of any repo or
  sync you don't fully control.
- **API mode is a single structured call, not an agentic loop.** CLI mode
  lets Claude Code re-read files and self-correct across multiple tool calls,
  same as the bash version; API mode asks for one structured response per
  note. Good enough for straightforward captures, less room to recover on
  genuinely ambiguous ones.
- **API mode needs its own Anthropic API key, billed separately** from a
  Claude Pro/Max subscription or an existing Claude Code login.

## Development

```bash
npm install
npm run dev      # esbuild watch mode
npm run build    # typecheck + production bundle -> main.js
npm test         # unit tests for both execution modes (no live API/CLI calls)
```

The core logic (`src/`) has no dependency on the Obsidian runtime and is
unit-tested directly with Node's built-in test runner. `main.ts` wires that
logic to the actual `obsidian` API (vault I/O, settings UI, commands, and -
for CLI mode - spawning the `claude` process) and can only be exercised
inside a real Obsidian instance.

## License

MIT — see [LICENSE](LICENSE).
