import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

const assetName = "nous-recorder-macos-universal";
const candidates = [
	"native/nous-recorder/.build/apple/Products/Release/nous-recorder",
	"native/nous-recorder/.build/release/nous-recorder",
];
const source = candidates.find((path) => existsSync(path));

if (!source) {
	process.stderr.write(`Could not find built nous-recorder. Tried:\n${candidates.map((p) => `- ${p}`).join("\n")}\n`);
	process.exit(1);
}

mkdirSync("dist", { recursive: true });
const target = join("dist", assetName);
copyFileSync(source, target);
chmodSync(target, 0o755);

const hash = createHash("sha256").update(readFileSync(target)).digest("hex");
writeFileSync(`${target}.sha256`, `${hash}  ${assetName}\n`);
process.stdout.write(`Packaged ${target}\n`);
process.stdout.write(`${hash}  ${assetName}\n`);
