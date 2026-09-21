import { createHash, randomUUID } from "node:crypto";
import { type Dirent, mkdirSync, writeFileSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

export type UpdateKind = "pi" | "user" | "project";
const LAUNCH = Symbol.for("proper-updater.launch.v1");

function launchId(): string {
	let id = Reflect.get(process, LAUNCH) as string | undefined;
	if (!id) {
		id = randomUUID();
		Reflect.set(process, LAUNCH, id);
	}
	return id;
}

function scope(kind: UpdateKind, cwd: string): string {
	return kind === "project"
		? `project-${createHash("sha256").update(resolve(cwd)).digest("hex")}`
		: kind;
}

// @lat: [[auto-updates#Next-launch readiness]]
export function rememberUpdate(
	agentDir: string,
	kind: UpdateKind,
	cwd: string,
): void {
	const directory = join(agentDir, "proper-updater-ready");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	// Tiny synchronous markers survive an immediate quit after a native notice.
	// Empty, exclusively created files need no partial-content recovery protocol.
	try {
		writeFileSync(join(directory, `${scope(kind, cwd)}-${launchId()}`), "", {
			flag: "wx",
			mode: 0o600,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

export async function pendingUpdates(
	agentDir: string,
	cwd: string,
	trusted: boolean,
) {
	const directory = join(agentDir, "proper-updater-ready");
	const ready = {
		pi: false,
		packages: false,
		project: false,
		files: [] as string[],
	};
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return ready;
	}
	const kinds: UpdateKind[] = trusted
		? ["pi", "user", "project"]
		: ["pi", "user"];
	for (const entry of entries) {
		if (!entry.isFile() || entry.name.endsWith(`-${launchId()}`)) continue;
		for (const kind of kinds) {
			const prefix = `${scope(kind, cwd)}-`;
			if (
				!entry.name.startsWith(prefix) ||
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
					entry.name.slice(prefix.length),
				)
			)
				continue;
			ready.files.push(join(directory, entry.name));
			if (kind === "pi") ready.pi = true;
			else ready.packages = true;
			if (kind === "project") ready.project = true;
		}
	}
	return ready;
}

export async function clearUpdates(files: string[]): Promise<void> {
	for (const file of files) {
		try {
			await unlink(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}
