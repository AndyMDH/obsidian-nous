# Tutorial: your first hour with Nous

The [README](../README.md) is a fast reference. [USAGE.md](USAGE.md) covers
every option in full detail. This page is different. It is a slow
walkthrough for your first time with Nous. It is for someone who has never
used Nous before.

## What Nous does

You give Nous something - typed text, a voice memo, a meeting transcript, a
photo, or a PDF. Within seconds, it comes back as a note: titled,
summarized, tagged, and linked to related notes you already have. You never
format or file anything yourself.

Nous manages four folders for you:

| Folder | What is in it |
|---|---|
| `00-Inbox` | A capture sits here for a moment before Nous processes it. |
| `10-Notes` | Finished notes. You read things here. |
| `20-Tags` | One file per tag. Tags become clickable in your graph. |
| `30-Wikis` | Hub pages. Nous writes one once a topic has enough notes. |

You will look at `10-Notes` most often, and `30-Wikis` sometimes. Nous runs
the rest on its own.

## Step 1: install Nous and go through the wizard

1. Open Settings, then Community plugins. Turn on community plugins.
2. Click Browse. Search for "Nous." Click Install, then click Enable.
3. A setup wizard opens on its own. Pick how Nous writes your notes:
   - **Claude subscription.** Free, if you already pay for Claude Pro or
     Max and have [Claude Code](https://docs.claude.com/claude-code)
     installed.
   - **A local model**, for example [Ollama](https://ollama.com). Free.
     Takes about two minutes. Nothing leaves your machine.
   - **An API key.** Anthropic, OpenAI, Gemini, or Z.ai. Billed
     separately. Note: "Nous: Query vault" needs the Claude subscription
     path. It does not work in API-key mode.
4. The wizard checks your choice, then offers voice and meeting setup. It
   drops a sample note in your inbox, so you can watch the whole process
   once.

<p align="center">
  <img alt="Obsidian's settings window: Nous in the left sidebar under Community plugins, with Execution mode, Provider, and Model settings in the main pane." src="../assets/settings-nav.svg">
</p>

To skip the sample note, or to redo setup later, open the command palette
(`Cmd` or `Ctrl+P`) and run **"Nous: Open setup wizard."**

## Step 2: your first capture

This step needs no setup. It is a good first test.

1. Right-click `00-Inbox` in the file explorer. Click New note.
2. Type a sentence or two. For example: "Testing Nous - this should become
   a real note in a few seconds."
3. Wait a few seconds. Open `10-Notes`. A new file is there: a real title
   (not "Testing Nous"), a short summary, one to four tags, and your
   original text underneath.

If that worked, Nous is set up correctly. The rest of this page shows other
ways to capture.

## Step 3: what just happened

This is worth understanding once. Then it stops feeling like magic.

1. Your text landed in `00-Inbox`.
2. Nous watches that folder while Obsidian is open. It found your new file
   and read it.
3. Nous summarized your text and added tags from your existing tag list.
   Nous rarely invents a new tag.
4. Nous checked your recent notes for anything related, and linked to it.
5. Nous wrote the finished note into `10-Notes`. Your original text stays,
   added under the summary.

Once a tag has four or more notes, Nous writes a wiki page for it in
`30-Wikis`. This happens on its own. You never trigger it.

<p align="center">
  <img alt="Capture anything into 00-Inbox; Nous turns it into a tagged, linked note in 10-Notes; topics with 4+ notes get a wiki page in 30-Wikis." src="../assets/pipeline.svg">
</p>

## Step 4: your first voice note

Voice notes need speech-to-text first. On macOS, open the command palette
and run "Nous: Open setup wizard." Click Install on the voice notes step.
This needs two clicks and no Terminal command. Or add a Gemini or OpenAI
key instead - this needs no install. If neither is ready, Nous shows a
setup message and does not start recording.

1. Click the mic icon in Obsidian's left sidebar.
2. Talk for a few seconds.
3. Click the mic icon again to stop.
4. Open `10-Notes` in a few seconds, same as before. The note now has your
   recording inside it, and you can play it back.

<p align="center">
  <img alt="Click the mic or phone icon to start recording, talk, click it again to stop — a tagged note with the audio or transcript inside lands in your inbox." src="../assets/demo.svg">
</p>

Step 6 below uses the same click-to-start, click-to-stop pattern for
meetings. Use the phone icon instead of the mic icon.

Want to see the words appear while you talk, instead of only after you
stop? Go to Settings → Nous. Turn on Advanced settings. Add an OpenAI API
key. Turn on Live voice transcription (beta). This feature is optional and
off by default. It needs an OpenAI key and a desktop computer. The plain
version above works everywhere, with no extra setup.

## Step 5: photos, PDFs, and pasted meeting transcripts

- **Photo or screenshot.** Drop a `.png`, `.jpg`, `.webp`, or `.heic` file
  into `00-Inbox`.
- **PDF.** Same - drop it into `00-Inbox`.
- **A transcript you already have**, for example from Teams, Zoom, or
  Granola. Paste it into a new note in `00-Inbox`, same as Step 2. Nous
  treats it the same as a recorded meeting.

## Step 6: recording an actual meeting (macOS)

This needs a small one-time setup. Capturing both sides of a call needs a
real macOS recording permission. Obsidian's own mic recorder cannot do
this alone, so Nous uses a small helper program instead.

1. If the wizard says the native recorder is missing, click Install. Nous
   downloads the recorder, checks it, and stores it in this vault.
2. After that, click the phone icon when a call starts. Click it again
   when the call ends.

When recording starts, Nous opens a live note with a Meeting notes
section. Type anything there during the meeting - questions, decisions, or
reminders. Checkboxes (`- [ ]`) work too, if you want a list to check off.

This works for calls and for in-person meetings. When you stop, Nous adds
the transcript to that same note and enriches it, the same as any other
capture.

If speech-to-text is not ready, Nous still saves the recording. It leaves
a note in `00-Inbox` that says the meeting needs transcription, with your
typed notes still inside. Finish voice setup later from the wizard, or add
a Gemini or OpenAI key. Then run "Nous: Process inbox now" from the
command palette. Nous finishes that saved recording.

## Where to go from here

- Something not behaving? [USAGE.md](USAGE.md#if-something-breaks) has
  real troubleshooting steps.
- Want the full list of settings, hotkeys, and every capture method?
  [USAGE.md](USAGE.md) is the complete reference.
- Curious how the pipeline works? Read
  [ARCHITECTURE.md](ARCHITECTURE.md) and [TECHNICAL.md](TECHNICAL.md).
