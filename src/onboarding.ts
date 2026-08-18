// Shown via settingsNotice(), which already appends its own clickable "Open
// Nous settings" link - spelling out the click-path in the text too was
// redundant on top of that link (two ways to say "go here" in one bubble).
export const MEETING_RECORDER_MISSING_NOTICE = "Meeting recorder isn't installed yet.";

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
			// Short on purpose - the button right here handles step one, and
			// step two (also a button, no Terminal needed) only shows up once
			// step one is done. Still says "two steps," not "download this
			// and you're set" - the model alone was the exact silent-success
			// bug this screen used to have.
			desc: status.voiceReady
				? "Ready."
				: "Needs speech-to-text - two one-click installs, no Terminal.",
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
						? "Installed, but the last attempt failed - check mic/screen recording permissions, then try again."
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
	// "...without meeting capture" used to read like giving it up for good
	// to a first-time user, rather than "set it up later" - it's just
	// deferred, reachable any time from Settings -> Nous.
	if (status.meeting === "needs-recorder") return "Continue - set up meeting capture later";
	return "Continue";
}

export function onboardingFinishTitle(status: CapturePrerequisiteStatus): string {
	if (status.voiceReady && status.meeting === "ready-native") return "Nous is ready";
	if (status.voiceReady && status.meeting === "unsupported") {
		return "Text and voice capture are ready";
	}
	return "Text capture is ready";
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
			return `Installed, but the last start failed - check mic/screen recording permissions, then try again.${command}${version} ${status.detail}`.trim();
		case "error":
			return `Could not check the recorder.${command}${version} ${status.detail}`.trim();
		case "installed":
		default:
			return `Installed and ready.${command}${version}`.trim();
	}
}
