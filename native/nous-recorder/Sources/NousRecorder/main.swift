import AVFoundation
import CoreMedia
import Foundation
import MachO
import ScreenCaptureKit

struct RecorderState: Codable {
	let pid: Int32
	let output: String
	let startedAt: String
}

enum RecorderError: Error, CustomStringConvertible {
	case usage(String)
	case noDisplay
	case screenCaptureUnavailable
	case captureStart(String)
	case writer(String)

	var description: String {
		switch self {
		case .usage(let message):
			return message
		case .noDisplay:
			return "No display is available for ScreenCaptureKit audio capture."
		case .screenCaptureUnavailable:
			return "ScreenCaptureKit is unavailable on this macOS version."
		case .captureStart(let message):
			return message
		case .writer(let message):
			return message
		}
	}
}

struct Options {
	var command: String
	var recordingsDir: URL?
	var output: URL?
	var stateFile: URL?

	static func parse(_ args: [String]) throws -> Options {
		guard let command = args.first else {
			throw RecorderError.usage(Self.help)
		}
		if command == "--help" || command == "help" {
			throw RecorderError.usage(Self.help)
		}
		if command == "--version" || command == "version" {
			return Options(command: "version")
		}

		var options = Options(command: command)
		var idx = 1
		while idx < args.count {
			let arg = args[idx]
			guard idx + 1 < args.count else {
				throw RecorderError.usage("Missing value for \(arg).\n\n\(Self.help)")
			}
			let value = URL(fileURLWithPath: NSString(string: args[idx + 1]).expandingTildeInPath)
			switch arg {
			case "--recordings-dir":
				options.recordingsDir = value
			case "--output":
				options.output = value
			case "--state-file":
				options.stateFile = value
			default:
				throw RecorderError.usage("Unknown argument: \(arg)\n\n\(Self.help)")
			}
			idx += 2
		}
		return options
	}

	static let help = """
	nous-recorder start --recordings-dir <dir>
	nous-recorder stop --recordings-dir <dir>
	nous-recorder status --recordings-dir <dir>

	Internal:
	nous-recorder record --output <Recording.qma> --state-file <state.json>
	"""
}

@main
struct NousRecorderCLI {
	static func main() async {
		do {
			let options = try Options.parse(Array(CommandLine.arguments.dropFirst()))
			try await run(options)
		} catch let error as RecorderError {
			fputs("\(error.description)\n", stderr)
			exit(error.description == Options.help ? 0 : 1)
		} catch {
			fputs("\(error)\n", stderr)
			exit(1)
		}
	}

	private static func run(_ options: Options) async throws {
		switch options.command {
		case "version":
			print("nous-recorder 0.1.0")
		case "status":
			let dir = try requiredRecordingsDir(options)
			let state = readState(in: dir)
			let recording = state.map { isProcessAlive($0.pid) } ?? false
			if !recording {
				removeState(in: dir)
			}
			printJSON(["recording": recording, "output": recording ? (state?.output ?? "") : ""])
		case "start":
			try start(options)
		case "stop":
			try await stop(options)
		case "record":
			try await record(options)
		default:
			throw RecorderError.usage("Unknown command: \(options.command)\n\n\(Options.help)")
		}
	}

	private static func requiredRecordingsDir(_ options: Options) throws -> URL {
		guard let dir = options.recordingsDir else {
			throw RecorderError.usage("--recordings-dir is required.\n\n\(Options.help)")
		}
		return dir
	}

	private static func stateURL(in recordingsDir: URL) -> URL {
		recordingsDir.appendingPathComponent(".nous-recorder-state.json")
	}

	private static func readState(in recordingsDir: URL) -> RecorderState? {
		let url = stateURL(in: recordingsDir)
		guard let data = try? Data(contentsOf: url) else { return nil }
		return try? JSONDecoder().decode(RecorderState.self, from: data)
	}

	private static func writeState(_ state: RecorderState, in recordingsDir: URL) throws {
		let data = try JSONEncoder().encode(state)
		try data.write(to: stateURL(in: recordingsDir), options: [.atomic])
	}

	private static func removeState(in recordingsDir: URL) {
		try? FileManager.default.removeItem(at: stateURL(in: recordingsDir))
	}

	private static func isProcessAlive(_ pid: Int32) -> Bool {
		guard pid > 0 else { return false }
		return kill(pid, 0) == 0
	}

