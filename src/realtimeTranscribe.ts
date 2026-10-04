// Live/streaming voice transcription via OpenAI's Realtime API,
// transcription-only intent. Opt-in beta layered on top of the existing
// batch pipeline (transcribe.ts) - see main.ts's LiveVoiceCaptureModal for
// how this is wired to the mic and the MediaRecorder safety net.
//
// Kept DOM-free and network-free at this level (no `WebSocket`, no `ws`
// import) so it's testable under the plain-Node test runner - `wsFactory`
// is injected, and production wiring (real `ws` via loadNodeModules()-style
// lazy require) lives in main.ts.
//
// Wire format below was verified against OpenAI's current Realtime API docs
// (developers.openai.com/api/docs/guides/realtime-transcription and the
// linked API reference) as of this writing, not just the design-time plan:
//   - The GA API dropped the `OpenAI-Beta: realtime=v1` header entirely
//     ("Remove the OpenAI-Beta: realtime=v1 header when calling the GA
//     interface") - so it is NOT sent here, unlike older 2024/2025-era
//     examples still circulating online.
//   - Session config is the generic `session.update` event (not the
//     older/legacy `transcription_session.update`, which the OpenAI
//     developer forum reports now errors) with a nested
//     `session.audio.input.{format,transcription,turn_detection}` shape,
//     not the flatter `input_audio_format`/`input_audio_transcription`
//     shape from the legacy beta docs.
//   - `gpt-4o-mini-transcribe` (not the newer `gpt-realtime-whisper`
//     the guide now leads with) is used deliberately: it still supports
//     server-side VAD (`turn_detection: server_vad`), so segments
//     auto-commit without us implementing manual `input_audio_buffer.commit`
//     timing - `gpt-realtime-whisper` requires turn_detection to be null and
//     manual commits, which is out of scope for this v1.
export const OPENAI_REALTIME_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
export const OPENAI_REALTIME_WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

// OpenAI's server_vad defaults to a 500ms silence_duration_ms, which is
// tuned for conversational turn-taking, not dictation - a normal
// mid-sentence "let me think" pause during dictation can easily exceed
// that and get prematurely finalized as a segment. Widen it so natural
// dictation pauses don't fragment the transcript; still auto-commits
// (no manual input_audio_buffer.commit needed), just less trigger-happy.
const DICTATION_SILENCE_DURATION_MS = 700;

// Minimal shape of the injectable socket - matches the subset of `ws`'s
// WebSocket (and the browser WebSocket) that this module actually uses, so
// tests can inject a fake without pulling in a real socket implementation.
export interface RealtimeSocket {
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: string }) => void) | null;
	onerror: ((event: { message?: string }) => void) | null;
	onclose: (() => void) | null;
}

type RealtimeSocketFactory = (url: string, headers: Record<string, string>) => RealtimeSocket;

// Float32 samples (Web Audio's native format, range -1..1) -> base64-encoded
// little-endian PCM16, the wire format `input_audio_buffer.append` expects.
export function float32ToPcm16Base64(samples: Float32Array): string {
	const pcm = new Uint8Array(samples.length * 2);
	const view = new DataView(pcm.buffer);
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
	}
	let binary = "";
	for (let i = 0; i < pcm.length; i++) binary += String.fromCharCode(pcm[i]);
	return btoa(binary);
}

// Only exercised if the AudioContext doesn't honor the {sampleRate: 24000}
// hint passed at construction (some platforms clamp to the hardware rate) -
// the Realtime transcription session requires exactly 24kHz input.
export function downsampleTo(samples: Float32Array, sourceRate: number, targetRate = 24000): Float32Array {
	if (sourceRate === targetRate) return samples;
	const ratio = sourceRate / targetRate;
	const outLength = Math.round(samples.length / ratio);
	const out = new Float32Array(outLength);
	for (let i = 0; i < outLength; i++) {
		out[i] = samples[Math.min(samples.length - 1, Math.round(i * ratio))];
	}
	return out;
}

