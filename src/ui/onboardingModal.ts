import { App, Modal, Platform, Setting, setIcon, type ButtonComponent } from "obsidian";
import type NousPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, type ApiProvider, type NousSettings } from "../types.ts";
import { capturePrerequisitesContinueText, capturePrerequisiteItems, onboardingFinishTitle, shouldOfferNativeRecorderInstall, type CapturePrerequisiteStatus } from "../onboarding.ts";
import { nousNotice } from "./notice.ts";
import { wireWhisperInstallButton, makeClickable } from "./controls.ts";
import { NOUS_LOGO_SVG } from "./icons.ts";

// First-run setup: pick how notes are written, prove it works, then show
// the optional voice/meeting setup state before the user leaves the wizard.
export class OnboardingModal extends Modal {
	private lastCaptureStatus: CapturePrerequisiteStatus | null = null;
	// capturePrerequisiteItems() always claims text/image/PDF capture is
	// "Ready" - true once the connection test has actually passed, but
	// renderConnectionError's Skip button reaches the same checklist screen
	// after a CONFIRMED failure, with no distinction between the two. Set
	// on skip-after-failure, cleared on an actual successful test.
	private connectionUnverified = false;
	// The chevron+dots row (docs/NOUS-REDESIGN.md §3, step 1) sits above
	// this.titleEl, not inside contentEl - Obsidian renders titleEl as a
	// fixed sibling before contentEl regardless of when setTitle() is
	// called, so it has to be inserted there directly via the public
	// titleEl reference. Tracked here so clear() can remove the previous
	// screen's row before the next screen decides whether to draw its own
	// (Welcome draws none at all, per spec).
	private topRowEl: HTMLElement | null = null;

	// Every mode-card/provider/key field on Welcome and the screens after it
	// saves straight to this.plugin.settings on click/keystroke, with no
	// draft state - fine for first-run (nothing to lose yet), but "Rerun
	// setup" opens this same modal on an already-working vault. Abandoning
	// it partway (closing without Finish, after already picking a new mode
	// or typing a partial key) would otherwise silently leave that
	// half-changed, untested config in place instead of the config that was
	// actually working. Snapshotting only when already onboarded, and only
	// restoring on an unfinished close, keeps first-run behavior untouched.
	// Only the fields this wizard itself edits are snapshotted - restoring the
	// whole settings object also threw away anything the plugin wrote while
	// the wizard was open (a freshly downloaded whisper model path, an
	// installed whisper-cli path, an active recording).
	private settingsSnapshot: Pick<
		NousSettings,
		"executionMode" | "apiProvider" | "apiKeys" | "localBaseUrl" | "glmBaseUrl"
	> | null = null;
	private finished = false;
	// Bumped on every screen change and on close. Async work started by one
	// screen (the connection test, the capture check, an install) compares
	// its captured value against this before it navigates, so a result that
	// lands after the user clicked Back or closed the wizard is dropped
	// instead of yanking them to a different screen.
	private screenToken = 0;

	// "tour" reopens straight to the 60-second walkthrough, skipping setup -
	// lets a user who is already connected revisit it later without redoing
	// provider setup. See the "show-tour" command.
	constructor(
		app: App,
		private plugin: NousPlugin,
		private startAt: "welcome" | "tour" | "notion-import" = "welcome"
	) {
		super(app);
		this.modalEl.addClass("nous-modal");
		if (plugin.settings.onboarded) {
			this.settingsSnapshot = {
				executionMode: plugin.settings.executionMode,
				apiProvider: plugin.settings.apiProvider,
				apiKeys: { ...plugin.settings.apiKeys },
				localBaseUrl: plugin.settings.localBaseUrl,
				glmBaseUrl: plugin.settings.glmBaseUrl,
			};
		}
	}

	onClose() {
		this.screenToken++;
		if (this.settingsSnapshot && !this.finished) {
			Object.assign(this.plugin.settings, this.settingsSnapshot);
			void this.plugin.saveSettings();
		}
		this.contentEl.empty();
	}

	onOpen() {
		if (this.startAt === "tour") this.renderTour(0);
		else if (this.startAt === "notion-import") this.renderNotionImport();
		else this.renderWelcome();
	}