	// argv[0] is only the bare command name when the parent resolved us via
	// PATH (Obsidian's plugin does), and Foundation would then look for it
	// relative to the working directory - "The file "nous-recorder" doesn't
	// exist" with NSFilePath=$HOME/nous-recorder. Ask the kernel for the real
	// executable path instead.
	private static func selfExecutableURL() -> URL {
		var size = UInt32(4096)
		var buffer = [CChar](repeating: 0, count: Int(size))
		if _NSGetExecutablePath(&buffer, &size) != 0 {
			buffer = [CChar](repeating: 0, count: Int(size))
			_ = _NSGetExecutablePath(&buffer, &size)
		}
		let raw = String(cString: buffer)
		if !raw.isEmpty {
			return URL(fileURLWithPath: raw).resolvingSymlinksInPath()
		}
		return URL(fileURLWithPath: CommandLine.arguments[0])
	}

	private static func start(_ options: Options) throws {
		let recordingsDir = try requiredRecordingsDir(options)
		try FileManager.default.createDirectory(at: recordingsDir, withIntermediateDirectories: true)

		if let existing = readState(in: recordingsDir), isProcessAlive(existing.pid) {
			printJSON(["recording": true, "output": existing.output])
			return
		}
		removeState(in: recordingsDir)

		let output = recordingsDir.appendingPathComponent("\(recordingStamp()) Meeting recording.qma")
		try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

		let child = Process()
		child.executableURL = selfExecutableURL()
		child.arguments = [
			"record",
			"--output", output.path,
			"--state-file", stateURL(in: recordingsDir).path,
		]

		let logURL = recordingsDir.appendingPathComponent(".nous-recorder.log")
		FileManager.default.createFile(atPath: logURL.path, contents: nil)
		let log = try FileHandle(forWritingTo: logURL)
		try log.seekToEnd()
		child.standardOutput = log
		child.standardError = log
		try child.run()

		let state = RecorderState(
			pid: child.processIdentifier,
			output: output.path,
			startedAt: ISO8601DateFormatter().string(from: Date())
		)
		try writeState(state, in: recordingsDir)
		printJSON(["recording": true, "output": output.path])
	}

	private static func stop(_ options: Options) async throws {
		let recordingsDir = try requiredRecordingsDir(options)
		guard let state = readState(in: recordingsDir), isProcessAlive(state.pid) else {
			removeState(in: recordingsDir)
			printJSON(["recording": false, "output": ""])
			return
		}

		kill(state.pid, SIGTERM)
		for _ in 0..<100 {
			if !isProcessAlive(state.pid) {
				break
			}
			try await Task.sleep(nanoseconds: 100_000_000)
		}
		printJSON(["recording": false, "output": state.output])
	}

	private static func record(_ options: Options) async throws {
		guard let output = options.output, let stateFile = options.stateFile else {
			throw RecorderError.usage("record requires --output and --state-file.\n\n\(Options.help)")
		}
		try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: stateFile) }

		guard #available(macOS 14.0, *) else {
			throw RecorderError.screenCaptureUnavailable
		}
		let recorder = try MeetingRecorder(outputFolder: output)
		do {
			try await recorder.start()
		} catch {
			throw RecorderError.captureStart(
				"Could not start meeting capture. Allow microphone and screen/audio recording permissions in macOS Privacy & Security for Obsidian and the Nous recorder helper, then try again. Underlying error: \(error)"
			)
		}
		let trap = SignalTrap()
		await trap.wait()
		await recorder.stop()
	}

	private static func recordingStamp() -> String {
		let formatter = DateFormatter()
		formatter.locale = Locale(identifier: "en_US_POSIX")
		formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
		return formatter.string(from: Date())
	}

	private static func printJSON(_ object: [String: Any]) {
		let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
		print(String(data: data, encoding: .utf8) ?? "{}")
	}
}

final class SignalTrap {
	private var sources: [DispatchSourceSignal] = []

	func wait() async {
		await withCheckedContinuation { continuation in
			let queue = DispatchQueue(label: "nous-recorder.signals")
			var resumed = false
			let resumeOnce = {
				guard !resumed else { return }
				resumed = true
				continuation.resume()
			}

			for signalNumber in [SIGTERM, SIGINT] {
				signal(signalNumber, SIG_IGN)
				let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: queue)
				source.setEventHandler(handler: resumeOnce)
				source.resume()
				sources.append(source)
			}
		}
	}
}

