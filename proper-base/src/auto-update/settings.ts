import { lstatSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type ExtensionContext,
	InteractiveMode,
} from "@earendil-works/pi-coding-agent";
import { installWrapper } from "../host-interop.ts";

const ID = "proper-updater-enabled";
const disabledPath = (agentDir: string) =>
	join(agentDir, "proper-updater.disabled");

export function readEnabled(agentDir: string): boolean {
	try {
		lstatSync(disabledPath(agentDir));
		return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return true;
	}
}

function saveEnabled(agentDir: string, enabled: boolean): void {
	try {
		if (enabled) unlinkSync(disabledPath(agentDir));
		else {
			mkdirSync(agentDir, { recursive: true, mode: 0o700 });
			writeFileSync(disabledPath(agentDir), "", { flag: "wx", mode: 0o600 });
		}
	} catch (error) {
		if (
			(error as NodeJS.ErrnoException).code !== (enabled ? "ENOENT" : "EEXIST")
		)
			throw error;
	}
}

type Item = {
	id: string;
	label: string;
	description?: string;
	currentValue: string;
	values: string[];
};
type List = { items: Item[]; onChange(id: string, value: string): void };

// @lat: [[auto-updates#Settings toggle]]
export function installSettings(
	agentDir: string,
	ctx: ExtensionContext,
	onChange: (enabled: boolean) => void,
) {
	let enabled = false;
	const warn = (error: unknown) => {
		if (typeof (error as NodeJS.ErrnoException).code !== "string") throw error;
		ctx.ui.notify(
			"proper-base updates: Could not read or save the auto-update preference. Automatic updates keep their previous setting (disabled if unreadable).",
			"warning",
		);
	};
	try {
		enabled = readEnabled(agentDir);
	} catch (error) {
		warn(error);
	}
	let active = true;
	let clearItem: (() => void) | undefined;
	const target = InteractiveMode.prototype;
	const native = Reflect.get(target, "showSettingsSelector");
	let remove: (() => void) | undefined;
	if (typeof native === "function") {
		remove = installWrapper(
			target,
			"showSettingsSelector",
			function (this: InteractiveMode, ...args: unknown[]) {
				const result = Reflect.apply(native, this, args);
				if (
					!active ||
					Reflect.get(this, "sessionManager") !== ctx.sessionManager
				)
					return result;
				clearItem?.();
				clearItem = undefined;
				const container = Reflect.get(this, "editorContainer") as
					| { children?: { settingsList?: List }[] }
					| undefined;
				const list = container?.children?.find(
					(child) => child.constructor?.name === "SettingsSelectorComponent",
				)?.settingsList;
				if (
					!list ||
					!Array.isArray(list.items) ||
					typeof list.onChange !== "function" ||
					list.items.some((item) => item.id === ID)
				)
					return result;
				const item: Item = {
					id: ID,
					label: "Automatic updates",
					description:
						"proper-base: install detected updates on the next launch. Startup flags override this preference; running installs are not interrupted.",
					currentValue: String(enabled),
					values: ["true", "false"],
				};
				list.items.push(item);
				const nativeChange = list.onChange;
				const restoreChange = installWrapper(
					list,
					"onChange",
					function (this: List, id: string, value: string) {
						if (id !== ID || !active)
							return Reflect.apply(nativeChange, this, [id, value]);
						if (value !== "true" && value !== "false") return;
						try {
							saveEnabled(agentDir, value === "true");
							enabled = value === "true";
						} catch (error) {
							warn(error);
						}
						item.currentValue = String(enabled);
						onChange(enabled);
					},
				);
				clearItem = () => {
					restoreChange();
					const index = list.items.indexOf(item);
					if (index !== -1) list.items.splice(index, 1);
				};
				return result;
			},
		);
	} else
		ctx.ui.notify(
			"proper-base updates: This Pi version cannot show the Automatic updates setting. Use --no-auto-update instead.",
			"warning",
		);
	return {
		enabled: () => enabled,
		dispose() {
			active = false;
			clearItem?.();
			clearItem = undefined;
			remove?.();
		},
	};
}
