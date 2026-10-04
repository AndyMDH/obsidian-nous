import { App, Modal, Setting } from "obsidian";
import type NousPlugin from "../../main.ts";
import { RealtimeTranscriber, type RealtimeSocket } from "../realtimeTranscribe.ts";
import { nousNotice } from "./notice.ts";
import { pickVoiceMimeType } from "../voiceMime.ts";

// "ws" (live/streaming voice transcription - see src/realtimeTranscribe.ts)
// is different from the modules above: it's an npm package, not a Node
// builtin, so window.require("ws") would fail (nothing ships a
// node_modules/ws alongside main.js in an installed plugin). Instead it's
// bundled straight into main.js by esbuild (deliberately left out of the
// `external` array), so a dynamic import() of it resolves against the
// bundle's own internal module registry rather than a real specifier - safe
// even though a dynamic import() of an actual Node builtin like
// child_process is not (see loadNodeModules() in main.ts). Still loaded
// lazily, only from the live-transcription path that actually needs it.
let wsModulePromise: Promise<typeof import("ws")> | null = null;
function loadWsModule(): Promise<typeof import("ws")> {
	if (!wsModulePromise) wsModulePromise = import("ws");
	return wsModulePromise;
}

// Live/streaming dictation - Siri-style: transcript text grows while the
// user is still talking, instead of only appearing after Stop. Layered
// strictly on top of the same MediaRecorder capture toggleVoiceCapture()
// already uses: the recorder starts first and keeps running unconditionally
// as the safety net, so if the OpenAI Realtime side never connects, drops
// mid-recording, or errors, the recording itself is never at risk - stop
// still produces a normal saved file that falls through to the unchanged
// batch transcription pipeline exactly as if this modal had never opened.
export class LiveVoiceCaptureModal extends Modal {
	private stream: MediaStream | null = null;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private audioCtx: AudioContext | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private transcriber: RealtimeTranscriber | null = null;
	// Finalized segments (server VAD committed them) plus whatever partial
	// text is still in flight for the current, not-yet-committed segment.
	private segments: string[] = [];
	private partial = "";
	// Set once Stop/Cancel/onClose has been handled, so the three
	// overlapping close paths (button, Esc/click-outside triggering
	// onClose, stopAndClose() calling this.close() which re-triggers
	// onClose) run the stop/save logic exactly once.
	private handled = false;
	// Set when the live connection drops mid-recording after some segments
	// were already committed - forces stopAndClose() to discard those
	// partial segments and let the batch pipeline re-transcribe the full
	// recording, instead of silently saving a transcript truncated at the
	// drop point (see onError below).
	private liveDropped = false;
	private statusEl: HTMLElement | null = null;
	private transcriptEl: HTMLElement | null = null;

	constructor(app: App, private plugin: NousPlugin) {
		super(app);
		this.modalEl.addClass("nous-modal");
	}

