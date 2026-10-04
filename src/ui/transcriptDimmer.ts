import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// Dim every line at or below a "## Transcript" heading in the editor.
// Purely visual (gated by body.nous-styled-notes in the stylesheet); the
// file content is untouched.
export const nousTranscriptDimmer = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildTranscriptDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = buildTranscriptDecorations(update.view);
			}
		}
	},
	{ decorations: (value) => value.decorations }
);

function buildTranscriptDecorations(view: EditorView): DecorationSet {
	const doc = view.state.doc;
	let headingFrom = -1;
	for (let i = 1; i <= doc.lines; i++) {
		if (doc.line(i).text.trim() === "## Transcript") {
			headingFrom = doc.line(i).from;
			break;
		}
	}
	const builder = new RangeSetBuilder<Decoration>();
	if (headingFrom === -1) return builder.finish();
	const lineDeco = Decoration.line({ class: "nous-transcript-line" });
	for (const range of view.visibleRanges) {
		let pos = Math.max(range.from, headingFrom);
		while (pos <= range.to) {
			const line = doc.lineAt(pos);
			if (line.from >= headingFrom) builder.add(line.from, line.from, lineDeco);
			pos = line.to + 1;
		}
	}
	return builder.finish();
}
