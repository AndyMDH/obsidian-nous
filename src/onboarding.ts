// Shown via settingsNotice(), which already appends its own clickable "Open
// Nous settings" link - spelling out the click-path in the text too was
// redundant on top of that link (two ways to say "go here" in one bubble).
export const MEETING_RECORDER_MISSING_NOTICE = "Meeting recorder isn't installed yet.";

export const ONBOARDING_PREREQUISITES_TEXT =
	"Text, images, and PDFs work after that choice. Voice notes also need speech-to-text: local whisper.cpp on macOS, or a Gemini/OpenAI key used only for transcription. For meetings on macOS, install the native Nous recorder. If speech-to-text is not ready yet, Nous still saves the recording and finishes it later.";

export const NATIVE_RECORDER_INSTALL_DESC =
	"Nous downloads its recorder, checks it, and uses it automatically.";

export type MeetingCapturePrerequisite = "ready-native" | "needs-recorder" | "needs-permission" | "unsupported";

export interface CapturePrerequisiteStatus {
	voiceReady: boolean;
	meeting: MeetingCapturePrerequisite;
}

export interface CapturePrerequisiteItem {
	name: string;
	desc: string;
	warning: boolean;
}

export type NativeRecorderReadinessState =
	| "unsupported"
	| "missing"
	| "installed"
	| "recording"
	| "needs-permission"
	| "error";

export interface NativeRecorderReadiness {
	state: NativeRecorderReadinessState;
	command: string | null;
	version: string | null;
	detail: string;
}

export function hasGeminiOrOpenAiTranscriptionKey(apiKeys: { gemini?: string; openai?: string }): boolean {
	return !!(apiKeys.gemini?.trim() || apiKeys.openai?.trim());
}

export function capturePrerequisiteItems(status: CapturePrerequisiteStatus): CapturePrerequisiteItem[] {
	return [
		{
			name: "Text, images, and PDFs",
			desc: "Ready.",
			warning: false,
		},
		{
			name: "Voice notes",
			desc: status.voiceReady
				? "Ready."
				: "Needs speech-to-text: use Download model below plus \"brew install whisper-cpp\", or add a Gemini/OpenAI key.",
			warning: !status.voiceReady,
		},
		{
			name: "Meeting capture",
			desc:
				status.meeting === "ready-native"
					? status.voiceReady
						? "Ready."
						: "Ready to record - transcripts wait in the inbox until speech-to-text is set up."
					: status.meeting === "needs-permission"
						? "Installed, but the last recording attempt failed - allow microphone and screen/audio recording permissions, then try again."
						: status.meeting === "unsupported"
							? "macOS only."
							: "Needs the native recorder - click Install below.",
			warning: status.meeting === "needs-recorder" || status.meeting === "needs-permission",
		},
	];
}

export function shouldOfferNativeRecorderInstall(status: CapturePrerequisiteStatus): boolean {
	return status.meeting === "needs-recorder";
}

export function capturePrerequisitesContinueText(status: CapturePrerequisiteStatus): string {
	if (status.meeting === "needs-recorder") return "Continue without meeting capture";
	return "Continue";
}

export function onboardingFinishTitle(status: CapturePrerequisiteStatus): string {
	if (status.voiceReady && status.meeting === "ready-native") return "Nous is ready";
	if (status.voiceReady && status.meeting === "unsupported") {
		return "Text and voice capture are ready";
	}
	return "Text capture is ready";
}

export function onboardingFinishNextActions(status: CapturePrerequisiteStatus): CapturePrerequisiteItem[] {
	const actions: CapturePrerequisiteItem[] = [];
	if (!status.voiceReady) {
		actions.push({
			name: "Voice notes",
			desc: "Use Download model in Settings -> Voice capture, or add a Gemini/OpenAI key.",
			warning: true,
		});
	}
	if (status.meeting === "needs-recorder") {
		actions.push({
			name: "Meeting capture",
			desc: "Install it from Settings -> Meeting capture.",
			warning: true,
		});
	} else if (status.meeting === "needs-permission") {
		actions.push({
			name: "Meeting capture",
			desc: "Allow microphone and screen/audio recording permissions, then try the phone button again.",
			warning: true,
		});
	} else if (status.meeting === "unsupported") {
		actions.push({
			name: "Meeting capture",
			desc: "macOS-only. This device still captures text, images, PDFs, and voice notes.",
			warning: false,
		});
	} else if (!status.voiceReady) {
		actions.push({
			name: "Meeting transcripts",
			desc: "Recordings save now - transcripts wait in the inbox until speech-to-text is set up.",
			warning: false,
		});
	}
	return actions;
}

export function nativeRecorderReadinessText(status: NativeRecorderReadiness): string {
	const command = status.command ? ` Path: ${status.command}.` : "";
	const version = status.version ? ` Version: ${status.version}.` : "";
	switch (status.state) {
		case "unsupported":
			return "Meeting recording is macOS-only.";
		case "missing":
			return `Not installed. Click Install to add the native Nous recorder.${command}`;
		case "recording":
			return `Recording now.${command}${version}`;
		case "needs-permission":
			return `Installed, but the last start failed. Try the phone button again after allowing microphone and screen/audio recording permissions.${command}${version} ${status.detail}`.trim();
		case "error":
			return `Could not check the recorder.${command}${version} ${status.detail}`.trim();
		case "installed":
		default:
			return `Installed and ready.${command}${version}`.trim();
	}
}
