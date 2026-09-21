import { stripVTControlCharacters } from "node:util";
import {
	DefaultPackageManager,
	type ExtensionContext,
	InteractiveMode,
} from "@earendil-works/pi-coding-agent";
import { installWrapper } from "../host-interop.ts";
import type { UpdateKind } from "./readiness.ts";

function showRestartHint(receiver: object, start: number): void {
	const chat = Reflect.get(receiver, "chatContainer") as
		| { children?: object[] }
		| undefined;
	if (!Array.isArray(chat?.children)) return;
	for (const child of chat.children.slice(start)) {
		if (child.constructor?.name !== "Text") continue;
		const text = Reflect.get(child, "text");
		const setText = Reflect.get(child, "setText");
		if (typeof text !== "string" || typeof setText !== "function") continue;
		const lines = text.split("\n");
		const instruction = stripVTControlCharacters(lines[1] ?? "").match(
			/^(New version .+ is available\.|Package updates are available\.) Run pi update(?: --extensions)?$/,
		);
		if (!instruction) continue;
		lines[1] = `${instruction[1]} Restart Pi to install detected updates.`;
		Reflect.apply(setText, child, [lines.join("\n")]);
	}
}

function childCount(receiver: object): number {
	const chat = Reflect.get(receiver, "chatContainer") as
		| { children?: unknown[] }
		| undefined;
	return Array.isArray(chat?.children) ? chat.children.length : 0;
}

// @lat: [[auto-updates#Native availability adapter]]
export function observeAvailability(
	agentDir: string,
	onAvailable: (kind: UpdateKind, ctx: ExtensionContext) => boolean,
) {
	const manager = DefaultPackageManager.prototype;
	const mode = InteractiveMode.prototype;
	const check = manager.checkForAvailableUpdates;
	const show = mode.showNewVersionNotification;
	const showPackages = mode.showPackageUpdateNotification;
	if (
		typeof check !== "function" ||
		typeof show !== "function" ||
		typeof showPackages !== "function"
	)
		return undefined;
	let context: ExtensionContext | undefined;
	let active = true;
	let packagesReady: ExtensionContext | undefined;
	let projectReady = false;
	const removeCheck = installWrapper(
		manager,
		"checkForAvailableUpdates",
		async function (
			this: DefaultPackageManager,
			...args: Parameters<typeof check>
		) {
			const owner = context;
			const matches =
				owner &&
				Reflect.get(this, "agentDir") === agentDir &&
				Reflect.get(this, "cwd") === owner.cwd;
			const updates = (await Reflect.apply(check, this, args)) as Awaited<
				ReturnType<typeof check>
			>;
			if (active && matches && context === owner) {
				let ready = updates.length > 0;
				projectReady = updates.some((update) => update.scope === "project");
				for (const scope of new Set(updates.map((update) => update.scope))) {
					if (scope === "project" && !owner.isProjectTrusted()) ready = false;
					else if (!onAvailable(scope, owner)) ready = false;
				}
				packagesReady = ready ? owner : undefined;
			}
			return updates;
		},
	);
	const removeShow = installWrapper(
		mode,
		"showNewVersionNotification",
		function (this: InteractiveMode, ...args: Parameters<typeof show>) {
			const start = childCount(this);
			const result = Reflect.apply(show, this, args);
			const owner = context;
			if (
				active &&
				owner &&
				Reflect.get(this, "sessionManager") === owner.sessionManager &&
				typeof args[0]?.version === "string" &&
				args[0].version.trim()
			)
				if (onAvailable("pi", owner)) showRestartHint(this, start);
			return result;
		},
	);
	const removePackages = installWrapper(
		mode,
		"showPackageUpdateNotification",
		function (this: InteractiveMode, ...args: Parameters<typeof showPackages>) {
			const start = childCount(this);
			const result = Reflect.apply(showPackages, this, args);
			if (
				active &&
				context &&
				packagesReady === context &&
				Reflect.get(this, "sessionManager") === context.sessionManager &&
				(!projectReady || context.isProjectTrusted())
			)
				showRestartHint(this, start);
			return result;
		},
	);
	return {
		setContext(ctx: ExtensionContext | undefined) {
			if (context !== ctx) packagesReady = undefined;
			context = ctx;
		},
		dispose() {
			active = false;
			context = undefined;
			removeCheck();
			removeShow();
			removePackages();
		},
	};
}