@available(macOS 14.0, *)
final class MeetingRecorder: NSObject, SCStreamOutput {
	private let outputFolder: URL
	private let systemWriter: SampleBufferAudioWriter
	private let micWriter: SampleBufferAudioWriter
	private let sampleQueue = DispatchQueue(label: "nous-recorder.samples")
	private var stream: SCStream?

	init(outputFolder: URL) throws {
		self.outputFolder = outputFolder
		self.systemWriter = try SampleBufferAudioWriter(url: outputFolder.appendingPathComponent("sys.m4a"))
		self.micWriter = try SampleBufferAudioWriter(url: outputFolder.appendingPathComponent("mic.m4a"))
		super.init()
	}

	func start() async throws {
		let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
		guard let display = content.displays.first else {
			throw RecorderError.noDisplay
		}
		let ownBundleID = Bundle.main.bundleIdentifier
		let excludedApps = content.applications.filter { app in
			guard let ownBundleID else { return false }
			return app.bundleIdentifier == ownBundleID
		}

		let filter = SCContentFilter(display: display, excludingApplications: excludedApps, exceptingWindows: [])
		let config = SCStreamConfiguration()
		config.width = 2
		config.height = 2
		config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
		config.queueDepth = 3
		config.capturesAudio = true
		config.excludesCurrentProcessAudio = true
		if #available(macOS 15.0, *) {
			config.captureMicrophone = true
		}

		let stream = SCStream(filter: filter, configuration: config, delegate: nil)
		try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
		if #available(macOS 15.0, *) {
			try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: sampleQueue)
		}
		try await stream.startCapture()
		self.stream = stream
	}

	func stop() async {
		try? await stream?.stopCapture()
		await systemWriter.finish()
		await micWriter.finish()
	}

	func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
		guard sampleBuffer.isValid else { return }
		switch outputType {
		case .audio:
			systemWriter.append(sampleBuffer)
		case .microphone:
			micWriter.append(sampleBuffer)
		default:
			return
		}
	}
}

final class SampleBufferAudioWriter {
	private let url: URL
	private let lock = NSLock()
	private var writer: AVAssetWriter?
	private var input: AVAssetWriterInput?
	private var started = false

	init(url: URL) throws {
		self.url = url
	}

	func append(_ sampleBuffer: CMSampleBuffer) {
		lock.lock()
		defer { lock.unlock() }

		do {
			if writer == nil {
				try prepareWriter(for: sampleBuffer)
			}
			guard let writer, let input else { return }
			if !started {
				writer.startWriting()
				writer.startSession(atSourceTime: sampleBuffer.presentationTimeStamp)
				started = true
			}
			if input.isReadyForMoreMediaData {
				input.append(sampleBuffer)
			}
		} catch {
			fputs("nous-recorder writer error for \(url.path): \(error)\n", stderr)
		}
	}

	private func prepareWriter(for sampleBuffer: CMSampleBuffer) throws {
		let formatDescription = sampleBuffer.formatDescription
		let audioDescription = formatDescription.flatMap { CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee }
		let sampleRate = audioDescription?.mSampleRate ?? 48_000
		let channels = max(1, Int(audioDescription?.mChannelsPerFrame ?? 2))
		let settings: [String: Any] = [
			AVFormatIDKey: kAudioFormatMPEG4AAC,
			AVSampleRateKey: sampleRate,
			AVNumberOfChannelsKey: channels,
			AVEncoderBitRateKey: 128_000,
		]

		let writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
		let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
		input.expectsMediaDataInRealTime = true
		guard writer.canAdd(input) else {
			throw RecorderError.writer("Cannot add audio input for \(url.path).")
		}
		writer.add(input)
		self.writer = writer
		self.input = input
	}

	func finish() async {
		let (writer, input, didStart) = takeFinishState()

		guard didStart, let writer, let input else {
			try? FileManager.default.removeItem(at: url)
			return
		}
		input.markAsFinished()
		await withCheckedContinuation { continuation in
			writer.finishWriting {
				continuation.resume()
			}
		}
		if writer.status != .completed {
			fputs("nous-recorder failed to finish \(url.path): \(writer.error?.localizedDescription ?? "unknown error")\n", stderr)
			try? FileManager.default.removeItem(at: url)
		}
	}

	private func takeFinishState() -> (AVAssetWriter?, AVAssetWriterInput?, Bool) {
		lock.lock()
		defer { lock.unlock() }
		let writer = self.writer
		let input = self.input
		let didStart = self.started
		self.writer = nil
		self.input = nil
		self.started = false
		return (writer, input, didStart)
	}
}
