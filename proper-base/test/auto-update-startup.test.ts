import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import * as host from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	rememberUpdate,
	type UpdateKind,
} from "../src/auto-update/readiness.ts";
import { readEnabled } from "../src/auto-update/settings.ts";

// Use the same virtual-module loader as Pi. All package writes and CLI commands
// target this synthetic installation, never the live host or user settings.
const require = createRequire(
	import.meta.resolve("@earendil-works/pi-coding-agent"),
);
const jitiManifestPath = require.resolve("jiti/package.json");
const jitiManifest = JSON.parse(await readFile(jitiManifestPath, "utf8"));
const { createJiti } = await import(
	join(dirname(jitiManifestPath), jitiManifest.exports["./static"].import)
);

type Scenario = {
	change?: boolean;
	fail?: boolean;
	typing?: boolean;
	mode?: "tui" | "rpc" | "print";
	signal?: boolean;
	trust?: boolean;
	args?: string[];
	probeMismatch?: boolean;
	cancelDuringUpdate?: boolean;
	offline?: boolean;
	liveProgress?: boolean;
	ready?: UpdateKind[];
	detected?: UpdateKind[];
	secondLaunch?: boolean;
	currentLaunchReady?: boolean;
	persistenceFailure?: boolean;
	shutdownAtStartup?: boolean;
	settingsEnabled?: boolean;
	toggleEnabled?: boolean;
	throughBase?: boolean;
	unsupported?: boolean;
};