	private clear() {
		this.screenToken++;
		this.contentEl.empty();
		this.topRowEl?.remove();
		this.topRowEl = null;
	}

	// Every screen but Welcome gets this: a back chevron (only when a
	// previous step exists) and step dots on the left. The close "x" is
	// Obsidian's own modalCloseButtonEl, already at top-right - no need to
	// hand-roll one just to match the spec's "✕ right" half of the row.
	private renderTopRow(step: number, total: number, onBack?: () => void) {
		const row = createDiv({ cls: "nous-wizard-toprow" });
		if (onBack) {
			const back = row.createDiv({ cls: "nous-wizard-back" });
			back.setAttribute("aria-label", "Back");
			setIcon(back, "chevron-left");
			makeClickable(back, onBack);
		}
		const dots = row.createDiv({ cls: "nous-wizard-dots" });
		for (let i = 0; i < total; i++) {
			dots.createSpan({ cls: i === step ? "nous-wizard-dot is-active" : "nous-wizard-dot" });
		}
		this.titleEl.insertAdjacentElement("beforebegin", row);
		this.topRowEl = row;
	}

	// Which of the three screen shapes (§3, step 3) this render pass is -
	// only affects title alignment and a couple of layout tweaks via CSS.
	private setScreenMode(mode: "hero" | "form" | "list") {
		this.modalEl.toggleClass("is-hero", mode === "hero");
		this.modalEl.toggleClass("is-form", mode === "form");
		this.modalEl.toggleClass("is-list", mode === "list");
	}

	private renderLogo() {
		const holder = this.contentEl.createDiv({ cls: "nous-wizard-logo" });
		const doc = new DOMParser().parseFromString(NOUS_LOGO_SVG, "image/svg+xml");
		holder.appendChild(document.importNode(doc.documentElement, true));
	}

	// The hero-tile version of the mark: a bordered white 56px tile holding
	// an outline Lucide icon in accent color (§3, step 2). Used on every
	// hero screen except Welcome/Done, which use the logo badge instead.
	private renderHeroIcon(icon: string) {
		const tile = this.contentEl.createDiv({ cls: "nous-hero-tile" });
		setIcon(tile, icon);
	}

	private renderBody(text: string, opts: { center?: boolean; wide?: boolean } = {}) {
		const cls = ["nous-wizard-body", opts.center && "is-center", opts.wide && "is-wide"]
			.filter(Boolean)
			.join(" ");
		this.contentEl.createEl("p", { cls, text });
	}

	// The one full-width moss primary button (§3, step 5). Returns the
	// button so callers that need to relabel/disable it while async work is
	// in flight (the capture-prerequisites check) can hold onto it.
	private renderPrimary(label: string, onClick: () => void | Promise<void>): ButtonComponent {
		let ref!: ButtonComponent;
		new Setting(this.contentEl).setClass("nous-wizard-primary").addButton((b) => {
			ref = b;
			b.setButtonText(label)
				.setCta()
				.onClick(() => void onClick());
		});
		return ref;
	}

	// The one quiet centered text link below the primary button (§3, step
	// 5) - never a button, never paired with anything else on its row.
	private renderSkip(label: string, onClick: () => void | Promise<void>): HTMLElement {
		const link = this.contentEl.createDiv({ cls: "nous-wizard-skip" });
		link.setText(label);
		makeClickable(link, () => void onClick());
		return link;
	}

	// Raw error text never sits inline in a screen's body (§3 "Error" spec)
	// - it always lands in this centered mono well instead.
	private renderErrorWell(message: string) {
		this.contentEl.createDiv({ cls: "nous-well", text: message });
	}