export function buildTranscriptionSessionUpdate(model = OPENAI_REALTIME_TRANSCRIBE_MODEL): string {
	return JSON.stringify({
		type: "session.update",
		session: {
			type: "transcription",
			audio: {
				input: {
					format: { type: "audio/pcm", rate: 24000 },
					transcription: { model },
					turn_detection: {
						type: "server_vad",
						threshold: 0.5,
						prefix_padding_ms: 300,
						silence_duration_ms: DICTATION_SILENCE_DURATION_MS,
					},
				},
			},
		},
	});
}

export function buildAppendAudioMessage(base64Audio: string): string {
	return JSON.stringify({ type: "input_audio_buffer.append", audio: base64Audio });
}

type RealtimeEvent =
	| { kind: "delta"; text: string }
	| { kind: "completed"; text: string }
	| { kind: "error"; message: string }
	| { kind: "unknown"; type: string };

// Discriminated union over the server events this module cares about -
// everything else (session.created, input_audio_buffer.speech_started, ...)
// comes back as "unknown" and is ignored by RealtimeTranscriber, not
// treated as a failure.
export function parseRealtimeEvent(raw: string): RealtimeEvent {
	let parsed: { type?: string; delta?: string; transcript?: string; error?: { message?: string }; message?: string };
	try {
		parsed = JSON.parse(raw) as typeof parsed;
	} catch {
		return { kind: "error", message: `Realtime API sent non-JSON message: ${raw.slice(0, 200)}` };
	}
	const type = parsed.type ?? "";
	if (type === "conversation.item.input_audio_transcription.delta") {
		return { kind: "delta", text: parsed.delta ?? "" };
	}
	if (type === "conversation.item.input_audio_transcription.completed") {
		return { kind: "completed", text: parsed.transcript ?? "" };
	}
	if (type === "conversation.item.input_audio_transcription.failed" || type === "error") {
		return { kind: "error", message: parsed.error?.message ?? parsed.message ?? `Realtime API error (${type})` };
	}
	return { kind: "unknown", type };
}

interface RealtimeTranscriberOptions {
	apiKey: string;
	wsFactory: RealtimeSocketFactory;
	model?: string;
	// Fired on every incremental delta for the in-progress segment.
	onPartial: (text: string) => void;
	// Fired once a segment is finalized (server VAD detected a turn
	// boundary and committed it) - text is that segment only, not the
	// whole-so-far transcript; callers accumulate.
	onSegmentDone: (text: string) => void;
	onError: (message: string) => void;
}

// Thin wrapper around one Realtime transcription-session WebSocket
// connection: sends session config on open, forwards audio chunks, and
// dispatches parsed server events to the caller's callbacks. Holds no
// transcript state of its own - LiveVoiceCaptureModal (main.ts) owns
// accumulating segments into the final transcript string.
export class RealtimeTranscriber {
	private socket: RealtimeSocket | null = null;
	private readonly options: RealtimeTranscriberOptions;

	constructor(options: RealtimeTranscriberOptions) {
		this.options = options;
	}

	connect(): void {
		const socket = this.options.wsFactory(OPENAI_REALTIME_WS_URL, {
			Authorization: `Bearer ${this.options.apiKey}`,
		});
		this.socket = socket;
		socket.onopen = () => {
			socket.send(buildTranscriptionSessionUpdate(this.options.model));
		};
		socket.onmessage = (event) => {
			const parsed = parseRealtimeEvent(event.data);
			if (parsed.kind === "delta") this.options.onPartial(parsed.text);
			else if (parsed.kind === "completed") this.options.onSegmentDone(parsed.text);
			else if (parsed.kind === "error") this.options.onError(parsed.message);
			// "unknown" events (session.created, speech_started, ...) are
			// expected noise, not surfaced to the caller.
		};
		socket.onerror = (event) => {
			this.options.onError(event.message ?? "Realtime API connection error.");
		};
		socket.onclose = () => {
			this.socket = null;
		};
	}

	// sourceRate lets the caller pass whatever rate the AudioContext actually
	// produced - downsampled to 24kHz here if it didn't honor the hint.
	sendAudioChunk(samples: Float32Array, sourceRate: number): void {
		if (!this.socket) return;
		const resampled = downsampleTo(samples, sourceRate);
		this.socket.send(buildAppendAudioMessage(float32ToPcm16Base64(resampled)));
	}

	close(): void {
		this.socket?.close();
		this.socket = null;
	}
}
