import { App, Platform, PluginSettingTab, Setting, type ButtonComponent, type SettingDefinition, type SettingDefinitionItem, type SettingGroup, type SettingGroupItem } from "obsidian";
import type NousPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, MODEL_OPTIONS, type ApiProvider, type NousSettings } from "../types.ts";
import { NATIVE_RECORDER_INSTALL_DESC, nativeRecorderReadinessText } from "../onboarding.ts";
import { nousNotice } from "./notice.ts";
import { attachCancelButton, wireWhisperInstallButton } from "./controls.ts";
import { NOUS_LOGO_SVG } from "./icons.ts";
import { OnboardingModal } from "./onboardingModal.ts";
import { LlmApiError } from "../llmProvider.ts";
import { DEFAULT_WHISPER_CLI_BIN } from "../whisperModel.ts";

const DEFAULT_CLAUDE_CLI_BIN = "claude";
const LOCAL_BASE_URL_DESC = 'OpenAI-compatible endpoint, e.g. Ollama\'s default "http://localhost:11434/v1".';

export class NousSettingTab extends PluginSettingTab {
	plugin: NousPlugin;
	// Provider whose model dropdown is showing the Custom field. Not persisted.
	private customModelFor: ApiProvider | null = null;
	// Whether rarely-touched fields (CLI paths, folder names, thresholds) are
	// shown. View-only, not persisted - resets to collapsed each time the
	// tab is reopened, same as customModelFor above.
	private showAdvanced = false;

