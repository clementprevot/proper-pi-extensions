import { spawn } from "node:child_process";
import { type FileHandle, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { Args } from "@earendil-works/pi-coding-agent";

export const RESTART_MARKER = "PROPER_UPDATER_RESTART";
export const TIMEOUT_MS = 180_000;
export type Snapshot = Record<string, { name: string; revision: string }>;
export type CommandResult = { code: number; stdout: string; stopped: boolean };

export function enabled(value: string | undefined): boolean {
	return /^(1|true|yes)$/i.test(value ?? "");
}

export function consumeRestartMarker(
	env: NodeJS.ProcessEnv,
	pid: number,
): boolean {
	const restarted = env[RESTART_MARKER] === String(pid);
	delete env[RESTART_MARKER];
	return restarted;
}

// @lat: [[auto-updates#Restart contract]]
export function restartArgs(
	raw: string[],
	parsed: Args,
	sessionFile?: string,
): string[] | undefined {
	if (
		parsed.messages.length ||
		parsed.fileArgs.length ||
		parsed.unknownFlags.size ||
		parsed.diagnostics.length ||
		parsed.fork ||
		parsed.resume ||
		parsed.sessionId
	)
		return undefined;
	const valuedFlags = new Set([
		"--provider",
		"--model",
		"--api-key",
		"--system-prompt",
		"--append-system-prompt",
		"--name",
		"-n",
		"--session-dir",
		"--models",
		"--tools",
		"-t",
		"--exclude-tools",
		"-xt",
		"--thinking",
		"--extension",
		"-e",
		"--skill",
		"--prompt-template",
		"--theme",
		"--use-theme",
		"--tui-mode",
		"--mode",
	]);
	const args: string[] = [];
	for (let i = 0; i < raw.length; i++) {
		const arg = raw[i];
		if (arg === "--") break;
		if (arg === "-c" || arg === "--continue") continue;
		if (arg === "--session") {
			i++;
			continue;
		}
		if (arg !== undefined) {
			args.push(arg);
			if (valuedFlags.has(arg)) {
				const value = raw[++i];
				if (value === undefined) return undefined;
				args.push(value);
			}
		}
	}
	// Never resume a not-yet-persisted session or reinterpret --continue later.
	if ((parsed.continue || parsed.session) && !sessionFile) return undefined;
	if (sessionFile && !parsed.noSession) args.push("--session", sessionFile);
	return args;
}

export function parseSnapshot(text: string): Snapshot {
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("Invalid update inventory");
	for (const entry of Object.values(value)) {
		if (
			!entry ||
			typeof entry !== "object" ||
			typeof entry.name !== "string" ||
			typeof entry.revision !== "string"
		) {
			throw new TypeError("Invalid update inventory entry");
		}
	}
	return value as Snapshot;
}

function display(text: string): string {
	return stripVTControlCharacters(text)
		.replace(/[\r\n\t]/g, " ")
		.slice(0, 100);
}

export function changes(before: Snapshot, after: Snapshot): string[] {
	return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(
		(key) => {
			const old = before[key];
			const next = after[key];
			if (old?.revision === next?.revision) return [];
			return [
				`${display(next?.name ?? old?.name ?? key)} ${display(old?.revision ?? "missing")} → ${display(next?.revision ?? "missing")}`,
			];
		},
	);
}

export function summary(items: string[]): string {
	return `${items.slice(0, 4).join("; ")}${items.length > 4 ? `; +${items.length - 4} more` : ""}`;
}

// Only recognized native Pi progress becomes UI text. Never echo installer logs,
// command arguments, registry credentials, or private repository URLs.
export function updateStatus(line: string): string | undefined {
	const text = stripVTControlCharacters(line).trim();
	if (text === "Updated packages") return "Checking Pi version…";
	if (text === "Updating user npm packages...")
		return "Updating global packages…";
	if (text === "Updating project npm packages...")
		return "Updating project packages…";
	const npm =
		/^Updating npm:((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)(?:@[^\s]+)?\.\.\.$/.exec(
			text,
		);
	if (npm) return `Updating ${npm[1]?.slice(0, 100)}…`;
	if (/^Updating (?:git:|https?:\/\/|ssh:\/\/)/.test(text))
		return "Updating git package…";
	if (
		text.startsWith("Updating pi with ") ||
		text === "Updating managed pi installation..."
	)
		return "Updating Pi…";
	if (/^pi is already up to date \(v[^()]+\)$/.test(text))
		return "Pi is up to date";
	if (/^Updated pi from \S+ to \S+$/.test(text)) return "Pi updated";
	return undefined;
}

// @lat: [[auto-updates#Update isolation]]
export async function acquireLock(
	agentDir: string,
): Promise<(() => Promise<void>) | undefined> {
	await mkdir(agentDir, { recursive: true });
	const path = join(agentDir, "proper-updater.lock");
	let file: FileHandle;
	try {
		file = await open(path, "wx", 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
		throw error;
	}
	try {
		await file.writeFile(`${process.pid}\n`);
	} catch (error) {
		await unlink(path);
		throw error;
	} finally {
		await file.close();
	}
	return () => unlink(path);
}

// Keep npm/git and their descendants inside one process group. Never kill only
// the CLI parent and release the lock while an installer still mutates files.
export function run(
	command: string,
	args: string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		signal: AbortSignal;
		timeout?: number;
		onLine?: (line: string) => void;
	},
): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		if (options.signal.aborted) {
			resolve({ code: 1, stdout: "", stopped: true });
			return;
		}
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let lineBuffer = "";
		let oversizedLine = false;
		const emitLine = () => {
			if (!oversizedLine && lineBuffer.length <= 4096)
				options.onLine?.(lineBuffer);
			lineBuffer = "";
			oversizedLine = false;
		};
		let stopped = false;
		let overflow = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const kill = (signal: NodeJS.Signals) => {
			if (!child.pid) return;
			try {
				process.kill(-child.pid, signal);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		};
		const stop = () => {
			if (stopped) return;
			stopped = true;
			kill("SIGTERM");
			killTimer = setTimeout(() => kill("SIGKILL"), 1000);
		};
		const timer = setTimeout(stop, options.timeout ?? TIMEOUT_MS);
		options.signal.addEventListener("abort", stop, { once: true });
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (options.onLine) {
				const lines = chunk.split(/[\r\n]/);
				for (const [index, line] of lines.entries()) {
					if (index > 0) emitLine();
					if (!oversizedLine) lineBuffer += line;
					if (lineBuffer.length > 4096) {
						lineBuffer = "";
						oversizedLine = true;
					}
				}
			}
			stdout += chunk;
			if (stdout.length > 1_048_576) {
				stdout = stdout.slice(-1_048_576);
				overflow = true;
			}
		});
		// Do not leak registry credentials or private repository URLs into the UI.
		child.stderr.resume();
		let spawnError: Error | undefined;
		child.on("error", (error) => {
			spawnError = error;
		});
		child.on("close", (code) => {
			if (lineBuffer) emitLine();
			clearTimeout(timer);
			clearTimeout(killTimer);
			options.signal.removeEventListener("abort", stop);
			// Descendants may have closed their pipes but still be alive.
			if (stopped) kill("SIGKILL");
			if (spawnError) reject(spawnError);
			else resolve({ code: overflow ? 1 : (code ?? 1), stdout, stopped });
		});
	});
}
