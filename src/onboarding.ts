export const VOICE_TRANSCRIPTION_SETUP_NOTICE =
	"Nous: voice capture needs speech-to-text setup first - install local whisper.cpp on macOS, or add a Gemini/OpenAI key in Settings -> Nous. No recording started.";

export const MEETING_RECORDER_MISSING_NOTICE =
	"Nous: meeting capture needs the native nous-recorder helper. If you have not installed it yet, use the older QuickRecorder setup as a fallback; QuickRecorder is not part of macOS.";

export const QUICKRECORDER_MISSING_NOTICE = MEETING_RECORDER_MISSING_NOTICE;

export const ONBOARDING_PREREQUISITES_TEXT =
	"Text, images, and PDFs work after that choice. Voice notes also need speech-to-text: local whisper.cpp on macOS, or a Gemini/OpenAI key used only for transcription. Meeting capture on macOS works best with the native nous-recorder helper; QuickRecorder is the fallback and is not part of macOS.";

export const ONBOARDING_FINISH_PREREQUISITES_TEXT =
	"For voice notes, set up local whisper.cpp or add a Gemini/OpenAI key. For meeting capture, install the native nous-recorder helper first; QuickRecorder remains available as a fallback and is not part of macOS.";

export const VOICE_CAPTURE_SETTINGS_DESC =
	"Voice memos need a speech-to-text backend: local whisper.cpp on macOS, or a Gemini/OpenAI key used only for transcription. Without one, Nous will not start mic capture.";

export type MeetingCapturePrerequisite = "ready-native" | "ready-quickrecorder" | "needs-recorder" | "unsupported";

export interface CapturePrerequisiteStatus {
	voiceReady: boolean;
	meeting: MeetingCapturePrerequisite;
}

export interface CapturePrerequisiteItem {
	name: string;
	desc: string;
	warning: boolean;
}

export function hasGeminiOrOpenAiTranscriptionKey(apiKeys: { gemini?: string; openai?: string }): boolean {
	return !!(apiKeys.gemini?.trim() || apiKeys.openai?.trim());
}

export function capturePrerequisiteItems(status: CapturePrerequisiteStatus): CapturePrerequisiteItem[] {
	return [
		{
			name: "Text, images, and PDFs",
			desc: "Ready after the connection check.",
			warning: false,
		},
		{
			name: "Voice notes",
			desc: status.voiceReady
				? "Ready - speech-to-text is configured."
				: "Needs speech-to-text first: install local whisper.cpp on macOS, or add a Gemini/OpenAI key. Nous will not start recording until this is set.",
			warning: !status.voiceReady,
		},
		{
			name: "Meeting capture",
			desc:
				status.meeting === "ready-native"
					? "Ready - native Nous Recorder is installed."
					: status.meeting === "ready-quickrecorder"
						? "Ready - using QuickRecorder fallback."
					: status.meeting === "unsupported"
						? "macOS only. Other platforms can still use text, file, and voice-note capture."
						: "Needs the native nous-recorder helper, or QuickRecorder as a fallback. QuickRecorder is not part of macOS.",
			warning: status.meeting === "needs-recorder",
		},
	];
}
