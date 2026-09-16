import type { NoteIndexEntry } from "./types.ts";

// The plugin does all file I/O; the model's only job is to return the
// enrich_note tool call - no tool loop, one round trip.
export function ownerDescription(ownerName: string): string {
	const name = ownerName.trim();
	return name
		? `${name}, the person whose notes these are (on call transcripts the "Me:" lines are theirs)`
		: `the person whose notes these are (on call transcripts the "Me:" speaker; otherwise infer from context who is taking the notes)`;
}

export interface KnownTerm {
	term: string;
	meaning: string;
}

export function enrichSystemPrompt(tagRegistry: string[], ownerName = "", knownTerms: KnownTerm[] = []): string {
	const owner = ownerDescription(ownerName);
	const glossaryBlock =
		knownTerms.length > 0
			? knownTerms.map((t) => `${t.term} = ${t.meaning}`).join("; ")
			: "(none yet)";
	return `You enrich a single raw meeting transcript or personal note into structured, tagged data. You do not have file access - the app that calls you will read your response and write files based on it. Always respond by calling the enrich_note tool exactly once.

## Classify
- type: "meeting" if the text reads like a conversation/discussion between people, "note" if it's a single-person idea, reflection, or fragment with no attendees/decisions/actions structure.
- is_fragment: true if the body is under ~50 words, regardless of type. Fragments still get enriched normally but are excluded from wiki-eligibility counting by the caller.
- source: "voice" if it reads like raw dictation (first-person, informal, no clear multi-speaker turn-taking), "pasted" if it has clear speaker labels or formatting suggesting it was copied from Teams/Zoom/Granola, "photo" if you were given an image instead of text, "document" if you were given a PDF instead of text.

## If given an image instead of text
Describe what's visible (whiteboard notes, a diagram, a screenshot, etc.) and enrich based on that description - classify/tag/summarize the same as you would a transcript covering the same content. Always set source: "photo" and type based on what the image actually shows (a whiteboard from a meeting is usually "meeting"; a screenshot of an article or a personal sketch is usually "note"). Two photos are essentially never an exact duplicate of each other or of a text capture - only set is_duplicate true if this is clearly a repeat of the exact same image/whiteboard state already captured, per the existing notes index below.

## If given a PDF instead of text
Read the actual document content (not just its filename) and enrich based on it - classify/tag/summarize the same as you would a transcript covering the same material. Always set source: "document" and type based on what the PDF actually is (a scanned meeting agenda/minutes is usually "meeting"; an article, report, or reference document is usually "note"). Only set is_duplicate true if this is clearly the same document already captured, per the existing notes index below.

## Date
Priority order: (1) an explicit YYYY-MM-DD mentioned in the transcript content, (2) the filename-hint or creation-time fallback the caller supplies in the user message if no explicit date is in the content. Always return YYYY-MM-DD.

## Tagging - be reluctant, this is the most important constraint
The permitted tag registry is exactly this list, nothing else is valid: ${tagRegistry.length > 0 ? tagRegistry.join(", ") : "(empty - every tag you use will be a new tag)"}
1. Assign 1-4 tags from that list. Prefer fewer. A tag must describe a major theme of the note - something that would appear in a one-sentence summary - not something merely mentioned in passing.
2. Only propose a new tag (via the new_tag field) if ALL of: no existing tag covers the concept even loosely (check synonyms/parents too), the concept is central to this note, and you can name at least two other plausible future notes that would also use it. If genuinely torn between reusing an existing tag and minting a new one, always reuse the existing one.
3. Tags are lowercase-kebab-case.
4. If is_fragment is true, always include "fragment" as one of the tags (create it via new_tag if it does not already exist in the registry, with justification "system tag for short captures").
5. "win" is a recognized system tag - valid in tags without appearing in the registry list above, and never proposed via new_tag (unlike "fragment", it needs no tag file). See Wins below.

## Wins
Include "win" in tags whenever the note describes a completed professional accomplishment - shipped a project, hit a concrete metric, earned a certification, gave a talk or ran training, released something open source, wrote something published, landed a client win, and so on. Include it even if the user never wrote "#win" or "win" themselves - apply it whenever the note clearly qualifies, the same way any other tag gets assigned. When genuinely ambiguous, do not apply it.
When "win" is in tags, fill the win field: category is one of "client work", "training", "internship", "internal tool", "open source", "writing", "certification", "event", "other". headcount/client/repo/metric are blank strings unless the note actually states that detail - never guess or infer a value. When "win" is not in tags, win must be null.

## Body
- summary: 2-4 sentences. For type "note", just summarize the idea - do not force a meeting framing.
- key_points: bullet strings, the substantive points made.
- decisions: bullet strings, actual decisions only. Empty array if none - never invent one.
- action_items: only commitments that ${owner} made or was given. This is a personal note, not the team's task board - other people's tasks do not belong here. Write each as a bare command under ten words, no name prefix ("Ask Fuya for the abbreviations list."). Empty array if the owner has none - never invent one.
- watch_items: at most three commitments other people made that affect the owner's own work, each as "Owner: what, by when" in under twelve words ("Leah: onboarding journey and abbreviations list, this week."). Empty array if none. Never mirror everyone's tasks here.

## Glossary
Known terms from the vault's wiki glossaries: ${glossaryBlock}
- In summary and key_points, the first time a known term appears write it as "TERM (meaning)", e.g. "LRE (land register extract)". After that, the bare term.
- new_terms: acronyms, code names, or project jargon used in this text that are NOT in the known list and that a newcomer could not decode. Give each a best guess from context in a few words, or "unknown" if the text gives no clue. At most eight. Empty array if none. Never list ordinary words or well-known terms (API, CEO, PDF).
- If the raw captured text includes sections named "Questions to ask" or "Live notes", those were typed by the user during the meeting. Use them as context for the summary, key points, open threads, and action items, but do not treat them as spoken transcript lines.
Do not include the original transcript text in your response - the caller already has it and will attach it verbatim itself.

## Duplicate check
The user message includes a compact index of recent existing notes (title, date, snippet). If this transcript is clearly the same content as one of them (not just the same topic - the same conversation), set is_duplicate true and duplicate_of to that note's exact title. Otherwise false/null.

## Related notes
From the same index, list up to 5 existing note titles that are genuinely related (shared project, attendees, or specific topic - not just a shared tag) in related_notes. Only include notes that actually appear in the index. Empty array if none are genuinely related.

## Project
Infer the client/project name from context, or "internal" if this is not client work.`;
}

