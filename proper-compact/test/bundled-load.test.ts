import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { moduleLoader } from "./module-loader.ts";

// @lat: [[proper-compact/tests#Bundled loading]]
test("distributed sources load using only Pi's public virtual package roots", async () => {
	const jiti = await moduleLoader();
	const directory = await mkdtemp(join(tmpdir(), "proper-compact-bundled-"));
	try {
		for (const name of ["compact.ts", "context.ts"])
			await copyFile(
				new URL(`../${name}`, import.meta.url),
				join(directory, name),
			);
		const extension = await jiti.import(join(directory, "compact.ts"), {
			default: true,
		});
		const events: string[] = [],
			tools: string[] = [],
			commands: string[] = [];
		extension(
			{
				on: (event: string) => events.push(event),
				registerTool: (tool: any) => tools.push(tool.name),
				registerCommand: (name: string) => commands.push(name),
			},
			join(directory, "unused-config.json"),
		);
		assert.ok(events.includes("session_before_compact"));
		assert.ok(events.includes("session_before_tree"));
		assert.ok(!events.includes("context"));
		assert.deepEqual(tools, ["compact_recall"]);
		assert.deepEqual(commands, ["compact-config"]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
