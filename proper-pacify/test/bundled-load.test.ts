import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import * as ai from "@earendil-works/pi-ai/compat";
import * as host from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";

// Exercise the real loader's bundled-mode jiti configuration, outside any
// package node_modules tree. Only Pi's documented virtual roots are available.
// @lat: [[proper-pacify/tests#Verification#Provider payload fixture]]
test("distributed extension sources load with bundled Pi's virtual modules", async () => {
	const require = createRequire(
		import.meta.resolve("@earendil-works/pi-coding-agent"),
	);
	const manifestPath = require.resolve("jiti/package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const { createJiti } = await import(
		join(dirname(manifestPath), manifest.exports["./static"].import)
	);
	const directory = await mkdtemp(join(tmpdir(), "proper-bundled-"));
	try {
		const jiti = createJiti(import.meta.url, {
			moduleCache: false,
			tryNative: false,
			virtualModules: {
				"@earendil-works/pi-ai": ai,
				"@earendil-works/pi-coding-agent": host,
				"@earendil-works/pi-tui": tui,
			},
		});
		for (const name of ["pacify.ts", "host.ts", "host-interop.ts"]) {
			await copyFile(
				new URL(`../${name}`, import.meta.url),
				join(directory, name),
			);
		}
		await copyFile(
			new URL("../../proper-llm-router/llm-router.ts", import.meta.url),
			join(directory, "llm-router.ts"),
		);
		assert.equal(
			typeof (await jiti.import(join(directory, "pacify.ts"), {
				default: true,
			})),
			"function",
		);
		assert.equal(
			typeof (await jiti.import(join(directory, "llm-router.ts"), {
				default: true,
			})),
			"function",
		);
		await writeFile(
			join(directory, "unsupported.ts"),
			'import { adjustMaxTokensForThinking } from "@earendil-works/pi-ai/api/simple-options"; export default adjustMaxTokensForThinking;',
		);
		await assert.rejects(
			jiti.import(join(directory, "unsupported.ts")),
			/Cannot find module|Cannot resolve/,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