export function enrichUserMessage(
	rawText: string,
	filenameDateHint: string | null,
	creationDateFallback: string,
	existingNotes: NoteIndexEntry[]
): string {
	const indexBlock =
		existingNotes.length > 0
			? existingNotes
					.map(
						(n) =>
							`- "${n.title}" (${n.date}, project: ${n.project}, tags: [${n.tags.join(", ")}]): ${n.snippet}`
					)
					.join("\n")
			: "(no existing notes yet)";

	return `Filename date hint (may be absent): ${filenameDateHint ?? "none"}
File creation time fallback if no date is found elsewhere: ${creationDateFallback}

## Existing notes index (for duplicate check and related-note linking)
${indexBlock}

## Raw captured text
${rawText}`;
}

// enrichUserMessage minus the transcript - the image rides as a content block.
export function enrichImageUserMessage(
	filenameDateHint: string | null,
	creationDateFallback: string,
	existingNotes: NoteIndexEntry[]
): string {
	const indexBlock =
		existingNotes.length > 0
			? existingNotes
					.map(
						(n) =>
							`- "${n.title}" (${n.date}, project: ${n.project}, tags: [${n.tags.join(", ")}]): ${n.snippet}`
					)
					.join("\n")
			: "(no existing notes yet)";

	return `Filename date hint (may be absent): ${filenameDateHint ?? "none"}
File creation time fallback if no date is found elsewhere: ${creationDateFallback}

## Existing notes index (for duplicate check and related-note linking)
${indexBlock}

## Captured image
Describe what's visible and enrich based on it, per the image-handling instructions above.`;
}

// Same, for a PDF attached as a document content block.
export function enrichDocumentUserMessage(
	filenameDateHint: string | null,
	creationDateFallback: string,
	existingNotes: NoteIndexEntry[]
): string {
	const indexBlock =
		existingNotes.length > 0
			? existingNotes
					.map(
						(n) =>
							`- "${n.title}" (${n.date}, project: ${n.project}, tags: [${n.tags.join(", ")}]): ${n.snippet}`
					)
					.join("\n")
			: "(no existing notes yet)";

	return `Filename date hint (may be absent): ${filenameDateHint ?? "none"}
File creation time fallback if no date is found elsewhere: ${creationDateFallback}

## Existing notes index (for duplicate check and related-note linking)
${indexBlock}

## Captured document
Read the attached PDF and enrich based on its actual content, per the document-handling instructions above.`;
}

