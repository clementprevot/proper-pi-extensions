import { writeSync } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	getPackageDir,
	parseArgs,
	type SessionStartEvent,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import { observeAvailability } from "./availability.ts";
import { clearUpdates, pendingUpdates, rememberUpdate } from "./readiness.ts";
import {
	acquireLock,
	changes,
	consumeRestartMarker,
	enabled,
	parseSnapshot,
	RESTART_MARKER,
	restartArgs,
	run,
	summary,
	updateStatus,
} from "./runtime.ts";
import { installSettings } from "./settings.ts";

const STARTED = Symbol.for("proper-updater.started.v1");
const RESULT = "PROPER_UPDATER_RESULT";

// @lat: [[auto-updates#Startup behavior]]
export function registerAutoUpdates(pi: ExtensionAPI): void {
	pi.registerFlag("no-auto-update", {
		description: "Skip automatic updates for this launch",
		type: "boolean",
		default: false,
	});
	let controller: AbortController | undefined;
	let removeInput: (() => void) | undefined;
	let cleanupSignals: (() => void) | undefined;
	let restarting = false;
	let pending: Promise<void> | undefined;
	let restartSupported = false;
	const agentDir = getAgentDir();
	const createObserver = () =>
		observeAvailability(agentDir, (kind, ctx) => {
			try {
				rememberUpdate(agentDir, kind, ctx.cwd);
				return restartSupported;
			} catch (error) {
				if (typeof (error as NodeJS.ErrnoException).code !== "string")
					throw error;
				ctx.ui.notify(
					"proper-base updates: Could not save update availability. Run pi update --all manually.",
					"warning",
				);
				return false;
			}
		});
	let observer: ReturnType<typeof observeAvailability>;
	let settings: ReturnType<typeof installSettings> | undefined;
	let autoUpdateEnabled = true;
	const refreshObserver = (ctx: ExtensionContext) => {
		const parsed = parseArgs(process.argv.slice(2));
		if (
			ctx.mode === "tui" &&
			autoUpdateEnabled &&
			!enabled(process.env.PROPER_UPDATER_OFF) &&
			!process.env.PI_OFFLINE &&
			!parsed.offline &&
			!pi.getFlag("no-auto-update")
		) {
			observer ??= createObserver();
			observer?.setContext(ctx);
		} else observer?.setContext(undefined);
	};

	pi.on("session_shutdown", async () => {
		settings?.dispose();
		observer?.dispose();
		observer = undefined;
		controller?.abort();
		// Keep Pi alive until installers are terminated and the lock is released.
		await pending;
		removeInput?.();
		if (!restarting) cleanupSignals?.();
	});

	async function start(
		event: SessionStartEvent,
		ctx: ExtensionContext,
	): Promise<void> {
		if (event.reason !== "startup" || Reflect.get(process, STARTED)) return;
		Reflect.set(process, STARTED, true);
		const restarted = consumeRestartMarker(process.env, process.pid);
		const result = process.env[RESULT];
		delete process.env[RESULT];
		if (restarted) {
			if (ctx.mode === "tui")
				ctx.ui.notify(result?.slice(0, 1200) || "Updates active.", "info");
			return;
		}
		const rawArgs = process.argv.slice(2);
		const parsed = parseArgs(rawArgs);
		if (
			ctx.mode !== "tui" ||
			!autoUpdateEnabled ||
			enabled(process.env.PROPER_UPDATER_OFF) ||
			process.env.PI_OFFLINE ||
			parsed.offline ||
			pi.getFlag("no-auto-update")
		)
			return;
		const warn = (message: string) =>
			ctx.ui.notify(`proper-base updates: ${message}`, "warning");
		if (!observer) {
			warn(
				"Native update observation is unavailable in this Pi version. Run pi update --all manually.",
			);
			return;
		}
		controller = new AbortController();
		const signal = controller.signal;
		const hasPending =
			(await pendingUpdates(agentDir, ctx.cwd, ctx.isProjectTrusted())).files
				.length > 0;
		if (signal.aborted) return;
		const execve = process.execve;
		const packageDir = getPackageDir();
		const entry = process.argv[1];
		// Immutable pnpm/managed release paths and embedded SDK hosts cannot be
		// relaunched by replaying this script path. Do not update a different Pi.
		if (
			!process.stdin.isTTY ||
			!process.stdout.isTTY ||
			!execve ||
			!["linux", "darwin"].includes(process.platform) ||
			process.versions.bun ||
			process.env.PI_MANAGED_INSTALL_ROOT ||
			packageDir.includes("/.pnpm/") ||
			!packageDir.includes("/lib/node_modules/") ||
			!entry
		) {
			if (hasPending)
				warn(
					"Automatic updates require an npm-installed Pi on Linux/macOS with Node 22.19+. Run pi update --all manually.",
				);
			return;
		}
		const manifest = JSON.parse(
			await readFile(join(packageDir, "package.json"), "utf8"),
		) as { bin?: { pi?: string } };
		if (
			!manifest.bin?.pi ||
			(await realpath(entry)) !==
				(await realpath(join(packageDir, manifest.bin.pi)))
		) {
			if (hasPending)
				warn("Unrecognized Pi launcher; run pi update --all manually.");
			return;
		}
		if (signal.aborted) return;
		restartSupported = true;
		if (!hasPending) return;
		let interrupted = false;
		const cancel = () => {
			interrupted = true;
			controller?.abort();
		};
		for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
			process.on(name, cancel);
		cleanupSignals = () => {
			for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
				process.off(name, cancel);
		};
		let inputReceived = false;
		removeInput = ctx.ui.onTerminalInput(() => {
			inputReceived = true;
		});
		const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
		const options = { cwd: ctx.cwd, env, signal };
		const inventoryScript = fileURLToPath(
			new URL("./inventory.mjs", import.meta.url),
		);
		const snapshot = async () => {
			const result = await run(
				process.execPath,
				[
					inventoryScript,
					packageDir,
					agentDir,
					ctx.cwd,
					String(ctx.isProjectTrusted()),
				],
				{ ...options, timeout: 30_000 },
			);
			if (result.code !== 0 || result.stopped) return undefined;
			return parseSnapshot(result.stdout);
		};
		let release: (() => Promise<void>) | undefined;
		let progressTimer: ReturnType<typeof setInterval> | undefined;
		const startedAt = Date.now();
		let phase = "Reading installed versions…";
		const renderProgress = () =>
			ctx.ui.setWidget("proper-updater", [
				`${phase} (${Math.floor((Date.now() - startedAt) / 1000)}s)`,
			]);
		const setProgress = (next: string) => {
			phase = next;
			renderProgress();
		};
		try {
			release = await acquireLock(agentDir);
			if (!release) {
				warn(
					`Another updater owns ${join(agentDir, "proper-updater.lock")}. Updates skipped. If stale, check its PID before removing it.`,
				);
				return;
			}
			// Recheck under the installer lock: another launch may have handled these.
			const ready = await pendingUpdates(
				agentDir,
				ctx.cwd,
				ctx.isProjectTrusted(),
			);
			if (!ready.files.length) return;
			renderProgress();
			progressTimer = setInterval(renderProgress, 1000);
			const before = await snapshot();
			if (!before) {
				if (!signal.aborted)
					warn(
						"Could not inspect installed packages; no updates attempted. Run pi update --all manually.",
					);
				return;
			}
			// Another launch may already have replaced Pi after this runtime loaded.
			before.pi = { name: "Pi", revision: VERSION };
			setProgress(
				ready.packages ? "Checking package updates…" : "Checking Pi version…",
			);
			const update = await run(
				process.execPath,
				[
					entry,
					"update",
					ready.pi ? (ready.packages ? "--all" : "--self") : "--extensions",
					ready.project && ctx.isProjectTrusted()
						? "--approve"
						: "--no-approve",
				],
				{
					...options,
					onLine: (line) => {
						const status = updateStatus(line);
						if (status)
							setProgress(
								!ready.pi && status === "Checking Pi version…"
									? "Package updates finished"
									: status,
							);
					},
				},
			);
			if (signal.aborted) return;
			if (update.code !== 0 || update.stopped) {
				warn(
					`Update ${update.stopped ? "timed out" : `failed (exit ${update.code})`}. Some packages may have changed. Run pi update --all for details.`,
				);
			}
			// --all can update packages and then fail self-update. Compare even on failure.
			setProgress("Verifying installed versions…");
			const after = await snapshot();
			if (!after) {
				if (!signal.aborted)
					warn(
						"Could not verify installed versions. Restart Pi manually before continuing.",
					);
				return;
			}
			if (update.code === 0 && !update.stopped && !signal.aborted)
				await clearUpdates(ready.files);
			const changed = changes(before, after);
			if (!changed.length) return;
			const changedSummary = summary(changed);
			let sessionFile = ctx.sessionManager.getSessionFile();
			if (sessionFile) {
				try {
					await access(sessionFile);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					sessionFile = undefined;
				}
			}
			const args = restartArgs(rawArgs, parsed, sessionFile);
			if (
				!args ||
				inputReceived ||
				ctx.ui.getEditorText() ||
				!ctx.isIdle() ||
				ctx.hasPendingMessages()
			) {
				warn(
					`Updated ${changedSummary}. Restart Pi to activate updates; automatic restart deferred to preserve input/session state.`,
				);
				return;
			}
			// Verify that the preserved launcher actually resolves to the new Pi.
			setProgress("Preparing restart…");
			const probe = await run(process.execPath, [entry, "--version"], {
				...options,
				timeout: 15_000,
			});
			if (
				probe.code !== 0 ||
				probe.stdout.trim() !== after.pi?.revision ||
				signal.aborted
			) {
				warn(
					`Updated ${changedSummary}. Could not verify the restart executable; restart Pi manually.`,
				);
				return;
			}
			// Recheck after the asynchronous probe so typing cannot race shutdown.
			if (
				inputReceived ||
				ctx.ui.getEditorText() ||
				!ctx.isIdle() ||
				ctx.hasPendingMessages()
			) {
				warn(
					`Updated ${changedSummary}. Restart Pi to activate updates; input arrived during verification.`,
				);
				return;
			}
			await release();
			release = undefined;
			if (signal.aborted) return;
			if (
				inputReceived ||
				ctx.ui.getEditorText() ||
				!ctx.isIdle() ||
				ctx.hasPendingMessages()
			) {
				warn(
					`Updated ${changedSummary}. Restart Pi to activate updates; input arrived before shutdown.`,
				);
				return;
			}
			restarting = true;
			ctx.ui.notify(`Updated ${changedSummary}. Restarting Pi…`, "info");
			// Pi's quit path stops the TUI and awaits ALL extension shutdown handlers
			// before process.exit(0). execve in session_shutdown would skip later owners.
			process.once("exit", (code) => {
				if (code !== 0 || interrupted) return;
				const nextEnv: Record<string, string> = {};
				for (const [key, value] of Object.entries(process.env))
					if (value !== undefined) nextEnv[key] = value;
				nextEnv[RESTART_MARKER] = String(process.pid);
				nextEnv[RESULT] =
					`Updates active: ${changedSummary}${update.code ? ". Update was incomplete; run pi update --all for details." : ""}`;
				try {
					execve(
						process.execPath,
						[process.execPath, ...process.execArgv, entry, ...args],
						nextEnv,
					);
				} catch (error) {
					if (typeof (error as NodeJS.ErrnoException).code !== "string")
						throw error;
					writeSync(
						2,
						"proper-base updates: Restart failed. Launch pi again to activate installed updates.\n",
					);
				}
			});
			ctx.shutdown();
		} finally {
			clearInterval(progressTimer);
			await release?.();
			ctx.ui.setWidget("proper-updater", undefined);
			removeInput?.();
			if (!restarting) cleanupSignals?.();
		}
	}
	pi.on("session_start", (event, ctx) => {
		settings?.dispose();
		if (ctx.mode === "tui") {
			settings = installSettings(agentDir, ctx, (value) => {
				autoUpdateEnabled = value;
				refreshObserver(ctx);
			});
			autoUpdateEnabled = settings.enabled();
		}
		refreshObserver(ctx);
		// A duplicate load/reload must not replace the pending operation cleanup awaits.
		if (pending) return pending;
		pending = start(event, ctx);
		return pending;
	});
}
