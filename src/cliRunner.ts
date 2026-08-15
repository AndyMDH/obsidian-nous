// Pure helpers for CLI execution mode (command construction, PATH, log
// summarizing). Process-spawning lives in main.ts.

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

// macOS GUI apps start with a minimal PATH, so `claude` often resolves in
// Terminal but not here - prepend the usual install locations.
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

// Some CLIs (claude included, for errors like "Not logged in") write their
// failure message to stdout rather than stderr, and a killed/missing binary
// produces no output at all - check both streams and never return blank.
export function cliErrorDetail(result: CliExecResult): string {
	const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 300);
	return detail || "(no output)";
}

export interface LogSummary {
	enriched: number;
	newWikis: number;
	updatedWikis: number;
	errors: number;
	skipped: number;
}

// Count event lines the run appended to the log - the CLI output itself is
// unstructured. Errors and skips are counted apart: a skip (empty stub,
// duplicate) is normal operation, an error is not, and the notices that
// report them must not blur the two.
export function summarizeLogLines(newLines: string): LogSummary {
	const count = (pattern: RegExp) => (newLines.match(pattern) || []).length;
	return {
		enriched: count(/ ENRICHED:/g),
		newWikis: count(/ NEW WIKI:/g),
		updatedWikis: count(/ UPDATED WIKI:/g),
		errors: count(/ ERROR:/g),
		skipped: count(/ SKIPPED:/g),
	};
}