	// Shared by Welcome and renderConnectChoice - both are plain lists of
	// clickable mode-cards, just with different content.
	private addModeCard(
		container: HTMLElement,
		options: {
			title: string;
			sub?: string;
			filled?: boolean;
			// A shorter, sub-less row for an option that isn't a mode choice
			// like the others (Notion import) - still a full-width card, not
			// a link, but reads as secondary next to the two real decisions.
			compact?: boolean;
			onChoose: () => void | Promise<void>;
		}
	) {
		const cls = ["nous-mode-card", options.filled && "is-filled", options.compact && "is-compact"]
			.filter(Boolean)
			.join(" ");
		const card = container.createDiv({ cls });
		const text = card.createDiv({ cls: "nous-mode-card-text" });
		text.createDiv({ cls: "nous-mode-card-title", text: options.title });
		if (options.sub) text.createDiv({ cls: "nous-mode-card-sub", text: options.sub });
		const arrow = card.createDiv({ cls: "nous-mode-card-arrow" });
		setIcon(arrow, "chevron-right");
		makeClickable(card, () => void options.onChoose());
	}

	private renderWelcome() {
		this.clear();
		this.setScreenMode("hero");
		this.setTitle("Welcome to Nous");
		// No dots/back chevron on Welcome - it's the first screen (§3
		// Welcome spec: "✕ only (no dots)").
		this.renderLogo();
		this.renderBody("Your vault, thinking with you. Pick a brain to start.", { center: true });

		if (this.app.vault.getRoot().children.length > 0) {
			this.renderBody(
				"This vault has other files - Nous adds its own folders here. For a clean space, start a new vault first.",
				{ center: true, wide: true }
			);
		}

		const cards = this.contentEl.createDiv({ cls: "nous-mode-cards" });
		this.addModeCard(cards, {
			title: "I have a Claude subscription",
			sub: "No extra billing",
			filled: true,
			onChoose: async () => {
				this.plugin.settings.executionMode = "cli";
				await this.plugin.saveSettings();
				this.renderTest();
			},
		});
		this.addModeCard(cards, {
			title: "I have an API key or local model",
			// Query vault (agentic search over your notes) needs CLI mode - it
			// is the one capability this path does not have, so it is named
			// here rather than only discovered later.
			sub: "Anthropic, OpenAI, Gemini, or run local - no vault search",
			onChoose: () => this.renderConnectChoice(),
		});
		// Not a mode choice like the two above it, so it's shorter and has
		// no sub-line - reads as secondary without needing its own line of
		// standalone text below the cards.
		this.addModeCard(cards, {
			title: "Migrating from Notion?",
			compact: true,
			onChoose: () => this.renderNotionImport(),
		});

		const themeLink = this.renderSkip("Try our Warm Paper theme", async () => {
			themeLink.setText("Installing…");
			try {
				await this.plugin.installWarmPaperTheme();
				themeLink.setText("Warm Paper installed ✓");
				nousNotice("Warm Paper installed and switched on.");
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				nousNotice(`Couldn't install Warm Paper - ${msg}`, 10000);
				themeLink.setText("Try our Warm Paper theme");
			}
		});

		this.renderSkip("Not now", async () => {
			this.finished = true;
			this.plugin.settings.onboarded = true;
			await this.plugin.saveSettings();
			// Every other exit from this wizard seeds the vault via
			// finish() - a full skip must too, or the vault is left
			// without 00-Inbox/10-Notes/20-Tags/30-Wikis until the
			// user's first capture happens to trigger folder creation.
			await this.plugin.ensureCoreFolders();
			this.close();
		});
	}

