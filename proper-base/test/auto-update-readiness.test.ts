import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	clearUpdates,
	pendingUpdates,
	rememberUpdate,
} from "../src/auto-update/readiness.ts";

// @lat: [[auto-update-tests#Next-launch updates]]
test("readiness is launch-scoped, project-scoped, and clears only consumed notices", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proper-updater-ready-"));
	const launch = Symbol.for("proper-updater.launch.v1");
	const saved = Object.getOwnPropertyDescriptor(process, launch);
	try {
		Reflect.deleteProperty(process, launch);
		assert.deepEqual((await pendingUpdates(dir, "/project-a", true)).files, []);
		for (const kind of ["pi", "user", "project"] as const)
			rememberUpdate(dir, kind, "/project-a");
		rememberUpdate(dir, "pi", "/project-a");
		assert.equal((await readdir(join(dir, "proper-updater-ready"))).length, 3);
		assert.deepEqual((await pendingUpdates(dir, "/project-a", true)).files, []);
		Reflect.deleteProperty(process, launch);
		const previous = await pendingUpdates(dir, "/project-a", true);
		assert.equal(previous.files.length, 3);
		assert.equal(previous.project, true);
		assert.equal(
			(await pendingUpdates(dir, "/project-b", true)).files.length,
			2,
		);
		assert.equal(
			(await pendingUpdates(dir, "/project-a", false)).files.length,
			2,
		);
		rememberUpdate(dir, "pi", "/project-b");
		await clearUpdates(previous.files);
		await clearUpdates(previous.files);
		assert.deepEqual((await pendingUpdates(dir, "/project-a", true)).files, []);
		Reflect.deleteProperty(process, launch);
		assert.equal(
			(await pendingUpdates(dir, "/project-a", true)).files.length,
			1,
		);
		await writeFile(join(dir, "proper-updater-ready", "pi-invalid"), "ignored");
		await mkdir(
			join(
				dir,
				"proper-updater-ready",
				"pi-11111111-1111-1111-1111-111111111111",
			),
		);
		assert.equal(
			(await pendingUpdates(dir, "/project-a", true)).files.length,
			1,
		);
	} finally {
		if (saved) Object.defineProperty(process, launch, saved);
		else Reflect.deleteProperty(process, launch);
		await rm(dir, { recursive: true, force: true });
	}
});
