import AVFoundation
import CoreMedia
import Foundation
import Speech

// Live, on-device transcription. TCC forces a two-process design:
//
// - The record process must stay attributed to the launching app (Obsidian)
//   so its existing screen/microphone grants keep working.
// - Speech recognition must run under this binary's OWN identity, because
//   the usage description lives in our embedded Info.plist, not Obsidian's.
//
// So the record process spawns `nous-recorder live` as a DISCLAIMED child
// (responsible for itself), streams it converted PCM over stdin, and the
// child runs Apple's recognizer and appends lines to live.jsonl. Every
// failure on this path degrades to "no live text"; the recording itself is
// never affected.

// Private but long-stable: marks a spawned child as responsible for itself,
// so TCC reads usage descriptions from the child's binary instead of the
// launching app's.
@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(
	_ attrs: UnsafeMutablePointer<posix_spawnattr_t?>,
	_ disclaim: Int32
) -> Int32

// ---------------------------------------------------------------------------
// Shared wire format: [track: u8 (0 sys, 1 mic)][frames: u32 LE][float32 mono 16 kHz]

let livePacketSampleRate = 16_000.0

// ---------------------------------------------------------------------------
// Record-process side: converts each track to 16 kHz mono and feeds the
// disclaimed live child over a pipe.

final class LiveFeeder: @unchecked Sendable {
	private let queue = DispatchQueue(label: "nous-live-feeder")
	private var stdinHandle: FileHandle?
	private var childPid: pid_t = 0
	private var converters: [UInt8: AVAudioConverter] = [:]
	private var disabled = false
	private let outFormat = AVAudioFormat(
		commonFormat: .pcmFormatFloat32,
		sampleRate: livePacketSampleRate,
		channels: 1,
		interleaved: false
	)!

	init?(executable: String, liveFileURL: URL) {
		let stdinPipe = Pipe()

		var fileActions: posix_spawn_file_actions_t?
		posix_spawn_file_actions_init(&fileActions)
		defer { posix_spawn_file_actions_destroy(&fileActions) }
		posix_spawn_file_actions_adddup2(&fileActions, stdinPipe.fileHandleForReading.fileDescriptor, 0)

		var attrs: posix_spawnattr_t?
		posix_spawnattr_init(&attrs)
		defer { posix_spawnattr_destroy(&attrs) }
		_ = responsibility_spawnattrs_setdisclaim(&attrs, 1)

		let args = [executable, "live", "--output", liveFileURL.path]
		let argv: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) } + [nil]
		defer { argv.forEach { free($0) } }

		var pid: pid_t = 0
		let result = posix_spawn(&pid, executable, &fileActions, &attrs, argv, environ)
		try? stdinPipe.fileHandleForReading.close()
		guard result == 0 else {
			fputs("nous-recorder: could not spawn live transcriber (posix_spawn \(result)); live transcript disabled\n", stderr)
			return nil
		}
		childPid = pid
		stdinHandle = stdinPipe.fileHandleForWriting
		// Non-blocking writes: if the child stalls (permission prompt, slow
		// recognizer), packets are dropped instead of wedging the recorder.
		let fd = stdinPipe.fileHandleForWriting.fileDescriptor
		let flags = fcntl(fd, F_GETFL)
		_ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
	}

	func append(track: UInt8, sampleBuffer: CMSampleBuffer) {
		queue.async {
			guard !self.disabled, let stdin = self.stdinHandle else { return }
			guard let payload = self.convert(track: track, sampleBuffer: sampleBuffer) else { return }
			var packet = Data([track])
			var frames = UInt32(payload.count / 4).littleEndian
			withUnsafeBytes(of: &frames) { packet.append(contentsOf: $0) }
			packet.append(payload)
			let written = packet.withUnsafeBytes { raw -> Int in
				Darwin.write(stdin.fileDescriptor, raw.baseAddress, raw.count)
			}
			if written < 0 {
				let err = errno
				if err == EAGAIN || err == EWOULDBLOCK {
					// Pipe full - drop this packet, the live view just lags.
					return
				}
				// Child gone (denied permission, crash) - stop feeding, keep recording.
				self.disabled = true
				try? stdin.close()
				self.stdinHandle = nil
			}
		}
	}

	func finish() {
		// Close the pipe without waiting on the feeder queue: with blocking
		// writes gone this cannot wedge, but a bounded wait keeps the stop
		// path safe against anything unexpected.
		let semaphore = DispatchSemaphore(value: 0)
		queue.async {
			try? self.stdinHandle?.close()
			self.stdinHandle = nil
			self.disabled = true
			semaphore.signal()
		}
		_ = semaphore.wait(timeout: .now() + 2)

		// Give the child a moment to commit its last line, then make sure it
		// is gone - it must never outlive the recording.
		var status: Int32 = 0
		for _ in 0..<20 {
			if waitpid(childPid, &status, WNOHANG) == childPid { return }
			usleep(100_000)
		}
		kill(childPid, SIGTERM)
		for _ in 0..<10 {
			if waitpid(childPid, &status, WNOHANG) == childPid { return }
			usleep(100_000)
		}
		kill(childPid, SIGKILL)
		_ = waitpid(childPid, &status, 0)
	}

	// Runs on `queue`.
	private func convert(track: UInt8, sampleBuffer: CMSampleBuffer) -> Data? {
		guard let description = CMSampleBufferGetFormatDescription(sampleBuffer) else { return nil }
		let inFormat = AVAudioFormat(cmAudioFormatDescription: description)
		let frameCount = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
		guard frameCount > 0, let inBuffer = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: frameCount) else {
			return nil
		}
		inBuffer.frameLength = frameCount
		let copyStatus = CMSampleBufferCopyPCMDataIntoAudioBufferList(
			sampleBuffer,
			at: 0,
			frameCount: Int32(frameCount),
			into: inBuffer.mutableAudioBufferList
		)
		guard copyStatus == noErr else { return nil }

		if converters[track] == nil {
			converters[track] = AVAudioConverter(from: inFormat, to: outFormat)
		}
		guard let converter = converters[track] else { return nil }

		let capacity = AVAudioFrameCount(Double(frameCount) * livePacketSampleRate / inFormat.sampleRate) + 16
		guard let outBuffer = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return nil }
		var served = false
		var conversionError: NSError?
		converter.convert(to: outBuffer, error: &conversionError) { _, status in
			if served {
				status.pointee = .noDataNow
				return nil
			}
			served = true
			status.pointee = .haveData
			return inBuffer
		}
		guard conversionError == nil, outBuffer.frameLength > 0, let channel = outBuffer.floatChannelData else {
			return nil
		}
		return Data(bytes: channel[0], count: Int(outBuffer.frameLength) * 4)
	}
}