	constructor(app: App, plugin: NousPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Obsidian's declarative getSettingDefinitions() API (below) only exists
	// since 1.13.0 - manifest.json's minAppVersion is kept at 1.6.6 (not
	// bumped to 1.13.0) specifically so pre-1.13.0 installs stay supported,
	// and 1.13.0 is a preview/insider release as of mid-2026 (1.12.7 is
	// current stable), so most installs are still on a runtime that has no
	// working SettingTab.display()/update() at all and
	// throws "e.display is not a function" the moment the tab opens. This
	// display() is a plain fallback that renders the same definitions
	// imperatively. On 1.13.0+, per Obsidian's own docs, display() is simply
	// never called once getSettingDefinitions() returns a non-empty array, so
	// this sits inert there and the native declarative rendering (search,
	// keyboard nav) is untouched.
	display(): void {
		this.renderLegacySettings();
	}

	private renderLegacySettings(): void {
		this.containerEl.empty();
		this.containerEl.addClass("nous-settings");
		// None of this class's render callbacks use the group param below -
		// avoid constructing a real SettingGroup (Obsidian 1.11.0+ only) so
		// this fallback keeps working on the older versions it exists for.
		const group = undefined as unknown as SettingGroup;
		const renderInto = (item: SettingDefinition, container: HTMLElement) => {
			if (!("render" in item) || typeof item.render !== "function") return;
			const setting = new Setting(container);
			if (item.name) setting.setName(item.name);
			if (item.desc) setting.setDesc(item.desc);
			item.render(setting, group);
		};
		for (const item of this.getSettingDefinitions()) {
			// getSettingDefinitions() now nests each section's settings inside a
			// SettingDefinitionGroup instead of a flat setHeading() item (see
			// its comment) - the native 1.13.0+ renderer draws those as real
			// boxed sections on its own, but this fallback still has to build
			// that shape by hand: a heading Setting styled the same way
			// setHeading() items always were, then every nested item rendered
			// the same way a flat item would be. Groups don't nest inside
			// groups (per Obsidian's own type), so one level of unwrapping is
			// enough.
			if ("type" in item && (item.type === "group" || item.type === "list")) {
				// Marked so the small-caps CSS below can target this hand-built
				// heading without also matching Obsidian's native 1.13.0+ group
				// heading - it reuses the identical setting-item/setting-item
				// -heading class names, and our selector previously outranked
				// Obsidian's own (more specific ancestor chain), silently
				// overriding native headings with 11px faint text instead of
				// leaving them at Obsidian's normal, full-contrast styling.
				if (item.heading) {
					new Setting(this.containerEl)
						.setName(item.heading)
						.setHeading()
						.settingEl.addClass("nous-legacy-heading");
				}
				for (const nested of item.items ?? []) {
					renderInto(nested, this.containerEl);
				}
				continue;
			}
			renderInto(item as SettingDefinition, this.containerEl);
		}
	}

	// Same story: this class's `render` callbacks call `this.update()` after
	// a change that should re-render (e.g. switching execution mode reveals
	// different fields below it). On 1.13.0+, defer to the real inherited
	// update() (search indexing etc.); pre-1.13.0 it doesn't exist, so fall
	// back to a plain re-render via display() above.
	update(): void {
		const inherited = (Object.getPrototypeOf(NousSettingTab.prototype) as { update?: () => void }).update;
		if (typeof inherited === "function") {
			inherited.call(this);
		} else {
			this.renderLegacySettings();
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = [];

		items.push({
			name: "",
			// Header (§4): 26px logo badge + "Nous" 17px 600, version right in
			// 12px mono faint. The doc/bug/GitHub links move to a quiet footer
			// at the bottom of the tab, alongside a new "Rerun setup" link.
			render: (setting) => {
				this.containerEl.addClass("nous-settings");
				setting.settingEl.addClass("nous-settings-header");
				setting.settingEl.empty();
				const head = setting.settingEl.createDiv({ cls: "nous-settings-header-inner" });
				const badge = head.createDiv({ cls: "nous-settings-header-badge" });
				const doc = new DOMParser().parseFromString(NOUS_LOGO_SVG, "image/svg+xml");
				badge.appendChild(document.importNode(doc.documentElement, true));
				head.createSpan({ cls: "nous-settings-header-name", text: "Nous" });
				head.createSpan({ cls: "nous-settings-header-version", text: `v${this.plugin.manifest.version}` });
			},
		});

		// Each section becomes a real SettingDefinitionGroup instead of a flat
		// setHeading() item - Obsidian's native 1.13.0+ renderer draws groups
		// as proper boxed sections on its own (no CSS needed for the box);
		// renderLegacySettings() above rebuilds the same setHeading() look by
		// hand for pre-1.13.0 installs. Every conditional below is unchanged
		// from before this restructure - only *where* each item gets pushed
		// (a section's local items array, wrapped in one group) changed.
		const providerItems: SettingGroupItem[] = [];
		providerItems.push({
			name: "Execution mode",
			render: (setting) => {
				setting
					.setDesc(
						this.plugin.settings.executionMode === "cli" ? "No extra billing." : "Billed separately."
					)
					.addDropdown((dropdown) => {
						dropdown
							.addOption("cli", "Claude Code CLI (uses your subscription)")
							.addOption("api", "Direct API key")
							.setValue(this.plugin.settings.executionMode)
							.onChange(async (value) => {
								this.plugin.settings.executionMode = value === "api" ? "api" : "cli";
								await this.plugin.saveSettings();
								this.update();
							});
					});
			},
		});

		providerItems.push({
			name: "Advanced settings",
			render: (setting) => {
				setting
					.setDesc("Defaults work for almost everyone.")
					.addToggle((toggle) =>
						toggle.setValue(this.showAdvanced).onChange((value) => {
							this.showAdvanced = value;
							this.update();
						})
					);
			},
		});

		if (this.plugin.settings.executionMode === "cli" && this.showAdvanced) {
			providerItems.push({
				name: "Claude CLI path",
				render: (setting) => {
					setting
						.setDesc(
							'Command or full path. If "claude" is not found, paste the output of `which claude`.'
						)
						.addText((text) =>
							text
								.setPlaceholder(DEFAULT_CLAUDE_CLI_BIN)
								.setValue(this.plugin.settings.claudeCliPath)
								.onChange(async (value) => {
									this.plugin.settings.claudeCliPath = value.trim() || DEFAULT_CLAUDE_CLI_BIN;
									await this.plugin.saveSettings();
								})
						);
				},
			});
		}
		if (this.plugin.settings.executionMode !== "cli") {
			const provider = this.plugin.settings.apiProvider;
			const providerLabel = {
				anthropic: "Anthropic",
				openai: "OpenAI",
				gemini: "Gemini",
				glm: "GLM",
				local: "Local",
			}[provider];

			providerItems.push({
				name: "Provider",
				render: (setting) => {
					setting
						.setDesc(
							'"local" (for example Ollama) needs no key and sends nothing off this machine.'
						)
						.addDropdown((dropdown) => {
							dropdown
								.addOption("anthropic", "Anthropic")
								.addOption("openai", "OpenAI")
								.addOption("gemini", "Gemini")
								.addOption("glm", "GLM (Z.ai)")
								.addOption("local", "Local (OpenAI-compatible, e.g. Ollama)")
								.setValue(provider)
								.onChange(async (value) => {
									this.plugin.settings.apiProvider = value as ApiProvider;
									await this.plugin.saveSettings();
									this.update();
								});
						});
				},
			});

			if (provider === "local") {
				providerItems.push({
					name: "Base URL",
					render: (setting) => {
						setting.setDesc(LOCAL_BASE_URL_DESC).addText((text) =>
							text.setValue(this.plugin.settings.localBaseUrl).onChange(async (value) => {
								this.plugin.settings.localBaseUrl = value.trim() || DEFAULT_SETTINGS.localBaseUrl;
								await this.plugin.saveSettings();
							})
						);
					},
				});
			} else if (provider === "glm") {
				providerItems.push({
					name: "GLM API key",
					render: (setting) => {
						setting.setDesc("Your Z.ai API key - stored locally in this vault.").addText((text) => {
							text.inputEl.type = "password";
							text.inputEl.autocomplete = "off";
							text.setValue(this.plugin.settings.apiKeys.glm).onChange(async (value) => {
								this.plugin.settings.apiKeys.glm = value.trim();
								await this.plugin.saveSettings();
							});
						});
					},
				});
				providerItems.push({
					name: "Base URL",
					render: (setting) => {
						setting
							.setDesc(
								'For a Coding Plan, use "https://api.z.ai/api/coding/paas/v4".'
							)
							.addText((text) =>
								text.setValue(this.plugin.settings.glmBaseUrl).onChange(async (value) => {
									this.plugin.settings.glmBaseUrl = value.trim() || DEFAULT_SETTINGS.glmBaseUrl;
									await this.plugin.saveSettings();
								})
							);
					},
				});
			} else {
				providerItems.push({
					name: `${providerLabel} API key`,
					render: (setting) => {
						setting
							.setDesc(
								"Stored locally in this vault. Keep the vault out of repos and syncs that you do not control."
							)
							.addText((text) => {
								text.inputEl.type = "password";
								text.inputEl.autocomplete = "off";
								text.setValue(this.plugin.settings.apiKeys[provider]).onChange(async (value) => {
									this.plugin.settings.apiKeys[provider] = value.trim();
									await this.plugin.saveSettings();
								});
							});
					},
				});
			}

			if (provider === "local") {
				providerItems.push({
					name: "Model",
					render: (setting) => {
						setting
							.setDesc('Model your local server should run, e.g. an Ollama model tag like "llama3.1".')
							.addText((text) =>
								text.setValue(this.plugin.settings.models[provider]).onChange(async (value) => {
									this.plugin.settings.models[provider] = value.trim();
									await this.plugin.saveSettings();
								})
							);
					},
				});
			} else {
				const options = MODEL_OPTIONS[provider];
				const current = this.plugin.settings.models[provider];
				const isListed = options.some((o) => o.id === current);
				const showCustom = !isListed || this.customModelFor === provider;
				providerItems.push({
					name: "Model",
					render: (setting) => {
						setting
							.setDesc(`${providerLabel} model used for both enrichment and wiki synthesis.`)
							.addDropdown((dropdown) => {
								for (const o of options) dropdown.addOption(o.id, o.label);
								dropdown.addOption("__custom__", "Custom model ID…");
								dropdown.setValue(showCustom ? "__custom__" : current).onChange(async (value) => {
									if (value === "__custom__") {
										this.customModelFor = provider;
									} else {
										this.customModelFor = null;
										this.plugin.settings.models[provider] = value;
										await this.plugin.saveSettings();
									}
									this.update();
								});
							});
					},
				});
				if (showCustom) {
					providerItems.push({
						name: "Custom model ID",
						render: (setting) => {
							setting
								.setDesc(`Exact ${providerLabel} model id to use instead of the list above.`)
								.addText((text) =>
									text.setValue(current).onChange(async (value) => {
										this.plugin.settings.models[provider] = value.trim();
										await this.plugin.saveSettings();
									})
								);
						},
					});
				}
			}
		}

		providerItems.push({
			name: "Test connection",
			render: (setting) => {
				setting
					.setDesc(
						this.plugin.settings.executionMode === "cli"
							? "Confirms Claude Code is reachable."
							: "Confirms the key and model work."
					)
					.addButton((button) =>
						button.setButtonText("Test").onClick(async () => {
							button.setButtonText("Testing…").setDisabled(true);
							try {
								nousNotice(`${await this.plugin.testConnection()}`);
							} catch (e) {
								const msg =
									e instanceof LlmApiError
										? `${e.message} (HTTP ${e.status})`
										: e instanceof Error
											? e.message
											: String(e);
								nousNotice(`Couldn't connect - ${msg}`, 10000);
							} finally {
								button.setButtonText("Test").setDisabled(false);
							}
						})
					);
			},
		});

		providerItems.push({
			name: "Auto-process on capture",
			render: (setting) => {
				setting
					.setDesc("Enrich new notes automatically, within seconds.")
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.autoProcessOnCreate).onChange(async (value) => {
							this.plugin.settings.autoProcessOnCreate = value;
							await this.plugin.saveSettings();
						})
				);
			},
		});
		items.push({ type: "group", heading: "Provider", cls: "nous-settings-group", items: providerItems });

		const meetingItems: SettingGroupItem[] = [];

		// Unconditional on macOS, like Voice capture's "Local speech-to-text" status
		// below - whether meeting capture actually works is basic info every
		// user needs, not an advanced setting. Without this, the whole
		// Meeting capture group rendered as an empty heading with nothing
		// under it for every non-advanced user, since every other item here
		// requires showAdvanced.
		if (Platform.isMacOS) {
			meetingItems.push({
				name: "Native recorder status",
				render: (setting) => {
					const refreshStatus = async (button?: ButtonComponent) => {
						button?.setButtonText("Checking...").setDisabled(true);
						setting.setDesc("Checking native recorder status...");
						try {
							const status = await this.plugin.getNativeRecorderReadiness();
							setting.setDesc(nativeRecorderReadinessText(status));
							button?.setButtonText(status.state === "needs-permission" ? "Recheck after you retry the meeting button" : "Refresh");
							setting.settingEl.toggleClass(
								"mod-warning",
								status.state === "missing" || status.state === "needs-permission" || status.state === "error"
							);
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e);
							setting.setDesc(`Could not check the native recorder: ${msg}`);
							setting.settingEl.toggleClass("mod-warning", true);
						} finally {
							button?.setDisabled(false);
						}
					};

					setting
						.setClass("nous-status-row")
						.setDesc("Checking native recorder status...")
						.addButton((button) => button.setButtonText("Refresh").onClick(() => void refreshStatus(button)));
					void refreshStatus();
				},
			});
			meetingItems.push({
				name: "Native recorder helper",
				render: (setting) => {
					setting
						.setDesc(NATIVE_RECORDER_INSTALL_DESC)
						.addButton((button) =>
							button.setButtonText("Install/update").onClick(async () => {
								button.setButtonText("Installing...").setDisabled(true);
								try {
									const installedPath = await this.plugin.installNativeRecorderFromRelease();
									nousNotice(`Recorder installed at ${installedPath} - ready to go.`);
									this.update();
								} catch (e) {
									const msg = e instanceof Error ? e.message : String(e);
									nousNotice(`Recorder install didn't work - ${msg}`, 12000);
								} finally {
									button.setButtonText("Install/update").setDisabled(false);
								}
							})
						);
				},
			});
		} else {
			meetingItems.push({
				name: "",
				render: (setting) => {
					setting.setDesc("Meeting capture needs macOS.").setClass("setting-item-description");
				},
			});
		}