async function fixture(scenario: Scenario) {
	const dir = await mkdtemp(join(tmpdir(), "proper-updater-startup-"));
	const packageDir = join(
		dir,
		"lib/node_modules/@earendil-works/pi-coding-agent",
	);
	const agentDir = join(dir, "agent");
	await mkdir(packageDir, { recursive: true });
	await mkdir(agentDir);
	const manifest = {
		name: "@earendil-works/pi-coding-agent",
		type: "module",
		version: host.VERSION,
		exports: { ".": { import: "./index.mjs" } },
		bin: { pi: "cli.mjs" },
	};
	await writeFile(join(packageDir, "package.json"), JSON.stringify(manifest));
	await writeFile(
		join(packageDir, "index.mjs"),
		`
import {readFileSync,writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(join(dir, "inventory-ran"))},'yes');
export const VERSION=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version;
export const CONFIG_DIR_NAME='.pi';
export class SettingsManager {static create(){return new SettingsManager()} drainErrors(){return []}}
export class DefaultPackageManager {listConfiguredPackages(){return []}}
`,
	);
	const entry = join(packageDir, "cli.mjs");
	await writeFile(
		entry,
		`
import {readFileSync,writeFileSync} from 'node:fs';
const path=new URL('./package.json',import.meta.url);
const manifest=JSON.parse(readFileSync(path,'utf8'));
if(process.argv[2]==='--version') console.log(${scenario.probeMismatch ? "'wrong'" : "manifest.version"});
else if(process.argv[2]==='update') {
  writeFileSync(${JSON.stringify(join(dir, "invoked.json"))},JSON.stringify(process.argv.slice(2)));
  if(${Boolean(scenario.change)}) {manifest.version='999.0.0';writeFileSync(path,JSON.stringify(manifest));}
  if(${Boolean(scenario.liveProgress)}) {
    process.stdout.write('Updating npm:proper-');
    await new Promise(resolve=>setTimeout(resolve,1100));
    console.log('base...');
    console.log('Updating project npm packages...');
    console.log('Updated packages');
    console.log('Updating pi with npm --registry=https://SECRET@host install...');
    console.log('SECRET MUST NOT APPEAR');
  }
  console.error('SECRET MUST NOT APPEAR');
  process.exitCode=${scenario.fail ? 7 : 0};
} else throw new Error('Unexpected CLI invocation');
`,
	);
	const savedArgv = process.argv;
	const stdin = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
	const stdout = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
	const execve = Object.getOwnPropertyDescriptor(process, "execve");
	const originalEnv = { ...process.env };
	const signals = ["SIGINT", "SIGTERM", "SIGHUP", "exit"] as const;
	const listeners = new Map<string, ReadonlySet<unknown>>(
		signals.map((signal) => [signal, new Set(process.rawListeners(signal))]),
	);
	const started = Symbol.for("proper-updater.started.v1");
	const launch = Symbol.for("proper-updater.launch.v1");
	const savedLaunch = Object.getOwnPropertyDescriptor(process, launch);
	const notifications: string[] = [];
	const widgets: (string[] | undefined)[] = [];
	const replacements: unknown[][] = [];
	const handlers = new Map<
		string,
		(event: object, ctx: host.ExtensionContext) => Promise<void> | void
	>();
	let input: (() => void) | undefined;
	let shutdown = false;
	let baseReady = false;
	let flagsRegistered = 0;
	const eventCounts = new Map<string, number>();
	let shutdownWork: Promise<boolean> | undefined;
	try {
		Reflect.deleteProperty(process, started);
		Reflect.deleteProperty(process, launch);
		for (const kind of scenario.ready ?? [
			"pi",
			"user",
			...(scenario.trust ? ["project" as const] : []),
		])
			rememberUpdate(agentDir, kind, dir);
		if (!scenario.currentLaunchReady) Reflect.deleteProperty(process, launch);
		if (scenario.settingsEnabled === false)
			await writeFile(join(agentDir, "proper-updater.disabled"), "");
		process.argv = [process.execPath, entry, ...(scenario.args ?? [])];
		for (const key of [
			"PI_OFFLINE",
			"PROPER_UPDATER_OFF",
			"PROPER_UPDATER_RESTART",
			"PROPER_UPDATER_RESULT",
			"PI_MANAGED_INSTALL_ROOT",
		])
			delete process.env[key];
		if (scenario.offline) process.env.PI_OFFLINE = "1";
		if (scenario.unsupported) process.env.PI_MANAGED_INSTALL_ROOT = dir;
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: true,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		Object.defineProperty(process, "execve", {
			configurable: true,
			value: (...args: unknown[]) => {
				replacements.push(args);
			},
		});
		class NativeManager {
			cwd = dir;
			agentDir = agentDir;
			async checkForAvailableUpdates() {
				return (scenario.detected ?? [])
					.filter((kind) => kind !== "pi")
					.map((kind) => ({ scope: kind === "user" ? "user" : "project" }));
			}
		}
		class SettingsSelectorComponent {
			settingsList = {
				items: [] as { id: string; currentValue: string }[],
				onChange(_id: string, _value: string) {},
			};
		}
		class NativeMode {
			chatContainer = { children: [] as Text[] };
			editorContainer = { children: [] as SettingsSelectorComponent[] };
			showSettingsSelector() {
				this.editorContainer.children = [new SettingsSelectorComponent()];
			}
			readonly sessionManager: unknown;
			constructor(sessionManager: unknown) {
				this.sessionManager = sessionManager;
			}
			showPackageUpdateNotification(_packages: string[]) {
				this.chatContainer.children.push(
					new Text(
						"Package Updates Available\nPackage updates are available. Run pi update --extensions",
					),
				);
			}
			showNewVersionNotification(_release: { version: string }) {
				this.chatContainer.children.push(
					new Text(
						"Update Available\nNew version 999.0.0 is available. Run pi update",
					),
				);
				notifications.push("Native Pi update notice");
			}
		}
		const jiti = createJiti(import.meta.url, {
			moduleCache: false,
			tryNative: false,
			virtualModules: {
				"@earendil-works/pi-coding-agent": {
					...host,
					DefaultPackageManager: NativeManager,
					InteractiveMode: NativeMode,
					getPackageDir: () => packageDir,
					getAgentDir: () => agentDir,
				},
			},
		});
		const module = await jiti.import(
			new URL(
				scenario.throughBase ? "../index.ts" : "../src/auto-update/index.ts",
				import.meta.url,
			).pathname,
		);
		const extension = scenario.throughBase
			? module.default
			: module.registerAutoUpdates;
		const api = {
			registerFlag() {
				flagsRegistered++;
			},
			getCommands: () => [],
			getFlag: () => scenario.args?.includes("--no-auto-update") ?? false,
			on: (
				name: string,
				handler: (
					event: object,
					ctx: host.ExtensionContext,
				) => Promise<void> | void,
			) => {
				eventCounts.set(name, (eventCounts.get(name) ?? 0) + 1);
				const previous = handlers.get(name);
				handlers.set(
					name,
					previous
						? async (event, ctx) => {
								await previous(event, ctx);
								await handler(event, ctx);
							}
						: handler,
				);
			},
		};
		extension(api);
		const ctx = {
			mode: scenario.mode ?? "tui",
			cwd: dir,
			isProjectTrusted: () => Boolean(scenario.trust),
			isIdle: () => true,
			hasPendingMessages: () => false,
			sessionManager: { getSessionFile: () => undefined, getBranch: () => [] },
			shutdown: () => {
				shutdown = true;
			},
			ui: {
				getEditorComponent: () => undefined,
				setEditorComponent: () => {
					baseReady = true;
				},
				notify: (message: string) => {
					notifications.push(message);
				},
				getEditorText: () => "",
				onTerminalInput: (handler: () => void) => {
					input = handler;
					return () => {
						input = undefined;
					};
				},
				setWidget: (_key: string, lines: string[] | undefined) => {
					if (scenario.throughBase && lines)
						assert.equal(
							baseReady,
							true,
							"base must initialize before updating",
						);
					widgets.push(lines);
					if (
						scenario.typing &&
						lines?.[0]?.startsWith("Checking package updates")
					)
						input?.();
					if (
						scenario.cancelDuringUpdate &&
						lines?.[0]?.startsWith("Checking package updates")
					) {
						queueMicrotask(() => {
							shutdownWork = Promise.resolve(
								handlers.get("session_shutdown")?.({ reason: "quit" }, ctx),
							).then(() =>
								readFile(join(agentDir, "proper-updater.lock")).then(
									() => true,
									(error: NodeJS.ErrnoException) => {
										if (error.code !== "ENOENT") throw error;
										return false;
									},
								),
							);
						});
					}
				},
			},
		} as unknown as host.ExtensionContext;
		const startup = handlers.get("session_start")?.({ reason: "startup" }, ctx);
		if (scenario.shutdownAtStartup)
			await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
		await startup;
		if (
			scenario.ready?.length === 0 ||
			scenario.currentLaunchReady ||
			scenario.shutdownAtStartup
		)
			await assert.rejects(readFile(join(dir, "inventory-ran")), {
				code: "ENOENT",
			});
		const firstWidgets = [...widgets];
		if (scenario.secondLaunch)
			await assert.rejects(readFile(join(dir, "invoked.json")), {
				code: "ENOENT",
			});
		if (scenario.persistenceFailure)
			await writeFile(join(agentDir, "proper-updater-ready"), "blocked");
		if (scenario.toggleEnabled !== undefined) {
			const mode = new NativeMode(ctx.sessionManager);
			mode.showSettingsSelector();
			const list = mode.editorContainer.children[0]?.settingsList;
			assert.ok(list);
			assert.ok(
				list.items.some((item) => item.id === "proper-updater-enabled"),
			);
			list.onChange("proper-updater-enabled", String(scenario.toggleEnabled));
		}
		await new NativeManager().checkForAvailableUpdates();
		const noticesMode = new NativeMode(ctx.sessionManager);
		if (scenario.detected?.includes("pi"))
			noticesMode.showNewVersionNotification({ version: "999.0.0" });
		if (scenario.detected?.some((kind) => kind !== "pi"))
			noticesMode.showPackageUpdateNotification(["proper-base"]);
		const noticeTexts = noticesMode.chatContainer.children.map(
			(child) => Reflect.get(child, "text") as string,
		);
		if (scenario.persistenceFailure)
			await rm(join(agentDir, "proper-updater-ready"));
		if (scenario.secondLaunch) {
			await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
			Reflect.deleteProperty(process, started);
			Reflect.deleteProperty(process, launch);
			handlers.clear();
			eventCounts.clear();
			extension(api);
			await handlers.get("session_start")?.({ reason: "startup" }, ctx);
		}
		if (scenario.cancelDuringUpdate)
			assert.equal(
				await shutdownWork,
				false,
				"shutdown returned before installer cleanup released its lock",
			);
		await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
		if (scenario.signal) {
			for (const handler of process.rawListeners("SIGTERM")) {
				if (!listeners.get("SIGTERM")?.has(handler))
					Reflect.apply(handler, process, []);
			}
		}
		for (const handler of process.rawListeners("exit")) {
			if (!listeners.get("exit")?.has(handler))
				Reflect.apply(handler, process, [0]);
		}
		// A reload and a duplicated startup event must not run the updater again.
		await handlers.get("session_start")?.({ reason: "reload" }, ctx);
		await handlers.get("session_start")?.({ reason: "startup" }, ctx);
		await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
		let invoked: string[] | undefined;
		try {
			invoked = JSON.parse(await readFile(join(dir, "invoked.json"), "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		assert.ok(!notifications.join(" ").includes("SECRET"));
		assert.ok(!widgets.flat().join(" ").includes("SECRET"));
		assert.ok(!widgets.flat().join(" ").includes("You can type"));
		await assert.rejects(readFile(join(agentDir, "proper-updater.lock")), {
			code: "ENOENT",
		});
		let remaining: string[] = [];
		try {
			remaining = await readdir(join(agentDir, "proper-updater-ready"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return {
			notifications,
			widgets,
			firstWidgets,
			shutdown,
			replacements,
			invoked,
			remaining,
			preferenceEnabled: readEnabled(agentDir),
			baseReady,
			noticeTexts,
			flagsRegistered,
			eventCounts,
		};
	} finally {
		process.argv = savedArgv;
		process.env = originalEnv;
		Reflect.deleteProperty(process, started);
		if (savedLaunch) Object.defineProperty(process, launch, savedLaunch);
		else Reflect.deleteProperty(process, launch);
		for (const [object, key, descriptor] of [
			[process.stdin, "isTTY", stdin],
			[process.stdout, "isTTY", stdout],
			[process, "execve", execve],
		] as const) {
			if (descriptor) Object.defineProperty(object, key, descriptor);
			else Reflect.deleteProperty(object, key);
		}
		for (const signal of signals)
			for (const listener of process.rawListeners(signal)) {
				if (!listeners.get(signal)?.has(listener))
					process.removeListener(signal, listener);
			}
		await rm(dir, { recursive: true, force: true });
	}
}

// @lat: [[auto-update-tests#Base integration]]
test("proper-base registers one updater and runs base setup before installation", async () => {
	const result = await fixture({ throughBase: true, change: true });
	assert.equal(result.flagsRegistered, 1);
	assert.equal(result.eventCounts.get("session_start"), 2);
	assert.equal(result.eventCounts.get("session_shutdown"), 2);
	assert.equal(result.baseReady, true);
	assert.deepEqual(result.invoked, ["update", "--all", "--no-approve"]);
	assert.equal(result.shutdown, true);
	assert.equal(result.replacements.length, 1);
});

test("native notices recommend restart only when auto-update readiness can be used", async () => {
	const enabled = await fixture({ ready: [], detected: ["pi", "user"] });
	assert.equal(enabled.noticeTexts.length, 2);
	assert.ok(
		enabled.noticeTexts.every((text) =>
			text.includes("Restart Pi to install detected updates."),
		),
	);
	for (const scenario of [
		{ settingsEnabled: false },
		{ args: ["--no-auto-update"] },
		{ persistenceFailure: true },
		{ unsupported: true },
	]) {
		const disabled = await fixture({
			...scenario,
			ready: [],
			detected: ["pi", "user"],
		});
		assert.equal(disabled.invoked, undefined);
		assert.ok(
			disabled.noticeTexts.every((text) => text.includes("Run pi update")),
		);
	}
});

// @lat: [[auto-update-tests#Next-launch updates]]
test("first launch only observes native checks; second launch installs recorded updates", async () => {
	const result = await fixture({
		ready: [],
		detected: ["pi", "user"],
		secondLaunch: true,
	});
	assert.deepEqual(result.firstWidgets, []);
	assert.deepEqual(result.invoked, ["update", "--all", "--no-approve"]);
	assert.deepEqual(result.remaining, []);
});

test("no readiness means no inventory, installer, widget, or restart", async () => {
	const result = await fixture({ ready: [] });
	assert.equal(result.invoked, undefined);
	assert.deepEqual(result.widgets, []);
	assert.deepEqual(result.notifications, []);
	assert.equal(result.shutdown, false);
});

test("notices from this launch cannot authorize this launch's installer", async () => {
	const result = await fixture({ currentLaunchReady: true });
	assert.equal(result.invoked, undefined);
	assert.deepEqual(result.widgets, []);
	assert.equal(result.remaining.length, 2);
});

test("shutdown during readiness lookup cannot start inventory or installation", async () => {
	const result = await fixture({ shutdownAtStartup: true });
	assert.equal(result.invoked, undefined);
	assert.deepEqual(result.widgets, []);
	assert.equal(result.remaining.length, 2);
});

test("readiness selects Pi, global packages, or trusted project updates", async () => {
	for (const [ready, trust, target, approval] of [
		[["pi"], true, "--self", "--no-approve"],
		[["user"], true, "--extensions", "--no-approve"],
		[["project"], true, "--extensions", "--approve"],
	] as const) {
		const result = await fixture({ ready: [...ready], trust });
		assert.deepEqual(result.invoked, ["update", target, approval]);
		assert.deepEqual(result.remaining, []);
	}
	const result = await fixture({ ready: ["project"], trust: false });
	assert.equal(result.invoked, undefined);
	assert.equal(result.remaining.length, 1);
});

test("availability persistence failure preserves native notices and skips installation", async () => {
	const result = await fixture({
		ready: [],
		detected: ["pi", "user"],
		persistenceFailure: true,
	});
	assert.equal(result.invoked, undefined);
	assert.ok(result.notifications.includes("Native Pi update notice"));
	assert.ok(
		result.notifications.some((message) =>
			message.includes("Could not save update availability"),
		),
	);
});

// @lat: [[auto-update-tests#Startup orchestration]]
test("changed installs gracefully restart once, carrying partial failure and current trust", async () => {
	const result = await fixture({ change: true, fail: true, trust: true });
	assert.equal(result.shutdown, true);
	assert.equal(result.replacements.length, 1);
	assert.deepEqual(result.invoked, ["update", "--all", "--approve"]);
	assert.ok(result.notifications.some((message) => message.includes("exit 7")));
	assert.equal(
		result.remaining.length,
		3,
		"failed updates must remain eligible for retry",
	);
	const env = result.replacements[0]?.[2] as Record<string, string>;
	assert.equal(env.PROPER_UPDATER_RESTART, String(process.pid));
	assert.match(env.PROPER_UPDATER_RESULT ?? "", /incomplete/);
	assert.equal(result.widgets.at(-1), undefined);
});

test("live widget follows package and Pi phases, then verifies and clears", async () => {
	const result = await fixture({ liveProgress: true, change: true });
	const statuses = result.widgets
		.flat()
		.filter((line): line is string => Boolean(line))
		.map((line) => line.replace(/ \(\d+s\)$/, ""));
	assert.ok(
		result.widgets.flat().some((line) => line && /\([1-9]\d*s\)$/.test(line)),
	);
	assert.deepEqual(
		statuses.filter((status, index) => status !== statuses[index - 1]),
		[
			"Reading installed versions…",
			"Checking package updates…",
			"Updating proper-base…",
			"Updating project packages…",
			"Checking Pi version…",
			"Updating Pi…",
			"Verifying installed versions…",
			"Preparing restart…",
		],
	);
	assert.equal(result.widgets.at(-1), undefined);
	assert.equal(result.shutdown, true);
});

test("no-op updates are quiet and never restart", async () => {
	const result = await fixture({});
	assert.equal(result.shutdown, false);
	assert.deepEqual(result.notifications, []);
	assert.deepEqual(result.invoked, ["update", "--all", "--no-approve"]);
	assert.deepEqual(result.remaining, []);
});

test("typing, prompt arguments and failed executable verification defer restart", async () => {
	for (const scenario of [
		{ typing: true },
		{ args: ["hello"] },
		{ probeMismatch: true },
	]) {
		const result = await fixture({ ...scenario, change: true });
		assert.equal(result.shutdown, false);
		assert.equal(result.replacements.length, 0);
		assert.ok(
			result.notifications.some((message) => /[Rr]estart Pi/.test(message)),
		);
	}
});

test("external signals suppress armed replacement", async () => {
	const result = await fixture({ change: true, signal: true });
	assert.equal(result.shutdown, true);
	assert.equal(result.replacements.length, 0);
});

test("shutdown waits for active update cleanup", async () => {
	const result = await fixture({ cancelDuringUpdate: true });
	assert.equal(result.remaining.length, 2);
	assert.equal(result.shutdown, false);
	assert.equal(result.replacements.length, 0);
});

// @lat: [[auto-update-tests#Settings preference]]
test("persisted settings disable updates and observing notices without losing readiness", async () => {
	const result = await fixture({
		settingsEnabled: false,
		detected: ["pi", "user"],
	});
	assert.equal(result.invoked, undefined);
	assert.equal(result.remaining.length, 2);
	assert.equal(result.preferenceEnabled, false);
	assert.deepEqual(result.widgets, []);
});

test("settings changes affect observation without running an installer now", async () => {
	const disabled = await fixture({
		ready: [],
		toggleEnabled: false,
		detected: ["pi", "user"],
	});
	assert.equal(disabled.invoked, undefined);
	assert.deepEqual(disabled.remaining, []);
	assert.equal(disabled.preferenceEnabled, false);
	const enabled = await fixture({
		settingsEnabled: false,
		toggleEnabled: true,
	});
	assert.equal(enabled.invoked, undefined);
	assert.equal(enabled.remaining.length, 2);
	assert.equal(enabled.preferenceEnabled, true);
});

test("startup opt-outs override enabling the settings preference", async () => {
	for (const options of [{ args: ["--no-auto-update"] }, { offline: true }]) {
		const result = await fixture({
			...options,
			toggleEnabled: true,
			detected: ["pi", "user"],
		});
		assert.equal(result.invoked, undefined);
		assert.equal(result.remaining.length, 2);
	}
});

test("offline and explicit opt-out never update", async () => {
	for (const scenario of [{ offline: true }, { args: ["--no-auto-update"] }]) {
		const result = await fixture(scenario);
		assert.equal(result.invoked, undefined);
		assert.deepEqual(result.notifications, []);
	}
});

test("RPC and print never invoke updates or emit updater notifications", async () => {
	for (const mode of ["rpc", "print"] as const) {
		const result = await fixture({ mode });
		assert.equal(result.invoked, undefined);
		assert.equal(result.shutdown, false);
		assert.deepEqual(result.notifications, []);
	}
});
