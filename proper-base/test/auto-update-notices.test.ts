import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DefaultPackageManager,
	type ExtensionContext,
	InteractiveMode,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { observeAvailability } from "../src/auto-update/availability.ts";

// @lat: [[auto-update-tests#Native observer compatibility]]
test("update notices offer restart only for saved, enabled, supported updates", async () => {
	const saved = [
		[DefaultPackageManager.prototype, "checkForAvailableUpdates"],
		[InteractiveMode.prototype, "showNewVersionNotification"],
		[InteractiveMode.prototype, "showPackageUpdateNotification"],
	] as const;
	const descriptors = saved.map(([target, key]) => {
		const descriptor = Object.getOwnPropertyDescriptor(target, key);
		assert.ok(descriptor);
		return { target, key, descriptor };
	});
	let trusted = true;
	let ready = true;
	const owner = {
		cwd: "/project",
		sessionManager: {},
		isProjectTrusted: () => trusted,
	} as unknown as ExtensionContext;
	const original = new Text(
		"Old notice\nNew version 0.1 is available. Run pi update",
	);
	const note = {
		text: "Release note\nNew version note is available. Run pi update",
		setText(text: string) {
			this.text = text;
		},
	};
	const children: object[] = [original];
	const screen = Object.create(InteractiveMode.prototype, {
		sessionManager: { value: owner.sessionManager },
		chatContainer: { value: { children } },
	});
	const manager = Object.assign(
		Object.create(DefaultPackageManager.prototype),
		{ cwd: "/project", agentDir: "/agent" },
	);
	Reflect.set(
		DefaultPackageManager.prototype,
		"checkForAvailableUpdates",
		async () => [{ scope: "user" }, { scope: "project" }],
	);
	Reflect.set(InteractiveMode.prototype, "showNewVersionNotification", () => {
		children.push(
			new Text(
				"\x1b[33mUpdate Available\x1b[0m\n\x1b[2mNew version 999.0.0 is available. Run \x1b[0m\x1b[36mpi update\x1b[0m",
			),
			note,
			new Text("Changelog: https://pi.dev/changelog"),
		);
	});
	Reflect.set(
		InteractiveMode.prototype,
		"showPackageUpdateNotification",
		() => {
			children.push(
				new Text(
					"Package Updates Available\nPackage updates are available. Run pi update --extensions\nPackages:\n- proper-base\n- @scope/extension",
				),
			);
		},
	);
	const observer = observeAvailability("/agent", () => ready);
	assert.ok(observer);
	const piNotice = () => {
		const index = children.length;
		screen.showNewVersionNotification({ version: "999.0.0" });
		return Reflect.get(children[index] as object, "text") as string;
	};
	const packagesNotice = () => {
		screen.showPackageUpdateNotification(["proper-base", "@scope/extension"]);
		return Reflect.get(children.at(-1) as object, "text") as string;
	};
	try {
		observer.setContext(owner);
		assert.match(
			piNotice(),
			/New version 999\.0\.0 is available\. Restart Pi to install detected updates\./,
		);
		assert.match(Reflect.get(original, "text"), /Run pi update$/);
		assert.match(note.text, /Run pi update$/);
		assert.equal(
			Reflect.get(children.at(-1) as object, "text"),
			"Changelog: https://pi.dev/changelog",
		);
		assert.match(packagesNotice(), /Run pi update --extensions/);
		await manager.checkForAvailableUpdates();
		const packages = packagesNotice();
		assert.match(packages, /Restart Pi to install detected updates\./);
		assert.match(packages, /Packages:\n- proper-base\n- @scope\/extension$/);
		assert.doesNotMatch(packages, /Run pi update/);
		ready = false;
		assert.match(piNotice(), /Run /);
		await manager.checkForAvailableUpdates();
		assert.match(packagesNotice(), /Run pi update --extensions/);
		ready = true;
		trusted = false;
		await manager.checkForAvailableUpdates();
		assert.match(packagesNotice(), /Run pi update --extensions/);
		observer.setContext(undefined);
		assert.match(piNotice(), /Run /);
		assert.match(packagesNotice(), /Run pi update --extensions/);
	} finally {
		observer.dispose();
		for (const { target, key, descriptor } of descriptors) {
			Object.defineProperty(target, key, descriptor);
		}
	}
});
