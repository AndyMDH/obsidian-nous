import CoreMedia
import Foundation
import Speech

// Live, on-device transcription for one audio track, streamed to a JSONL
// file that the plugin tails. Built on Apple's Speech framework so users
// install nothing: the OS ships the models. Every failure path degrades to
// "no live text" - the recording itself must never be affected.
//
// SFSpeech buffer requests only mark results final when the audio ends, so
// the request is rotated every ~20 seconds: the old request is closed (its
// final text is committed) while a fresh one keeps consuming buffers. The
// plugin shows committed lines plus the newest partial; the whisper pass at
// stop replaces everything with the final-quality transcript.
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
}

final class LiveTranscriber: @unchecked Sendable {
	private let track: String
	private let writer: LiveTranscriptWriter
	private let recognizer: SFSpeechRecognizer
	private let queue = DispatchQueue(label: "nous-live-transcriber")
	private var request: SFSpeechAudioBufferRecognitionRequest?
	private var task: SFSpeechRecognitionTask?
	private var latestPartial = ""
	private var stopped = false
	private var rotationTimer: DispatchSourceTimer?

	// nil when live transcription is unavailable - the caller records without it.
	init?(track: String, writer: LiveTranscriptWriter) {
		guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer() else {
			return nil
		}
		guard recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else { return nil }
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

	static func requestAuthorization(timeoutSeconds: Double = 3) -> Bool {
		if SFSpeechRecognizer.authorizationStatus() == .authorized { return true }
		let semaphore = DispatchSemaphore(value: 0)
		var granted = false
		SFSpeechRecognizer.requestAuthorization { status in
			granted = status == .authorized
			semaphore.signal()
		}
		_ = semaphore.wait(timeout: .now() + timeoutSeconds)
		return granted
	}

	func append(_ sampleBuffer: CMSampleBuffer) {
		queue.async {
			guard !self.stopped else { return }
			self.request?.appendAudioSampleBuffer(sampleBuffer)
		}
	}

	func finish() {
		queue.sync {
			self.stopped = true
			self.rotationTimer?.cancel()
			self.rotationTimer = nil
			self.request?.endAudio()
		}
		// Give the recognizer a moment to deliver the last final result.
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
