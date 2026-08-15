export const VOICE_TRANSCRIPTION_SETUP_NOTICE =
	"Nous: speech-to-text isn't set up yet - one click in Settings → Nous → Voice capture fixes it.";

export const MEETING_RECORDER_MISSING_NOTICE =
	"Nous: meeting recorder not installed - Settings → Nous → Meeting capture → Install.";

export const ONBOARDING_PREREQUISITES_TEXT =
	"Text, images, and PDFs work after that choice. Voice notes also need speech-to-text: local whisper.cpp on macOS, or a Gemini/OpenAI key used only for transcription. For meetings on macOS, install the native Nous recorder. If speech-to-text is not ready yet, Nous still saves the recording and finishes it later.";

export const VOICE_CAPTURE_SETTINGS_DESC =
	"Voice notes need speech-to-text: local whisper.cpp, or a Gemini/OpenAI key used only for transcription.";

export const NATIVE_RECORDER_INSTALL_DESC =
	"Nous downloads its recorder, checks it, and uses it automatically.";

export type MeetingCapturePrerequisite = "ready-native" | "needs-recorder" | "unsupported";

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
					: status.meeting === "unsupported"
						? "macOS only."
						: "Needs the native recorder - click Install below.",
			warning: status.meeting === "needs-recorder",
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

export function onboardingFinishIntro(
	status: CapturePrerequisiteStatus,
	inboxFolder: string,
	meetingsFolder: string
): string {
	if (onboardingFinishTitle(status) === "Nous is ready") {
		return `Drop anything into "${inboxFolder}" - text, images, PDFs, voice notes, or meeting recordings - it comes out tagged and linked in "${meetingsFolder}".`;
	}
	return `Text, images, and PDFs are ready now - drop them into "${inboxFolder}", they come out tagged in "${meetingsFolder}".`;
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
