import type NousPlugin from "../../main.ts";

// Shared by every place a whisper install button exists (Settings, the
// recording popup, the setup checklist) - a single definition instead of
// three nearly-identical copies of "add a quiet Cancel button right after
// this one." A free function since, like nousNotice above, the call sites
// are spread across unrelated Modal/PluginSettingTab classes.
export function attachCancelButton(afterEl: HTMLElement, onCancel: () => void): HTMLButtonElement {
	const cancel = createEl("button", { cls: "nous-numbered-cancel", text: "Cancel" });
	afterEl.insertAdjacentElement("afterend", cancel);
	cancel.addEventListener("click", onCancel);
	return cancel;
}

// The two one-click speech-to-text installs (download the whisper model,
// then install whisper-cli), shared by the setup checklist and the recording
// popup: label, busy state, a Cancel button while it runs, and a reset on
// failure/cancel. onDone only fires on success - what "done" means (redraw
// the checklist, close the popup) is the caller's.
export function wireWhisperInstallButton(
	button: HTMLButtonElement,
	plugin: NousPlugin,
	step: "model" | "cli",
	onDone: () => void
): void {
	const idle = step === "model" ? "Download model" : "Install";
	const busy = step === "model" ? "Downloading…" : "Installing…";
	button.textContent = idle;
	button.addEventListener("click", () => {
		void (async () => {
			button.textContent = busy;
			button.disabled = true;
			const cancel = attachCancelButton(button, () =>
				step === "model" ? plugin.cancelWhisperDownload() : plugin.cancelWhisperCliInstall()
			);
			const ok =
				step === "model"
					? await plugin.downloadWhisperModelsWithNotice()
					: await plugin.installWhisperCliWithNotice();
			cancel.remove();
			if (ok) {
				onDone();
				return;
			}
			button.textContent = idle;
			button.disabled = false;
		})();
	});
}

// Makes a non-<button> element (a card, a text link, the back chevron) act
// like one: focusable, announced as a button, and activated by click, Enter,
// or Space.
export function makeClickable(el: HTMLElement, onActivate: () => void): void {
	el.setAttribute("role", "button");
	el.setAttribute("tabindex", "0");
	el.addEventListener("click", onActivate);
	el.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onActivate();
		}
	});
}