	// Reached from Welcome's third card, or the "Import from Notion" command
	// for users who already finished setup. A one-time bulk import, not an
	// ongoing sync - see importFromNotion() for exactly what it does and
	// doesn't do (no property mapping, no link/image rewriting).
	private renderNotionImport() {
		this.clear();
		this.setScreenMode("form");
		this.setTitle("Import from Notion");
		// Opened straight from the "Import from Notion" command, this screen
		// is a standalone dialog - no back chevron into a setup wizard the
		// user never asked for. Reached from Welcome's card it gets the
		// chevron, but no step dots either way: it is a side trip, not one of
		// the three setup steps.
		const standalone = this.startAt === "notion-import";
		if (!standalone) this.renderTopRow(0, 0, () => this.renderWelcome());

		this.renderBody("Export from Notion as Markdown & CSV, then unzip it.");

		const status = this.contentEl.createEl("p", { cls: "nous-wizard-body is-center" });
		status.hide();

		// One button doing double duty, same as every other wizard screen's
		// single primary action - "Choose folder…" until one is picked, then
		// "Import". Two separate buttons (plus one disabled until the other
		// is used) doesn't match how the rest of the wizard reads.
		let folderPath: string | null = null;
		const primary = this.renderPrimary("Choose folder…", async () => {
			if (!folderPath) {
				try {
					const picked = await this.plugin.pickNotionExportFolder();
					if (!picked) return;
					folderPath = picked;
					const name = picked.split(/[\\/]/).pop() ?? picked;
					status.setText(`"${name}" - text only, links and images don't come along yet.`);
					status.show();
					primary.setButtonText("Import");
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					nousNotice(`Couldn't open the folder picker - ${msg}`, 10000);
					await this.plugin.appendLog(`ERROR: Notion import folder picker - ${msg}`);
				}
				return;
			}
			primary.setButtonText("Importing…").setDisabled(true);
			try {
				const result = await this.plugin.importFromNotion(folderPath);
				await this.plugin.appendLog(
					`NOTION IMPORT: ${folderPath} - imported ${result.imported}, skipped ${result.skipped}`
				);
				if (result.imported === 0 && result.skipped === 0) {
					nousNotice("No Notion pages found in that folder.", 8000);
					primary.setButtonText("Import").setDisabled(false);
					return;
				}
				const parts = [
					`Imported ${result.imported} note${result.imported === 1 ? "" : "s"} into ${this.plugin.settings.inboxFolder}`,
				];
				// Worded carefully: a skip means a same-titled file already sits
				// in the inbox - almost always a re-import, but two distinct
				// Notion pages that happen to share a title look identical here
				// too, so this must not claim certainty it doesn't have.
				if (result.skipped > 0) {
					parts.push(`skipped ${result.skipped} matching a title already in your inbox`);
				}
				const tail = this.plugin.settings.onboarded
					? "Enriching now."
					: "Finish setup and they'll be enriched.";
				nousNotice(`${parts.join(", ")}. ${tail}`, 8000);
				if (standalone) {
					// Nothing on this screen edits settings, so there is
					// nothing for onClose to roll back.
					this.finished = true;
					this.close();
					return;
				}
				this.renderWelcome();
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				nousNotice(`Couldn't import - ${msg}`, 10000);
				await this.plugin.appendLog(`ERROR: Notion import from ${folderPath} - ${msg}`);
				primary.setButtonText("Import").setDisabled(false);
			}
		});
	}

	// Sits between Welcome and renderApiSetup - both used to be separate
	// Welcome cards ("free local model" / "API key") going straight to the
	// same form; now Welcome has one combined card that lands here first.
	// Shares step 0 with renderApiSetup rather than getting its own dot -
	// they're two halves of the same "connect a provider" stage.
	private renderConnectChoice() {
		this.clear();
		this.setScreenMode("hero");
		this.renderTopRow(0, 3, () => this.renderWelcome());
		this.setTitle("Connect a provider");
		this.renderBody("Pick whichever works for you.", { center: true });

		const cards = this.contentEl.createDiv({ cls: "nous-mode-cards" });
		this.addModeCard(cards, {
			title: "I want a free local model",
			sub: "Free and private · 2-min setup",
			onChoose: async () => {
				this.plugin.settings.executionMode = "api";
				this.plugin.settings.apiProvider = "local";
				await this.plugin.saveSettings();
				this.renderApiSetup();
			},
		});
		this.addModeCard(cards, {
			title: "I have an API key",
			// Z.ai/GLM stays a real option in the provider dropdown on the
			// next screen - this line is just the marketing-copy summary,
			// which the redesign spec trims to the three best-known names.
			sub: "Anthropic, OpenAI, Gemini, etc.",
			onChoose: async () => {
				this.plugin.settings.executionMode = "api";
				// "local" left over from the other card (picked, then Back)
				// would open the key form on a Base URL field instead of a
				// key field.
				if (this.plugin.settings.apiProvider === "local") {
					this.plugin.settings.apiProvider = DEFAULT_SETTINGS.apiProvider;
				}
				await this.plugin.saveSettings();
				this.renderApiSetup();
			},
		});
	}

