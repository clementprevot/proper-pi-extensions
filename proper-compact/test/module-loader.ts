import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as ai from "@earendil-works/pi-ai/compat";
import * as host from "@earendil-works/pi-coding-agent";
import * as typebox from "typebox";

export async function moduleLoader() {
	const require = createRequire(
		import.meta.resolve("@earendil-works/pi-coding-agent"),
	);
	const manifestPath = require.resolve("jiti/package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const { createJiti } = await import(
		join(dirname(manifestPath), manifest.exports["./static"].import)
	);
	return createJiti(import.meta.url, {
		moduleCache: false,
		tryNative: false,
		virtualModules: {
			"@earendil-works/pi-ai": ai,
			"@earendil-works/pi-coding-agent": host,
			typebox,
		},
	});
}