		// Basic, not advanced: who "you" are decides which action items a note keeps.
		meetingItems.push({
			name: "Your name",
			render: (setting) => {
				setting
					.setDesc(
						"Action items keep only your own commitments. Other people's tasks that affect you go under Watch. Leave empty to use the Me: speaker."
					)
					.addText((text) =>
						text
							.setPlaceholder("Andy")
							.setValue(this.plugin.settings.ownerName)
							.onChange(async (value) => {
								this.plugin.settings.ownerName = value.trim();
								await this.plugin.saveSettings();
								// CLI mode reads the name from the skill files, so rewrite them.
								await this.plugin.ensureSkillsInstalled(true);
							})
					);
			},
		});

		if (this.showAdvanced) {
			meetingItems.push({
				name: "Wiki threshold",
				render: (setting) => {
					setting
						.setDesc("Number of non-fragment meeting notes a tag needs before a wiki hub page is created for it.")
						.addText((text) =>
							text.setValue(String(this.plugin.settings.wikiThreshold)).onChange(async (value) => {
								const n = parseInt(value, 10);
								if (!Number.isNaN(n) && n > 0) {
									this.plugin.settings.wikiThreshold = n;
									await this.plugin.saveSettings();
								} else {
									nousNotice("Wiki threshold needs a whole number above 0 - not saved.", 6000);
								}
							})
						);
				},
			});

			if (this.plugin.settings.executionMode === "api") {
				// CLI mode's duplicate check lives in the skill - nothing to configure here.
				meetingItems.push({
					name: "Duplicate-check lookback",
					render: (setting) => {
						setting
							.setDesc(
								"How many recent notes to check for duplicates and related links."
							)
							.addText((text) =>
								text.setValue(String(this.plugin.settings.dedupLookback)).onChange(async (value) => {
									const n = parseInt(value, 10);
									if (!Number.isNaN(n) && n > 0) {
										this.plugin.settings.dedupLookback = n;
										await this.plugin.saveSettings();
									} else {
										nousNotice("Duplicate-check lookback needs a whole number above 0 - not saved.", 6000);
									}
								})
							);
					},
				});
			}
		}
		items.push({ type: "group", heading: "Meeting capture", cls: "nous-settings-group", items: meetingItems });

