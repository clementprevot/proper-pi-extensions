import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE_NAME = "proper-base.json";

type JsonObject = Record<string, unknown>;

function readJsonObject(path: string): JsonObject | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as JsonObject)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Whether model and effort selections follow into Pi's startup defaults. */
export function stickyDefaultsEnabled(agentDir?: string): boolean {
	if (!agentDir) return true;
	return (
		readJsonObject(join(agentDir, CONFIG_FILE_NAME))?.stickyDefaults !== false
	);
}