	private renderApiSetup() {
		this.clear();
		this.setScreenMode("form");
		this.setTitle("Connect a provider");
		this.renderTopRow(0, 3, () => this.renderConnectChoice());
		this.renderBody("Changeable anytime in settings.");

		const provider = () => this.plugin.settings.apiProvider;

		new Setting(this.contentEl).setName("Provider").addDropdown((dropdown) => {
			dropdown
				.addOption("anthropic", "Anthropic")
				.addOption("openai", "OpenAI")
				.addOption("gemini", "Gemini")
				.addOption("glm", "GLM (Z.ai)")
				.addOption("local", "Local (OpenAI-compatible, e.g. Ollama)")
				.setValue(provider())
				.onChange(async (value) => {
					this.plugin.settings.apiProvider = value as ApiProvider;
					await this.plugin.saveSettings();
					this.renderApiSetup();
				});
		});

		if (provider() === "local") {
			new Setting(this.contentEl)
				.setName("Base URL")
				.setDesc("Your OpenAI-compatible endpoint.")
				.addText((text) => {
					text.inputEl.addClass("nous-mono-input");
					text.setValue(this.plugin.settings.localBaseUrl).onChange(async (value) => {
						this.plugin.settings.localBaseUrl = value.trim() || DEFAULT_SETTINGS.localBaseUrl;
						await this.plugin.saveSettings();
					});
				});
		} else if (provider() === "glm") {
			new Setting(this.contentEl)
				.setName("GLM API key")
				.setDesc("Your Z.ai API key - stored locally in this vault.")
				.addText((text) => {
					text.inputEl.type = "password";
					text.inputEl.autocomplete = "off";
					text
						.setPlaceholder("Paste your key")
						.setValue(this.plugin.settings.apiKeys.glm ?? "")
						.onChange(async (value) => {
							this.plugin.settings.apiKeys.glm = value.trim();
							await this.plugin.saveSettings();
						});
				});
			new Setting(this.contentEl)
				.setName("Base URL")
				.setDesc('Z.ai OpenAI-compatible endpoint. Use "https://api.z.ai/api/coding/paas/v4" for the Coding Plan.')
				.addText((text) => {
					text.inputEl.addClass("nous-mono-input");
					text.setValue(this.plugin.settings.glmBaseUrl).onChange(async (value) => {
						this.plugin.settings.glmBaseUrl = value.trim() || DEFAULT_SETTINGS.glmBaseUrl;
						await this.plugin.saveSettings();
					});
				});
		} else {
			new Setting(this.contentEl)
				.setName("API key")
				.setDesc("Stored locally in this vault, never sent anywhere except your provider.")
				.addText((text) => {
					text.inputEl.type = "password";
					text.inputEl.autocomplete = "off";
					text
						.setPlaceholder("Paste your key")
						.setValue(this.plugin.settings.apiKeys[provider()] ?? "")
						.onChange(async (value) => {
							this.plugin.settings.apiKeys[provider()] = value.trim();
							await this.plugin.saveSettings();
						});
				});
		}

		this.renderPrimary("Continue", () => this.renderTest());
	}

	private renderTest() {
		this.clear();
		this.setScreenMode("hero");
		const isCli = this.plugin.settings.executionMode === "cli";
		// Shares dot 0 with Welcome/ApiSetup rather than getting its own -
		// this screen never took a choice of its own, it just runs a check
		// and either advances on its own or bounces to the error screen
		// below, so counting it as a separate step made the back chevron
		// from "What works now" jump two dots at once instead of one.
		this.renderTopRow(0, 3, () => (isCli ? this.renderWelcome() : this.renderApiSetup()));
		this.setTitle("Checking the connection…");
		this.renderHeroIcon("plug");
		this.renderBody(
			isCli ? "Making sure Claude Code is reachable." : "One tiny API call to confirm your key works.",
			{ center: true }
		);

		// A fast check (cached CLI auth, a quick local ping) can resolve in
		// well under a frame - without a floor, this whole screen shows for
		// a handful of milliseconds and reads as a glitchy flash rather than
		// a real step, right when a new user is watching most closely.
		const minDisplayMs = 400;
		const token = this.screenToken;
		const runCheck = async () => {
			const shownAt = Date.now();
			const settle = async () => {
				const remaining = minDisplayMs - (Date.now() - shownAt);
				if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
			};
			try {
				await this.plugin.testConnection();
				await settle();
				if (token !== this.screenToken) return;
				this.connectionUnverified = false;
				this.renderCapturePrerequisites();
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				await settle();
				if (token !== this.screenToken) return;
				this.renderConnectionError(isCli, msg);
			}
		};
		void runCheck();
	}

