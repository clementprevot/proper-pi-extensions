import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	type ExtensionContext,
	InteractiveMode,
} from "@earendil-works/pi-coding-agent";
import { installSettings, readEnabled } from "../src/auto-update/settings.ts";

class SettingsSelectorComponent {
	seen: [string, string][] = [];
	settingsList = {
		items: [
			{
				id: "native",
				label: "Native setting",
				currentValue: "true",
				values: ["true", "false"],
			},
			{
				id: "proper-base-session-rail",
				label: "Session action rail",
				currentValue: "true",
				values: ["true", "false"],
			},
		],
		onChange: (id: string, value: string) => {
			this.seen.push([id, value]);
		},
	};
}

// @lat: [[auto-update-tests#Settings preference]]
test("native settings toggle persists, coexists with other items, and restores wrappers", () => {
	const dir = mkdtempSync(join(tmpdir(), "proper-updater-settings-"));
	const target = InteractiveMode.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(
		target,
		"showSettingsSelector",
	);
	assert.ok(descriptor);
	const warnings: string[] = [];
	const ctx = {
		sessionManager: {},
		ui: { notify: (message: string) => warnings.push(message) },
	} as unknown as ExtensionContext;
	const container = { children: [] as SettingsSelectorComponent[] };
	const mode = Object.create(target, {
		sessionManager: { value: ctx.sessionManager },
		editorContainer: { value: container },
	});
	const native = () => {
		container.children = [new SettingsSelectorComponent()];
	};
	Reflect.set(target, "showSettingsSelector", native);
	const changes: boolean[] = [];
	let controller = installSettings(dir, ctx, (value) => changes.push(value));
	let replacement: ReturnType<typeof installSettings> | undefined;
	const open = () => {
		mode.showSettingsSelector();
		const selector = container.children[0];
		assert.ok(selector);
		return selector;
	};
	try {
		assert.equal(readEnabled(dir), true);
		const first = open();
		const item = first.settingsList.items.find(
			(entry) => entry.id === "proper-updater-enabled",
		);
		assert.ok(item);
		assert.equal(item.label, "Automatic updates");
		assert.equal(item.currentValue, "true");
		assert.deepEqual(item.values, ["true", "false"]);
		first.settingsList.onChange(item.id, "false");
		assert.equal(readEnabled(dir), false);
		assert.equal(controller.enabled(), false);
		assert.deepEqual(changes, [false]);
		first.settingsList.onChange("native", "false");
		first.settingsList.onChange("proper-base-session-rail", "false");
		assert.deepEqual(first.seen, [
			["native", "false"],
			["proper-base-session-rail", "false"],
		]);
		replacement = installSettings(dir, ctx, () => {});
		controller.dispose();
		const second = open();
		assert.equal(
			second.settingsList.items.filter((entry) => entry.id === item.id).length,
			1,
		);
		assert.equal(
			second.settingsList.items.find((entry) => entry.id === item.id)
				?.currentValue,
			"false",
		);
		second.settingsList.onChange(item.id, "true");
		assert.equal(readEnabled(dir), true);
		replacement.dispose();
		assert.equal(Reflect.get(target, "showSettingsSelector"), native);
		assert.equal(
			second.settingsList.items.some((entry) => entry.id === item.id),
			false,
		);
		assert.equal(open().settingsList.items.length, 2);
		assert.deepEqual(warnings, []);

		// A directory at the marker path cannot be unlinked as a file. Failed
		// persistence leaves both the live preference and displayed value off.
		mkdirSync(join(dir, "proper-updater.disabled"));
		controller = installSettings(dir, ctx, () => {});
		const failed = open();
		failed.settingsList.onChange(item.id, "true");
		assert.equal(controller.enabled(), false);
		assert.equal(
			failed.settingsList.items.find((entry) => entry.id === item.id)
				?.currentValue,
			"false",
		);
		assert.equal(warnings.length, 1);
		controller.dispose();
		writeFileSync(join(dir, "not-directory"), "file");
		controller = installSettings(join(dir, "not-directory"), ctx, () => {});
		assert.equal(
			controller.enabled(),
			false,
			"unreadable preferences must disable installation",
		);
	} finally {
		controller.dispose();
		replacement?.dispose();
		Object.defineProperty(target, "showSettingsSelector", descriptor);
		rmSync(dir, { recursive: true, force: true });
	}
});
