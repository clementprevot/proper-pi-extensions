import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import {
	DefaultPackageManager,
	type ExtensionContext,
	InteractiveMode,
	initTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { observeAvailability } from "../src/auto-update/availability.ts";

// @lat: [[auto-update-tests#Native observer compatibility]]
test("update notices offer restart only for saved, enabled, supported updates", async () => {
	initTheme("dark", false);
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
		render: () => [],
		invalidate() {},
	};
	const chat = new Container();
	chat.addChild(original);
	const children: object[] = chat.children;
	const screen = Object.create(InteractiveMode.prototype, {
		sessionManager: { value: owner.sessionManager },
		chatContainer: { value: chat },
		ui: { value: { requestRender() {} } },
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
	// Pi's real notices run, so their component shape is the host's own; the
	// extra child proves a non-Text component in the same notice is left alone.
	const nativeShow = InteractiveMode.prototype.showNewVersionNotification;
	Reflect.set(
		InteractiveMode.prototype,
		"showNewVersionNotification",
		function (this: InteractiveMode, ...args: Parameters<typeof nativeShow>) {
			Reflect.apply(nativeShow, this, args);
			children.push(note);
		},
	);
	const observer = observeAvailability("/agent", () => ready);
	assert.ok(observer);
	const rendered = (component: object) =>
		(component as Text)
			.render(100)
			.map((line) => stripVTControlCharacters(line).trim())
			.join("\n");
	const texts = (start: number) =>
		children.slice(start).filter((child) => child instanceof Text);
	let latest: Text[] = [];
	const piNotice = () => {
		const index = children.length;
		screen.showNewVersionNotification({ version: "999.0.0" });
		latest = texts(index);
		return rendered(latest[0] as Text);
	};
	const packagesNotice = () => {
		const index = children.length;
		screen.showPackageUpdateNotification(["proper-base", "@scope/extension"]);
		latest = texts(index);
		return rendered(latest[0] as Text);
	};
	try {
		observer.setContext(owner);
		assert.match(
			piNotice(),
			/New version 999\.0\.0 is available\. Restart Pi to install detected updates\./,
		);
		// A theme change rebuilds the notice; the hint has to survive it.
		(latest[0] as Text).invalidate();
		assert.match(
			rendered(latest[0] as Text),
			/Restart Pi to install detected updates\./,
		);
		assert.match(Reflect.get(original, "text"), /Run pi update$/);
		assert.match(note.text, /Run pi update$/);
		assert.equal(
			rendered(latest[1] as Text),
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