	// The wizard's one "Error" screen (§3 "Error" spec): hero alert-circle
	// icon (accent, not red), a truthful one-line summary, the raw error in
	// a mono well - never inline in the body - Retry as the primary action,
	// Skip underneath.
	private renderConnectionError(isCli: boolean, message: string) {
		this.clear();
		this.setScreenMode("hero");
		// Same dot as renderTest (see its comment) - this screen is just
		// that check's failure outcome, not a further step of its own.
		this.renderTopRow(0, 3, () => (isCli ? this.renderWelcome() : this.renderApiSetup()));
		this.setTitle("Couldn't connect");
		this.renderHeroIcon("alert-circle");
		// "Is Ollama running?" used to be the only local-mode message, but a
		// live server whose model just doesn't support tool calls fails the
		// exact same way - the real cause is in the error well below either
		// way, so the headline now covers both instead of guessing one.
		const line = isCli
			? "Claude Code didn't respond. Is it installed and logged in?"
			: this.plugin.settings.apiProvider === "local"
				? "Nothing answered - check that the server is running and its model supports tool calls."
				: "Nothing answered. Check your key and connection.";
		this.renderBody(line, { center: true });
		this.renderErrorWell(message);
		// A failed CLI check is a dead end for someone who has never
		// installed Claude Code - the one allowed extra link (§3, step 4)
		// points straight at the install guide instead of a raw error.
		if (isCli) {
			const links = this.contentEl.createDiv({ cls: "nous-wizard-link-row" });
			links.createEl("a", {
				text: "Claude Code install guide",
				href: "https://docs.claude.com/en/docs/claude-code/setup",
			});
		}
		this.renderPrimary("Retry", () => this.renderTest());
		this.renderSkip("Skip", () => {
			this.connectionUnverified = true;
			this.renderCapturePrerequisites();
		});
	}

