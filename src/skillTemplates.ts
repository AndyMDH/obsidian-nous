// CLI execution mode shells out to the Claude Code CLI and lets it do its own
// agentic Read/Write/Bash work, exactly like the original bash-based Cortex
// (github.com/AndyMDH/cortex). These are that project's two SKILL.md files,
// adapted so the plugin can write them into any vault's .claude/skills/
// folder itself - CLI mode doesn't depend on the bash repo being installed
// separately. Folder names are interpolated so they track this plugin's
// settings instead of being hardcoded to 00-Inbox/10-Meetings/etc.

import { IMAGE_EXTENSIONS } from "./logic.ts";

export interface SkillFolders {
	inbox: string;
	meetings: string;
	wikis: string;
	tags: string;
}

const IMAGE_EXTENSIONS_MD = IMAGE_EXTENSIONS.map((e) => `\`.${e}\``).join(", ");

export function meetingEnricherSkill(f: SkillFolders): string {
	return `---
name: meeting-enricher
description: Enrich raw meeting transcripts sitting in ${f.inbox}/ into structured, tagged, linked meeting notes in ${f.meetings}/. Use when asked to process, enrich, or clean up inbox transcripts.
---

# Meeting Enricher

Turns raw transcript dumps in \`${f.inbox}/\` into structured meeting notes in
\`${f.meetings}/\`, tagged from a controlled registry and linked into the graph.

Vault root is the current working directory. All paths below are relative to it.

## Scope

Process every \`.md\`, \`.txt\`, and image file (${IMAGE_EXTENSIONS_MD} - not
HEIC or GIF, unsupported) directly inside \`${f.inbox}/\` (not
\`${f.inbox}/duplicates/\`). Process files **one at a time, fully, before moving to
the next** — read, enrich, move, log, then proceed.

Skip a file if its frontmatter already contains \`status: enriched\` — it's
already been processed. This is the idempotency guard; it means it's always
safe to re-run this skill over an inbox that partially succeeded before. (Image
files never have frontmatter of their own, so this guard only applies once
they've already been turned into a note in \`${f.meetings}/\` - at that point the
original image is gone from \`${f.inbox}/\`, so there's nothing left to re-skip.)

## Step 0 — Duplicate check

Skip this step entirely for image files - two photos are essentially never an
exact duplicate of each other, and there's no transcript body to compare.

For text files: read the first ~200 characters of the inbox file's body
(ignore any frontmatter if present). Compare against the first ~200 characters
of the body of every note in \`${f.meetings}/\`. If it matches an existing note
closely enough that it's clearly the same transcript:

- Move the inbox file to \`${f.inbox}/duplicates/\` (create the folder if needed).
- Append to \`.cortex/pipeline.log\`:
  \`<ISO timestamp> DUPLICATE: <filename> matches <existing note> - moved to duplicates/\`
- Do not enrich it further. Move to the next inbox file.

## Step 1 — Classify

If the file is an image, use the Read tool to view it directly (Claude Code
can read image files, not just text) - do not attempt to read it as text.
Otherwise read the full transcript. Decide:

- **type**: \`meeting\` if it reads like (or shows, for an image - e.g. a
  whiteboard from a meeting) a conversation/discussion between people, \`note\`
  if it's a single-person idea, reflection, screenshot of an article, or
  fragment with no attendees/decisions/actions structure.
- **word count**: if the body is under ~50 words, this is a \`fragment\` regardless
  of type — it still gets frontmatter and moves to \`${f.meetings}/\`, but skip wiki
  eligibility (wiki-builder won't count it) and always include the \`fragment\`
  tag in addition to any other applicable tag(s). Images are never fragments
  purely for being an image - judge by how much content is actually in them.
- **source**: \`handy\` if it reads like raw dictation (first-person, informal,
  no clear multi-speaker turn-taking); \`pasted\` if it has clear speaker labels
  or formatting suggesting it was copied from Teams/Zoom/Granola; \`photo\` if
  the file is an image.

## Step 2 — Frontmatter

Build this frontmatter block (field order matters, keep it stable):

\`\`\`yaml
---
type: meeting               # or "note" per Step 1
date: YYYY-MM-DD
title: <inferred concise title>
attendees: [<names found in transcript>]   # omit this field entirely for type: note
source: handy                # or "pasted"
project: <inferred client/project or "internal">
tags: [<from registry only - see Step 3>]
status: enriched
enriched_at: <ISO 8601 timestamp, e.g. 2026-07-01T18:30:00+02:00>
---
\`\`\`

Date derivation priority: (1) a \`YYYY-MM-DD\` prefix already in the filename,
(2) an explicit date mentioned in the transcript content, (3) the file's
creation time (\`stat\` on the file) as fallback.

## Step 3 — Tagging (be reluctant)

This is the most important constraint in this skill. Tag sprawl makes the
registry useless, so the default answer is "use what exists."

1. List \`${f.tags}/*.md\` — the filename (without \`.md\`) of every file there is
   the complete set of permitted tags. Nothing else is a valid tag.
2. Assign 1–4 tags. Prefer fewer over more. A tag must describe a **major
   theme** of the note — something that would appear if you summarized the
   note in one sentence — not a term that was merely mentioned in passing.
3. Creating a new tag is exceptional. Only do it if **all** of the following
   are true:
   - No existing tag covers the concept, even loosely (check synonyms/parents
     too — e.g. a specific tool under an existing broader tag doesn't qualify).
   - The concept is central to this note.
   - You can name at least two other plausible future notes that would also
     use this tag.
   If any of these fail, do not create the tag — fall back to the closest
   existing tag instead, or drop the concept from tagging entirely.
4. If a new tag is justified, create \`${f.tags}/<tag>.md\`:
   \`\`\`markdown
   ---
   type: tag
   created: <today's date, YYYY-MM-DD>
   ---
   # <tag>

   One-line definition of what belongs under this tag.

   ## Notes with this tag
   (Obsidian backlinks panel shows these automatically - leave this section empty)
   \`\`\`
   Then append to \`.cortex/pipeline.log\`:
   \`<ISO timestamp> NEW TAG: <tag> - <one-line justification>\`
5. Tie-break rule: if genuinely torn between reusing an existing tag and
   minting a new one, always reuse the existing one.
6. Tags are lowercase-kebab-case, matching the tag note filenames exactly.

## Step 4 — Body enrichment

Restructure the note body into this shape. For \`type: note\` (non-meeting
fragments), omit Decisions and Action items, and skip an attendees-driven
Summary framing — just summarize the idea.

\`\`\`markdown
## Summary

2-4 sentence summary.

## Key points

- ...

## Decisions

- ...

## Action items

- [ ] ...

## Transcript

<original raw text, unmodified, collapsed under this heading>
\`\`\`

Omit the Decisions section entirely if there were none, and Action items
entirely if there were none. Never invent decisions or action items that
aren't actually in the transcript.

**Never delete, summarize away, or paraphrase the original transcript text.**
It moves intact, verbatim, under \`## Transcript\`. Enrichment adds structure
above it; it does not touch the source material.

**For an image file, there is no transcript.** Replace the \`## Transcript\`
section with \`## Captured image\` containing only \`![[<final image
filename>]]\` (see Step 6 for the final filename) - nothing else in that
section, no description duplicated from the Summary above it.

## Step 5 — Relations

Append a \`## Related\` section at the bottom, after \`## Transcript\`:

\`\`\`markdown
## Related

- [[<tag note>]]        (one per assigned tag)
- [[<other meeting note>]]   (notes in ${f.meetings}/ sharing project, attendees, or topic - search for candidates, link only genuinely related ones, max ~5)
- [[<wiki page>]]        (only if a matching wiki already exists in ${f.wikis}/)
\`\`\`

Every \`[[wikilink]]\` must point to a note that actually exists (tag notes,
other meeting notes, or wiki pages) — check before writing the link. Do not
invent links to notes that don't exist. The one exception: wiki-builder runs
after this skill in the same pipeline invocation and may create a wiki that
doesn't exist yet — you don't need to pre-link to a future wiki; wiki-builder
adds that link itself once it creates the page (see its SKILL.md).

Note: wiki pages are filed as \`${f.wikis}/<Topic> Wiki.md\` (with a \` Wiki\`
suffix), not bare \`<Topic>.md\` — this avoids colliding with the tag note of
the same topic name. If linking to an existing wiki, use its actual filename
(e.g. \`[[dbt Wiki]]\`), which is textually distinct from the tag link
(\`[[dbt]]\`) even though both relate to the same topic.

## Step 6 — Move

1. Determine final filename: \`YYYY-MM-DD <title>.md\` (using the date and title
   from frontmatter). Sanitize the title for filesystem safety (no \`/\`, \`:\`,
   etc.) but keep it human-readable.
2. Write the fully enriched content to \`${f.meetings}/<final filename>\`.
3. For a text file: remove the original from \`${f.inbox}/\` - its content is
   now fully copied into the new note. **For an image file: move (rename) it
   into \`${f.meetings}/\` instead of deleting it**, using the same date+title
   as the note but keeping the image's original extension (e.g.
   \`2026-07-06 Whiteboard Sketch.png\` next to \`2026-07-06 Whiteboard
   Sketch.md\`) - this is the file the \`## Captured image\` embed points to, so
   it must actually exist at that path afterward, not be deleted.
4. Append to \`.cortex/pipeline.log\`:
   \`<ISO timestamp> ENRICHED: <final filename> - tags: [<tags>] - project: <project>\`

## Rules of engagement

- Process files strictly one at a time; complete steps 0–6 for one file before
  starting the next.
- Never modify anything under \`${f.wikis}/\` from this skill.
- Never modify the content of an existing note's \`## Transcript\` section for
  any note (including ones this skill itself is currently processing — the
  transcript is copied once, verbatim, and never touched again).
- If you cannot confidently classify or enrich a file (e.g. it's empty, or
  unreadable), skip it and log:
  \`<ISO timestamp> SKIPPED: <filename> - <reason>\`
  Leave it in \`${f.inbox}/\` for manual review rather than guessing.
`;
}