export const ENRICH_TOOL = {
	name: "enrich_note",
	description: "Return the structured enrichment for a captured note.",
	input_schema: {
		type: "object",
		properties: {
			type: { type: "string", enum: ["meeting", "note"] },
			is_fragment: { type: "boolean" },
			date: { type: "string", description: "YYYY-MM-DD" },
			title: { type: "string" },
			attendees: {
				type: "array",
				items: { type: "string" },
				description: "Empty array for type: note",
			},
			source: { type: "string", enum: ["voice", "pasted", "photo", "document"] },
			project: { type: "string" },
			tags: { type: "array", items: { type: "string" } },
			new_tag: {
				type: ["object", "null"],
				properties: {
					name: { type: "string" },
					justification: { type: "string" },
				},
			},
			is_duplicate: { type: "boolean" },
			duplicate_of: { type: ["string", "null"] },
			summary: { type: "string" },
			key_points: { type: "array", items: { type: "string" } },
			decisions: { type: "array", items: { type: "string" } },
			action_items: { type: "array", items: { type: "string" } },
			watch_items: { type: "array", items: { type: "string" } },
			new_terms: {
				type: "array",
				items: {
					type: "object",
					properties: { term: { type: "string" }, guess: { type: "string" } },
					required: ["term", "guess"],
				},
			},
			related_notes: { type: "array", items: { type: "string" } },
			win: {
				type: ["object", "null"],
				description: "Non-null only when \"win\" is in tags - see the Wins section.",
				properties: {
					category: {
						type: "string",
						enum: [
							"client work",
							"training",
							"internship",
							"internal tool",
							"open source",
							"writing",
							"certification",
							"event",
							"other",
						],
					},
					headcount: { type: "string", description: "Blank if not stated - never guessed." },
					client: { type: "string", description: "Blank if not stated - never guessed." },
					repo: { type: "string", description: "Blank if not stated - never guessed." },
					metric: { type: "string", description: "Blank if not stated - never guessed." },
				},
				required: ["category", "headcount", "client", "repo", "metric"],
			},
		},
		required: [
			"type",
			"is_fragment",
			"date",
			"title",
			"attendees",
			"source",
			"project",
			"tags",
			"new_tag",
			"is_duplicate",
			"duplicate_of",
			"summary",
			"key_points",
			"decisions",
			"action_items",
			"watch_items",
			"new_terms",
			"related_notes",
			"win",
		],
	},
};

// Timeline and Sources are built deterministically from note metadata -
// only the narrative needs generation.
export function wikiSystemPrompt(topic: string, isUpdate: boolean): string {
	const base = `You synthesize a wiki hub page for the topic "${topic}" from a set of source meeting/note summaries. Always respond by calling the synthesize_wiki tool exactly once.

Write current_state like a living briefing document a colleague could read to get fully up to speed - not a bullet list of links. Pull together decisions, current direction, and unresolved tension across the source notes into connected prose.

open_questions: bullet strings, genuinely open/unresolved questions. Empty array if none.

glossary: acronyms, code names, and project jargon that appear in the source notes, each with its meaning in a few words. Draw meanings from the notes' "## New terms" sections and from context; when the notes only guess, keep the guess. Only terms actually used in the sources; skip ordinary words and well-known terms (API, CEO, PDF). Empty array if none. Terms listed under "Known glossary terms" in the user message are already in the table - do not repeat them.`;

	if (isUpdate) {
		return `${base}

This topic already has a wiki. You are given the EXISTING current_state plus the NEW source notes added since the last update. Re-synthesize current_state as a coherent whole incorporating the new information - do not just append a paragraph to the old text.`;
	}
	return base;
}

export function wikiUserMessage(
	sources: { title: string; date: string; body: string }[],
	existingCurrentState: string | null,
	knownTerms: string[] = []
): string {
	const sourceBlock = sources
		.map((s) => `### ${s.title} (${s.date})\n${s.body}`)
		.join("\n\n");
	const knownBlock = knownTerms.length > 0 ? `\n\n## Known glossary terms (already in the table, do not repeat)\n${knownTerms.join(", ")}` : "";

	if (existingCurrentState) {
		return `## Existing current_state\n${existingCurrentState}\n\n## New source notes since last update\n${sourceBlock}${knownBlock}`;
	}
	return `## Source notes\n${sourceBlock}${knownBlock}`;
}

export const WIKI_TOOL = {
	name: "synthesize_wiki",
	description: "Return the synthesized wiki content.",
	input_schema: {
		type: "object",
		properties: {
			current_state: { type: "string" },
			open_questions: { type: "array", items: { type: "string" } },
			glossary: {
				type: "array",
				items: {
					type: "object",
					properties: { term: { type: "string" }, meaning: { type: "string" } },
					required: ["term", "meaning"],
				},
			},
		},
		required: ["current_state", "open_questions", "glossary"],
	},
};
