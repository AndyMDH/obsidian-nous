import { Notice } from "obsidian";

// The bare-wire Clip-n mark (docs/NOUS-REDESIGN.md §2: "bare wire at
// <=16px ... use currentColor so Obsidian themes it") - every Nous Notice
// gets this ahead of its text instead of relying on the "" text
// prefix alone to say who's talking. See styles.css's .notice rules for
// the warm-paper retone that goes with it.
const NOUS_NOTICE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="14" height="14" aria-hidden="true"><path d="M28 78 V38 C28 25 37 16 48 16 C60 16 70 25 70 38 V62 A10 10 0 0 1 50 62 V44" stroke="currentColor" stroke-width="9" fill="none" stroke-linecap="round"/></svg>`;

export function appendNousNoticeIcon(el: HTMLElement | DocumentFragment): void {
	const icon = el.createSpan({ cls: "nous-notice-icon" });
	const doc = new DOMParser().parseFromString(NOUS_NOTICE_ICON_SVG, "image/svg+xml");
	icon.appendChild(document.importNode(doc.documentElement, true));
}

// Builds the icon+message fragment shared by every Nous Notice - exported
// as its own step (not folded into nousNotice() below) because
// settingsNotice() needs the icon plus an extra trailing link, not just
// the icon plus plain text.
export function nousNoticeFragment(message: string): DocumentFragment {
	return createFragment((el) => {
		appendNousNoticeIcon(el);
		el.createSpan({ text: message });
	});
}

// Every Nous-initiated toast goes through this instead of `new Notice(...)`
// directly, so it always carries the icon. A free function, not a
// NousPlugin method - it's called from several Modal subclasses
// (OnboardingModal, NousSettingTab, LiveVoiceCaptureModal, QueryModal)
// that don't hold a plugin reference for this alone.
export function nousNotice(message: string, duration?: number): Notice {
	const notice = new Notice(nousNoticeFragment(message), duration);
	// noticeEl over the newer containerEl/messageEl - those need 1.8.7,
	// this plugin's minAppVersion is 1.6.6. Marks this as ours so CSS can
	// target it directly instead of :has(.nous-notice-icon), which the
	// plugin health scanner flags as a real perf risk (broad selector
	// invalidation re-evaluated on every DOM change).
	notice.noticeEl.addClass("nous-notice");
	return notice;
}
