import { App, Modal, Setting } from "obsidian";

export class QueryModal extends Modal {
	private question = "";

	constructor(app: App, private onSubmit: (question: string) => void) {
		super(app);
		this.modalEl.addClass("nous-modal");
	}

	onOpen() {
		this.setTitle("Query vault");
		const input = this.contentEl.createEl("textarea", {
			attr: { rows: "3", placeholder: "What do you want to know?" },
		});
		input.setCssStyles({ width: "100%" });
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				submit();
			}
		});
		input.addEventListener("input", () => {
			this.question = input.value;
		});
		const submit = () => {
			if (!this.question.trim()) return;
			this.close();
			this.onSubmit(this.question.trim());
		};
		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("Ask").setCta().onClick(submit)
		);
		input.focus();
	}

	onClose() {
		this.contentEl.empty();
	}
}