	private renderCapturePrerequisites() {
		this.clear();
		this.setScreenMode("list");
		// Back can't target renderTest() - that screen just re-runs the
		// connection check and, once it succeeds, immediately advances right
		// back here on its own, which made the chevron look broken. The real
		// previous interactive step is whichever screen set up the
		// connection in the first place.
		const isCli = this.plugin.settings.executionMode === "cli";
		this.renderTopRow(1, 3, () => (isCli ? this.renderWelcome() : this.renderApiSetup()));
		this.setTitle("Setting up");
		const statusEl = this.contentEl.createDiv({ cls: "nous-capture-checklist" });
		statusEl.createEl("p", { cls: "nous-wizard-body", text: "Checking capture setup..." });
		const continueButton = this.renderPrimary("Checking...", () => this.renderFinish());
		continueButton.setDisabled(true);
		const token = this.screenToken;
		// An install can finish after the user moved on to another screen -
		// only redraw this checklist if it is still the one on screen.
		const refresh = () => {
			if (token === this.screenToken) this.renderCapturePrerequisites();
		};
		void this.plugin
			.getCapturePrerequisiteStatus()
			.then((status) => {
				if (token !== this.screenToken) return;
				this.lastCaptureStatus = status;
				statusEl.empty();
				const items = capturePrerequisiteItems(status);
				// capturePrerequisiteItems() always calls text/image/PDF capture
				// "Ready" - true once the connection test passed, but this
				// screen is also reachable by clicking Skip after a CONFIRMED
				// failed test, and nothing distinguished the two.
				if (this.connectionUnverified) {
					const text = items.find((item) => item.id === "text");
					if (text) {
						text.desc = "Skipped - the connection test failed, so this isn't confirmed working yet.";
						text.warning = true;
					}
				}
				// This is a setup screen, not a status report - Nous already
				// knows what's ready, so there's nothing to gain by telling
				// the user that too. Only what still needs a decision or an
				// action shows up here; row numbers count what's actually
				// shown, not the original 3-item list, so it reads as a clean
				// to-do list instead of a checklist with gaps in it.
				const pending = items.filter((item) => item.warning);
				if (pending.length === 0) {
					statusEl.createEl("p", { cls: "nous-wizard-body", text: "Everything is ready." });
				}
				// Numbered hairline rows (§3 "What works now" spec) - 01/02/03
				// plus the item name and its one-line status.
				const list = statusEl.createDiv({ cls: "nous-numbered-list" });
				// Buttons live on their own numbered row now, instead of a
				// separate block below repeating the same "needs X" story a
				// second time - a brand-new user with nothing installed used
				// to see the same two problems named twice each (once in the
				// checklist, once in its own paragraph+button underneath).
				pending.forEach((item, displayIndex) => {
					const row = list.createDiv({ cls: "nous-numbered-row is-warning" });
					row.createDiv({ cls: "nous-numbered-index", text: String(displayIndex + 1).padStart(2, "0") });
					const text = row.createDiv({ cls: "nous-numbered-text" });
					text.createDiv({ cls: "nous-numbered-name", text: item.name });
					text.createDiv({ cls: "nous-numbered-desc", text: item.desc });

					if (item.id === "voice" && Platform.isMacOS && !status.voiceReady) {
						const actions = row.createDiv({ cls: "nous-numbered-actions" });
						void Promise.all([this.plugin.hasWhisperModel(), this.plugin.hasWhisperCli()]).then(
							([hasModel, hasCli]) => {
								if (hasModel && hasCli) return;
								const button = actions.createEl("button", { cls: "mod-cta" });
								wireWhisperInstallButton(button, this.plugin, hasModel ? "cli" : "model", refresh);
							}
						);
					}

					if (item.id === "meeting" && Platform.isMacOS && shouldOfferNativeRecorderInstall(status)) {
						const actions = row.createDiv({ cls: "nous-numbered-actions" });
						const button = actions.createEl("button", { cls: "mod-cta", text: "Install recorder" });
						button.addEventListener("click", () => {
							void (async () => {
								button.textContent = "Installing…";
								button.disabled = true;
								try {
									await this.plugin.installNativeRecorderFromRelease();
									nousNotice("Recorder installed and ready to go.");
									refresh();
								} catch (e) {
									const msg = e instanceof Error ? e.message : String(e);
									nousNotice(`Recorder install didn't work - ${msg}`, 12000);
									button.textContent = "Install recorder";
									button.disabled = false;
								}
							})();
						});
					}
				});
				continueButton.setButtonText(capturePrerequisitesContinueText(status)).setDisabled(false);
			})
			.catch((e) => {
				if (token !== this.screenToken) return;
				const msg = e instanceof Error ? e.message : String(e);
				statusEl.empty();
				statusEl.createEl("p", { cls: "nous-wizard-body", text: "Could not check capture setup." });
				statusEl.createDiv({ cls: "nous-well", text: msg });
				continueButton.setButtonText("Continue anyway").setDisabled(false);
			});
	}

	private renderFinish() {
		this.clear();
		this.setScreenMode("hero");
		this.renderTopRow(2, 3, () => this.renderCapturePrerequisites());
		const status = this.lastCaptureStatus;
		// "Nous is ready" must not be shown over a connection that was never
		// actually confirmed working (Skip after a failed test) - voice/
		// meeting readiness are unrelated checks and can both be true even
		// then, which is exactly what onboardingFinishTitle alone can't see.
		this.setTitle(
			status && !this.connectionUnverified ? onboardingFinishTitle(status) : "Text capture is ready"
		);
		this.renderLogo();
		const body = this.contentEl.createEl("p", { cls: "nous-wizard-body is-center" });
		body.appendText("Drop anything in ");
		body.createEl("code", { text: this.plugin.settings.inboxFolder });
		body.appendText(". It comes back tagged - your tag list starts empty and grows as you capture.");
		// What's still missing was already shown on the previous screen
		// (What works now) one click ago - repeating the same warnings here
		// was the biggest single contributor to the wizard feeling long for
		// anyone starting with nothing installed. Settings -> Nous covers
		// it if they want to finish setup later.

		// The theme snippet is one click away in Nous settings, and so is
		// plain Finish's destination - keeping both off this screen keeps
		// "you're done" reading as exactly that, one decision (tour or not),
		// not several (§3 Done spec: primary "Take the tour", quiet "Finish").
		this.renderPrimary("Take the tour", () => this.renderTour(0));
		this.renderSkip("Finish", () => this.finish());
	}

