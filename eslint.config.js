import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";

// Nous's own product/vendor names the sentence-case rule doesn't know about -
// without these it would "fix" them down to lowercase (e.g. "quickrecorder").
const PROJECT_BRANDS = [...DEFAULT_BRANDS, "Nous", "GLM", "Claude Code", "Z.ai", "Siri", "Realtime API"];
const PROJECT_ACRONYMS = [...DEFAULT_ACRONYMS, "HEIC"];
// Literal command names and UI option labels, not prose - lowercasing or
// uppercasing part of them (e.g. "whisper-CLI") would make them wrong to
// copy-paste or inconsistent with the dropdown option they're quoting.
const PROJECT_IGNORE_WORDS = ["claude", "whisper-cli", "Local"];

export default defineConfig(
	{
		ignores: ["main.js", "node_modules/**", "examples/**"],
	},
	...tseslint.configs.recommendedTypeChecked,
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
			"@typescript-eslint/no-explicit-any": "warn",
			"no-console": "warn",
			// Redundant with (and less accurate than) the TS compiler for Node
			// globals like `process`/`Buffer` in this desktop-capable plugin -
			// standard typescript-eslint guidance is to turn this off for TS.
			"no-undef": "off",
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: PROJECT_BRANDS,
					acronyms: PROJECT_ACRONYMS,
					ignoreWords: PROJECT_IGNORE_WORDS,
					allowAutoFix: true,
				},
			],
		},
	},
	{
		// Build tooling (esbuild/version-bump scripts, this file) isn't part of
		// tsconfig's "**/*.ts" project, so type-aware rules can't run on it.
		files: ["*.mjs", "*.js", "scripts/*.mjs"],
		extends: [tseslint.configs.disableTypeChecked],
	},
	{
		// Obsidian plugin-guideline rules (mobile compat, UI conventions, API
		// version gating) only make sense for the shipped plugin bundle
		// (main.ts + src/**). Tests run under Node via `node --test`, and the
		// *.mjs files are esbuild/version-bump build tooling - neither ever
		// runs inside Obsidian.
		files: ["test/**", "*.mjs", "scripts/*.mjs"],
		rules: Object.fromEntries(Object.keys(obsidianmd.rules).map((name) => [`obsidianmd/${name}`, "off"])),
	},
	{
		// recommendedTypeChecked (added for the unsafe-any rules on main.ts/src)
		// also turns this on repo-wide as a side effect. Out of scope here - the
		// test suite predates this pass and wasn't part of what was reviewed.
		files: ["test/**"],
		rules: { "@typescript-eslint/no-floating-promises": "off" },
	}
);