final class Atomic<T>: @unchecked Sendable {
	private let lock = NSLock()
	private var value: T
	init(_ value: T) { self.value = value }
	func get() -> T { lock.lock(); defer { lock.unlock() }; return value }
	func set(_ newValue: T) { lock.lock(); defer { lock.unlock() }; value = newValue }
}

// ---------------------------------------------------------------------------
// Disclaimed child: owns Speech authorization and recognition.

func runLiveSubcommand(outputURL: URL) {
	// Authorization may sit behind a user prompt for a while. stdin must be
	// drained the whole time - a full pipe would stall the recorder - so the
	// request runs in the background and packets are dropped until granted.
	let authorized = Atomic(false)
	let authDone = Atomic(false)
	DispatchQueue.global().async {
		authorized.set(requestSpeechAuthorization())
		authDone.set(true)
	}

	let writer = LiveTranscriptWriter(url: outputURL)
	var transcribers: [UInt8: LiveTranscriber] = [:]
	let trackNames: [UInt8: String] = [0: "sys", 1: "mic"]

	let stdin = FileHandle.standardInput
	var buffer = Data()
	while true {
		guard let chunk = try? stdin.read(upToCount: 65_536), !chunk.isEmpty else { break }
		if authDone.get(), !authorized.get() {
			fputs("nous-recorder live: speech recognition not authorized; draining until stop\n", stderr)
			// Keep draining so the recorder never blocks, but do no work.
			buffer.removeAll(keepingCapacity: false)
			while let more = try? stdin.read(upToCount: 65_536), !more.isEmpty {}
			return
		}
		if !authDone.get() {
			// Still waiting on the prompt: drop audio, keep the pipe moving.
			continue
		}
		buffer.append(chunk)
		while buffer.count >= 5 {
			let track = buffer[buffer.startIndex]
			let frames = buffer.subdata(in: buffer.startIndex + 1..<buffer.startIndex + 5).withUnsafeBytes {
				UInt32(littleEndian: $0.load(as: UInt32.self))
			}
			let payloadBytes = Int(frames) * 4
			guard buffer.count >= 5 + payloadBytes else { break }
			let payload = buffer.subdata(in: buffer.startIndex + 5..<buffer.startIndex + 5 + payloadBytes)
			buffer.removeFirst(5 + payloadBytes)

			guard let name = trackNames[track] else { continue }
			if transcribers[track] == nil {
				transcribers[track] = LiveTranscriber(track: name, writer: writer)
			}
			transcribers[track]?.append(pcm: payload)
		}
	}
	for transcriber in transcribers.values {
		transcriber.finish()
	}
	writer.flush()
}

