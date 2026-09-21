import {
	DefaultPackageManager,
	type ExtensionContext,
	InteractiveMode,
} from "@earendil-works/pi-coding-agent";
import { installWrapper } from "../host-interop.ts";
import type { UpdateKind } from "./readiness.ts";

// @lat: [[auto-updates#Native availability adapter]]
export function observeAvailability(
	agentDir: string,
	onAvailable: (kind: UpdateKind, ctx: ExtensionContext) => void,
) {
	const manager = DefaultPackageManager.prototype;
	const mode = InteractiveMode.prototype;
	const check = manager.checkForAvailableUpdates;
	const show = mode.showNewVersionNotification;
	if (typeof check !== "function" || typeof show !== "function")
		return undefined;
	let context: ExtensionContext | undefined;
	let active = true;
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
				if (updates.some((update) => update.scope === "user"))
					onAvailable("user", owner);
				if (
					owner.isProjectTrusted() &&
					updates.some((update) => update.scope === "project")
				)
					onAvailable("project", owner);
			}
			return updates;
		},
	);
	const removeShow = installWrapper(
		mode,
		"showNewVersionNotification",
		function (this: InteractiveMode, ...args: Parameters<typeof show>) {
			const result = Reflect.apply(show, this, args);
			const owner = context;
			if (
				active &&
				owner &&
				Reflect.get(this, "sessionManager") === owner.sessionManager &&
				typeof args[0]?.version === "string" &&
				args[0].version.trim()
			)
				onAvailable("pi", owner);
			return result;
		},
	);
	return {
		setContext(ctx: ExtensionContext | undefined) {
			context = ctx;
		},
		dispose() {
			active = false;
			context = undefined;
			removeCheck();
			removeShow();
		},
	};
}
