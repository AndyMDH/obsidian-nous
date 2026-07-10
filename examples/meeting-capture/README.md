# Record meetings with one hotkey (macOS)

Press a hotkey when a meeting starts, press it again when it ends — a
speaker-labeled transcript ("Me:" / "Them:") lands in your Cortex inbox and
comes out as an enriched note. Everything runs on your Mac: the recording
never leaves your machine, and no API key is used for transcription.

This is the setup for **calls with other people** (Teams/Zoom/Meet — it
captures system audio *and* your mic). For solo voice notes, the plugin's
built-in "Toggle voice capture" hotkey is all you need.

> Recording is silent to other participants — treat it as personal
> note-taking and follow your workplace/client norms and local law.

## One-time setup (~10 minutes)

**1. QuickRecorder** (free, open source) — records system audio + your mic:

```bash
# Download from https://github.com/lihaoyun6/QuickRecorder/releases
# drag QuickRecorder.app into /Applications, then preconfigure it:
mkdir -p ~/Movies/MeetingRecordings
defaults write com.lihaoyun6.QuickRecorder saveDirectory -string "$HOME/Movies/MeetingRecordings"
defaults write com.lihaoyun6.QuickRecorder recordMic -bool true
defaults write com.lihaoyun6.QuickRecorder enableAEC -bool true
defaults write com.lihaoyun6.QuickRecorder showPreview -bool false
# Bind Option+M as a start/stop toggle (key code 46 = M):
defaults write com.lihaoyun6.QuickRecorder KeyboardShortcuts_startWithAudio -string '{"carbonKeyCode":46,"carbonModifiers":2048}'
defaults write com.lihaoyun6.QuickRecorder KeyboardShortcuts_stop -string '{"carbonKeyCode":46,"carbonModifiers":2048}'
open -a QuickRecorder   # add it to Login Items in System Settings too
```

**2. whisper.cpp** — local speech-to-text:

```bash
brew install whisper-cpp
mkdir -p ~/.local/share/whisper-models
curl -L -o ~/.local/share/whisper-models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
curl -L -o ~/.local/share/whisper-models/ggml-silero-v5.1.2.bin \
  https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin
```

**3. The transcriber** — edit `VAULT` at the top of
[`meeting-transcribe.sh`](meeting-transcribe.sh) (and `INBOX_FOLDER` if you
renamed it), then install it with the launchd job from
[`com.example.meetingtranscribe.plist`](com.example.meetingtranscribe.plist)
(instructions in its comments).

**4. Test it**: play any video, press ⌥M, talk over it for 30 seconds, press
⌥M again. First run triggers macOS microphone + screen/system-audio
permission prompts — allow them. Within a couple of minutes a "Meeting
transcript" note appears in your inbox, and Cortex enriches it.

## How it works

QuickRecorder saves the call as two tracks (everyone else / you). The
watcher converts them with macOS's built-in `afconvert`, transcribes both
with whisper.cpp (voice-activity detection strips silence), interleaves them
by timestamp into "Me:" / "Them:" dialogue, and writes the transcript into
your inbox. Processed recordings are kept 30 days in
`MeetingRecordings/Processed/`, failures are parked loudly in `Failed/`.
