import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

// Run outside the TUI: Pi's inventory API can synchronously query legacy npm
// roots. Resolve the running host, not a development copy beside this package.
const [packageDir, agentDir, cwd, trusted] = process.argv.slice(2);
const manifest = JSON.parse(
	await readFile(join(packageDir, "package.json"), "utf8"),
);
const rootExport = manifest.exports?.["."]?.import;
if (typeof rootExport !== "string")
	throw new TypeError("Pi has no ESM root export");
const { DefaultPackageManager, SettingsManager, VERSION, CONFIG_DIR_NAME } =
	await import(pathToFileURL(join(packageDir, rootExport)).href);
const settings = SettingsManager.create(cwd, agentDir, {
	projectTrusted: trusted === "true",
});
const manager = new DefaultPackageManager({
	cwd,
	agentDir,
	settingsManager: settings,
});
const errors = settings.drainErrors();
if (errors.length) throw new Error("Could not read package settings");
const inventory = { pi: { name: "Pi", revision: VERSION } };

async function optionalFile(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return undefined;
		throw error;
	}
}

async function dependencies(path, key, name) {
	const content = await optionalFile(path);
	inventory[key] = {
		name,
		revision:
			content === undefined
				? "missing"
				: createHash("sha256").update(content).digest("hex").slice(0, 12),
	};
}

for (const pkg of manager.listConfiguredPackages()) {
	const npm = pkg.source.startsWith("npm:");
	const git = /^(git:|https?:|ssh:|git:\/\/)/.test(pkg.source);
	if (!npm && !git) continue;
	const key = `${pkg.scope}:${pkg.source}`;
	const npmName =
		pkg.source.slice(4).match(/^(@[^/]+\/[^@]+|[^@]+)/)?.[0] ?? "npm package";
	const name = `${pkg.scope === "project" ? "project " : ""}${npm ? npmName : basename(pkg.installedPath ?? "git package")}`;
	let revision = "missing";
	if (pkg.installedPath) {
		if (npm) {
			const manifest = JSON.parse(
				await readFile(join(pkg.installedPath, "package.json"), "utf8"),
			);
			if (typeof manifest.version !== "string")
				throw new TypeError("Missing package version");
			revision = manifest.version;
		} else {
			const { stdout } = await promisify(execFile)(
				"git",
				["-C", pkg.installedPath, "rev-parse", "HEAD"],
				{ timeout: 5000 },
			);
			revision = stdout.trim();
			await dependencies(
				join(pkg.installedPath, "node_modules", ".package-lock.json"),
				`${key}:dependencies`,
				`${name} dependencies`,
			);
		}
	}
	inventory[key] = { name, revision };
}
await dependencies(
	join(agentDir, "npm", "node_modules", ".package-lock.json"),
	"user:dependencies",
	"Package dependencies",
);
if (trusted === "true") {
	await dependencies(
		join(cwd, CONFIG_DIR_NAME, "npm", "node_modules", ".package-lock.json"),
		"project:dependencies",
		"Project package dependencies",
	);
}
process.stdout.write(JSON.stringify(inventory));