private func requestSpeechAuthorization(timeoutSeconds: Double = 60) -> Bool {
	if SFSpeechRecognizer.authorizationStatus() == .authorized { return true }
	let semaphore = DispatchSemaphore(value: 0)
	var granted = false
	SFSpeechRecognizer.requestAuthorization { status in
		granted = status == .authorized
		semaphore.signal()
	}
	// Generous timeout: the user may be reading the permission prompt.
	_ = semaphore.wait(timeout: .now() + timeoutSeconds)
	return granted
}

final class LiveTranscriptWriter: @unchecked Sendable {
	private let queue = DispatchQueue(label: "nous-live-writer")
	private let url: URL

	init(url: URL) {
		self.url = url
	}

	func append(_ object: [String: Any]) {
		queue.async {
			guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
			if !FileManager.default.fileExists(atPath: self.url.path) {
				FileManager.default.createFile(atPath: self.url.path, contents: nil)
			}
			guard let handle = try? FileHandle(forWritingTo: self.url) else { return }
			defer { try? handle.close() }
			_ = try? handle.seekToEnd()
			try? handle.write(contentsOf: data)
			try? handle.write(contentsOf: Data("\n".utf8))
		}
	}

	func flush() {
		queue.sync {}
	}
}

final class LiveTranscriber: @unchecked Sendable {
	private let track: String
	private let writer: LiveTranscriptWriter
	private let recognizer: SFSpeechRecognizer
	private let queue = DispatchQueue(label: "nous-live-transcriber")
	private let format = AVAudioFormat(
		commonFormat: .pcmFormatFloat32,
		sampleRate: livePacketSampleRate,
		channels: 1,
		interleaved: false
	)!
	private var request: SFSpeechAudioBufferRecognitionRequest?
	private var task: SFSpeechRecognitionTask?
	private var latestPartial = ""
	private var stopped = false
	private var rotationTimer: DispatchSourceTimer?

	init?(track: String, writer: LiveTranscriptWriter) {
		guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer() else {
			return nil
		}
		guard recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
			fputs("nous-recorder live: on-device recognition unavailable for \(track)\n", stderr)
			return nil
		}
		self.track = track
		self.writer = writer
		self.recognizer = recognizer

		queue.sync { self.startRequest() }

		let timer = DispatchSource.makeTimerSource(queue: queue)
		timer.schedule(deadline: .now() + 20, repeating: 20)
		timer.setEventHandler { [weak self] in self?.rotateRequest() }
		timer.resume()
		rotationTimer = timer
	}

	func append(pcm: Data) {
		queue.async {
			guard !self.stopped, let request = self.request else { return }
			let frames = AVAudioFrameCount(pcm.count / 4)
			guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: self.format, frameCapacity: frames) else {
				return
			}
			buffer.frameLength = frames
			pcm.withUnsafeBytes { raw in
				buffer.floatChannelData![0].update(
					from: raw.bindMemory(to: Float.self).baseAddress!,
					count: Int(frames)
				)
			}
			request.append(buffer)
		}
	}

	func finish() {
		queue.sync {
			self.stopped = true
			self.rotationTimer?.cancel()
			self.rotationTimer = nil
			self.request?.endAudio()
		}
		Thread.sleep(forTimeInterval: 0.8)
		queue.sync {
			self.task?.cancel()
			self.task = nil
			self.request = nil
		}
	}

	// Runs on `queue`.
	private func startRequest() {
		let request = SFSpeechAudioBufferRecognitionRequest()
		request.requiresOnDeviceRecognition = true
		request.shouldReportPartialResults = true
		if #available(macOS 13.0, *) {
			request.addsPunctuation = true
		}
		self.request = request
		self.latestPartial = ""
		self.task = recognizer.recognitionTask(with: request) { [weak self] result, error in
			guard let self else { return }
			self.queue.async { self.handle(result: result, error: error) }
		}
	}

	// Runs on `queue`.
	private func rotateRequest() {
		guard !stopped else { return }
		request?.endAudio()
		startRequest()
	}

	// Runs on `queue`.
	private func handle(result: SFSpeechRecognitionResult?, error: Error?) {
		if let result {
			let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
			if result.isFinal {
				if !text.isEmpty {
					writer.append(["type": "final", "track": track, "text": text])
				}
				latestPartial = ""
				return
			}
			if !text.isEmpty, text != latestPartial {
				latestPartial = text
				writer.append(["type": "partial", "track": track, "text": text])
			}
			return
		}
		if error != nil, !stopped, request == nil {
			startRequest()
		}
	}
}
