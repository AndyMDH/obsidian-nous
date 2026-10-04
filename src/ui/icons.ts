import { addIcon } from "obsidian";

// Clip-n badge (docs/NOUS-REDESIGN.md §2): an n whose right leg bends back
// up like paperclip wire, on a squircle filled with the user's own theme
// accent color (--interactive-accent), not a fixed brand color - matches
// the theme-adaptive pivot the rest of the plugin already follows. Sized by
// CSS at each call site (56px wizard hero, 26px settings header) -
// width/height below are just the SVG's own default before CSS overrides
// them.
export const NOUS_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112" width="56" height="56" aria-hidden="true"><rect x="4" y="4" width="104" height="104" rx="30" fill="var(--interactive-accent, #4c5138)"/><path d="M36 86 V46 C36 33 45 24 56 24 C68 24 78 33 78 46 V70 A10 10 0 0 1 58 70 V52" stroke="var(--text-on-accent, #f5f2ed)" stroke-width="10" fill="none" stroke-linecap="round"/></svg>`;

// docs/NOUS-REDESIGN.md §2 / warm-paper theme spec §3: clip-n-derived
// icons, registered once at startup so setIcon()/addRibbonIcon() can use
// them by name like any Lucide icon. nous-badge duplicates NOUS_LOGO_SVG's
// artwork (already used via the raw-embed path above) - registered anyway
// so it's available anywhere an Icon-by-name is needed instead of a raw SVG
// embed.
export function registerNousIcons(): void {
	// Full <svg viewBox> wrapper on each, not just the inner paths - the
	// source art uses a 96 or 112 grid, not Obsidian's addIcon() default of
	// 100, and passing bare path fragments would let Obsidian rescale them
	// against the wrong grid.
	addIcon(
		"nous-clip",
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M28 78 V38 C28 25 37 16 48 16 C60 16 70 25 70 38 V62 A10 10 0 0 1 50 62 V44" stroke="currentColor" stroke-width="9" stroke-linecap="round"/></svg>'
	);
	addIcon(
		"nous-badge",
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112" fill="none"><rect x="4" y="4" width="104" height="104" rx="30" fill="var(--interactive-accent, #4c5138)"/><path d="M36 86 V46 C36 33 45 24 56 24 C68 24 78 33 78 46 V70 A10 10 0 0 1 58 70 V52" stroke="var(--text-on-accent, #f5f2ed)" stroke-width="10" stroke-linecap="round"/></svg>'
	);
	addIcon(
		"nous-enrich",
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M28 82 V42 C28 29 37 20 48 20 C60 20 70 29 70 42 V66 A10 10 0 0 1 50 66 V48" stroke="currentColor" stroke-width="9" stroke-linecap="round"/><path d="M78 8 L80.5 15.5 L88 18 L80.5 20.5 L78 28 L75.5 20.5 L68 18 L75.5 15.5 Z" fill="currentColor"/></svg>'
	);
	addIcon(
		"nous-recording",
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M28 82 V42 C28 29 37 20 48 20 C60 20 70 29 70 42 V66 A10 10 0 0 1 50 66 V48" stroke="currentColor" stroke-width="9" stroke-linecap="round"/><circle cx="80" cy="18" r="10" fill="currentColor"/></svg>'
	);
}
