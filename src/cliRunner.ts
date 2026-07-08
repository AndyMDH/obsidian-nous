// CLI execution mode: instead of calling the Anthropic API directly, shell
// out to the Claude Code CLI and let its own agentic Read/Write/Bash loop do
// the work, exactly like the original bash-based Cortex's run.sh. This file
// only holds pure helpers (command construction, PATH handling, log
// summarizing) - the actual process-spawning lives in main.ts, next to the
// httpPost wiring, since both are the one place that's allowed to touch
// Node/Obsidian runtime APIs directly.

export interface CliExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

export type CliExec = (
	command: string,
	args: string[],
	options: { cwd: string; env: Record<string, string> }
) => Promise<CliExecResult>;

// GUI apps on macOS (Obsidian included, since it's Electron) typically start
// with a minimal PATH inherited from launchd/Finder, not the full PATH a
// login shell builds from .zshrc etc - so `claude` often resolves fine in
// Terminal but not here. Mirrors the same fallback list the bash version's
// launchd plist template uses.
export function augmentedPath(existingPath: string, homeDir: string, extraDir: string | null): string {
	const extras = [extraDir, "/opt/homebrew/bin", "/usr/local/bin", `${homeDir}/.local/bin`].filter(
		(p): p is string => !!p
	);
	return [...extras, existingPath].join(":");
}

export function buildEnrichArgs(inboxFolder: string): string[] {
	return [
		"-p",
		`Use the meeting-enricher skill to process all files in ${inboxFolder}/.`,
		"--allowedTools",
		"Read,Write,Edit,Glob,Grep,Bash",
		"--permission-mode",
		"acceptEdits",
	];
}

export function buildWikiArgs(meetingsFolder: string): string[] {
	return [
		"-p",
		`Use the wiki-builder skill to create or update wiki pages based on ${meetingsFolder}/.`,
		"--allowedTools",
		"Read,Write,Edit,Glob,Grep,Bash",
		"--permission-mode",
		"acceptEdits",
	];
}

export function buildQueryArgs(question: string): string[] {
	return [
		"-p",
		`Use the vault-query skill to answer this question: ${question}`,
		"--allowedTools",
		"Read,Glob,Grep",
	];
}

export interface LogSummary {
	enriched: number;
	newWikis: number;
	updatedWikis: number;
	problems: number;
}

// Mirrors run.sh's own notification logic: count event lines appended to
// .cortex/pipeline.log by this run, rather than trying to parse the raw
// (verbose, unstructured) CLI output.
export function summarizeLogLines(newLines: string): LogSummary {
	const count = (pattern: RegExp) => (newLines.match(pattern) || []).length;
	return {
		enriched: count(/ ENRICHED:/g),
		newWikis: count(/ NEW WIKI:/g),
		updatedWikis: count(/ UPDATED WIKI:/g),
		problems: count(/ ERROR:| SKIPPED:/g),
	};
}
