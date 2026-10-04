import { App, Modal, Setting } from "obsidian";

// Bulk-rewrites real vault files - shown before every migration run, no
// auto-run and no skipping this even in tests/dev.
export class ConfirmTranscriptMigrationModal extends Modal {
	constructor(app: App, private count: number, private onConfirm: () => void | Promise<void>) {
		super(app);
	}

	onOpen() {
		this.setTitle("Convert transcripts to collapsed sections");
		this.contentEl.createEl("p", {
			text: `This will convert the Transcript section in ${this.count} note${this.count === 1 ? "" : "s"} to a collapsed format. This can't be undone by Nous - use your own backup/git/sync history if you need to revert. Continue?`,
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Convert")
					.setCta()
					.onClick(() => {
						this.close();
						void this.onConfirm();
					})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
