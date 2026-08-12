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
			]
		),
	]
)
