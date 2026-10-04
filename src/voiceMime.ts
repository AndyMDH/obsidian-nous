// afconvert (CoreAudio) can read AIFF/WAV/CAF/M4A/MP3 but not WebM/Opus, so
// local transcription silently fails if the browser records WebM (Chromium's
// default with no mimeType hint) - ask for an afconvert-readable container
// first and only fall back to WebM if the platform truly can't produce one.
const PREFERRED_VOICE_MIME_TYPES = ["audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm"];
export function pickVoiceMimeType(): string | undefined {
	return PREFERRED_VOICE_MIME_TYPES.find(
		(type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
	);
}
