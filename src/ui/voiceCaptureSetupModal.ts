import { App, Modal, Platform, Setting } from "obsidian";
import type NousPlugin from "../../main.ts";
import { wireWhisperInstallButton } from "./controls.ts";
import { OnboardingModal } from "./onboardingModal.ts";

export class VoiceCaptureSetupModal extends Modal {
	constructor(app: App, private plugin: NousPlugin) {
		super(app);
		this.modalEl.addClass("nous-modal");
	}

	onOpen() {
		this.setTitle("Set up voice notes");
		this.contentEl.createEl("p", { cls: "nous-wizard-body", text: "Voice notes need speech-to-text. Pick one:" });

		if (Platform.isMacOS) {
			const setting = new Setting(this.contentEl).setName("Private (recommended)");
			setting.setDesc("Checking…");
			void Promise.all([this.plugin.hasWhisperModel(), this.plugin.hasWhisperCli()]).then(
				([hasModel, hasCli]) => {
					// Stays open while a download/install runs instead of closing
					// immediately - closing right away left the only way to
					// cancel a ~574MB transfer already in flight as a floating
					// notice with no obvious button on it.
					const step = hasModel && !hasCli ? "cli" : "model";
					setting.setDesc(
						step === "cli"
							? "Model already downloaded. One more step, installed automatically:"
							: "One download (~574 MB). Fully private. Also installed automatically, in one more step after."
					);
					setting.addButton((button) => {
						button.setCta();
						wireWhisperInstallButton(button.buttonEl, this.plugin, step, () => this.close());
					});
				}
			);
		}

		new Setting(this.contentEl)
			.setName("Cloud")
			.setDesc("Add a Gemini or OpenAI key - used only for speech-to-text.")
			.addButton((button) =>
				button.setButtonText("Open Nous settings").onClick(() => {
					this.close();
					this.plugin.openNousSettings();
				})
			);

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Open setup wizard").onClick(() => {
					this.close();
					new OnboardingModal(this.app, this.plugin).open();
				})
			)
			.addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
	}
}