	onOpen() {
		this.setTitle("Live voice capture (beta)");
		this.statusEl = this.contentEl.createEl("p", { text: "Starting…", cls: "setting-item-description" });
		this.transcriptEl = this.contentEl.createDiv({ text: "Listening…" });
		this.transcriptEl.setCssStyles({ minHeight: "4em", whiteSpace: "pre-wrap" });

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => void this.cancel()))
			.addButton((b) => b.setButtonText("Stop").setCta().onClick(() => void this.stopAndClose()));

		void this.start();
	}

	private renderTranscript() {
		const text = [...this.segments, this.partial].filter(Boolean).join(" ");
		this.transcriptEl?.setText(text || "Listening…");
	}

	private async start() {
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			nousNotice("Can't hear you - allow microphone access for Obsidian in System Settings.", 8000);
			this.close();
			return;
		}

		// Stop/Cancel/Esc can land while getUserMedia() was still pending -
		// stopAndClose()/cancel() already ran with this.recorder/this.stream
		// still null, set handled=true, and closed the modal. Without this
		// check, the code below would start a real MediaRecorder (and live
		// transcription) on an instance nothing can reach any more -
		// stopAndClose()/cancel() both bail immediately when handled is
		// already true, so it could never be stopped except by quitting
		// Obsidian. Tear the stream down instead of using it.
		if (this.handled) {
			this.stream.getTracks().forEach((t) => t.stop());
			this.stream = null;
			return;
		}

		// The existing, unmodified MediaRecorder path - starts first and
		// independently of the live-transcription setup below.
		const mimeType = pickVoiceMimeType();
		const recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};
		recorder.start();
		this.recorder = recorder;
		this.plugin.setVoiceRecordingIndicator(true);

		try {
			await this.startLiveTranscription();
			this.statusEl?.setText("🔴 Listening…");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.teardownLiveTranscription();
			this.statusEl?.setText("Live transcription unavailable - finishing as a normal recording.");
			await this.plugin.appendLog(`ERROR: live transcription failed to start - ${msg}`);
		}
	}

	private async startLiveTranscription() {
		const { WebSocket: WsCtor } = await loadWsModule();
		const transcriber = new RealtimeTranscriber({
			apiKey: this.plugin.settings.apiKeys.openai,
			wsFactory: (url, headers) => new WsCtor(url, { headers }) as unknown as RealtimeSocket,
			onPartial: (text) => {
				this.partial = text;
				this.renderTranscript();
			},
			onSegmentDone: (text) => {
				if (text.trim()) this.segments.push(text.trim());
				this.partial = "";
				this.renderTranscript();
			},
			onError: (message) => {
				// Also fires from our own close()/connection teardown on
				// stop - handled is already true by then, so this is only
				// a real mid-recording drop when it's still false.
				if (this.handled) return;
				this.liveDropped = true;
				this.teardownLiveTranscription();
				this.statusEl?.setText("Live transcription dropped - still recording, will transcribe after stop.");
				void this.plugin.appendLog(`ERROR: live transcription connection dropped - ${message}`);
			},
		});
		transcriber.connect();
		this.transcriber = transcriber;

		// {sampleRate: 24000} is only a hint - some platforms clamp to the
		// hardware rate, which is why sendAudioChunk() downsamples using
		// the AudioContext's actual sampleRate rather than assuming 24kHz.
		const ctx = new AudioContext({ sampleRate: 24000 });
		this.audioCtx = ctx;
		const source = ctx.createMediaStreamSource(this.stream as MediaStream);

		// A tiny inline AudioWorkletProcessor, registered via a Blob URL -
		// no new asset needs to ship with the plugin for this. It just
		// forwards each render quantum's Float32 samples to the main thread.
		const workletUrl = URL.createObjectURL(
			new Blob(
				[
					`class NousPcmWorklet extends AudioWorkletProcessor {
						process(inputs) {
							const channel = inputs[0]?.[0];
							if (channel) this.port.postMessage(channel.slice());
							return true;
						}
					}
					registerProcessor("nous-pcm-worklet", NousPcmWorklet);`,
				],
				{ type: "application/javascript" }
			)
		);
		try {
			await ctx.audioWorklet.addModule(workletUrl);
		} finally {
			URL.revokeObjectURL(workletUrl);
		}
		const worklet = new AudioWorkletNode(ctx, "nous-pcm-worklet");
		worklet.port.onmessage = (event: MessageEvent) => {
			this.transcriber?.sendAudioChunk(event.data as Float32Array, ctx.sampleRate);
		};
		// Deliberately not connected to ctx.destination - that would echo
		// the user's own mic back out through their speakers.
		source.connect(worklet);
		this.workletNode = worklet;
	}

	// Tears down only the live-transcription side (WS/worklet/context) -
	// the MediaRecorder keeps running untouched, per the fallback matrix.
	private teardownLiveTranscription() {
		this.transcriber?.close();
		this.transcriber = null;
		this.workletNode?.disconnect();
		this.workletNode = null;
		void this.audioCtx?.close();
		this.audioCtx = null;
	}

	async stopAndClose() {
		if (this.handled) return;
		this.handled = true;
		this.teardownLiveTranscription();

		const recorder = this.recorder;
		if (recorder && recorder.state !== "inactive") {
			recorder.onstop = () => {
				this.stream?.getTracks().forEach((t) => t.stop());
				this.plugin.setVoiceRecordingIndicator(false);
				// A mid-recording drop means segments/partial only cover audio
				// up to the drop point - using them would silently truncate the
				// note. Pass no transcript so the batch pipeline re-transcribes
				// the complete recording instead, matching the "nothing is
				// lost" fallback promise.
				const transcript = this.liveDropped
					? undefined
					: [...this.segments, this.partial].filter(Boolean).join(" ").trim() || undefined;
				void this.plugin.saveVoiceRecording(recorder.mimeType || "audio/webm", this.chunks, transcript);
			};
			recorder.stop();
		} else {
			// getUserMedia/recorder never got going (e.g. denied) - nothing
			// to save, the earlier Notice already explained why.
			this.plugin.setVoiceRecordingIndicator(false);
		}
		this.close();
	}

	// Explicit, visible discard - distinct from an accidental close, which
	// is treated as Stop (see onClose below), not a silent loss.
	async cancel() {
		if (this.handled) return;
		this.handled = true;
		this.teardownLiveTranscription();
		this.recorder?.stop();
		this.stream?.getTracks().forEach((t) => t.stop());
		this.plugin.setVoiceRecordingIndicator(false);
		nousNotice("Recording tossed - no note made.");
		this.close();
	}

	// Esc / click-outside mid-recording: this codebase never silently
	// drops a capture (see the duplicate-parking behavior in the README),
	// so treat it the same as clicking Stop rather than losing the
	// recording. stopAndClose()/cancel() both set `handled` before calling
	// close() themselves, so this no-ops on those paths.
	onClose() {
		this.plugin.liveCaptureModal = null;
		if (!this.handled) void this.stopAndClose();
		this.contentEl.empty();
	}
}