		const voiceItems: SettingGroupItem[] = [];

		// Speech-to-text setup lives here, not only in the wizard - every
		// "waiting on speech-to-text" notice and the recording popup's Cloud
		// row send the user to this tab, so both routes (local install, cloud
		// key) must actually be reachable from it in every execution mode.
		if (Platform.isMacOS) {
			voiceItems.push({
				name: "Local speech-to-text",
				render: (setting) => {
					setting.setDesc("Checking…");
					void Promise.all([this.plugin.hasWhisperModel(), this.plugin.hasWhisperCli()]).then(
						([hasModel, hasCli]) => {
							if (hasModel && hasCli) {
								setting.setDesc("Ready. Runs on this Mac, nothing leaves it.");
								return;
							}
							const step = hasModel ? "cli" : "model";
							setting.setDesc(
								step === "cli"
									? "Model downloaded. One more install, through Homebrew."
									: "Not installed. One download (~574 MB), then one install. Fully private."
							);
							setting.addButton((button) => {
								button.setCta();
								wireWhisperInstallButton(button.buttonEl, this.plugin, step, () => this.update());
							});
						}
					);
				},
			});
		}

		// Transcription uses a Gemini or OpenAI key whatever the execution
		// mode is, but the Provider group only shows the key of the selected
		// API provider (and none at all in CLI mode). Skipped when that same
		// key field is already on screen above.
		const speechKeyItem = (provider: "gemini" | "openai", name: string, desc: string) => {
			if (this.plugin.settings.executionMode === "api" && this.plugin.settings.apiProvider === provider) return;
			voiceItems.push({
				name,
				render: (setting) => {
					setting.setDesc(desc).addText((text) => {
						text.inputEl.type = "password";
						text.inputEl.autocomplete = "off";
						text
							.setPlaceholder("Paste your key")
							.setValue(this.plugin.settings.apiKeys[provider])
							.onChange(async (value) => {
								this.plugin.settings.apiKeys[provider] = value.trim();
								await this.plugin.saveSettings();
							});
					});
				},
			});
		};
		speechKeyItem("gemini", "Gemini API key for speech-to-text", "Optional. Used only to turn speech into text.");
		speechKeyItem(
			"openai",
			"OpenAI API key for speech-to-text",
			"Optional. Used only to turn speech into text, and for live captions."
		);

