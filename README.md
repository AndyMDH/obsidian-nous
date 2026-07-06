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
- Either of these:
  - **A Claude subscription** (Claude Pro or Max) — also needs
    [Claude Code](https://docs.claude.com/claude-code) installed (a one-time
    terminal step, just following that page's instructions — no coding).
  - **An Anthropic API key** instead, billed separately — get one at
    [console.anthropic.com](https://console.anthropic.com/settings/keys).

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
  subscription and installed Claude Code above, or "Direct API key" if
  you're using an API key instead.
- If you chose the API key option, paste your key into the **Anthropic API
  key** field.
- If you chose Claude Code and it's not being found automatically, see
  "Something not working?" below.

Everything else has a sensible default — you don't need to touch anything
else to start using it.

## How to use it day to day

1. Get a note into the `00-Inbox` folder, either:
   - **Manually**: create a new note in Obsidian (`Cmd/Ctrl+N`) and dictate
     or paste whatever you want captured — a meeting, a thought, anything.
     New notes land in `00-Inbox` automatically.
   - **Fully hands-free** (optional, see below): a dictation tool writes the
     note for you, with no need to open Obsidian at all.
2. Within a few seconds (or the next time you open Obsidian), Cortex picks
   it up on its own — no button to press. You can also trigger it manually
   any time via the brain-circuit icon in the left sidebar, or the command
   palette → "Cortex: Process inbox now."
3. Check the `10-Meetings` folder — your note will show up there, tagged
   and summarized, with your original text preserved underneath.
4. Once a topic has 4 or more notes behind it, Cortex automatically writes
   a summary page for that topic in `20-Wikis` — a single page that pulls
   together everything you've captured about it so far.

Your tags come from the `30-Tags` folder — one file per tag. Add a file
there for any tag you want Cortex to be able to use (for example, a client
or project name), and Cortex will start using it going forward instead of
falling back to something more generic.

### Fully hands-free capture (optional)

If your dictation tool supports running a custom script with the transcript
(check its settings for something like "paste method" or "output" → "run a
script" / "external script") — [Handy](https://handy.computer) does, under
Settings → Paste method → "External script" — you can skip Obsidian
entirely: press your dictation hotkey, talk, press it again, and the
transcript lands straight in `00-Inbox` on its own. Cortex picks it up the
same way either way.

[`examples/dictation-capture.sh`](examples/dictation-capture.sh) is a small
script for this: edit the `VAULT` and `INBOX_FOLDER` variables at the top to
match your vault and Cortex's "Inbox folder" setting, point your dictation
tool's external-script option at it, and you're done.

One thing to know: this is usually an all-or-nothing setting for the
dictation tool, not per-hotkey — turning it on means that tool stops typing
transcribed text into other apps, since every transcription now goes to the
script instead. Fine if you want a dictation hotkey dedicated to capture;
skip this section if you use that hotkey for other apps too.

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

- **Remote service used**: the [Anthropic API](https://www.anthropic.com/).
  In CLI mode this call is made by the Claude Code program, not the plugin
  directly; in API mode the plugin calls it directly. Either way, the only
  data sent is the content of your captured notes, plus your tag names and
  a short list of recent note titles (used for tagging and duplicate
  detection) — nothing else in your vault is transmitted.
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