export function wikiBuilderSkill(f: SkillFolders): string {
	return `---
name: wiki-builder
description: Synthesize research-area wiki hub pages in ${f.wikis}/ from clusters of meeting notes in ${f.meetings}/, and keep existing wikis updated as new meetings arrive. Use after meeting-enricher has run, or when asked to build/update wikis.
---

# Wiki Builder

Turns clusters of related meeting notes into a single synthesized hub page per
topic, so the graph reads as hub-and-spoke (wikis and tags as hubs, meetings as
spokes) instead of a hairball of meeting-to-meeting links.

Vault root is the current working directory. Run this after \`meeting-enricher\`
has finished processing the inbox for this run.

## Step 1 — Cluster meeting notes by topic

Scan every note in \`${f.meetings}/\`:
- Read frontmatter \`tags\` and \`project\`.
- Read the \`## Related\` section for tag-note links (these mirror \`tags\` but
  confirm them).

Skip notes tagged \`fragment\` when counting — fragments don't count toward wiki
eligibility (per meeting-enricher's Step 1 classification), even though they
still live in \`${f.meetings}/\`.

For each tag (a candidate "topic"), count how many non-fragment meeting notes
carry it.

## Step 2 — Threshold check

- If a topic has **≥4** meeting notes and **no existing wiki** in \`${f.wikis}/\`
  for it (check \`${f.wikis}/*.md\` frontmatter \`topic:\` field, not just filename),
  it qualifies for a new wiki.
- If a topic has fewer than 4 meeting notes and no wiki exists yet, do nothing
  for it this run.
- If a wiki already exists for a topic, go to Step 4 (update) regardless of
  count, as long as at least one new meeting note has been added since the
  wiki's \`updated\` date.

## Filename convention (avoid tag/wiki collisions)

macOS's default filesystem is case-insensitive, and wiki topics are almost
always derived from tag names — so naming a wiki file after its topic exactly
(e.g. \`${f.wikis}/dbt.md\`) will collide with the tag note of the same name
(\`${f.tags}/dbt.md\`). Two notes with the same filename in different folders make
\`[[wikilink]]\`s ambiguous in Obsidian and silently break the hub-and-spoke
graph shape this system depends on.

To avoid this, **always name wiki files \`<Topic> Wiki.md\`** (e.g.
\`${f.wikis}/dbt Wiki.md\`, \`${f.wikis}/RAG Wiki.md\`), never bare \`<Topic>.md\`. Keep
the clean topic name in frontmatter (\`topic: dbt\`) and as the \`# <Topic>\` H1 —
only the filename (and therefore the \`[[...]]\` link text used to reference it)
carries the \` Wiki\` suffix.

## Step 3 — Create a new wiki

For each topic crossing the threshold:

1. Read all source meeting notes for that topic in full (Summary, Key points,
   Decisions, Action items — not the raw Transcript, unless something is
   ambiguous and you need to check it).
2. Write \`${f.wikis}/<Topic> Wiki.md\` (see filename convention above):

\`\`\`markdown
---
type: wiki
topic: <topic>
created: <today's date, YYYY-MM-DD>
updated: <today's date, YYYY-MM-DD>
sources: <count>
---
# <Topic>

## Current state

Synthesized narrative of what is known/decided about this topic across all
source meetings. Write this like a living briefing document a colleague could
read to get fully up to speed — not a bullet list of links. Pull together
decisions, current direction, and unresolved tension across the source
meetings into connected prose.

## Open questions

- ...

## Timeline

- YYYY-MM-DD - [[meeting note]] - one-line what happened

## Sources

- [[meeting note 1]]
- [[meeting note 2]]
\`\`\`

Use the topic's tag name (capitalized/humanized) as \`<Topic>\` unless the
meeting notes clearly point to a more specific, more human title.

3. Append to \`.cortex/pipeline.log\`:
   \`<ISO timestamp> NEW WIKI: <topic> - sources: <count>\`

## Step 4 — Update an existing wiki

If a wiki's topic has gained meeting notes since its \`updated\` date:

1. Read the existing wiki in full, plus the newly added source meeting notes.
2. Rewrite \`## Current state\` to incorporate the new information — don't just
   append a paragraph, actually re-synthesize so the narrative stays coherent.
3. Append new entries to \`## Timeline\` (keep existing entries, keep
   chronological order).
4. Append new notes to \`## Sources\`. **Never drop existing Sources** — only add.
5. Update \`sources:\` count and \`updated:\` date in frontmatter. Leave \`created:\`
   untouched.
6. Append to \`.cortex/pipeline.log\`:
   \`<ISO timestamp> UPDATED WIKI: <topic> - sources: <count>\`

## Step 5 — Close the loop (hub-and-spoke linking)

After creating or updating a wiki, go back to every meeting note that is a
source for it and ensure its \`## Related\` section contains \`[[<Topic> Wiki]]\`
(the actual wiki filename, per the naming convention above — this is distinct
from the \`[[<tag>]]\` link that's likely already there). Add the link if
missing; don't duplicate it if already present. Since the wiki and tag links
are textually different (\`[[dbt Wiki]]\` vs \`[[dbt]]\`), don't mistake the
existing tag link for satisfying this step. This is what completes the
hub-and-spoke shape — meeting-enricher may not have been able to link to a
wiki that didn't exist yet when it ran.

## Rules of engagement

- Never modify a meeting note's \`## Transcript\`, \`## Summary\`, \`## Key points\`,
  \`## Decisions\`, or \`## Action items\` sections — the only meeting-note edit
  this skill is allowed to make is adding a missing wikilink to \`## Related\`.
- Never drop existing content from a wiki (\`## Sources\`, \`## Timeline\` entries)
  when updating it.
- If two topics are near-synonyms (e.g. a tag and a project name covering
  almost the same meetings), prefer building one wiki per **tag**, since tags
  are the controlled vocabulary — don't fragment the hub structure by project
  name unless the project is clearly the more natural hub for those meetings.
`;
}
