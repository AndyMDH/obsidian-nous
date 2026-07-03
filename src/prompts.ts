import type { NoteIndexEntry } from "./types.ts";

// Adapted from the meeting-enricher Claude Code skill. The original skill let
// the model use Read/Write/Glob tools itself; here the plugin does all file
// I/O, so the model's only job is to return the enrich_note tool call - no
// tool loop, no filesystem access, one round trip.
export function enrichSystemPrompt(tagRegistry: string[]): string {
	return `You enrich a single raw meeting transcript or personal note into structured, tagged data. You do not have file access - the app that calls you will read your response and write files based on it. Always respond by calling the enrich_note tool exactly once.

## Classify
- type: "meeting" if the text reads like a conversation/discussion between people, "note" if it's a single-person idea, reflection, or fragment with no attendees/decisions/actions structure.
- is_fragment: true if the body is under ~50 words, regardless of type. Fragments still get enriched normally but are excluded from wiki-eligibility counting by the caller.
- source: "handy" if it reads like raw dictation (first-person, informal, no clear multi-speaker turn-taking), "pasted" if it has clear speaker labels or formatting suggesting it was copied from Teams/Zoom/Granola.

## Date
Priority order: (1) an explicit YYYY-MM-DD mentioned in the transcript content, (2) the filename-hint or creation-time fallback the caller supplies in the user message if no explicit date is in the content. Always return YYYY-MM-DD.

## Tagging - be reluctant, this is the most important constraint
The permitted tag registry is exactly this list, nothing else is valid: ${tagRegistry.length > 0 ? tagRegistry.join(", ") : "(empty - every tag you use will be a new tag)"}
1. Assign 1-4 tags from that list. Prefer fewer. A tag must describe a major theme of the note - something that would appear in a one-sentence summary - not something merely mentioned in passing.
2. Only propose a new tag (via the new_tag field) if ALL of: no existing tag covers the concept even loosely (check synonyms/parents too), the concept is central to this note, and you can name at least two other plausible future notes that would also use it. If genuinely torn between reusing an existing tag and minting a new one, always reuse the existing one.
3. Tags are lowercase-kebab-case.
4. If is_fragment is true, always include "fragment" as one of the tags (create it via new_tag if it does not already exist in the registry, with justification "system tag for short captures").

## Body
- summary: 2-4 sentences. For type "note", just summarize the idea - do not force a meeting framing.
- key_points: bullet strings, the substantive points made.
- decisions: bullet strings, actual decisions only. Empty array if none - never invent one.
- action_items: bullet strings, actual commitments only. Empty array if none - never invent one.
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
			source: { type: "string", enum: ["handy", "pasted"] },
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
			related_notes: { type: "array", items: { type: "string" } },
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
			"related_notes",
		],
	},
};

// Adapted from the wiki-builder skill's synthesis step (Step 3/4). Timeline
// and Sources are handled deterministically by the plugin from note
// metadata, not by the model - only the narrative needs generation.
export function wikiSystemPrompt(topic: string, isUpdate: boolean): string {
	const base = `You synthesize a wiki hub page for the topic "${topic}" from a set of source meeting/note summaries. Always respond by calling the synthesize_wiki tool exactly once.

Write current_state like a living briefing document a colleague could read to get fully up to speed - not a bullet list of links. Pull together decisions, current direction, and unresolved tension across the source notes into connected prose.

open_questions: bullet strings, genuinely open/unresolved questions. Empty array if none.`;

	if (isUpdate) {
		return `${base}

This topic already has a wiki. You are given the EXISTING current_state plus the NEW source notes added since the last update. Re-synthesize current_state as a coherent whole incorporating the new information - do not just append a paragraph to the old text.`;
	}
	return base;
}

export function wikiUserMessage(
	sources: { title: string; date: string; body: string }[],
	existingCurrentState: string | null
): string {
	const sourceBlock = sources
		.map((s) => `### ${s.title} (${s.date})\n${s.body}`)
		.join("\n\n");

	if (existingCurrentState) {
		return `## Existing current_state\n${existingCurrentState}\n\n## New source notes since last update\n${sourceBlock}`;
	}
	return `## Source notes\n${sourceBlock}`;
}

export const WIKI_TOOL = {
	name: "synthesize_wiki",
	description: "Return the synthesized wiki content.",
	input_schema: {
		type: "object",
		properties: {
			current_state: { type: "string" },
			open_questions: { type: "array", items: { type: "string" } },
		},
		required: ["current_state", "open_questions"],
	},
};