	// A click-through tour of the daily loop: one hero icon, one line, one
	// primary button per step - same grammar as every other wizard screen
	// (§3 "Tour slides" spec). Earlier revisions surfaced a per-step
	// shortcut button (record now, drop a sample note, open settings)
	// alongside Back/Next/Skip; the spec's tour screens only ever call for
	// hero+title+line+primary, so those shortcuts are gone - each action is
	// still reachable from its own command/ribbon icon, just not duplicated
	// here.
	private renderTour(step: number) {
		this.clear();
		this.setScreenMode("hero");
		const steps = this.tourSteps();
		const current = steps[Math.max(0, Math.min(step, steps.length - 1))];
		// Step 0's Back returns to the Finish screen the tour was started
		// from - but the "show-tour" command opens the tour directly, with no
		// Finish screen (and no capture status for its title) behind it.
		const onBack =
			step > 0
				? () => this.renderTour(step - 1)
				: this.startAt === "tour"
					? undefined
					: () => this.renderFinish();
		this.renderTopRow(step, steps.length, onBack);
		this.setTitle(current.title);
		this.renderHeroIcon(current.icon);
		this.renderBody(current.text, { center: true });
		if (current.link) {
			const links = this.contentEl.createDiv({ cls: "nous-wizard-link-row" });
			links.createEl("a", { text: current.link.text, href: current.link.href });
		}

		const isLast = step === steps.length - 1;
		this.renderPrimary(isLast ? "Finish" : "Next", () => {
			if (isLast) return this.finish();
			this.renderTour(step + 1);
		});
		this.renderSkip("Skip", () => this.finish());
	}

	private tourSteps(): {
		title: string;
		icon: string;
		text: string;
		link?: { text: string; href: string };
	}[] {
		const steps: ReturnType<OnboardingModal["tourSteps"]> = [];

		steps.push({
			title: "One loop",
			icon: "refresh-cw",
			text: `Capture anything. It comes back tagged and linked in ${this.plugin.settings.meetingsFolder}.`,
		});

		steps.push({
			title: "Voice notes",
			icon: "mic",
			// Doesn't say "transcribed on this machine" - that's only true
			// with local whisper.cpp set up; the cloud (Gemini/OpenAI key)
			// path is just as real a default, so the tour stays silent on
			// which one runs (§3 Tour slides spec).
			text: "Click, talk, click again. It becomes a note.",
			link: {
				text: "Dictate from anywhere with Handy (optional)",
				href: "https://github.com/AndyMDH/obsidian-nous/blob/main/docs/USAGE.md",
			},
		});

		if (Platform.isMacOS) {
			steps.push({
				title: "Meetings",
				icon: "audio-lines",
				text: "For when someone else is talking - calls or in person. A live note opens for your questions.",
				link: {
					text: "How meetings work",
					href: "https://github.com/AndyMDH/obsidian-nous/blob/main/docs/USAGE.md",
				},
			});
		}

		steps.push({
			title: "That is everything",
			icon: "sparkles",
			text: "Wikis build themselves. Set hotkeys for capture in Settings → Hotkeys.",
			link: {
				text: "Read the docs",
				href: "https://github.com/AndyMDH/obsidian-nous/tree/main/docs",
			},
		});

		return steps;
	}

	// Drops a sample note on every exit from here - someone who clicks Finish
	// straight off the finish screen still gets to see the capture ->
	// enrichment payoff instead of an empty vault. createSampleNote() and
	// processInbox() are both idempotent, so a second run (the tour reopened
	// from its command) is a harmless no-op.
	private async finish() {
		this.finished = true;
		this.plugin.settings.onboarded = true;
		await this.plugin.saveSettings();
		await this.plugin.ensureCoreFolders();
		this.close();
		await this.plugin.createSampleNote();
		void this.plugin.processInbox();
	}
}
