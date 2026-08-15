// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "nous-recorder",
	platforms: [.macOS(.v14)],
	products: [
		.executable(name: "nous-recorder", targets: ["NousRecorder"]),
	],
	targets: [
		.executableTarget(
			name: "NousRecorder",
			path: "Sources/NousRecorder",
			swiftSettings: [
				.unsafeFlags(["-parse-as-library"]),
			],
			linkerSettings: [
				// Embed an Info.plist so the unbundled binary can request
				// Speech authorization (TCC requires a usage description).
				.unsafeFlags([
					"-Xlinker", "-sectcreate",
					"-Xlinker", "__TEXT",
					"-Xlinker", "__info_plist",
					"-Xlinker", "Sources/NousRecorder/Info.plist",
				]),
			]
		),
	]
)