		voiceItems.push({
			name: "Live voice transcription (beta)",
			render: (setting) => {
				setting
					.setDesc("Live captions while you talk. Needs an OpenAI key.")
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.liveTranscriptionEnabled).onChange(async (value) => {
							this.plugin.settings.liveTranscriptionEnabled = value;
							await this.plugin.saveSettings();
							this.update();
						})
					);
			},
		});
		if (this.plugin.settings.liveTranscriptionEnabled && !this.plugin.settings.apiKeys.openai) {
			voiceItems.push({
				name: "",
				render: (setting) => {
					setting
						.setDesc("Needs an OpenAI API key - until then, voice capture works normally (non-live).")
						.setClass("mod-warning");
				},
			});
		}

		// Basic, not advanced: hiding the recording indicators is a one-time choice every user may want.
		if (Platform.isMacOS) {
		voiceItems.push({
			name: "Discreet recording",
			render: (setting) => {
				setting
					.setDesc(
						"No red icon, timer, or popup while a meeting records. The live note shows only your notes, and the transcript still arrives when you stop."
					)
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.discreetRecording).onChange(async (value) => {
							this.plugin.settings.discreetRecording = value;
							await this.plugin.saveSettings();
						})
					);
			},
		});
		}

		if (this.showAdvanced) {
			voiceItems.push({
				name: "Whisper CLI path",
				render: (setting) => {
					setting
						.setDesc(
							'Command or full path to whisper-cli ("brew install whisper-cpp"). macOS only.'
						)
						.addText((text) =>
							text
								.setPlaceholder(DEFAULT_WHISPER_CLI_BIN)
								.setValue(this.plugin.settings.whisperCliPath)
								.onChange(async (value) => {
									this.plugin.settings.whisperCliPath = value.trim() || DEFAULT_WHISPER_CLI_BIN;
									await this.plugin.saveSettings();
								})
						);
				},
			});

			voiceItems.push({
				name: "Whisper model path",
				render: (setting) => {
					setting
						.setDesc(
							"Leave blank for the default location."
						)
						.addText((text) =>
							text
								.setPlaceholder(this.plugin.defaultWhisperModelPath())
								.setValue(this.plugin.settings.whisperModelPath)
								.onChange(async (value) => {
									this.plugin.settings.whisperModelPath = value.trim();
									await this.plugin.saveSettings();
								})
						);
				},
			});

			if (Platform.isMacOS) {
				voiceItems.push({
					name: "Faster, less accurate model",
					render: (setting) => {
						setting
							.setDesc("Swaps to a smaller model. Transcripts run quicker and miss more.")
							.addButton((button) =>
								button.setButtonText("Switch").onClick(() => {
									button.setDisabled(true).setButtonText("Downloading…");
									const cancel = attachCancelButton(button.buttonEl, () =>
										this.plugin.cancelWhisperDownload()
									);
									void this.plugin.downloadFastWhisperModelWithNotice().then((ok) => {
										cancel.remove();
										if (ok) {
											this.update();
											return;
										}
										button.setDisabled(false).setButtonText("Switch");
									});
								})
							);
					},
				});
			}
		}
		items.push({ type: "group", heading: "Voice capture", cls: "nous-settings-group", items: voiceItems });

		// Vault is its own group, but - same as before this restructure -
		// only shown at all once Advanced settings is on.
		if (this.showAdvanced) {
			const vaultItems: SettingGroupItem[] = [];
			const folderSetting = (key: keyof NousSettings, name: string): SettingGroupItem => ({
				name,
				render: (setting) => {
					setting.addText((text) => {
						// Folder values sit right-aligned in mono (§4) - they
						// read as paths, not prose.
						text.inputEl.addClass("nous-mono-input");
						text.setValue(this.plugin.settings[key] as string).onChange(async (value) => {
							// An empty folder path isn't just cosmetically wrong -
							// it makes isInInbox() match startsWith("/"), which is
							// never true, so captures silently stop being picked
							// up at all.
							(this.plugin.settings[key] as string) = value.trim() || (DEFAULT_SETTINGS[key] as string);
							await this.plugin.saveSettings();
						});
					});
				},
			});
			vaultItems.push(folderSetting("inboxFolder", "Inbox folder"));
			vaultItems.push(folderSetting("meetingsFolder", "Meetings folder"));
			vaultItems.push(folderSetting("wikisFolder", "Wikis folder"));
			vaultItems.push(folderSetting("tagsFolder", "Tags folder"));
			vaultItems.push(folderSetting("queriesFolder", "Queries folder"));
			items.push({ type: "group", heading: "Vault", cls: "nous-settings-group", items: vaultItems });
		}

		// Footer (§4): quiet underlined links, mono-adjacent to the header's
		// version stamp rather than crowding it at the top of the tab.
		items.push({
			name: "",
			render: (setting) => {
				setting.settingEl.addClass("nous-settings-footer");
				setting.settingEl.empty();
				const footer = setting.settingEl.createDiv({ cls: "nous-settings-footer-inner" });
				const rerun = footer.createEl("a", { text: "Rerun setup", href: "#" });
				rerun.addEventListener("click", (event) => {
					event.preventDefault();
					new OnboardingModal(this.app, this.plugin).open();
				});
				footer.createEl("a", { text: "Docs", href: "https://github.com/AndyMDH/obsidian-nous/tree/main/docs" });
				footer.createEl("a", { text: "Report a bug", href: "https://github.com/AndyMDH/obsidian-nous/issues" });
				footer.createEl("a", { text: "GitHub", href: "https://github.com/AndyMDH/obsidian-nous" });
			},
		});

		return items;
	}
}
