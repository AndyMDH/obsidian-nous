# Cortex

Turn things you dictate or paste into Obsidian — meeting notes, ideas, stray
thoughts — into a linked, tagged knowledge graph, automatically. Capture a
note, and Cortex tags it, summarizes it, and links it to related notes for
you. Once a topic has enough notes behind it, Cortex writes a summary page
for that topic too, so your vault turns into something you can actually
browse later instead of a pile of unread captures.

Everything happens inside Obsidian. No separate app to run, no terminal
required day to day.

## What you need before installing

You don't need to know how to code to use Cortex. You need:

- **Obsidian** (free, [obsidian.md](https://obsidian.md))
- One of these:
  - **A Claude subscription** (Claude Pro or Max) — also needs
    [Claude Code](https://docs.claude.com/claude-code) installed (a one-time
    terminal step, just following that page's instructions — no coding).
  - **An API key** instead, billed separately, from whichever you already
    have: Anthropic, OpenAI, or Gemini.
  - **A local model** (e.g. via [Ollama](https://ollama.com)) — no API key,
    no billing, nothing ever leaves this machine.

## Installing Cortex

1. Open Obsidian, go to **Settings → Community plugins**, and make sure
   community plugins are turned on.
2. Install a plugin called **BRAT** — search for "BRAT" in the Community
   plugins browser, click install, then enable it. BRAT is a tool that lets
   Obsidian install plugins (like Cortex) that aren't in the official
   directory yet.
3. Open BRAT's settings (or use the command palette — `Cmd/Ctrl+P` — and
   search "BRAT: Add a beta plugin").
4. Paste in: `AndyMDH/obsidian-cortex`, then confirm.
5. Go back to **Settings → Community plugins** and make sure **Cortex** is
   turned on.

That's it — no files to download by hand, no terminal for this part. BRAT
will also keep Cortex updated for you automatically.

## First-time setup

Open **Settings → Cortex** in Obsidian:

- **Execution mode**: choose "Claude Code CLI" if you have a Claude
  subscription and installed Claude Code above, or "Direct API key" for
  everything else.
- If you chose Direct API key, pick a **Provider** (Anthropic, OpenAI,
  Gemini, or Local) and fill in whatever it asks for — an API key, or a base
  URL if you picked Local.
- If you chose Claude Code and it's not being found automatically, see
  "Something not working?" below.

Everything else has a sensible default — you don't need to touch anything
else to start using it.

## How to use it day to day

Point your dictation tool's "run a script with the transcript" setting at
[`examples/dictation-capture.sh`](examples/dictation-capture.sh) (edit the two
variables at the top first — [Handy](https://handy.computer) calls this
Settings → Paste method → "External script"). Then:

1. Press your dictation hotkey, talk, press it again. The transcript lands
   in `00-Inbox` on its own — no need to open Obsidian at all.
2. Cortex picks it up within a few seconds once Obsidian's open — no button
   to press. Trigger it manually any time via the brain-circuit icon in the
   left sidebar, or the command palette → "Cortex: Process inbox now."
3. Check `10-Meetings` — tagged, summarized, your original text preserved
   underneath.
4. Once a topic has 4 or more notes behind it, Cortex writes a summary page
   for it in `20-Wikis`, pulling together everything captured about it so far.

No dictation tool with that option? Create a note by hand (`Cmd/Ctrl+N`) and
paste or type into it instead — same result, one extra step.

One thing to know: the external-script setting is usually all-or-nothing for
the dictation tool, not per-hotkey — turning it on means that tool stops
typing transcribed text into other apps, since transcription now goes to the
script instead. Skip it if you use that hotkey for other apps too.

Tags come from the `30-Tags` folder — one file per tag. Add a file there for
any tag you want Cortex to use (a client or project name, say), and Cortex
will prefer it over inventing something more generic.

### Photos and screenshots

Drop a `.png`, `.jpg`/`.jpeg`, or `.webp` file into `00-Inbox` (a whiteboard
photo, a screenshot) and Cortex enriches it the same way — tagged, summarized,
with the image itself embedded in the resulting note instead of a transcript.

A few things to know:
- Not HEIC or GIF — inconsistent support across providers' vision APIs, no
  conversion step. (iOS's Share sheet commonly re-encodes to JPEG anyway, so
  this bites less often than it sounds.)
- No resizing — a full-resolution phone photo can fail specifically on
  Anthropic (its practical cap is ~5MB) while working fine on OpenAI/Gemini.
  Downscale it first if that happens.
- One image per note. Multiple images in one capture isn't supported yet.
- If you're on Direct API key mode with the Local provider, check your
  model actually supports vision — a text-only local model (Ollama's default
  `llama3.1`, for example) will just error out on an image.

## Something not working?

- **Nothing happens after capturing a note**: open the command palette and
  run "Cortex: Process inbox now" to trigger it manually and see if an
  error notification appears.
- **"Claude not found" or similar, in CLI mode**: Obsidian sometimes can't
  find the `claude` program even though it works fine in your terminal.
  Open a terminal, type `which claude`, and paste whatever path it gives
  you into the **Claude CLI path** field in Settings → Cortex.
- **Check the log**: your vault has a hidden `.cortex/pipeline.log` file
  recording every note Cortex has processed and any errors — useful if
  something seems off.

## Privacy & permissions

- **Remote service used**: in CLI mode, the Anthropic API, called by the
  Claude Code program, not the plugin directly. In Direct API key mode,
  whichever provider you picked (Anthropic, OpenAI, or Gemini) — called by
  the plugin directly. **Local mode makes no remote call at all**: the
  request goes to a model running on this machine (or wherever your base URL
  points), nothing leaves it. Whenever a remote call is made, the only data
  sent is the content of your captured notes, plus your tag names and a short
  list of recent note titles (used for tagging and duplicate detection) —
  nothing else in your vault is transmitted.
- **File access outside the vault**: none. Cortex only reads and writes
  files inside the current vault.
- **Local program execution**: in CLI mode, Cortex runs the `claude`
  program you installed yourself, scoped to your vault's folder, so it can
  read and write your notes without asking for confirmation on every single
  file. No other program is ever run. API mode doesn't run any program at
  all.
- **Telemetry**: none, ever.

## A few honest limitations

- **Obsidian has to be open** to catch a new capture. If Obsidian is
  closed, nothing runs until you open it again — at which point it catches
  up on anything it missed.
- **CLI mode only works on desktop**, not the mobile app, and needs Claude
  Code installed separately. If you want this to work on your phone too,
  use the "Direct API key" mode instead.
- **The API key (if you use one) is stored as plain text** inside your
  vault's settings file. Keep your vault out of any shared or public
  backup you don't fully control.
- **CLI mode is more thorough than API mode.** CLI mode lets Claude re-read
  files and double-check itself while working; API mode asks for one
  response per note in a single pass. Both work well for normal notes — CLI
  mode has more room to get a tricky or ambiguous one right.
- **Non-Anthropic providers vary in reliability.** Every provider is asked to
  return one structured tool call per note; smaller or local models are more
  likely to produce something Cortex can't parse, in which case the note is
  left in `00-Inbox` and logged as an error rather than guessed at.

## For developers

The rest of this section is only relevant if you want to modify Cortex's
code — not needed to use the plugin.

```bash
npm install
npm run dev      # rebuild automatically as you edit
npm run build    # typecheck + produce the final main.js
npm test         # run the test suite (no live API/CLI calls made)
```

The core logic lives in `src/` and has no dependency on Obsidian itself, so
it's tested directly with Node's built-in test runner. `main.ts` connects
that logic to the real Obsidian app — the settings panel, reading/writing
vault files, and (in CLI mode) running the `claude` program — and can only
be tried out inside a real Obsidian install.

## License

MIT — see [LICENSE](LICENSE).
