import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	DefaultPackageManager,
	type ExtensionContext,
	InteractiveMode,
} from "@earendil-works/pi-coding-agent";
import { observeAvailability } from "../src/auto-update/availability.ts";

// @lat: [[auto-update-tests#Native observer compatibility]]
test("native observers preserve receivers, results and failures, and isolate owners and lifecycle", async () => {
	const manager = DefaultPackageManager.prototype;
	const mode = InteractiveMode.prototype;
	const check = Object.getOwnPropertyDescriptor(
		manager,
		"checkForAvailableUpdates",
	);
	const show = Object.getOwnPropertyDescriptor(
		mode,
		"showNewVersionNotification",
	);
	assert.ok(check);
	assert.ok(show);
	const owner = {
		cwd: "/project",
		sessionManager: {},
		isProjectTrusted: () => true,
	} as unknown as ExtensionContext;
	const receiver = Object.assign(Object.create(manager), {
		cwd: "/project",
		agentDir: "/agent",
	});
	const screen = Object.create(mode, {
		sessionManager: { value: owner.sessionManager },
	});
	const updates = [{ scope: "user" }, { scope: "project" }];
	let failure: Error | undefined;
	let wait: Promise<void> | undefined;
	let nativeNotices = 0;
	const nativeCheck = async function (this: unknown, ...args: unknown[]) {
		assert.equal(this, receiver);
		assert.deepEqual(args, ["sentinel"]);
		await wait;
		if (failure) throw failure;
		return updates;
	};
	Reflect.set(manager, "checkForAvailableUpdates", nativeCheck);
	Reflect.set(
		mode,
		"showNewVersionNotification",
		function (this: unknown, release: unknown) {
			assert.equal(this, screen);
			nativeNotices++;
			return release;
		},
	);
	const notices: string[] = [];
	let observer = observeAvailability("/agent", (kind) => notices.push(kind));
	let peer: ReturnType<typeof observeAvailability>;
	try {
		assert.ok(observer);
		observer.setContext(owner);
		assert.equal(
			await Reflect.apply(manager.checkForAvailableUpdates, receiver, [
				"sentinel",
			]),
			updates,
		);
		const release = { version: "999.0.0", note: "native note" };
		assert.equal(
			Reflect.apply(mode.showNewVersionNotification, screen, [release]),
			release,
		);
		assert.deepEqual(notices, ["user", "project", "pi"]);
		assert.equal(nativeNotices, 1);
		notices.length = 0;
		receiver.cwd = "/elsewhere";
		await Reflect.apply(manager.checkForAvailableUpdates, receiver, [
			"sentinel",
		]);
		receiver.cwd = "/project";
		observer.setContext({ ...owner, sessionManager: {} } as ExtensionContext);
		Reflect.apply(mode.showNewVersionNotification, screen, [release]);
		assert.equal(notices.length, 0);
		observer.setContext({ ...owner, isProjectTrusted: () => false });
		await Reflect.apply(manager.checkForAvailableUpdates, receiver, [
			"sentinel",
		]);
		assert.deepEqual(notices, ["user"]);
		notices.length = 0;
		failure = new Error("native failure");
		await assert.rejects(
			Reflect.apply(manager.checkForAvailableUpdates, receiver, ["sentinel"]),
			(error) => error === failure,
		);
		assert.equal(notices.length, 0);
		failure = undefined;
		let releaseCheck!: () => void;
		wait = new Promise<void>((resolve) => {
			releaseCheck = resolve;
		});
		const inflight = Reflect.apply(manager.checkForAvailableUpdates, receiver, [
			"sentinel",
		]);
		observer.dispose();
		releaseCheck();
		assert.equal(await inflight, updates);
		assert.equal(notices.length, 0);
		assert.equal(manager.checkForAvailableUpdates, nativeCheck);
		observer = observeAvailability("/agent", (kind) => notices.push(kind));
		assert.ok(observer);
		observer.setContext(owner);
		peer = observeAvailability("/agent", (kind) =>
			notices.push(`peer:${kind}`),
		);
		assert.ok(peer);
		peer.setContext(owner);
		observer.dispose();
		await Reflect.apply(manager.checkForAvailableUpdates, receiver, [
			"sentinel",
		]);
		assert.deepEqual(notices, ["peer:user", "peer:project"]);
		peer.dispose();
		assert.equal(manager.checkForAvailableUpdates, nativeCheck);
		Reflect.set(manager, "checkForAvailableUpdates", undefined);
		assert.equal(
			observeAvailability("/agent", () => {}),
			undefined,
		);
	} finally {
		observer?.dispose();
		peer?.dispose();
		Object.defineProperty(manager, "checkForAvailableUpdates", check);
		Object.defineProperty(mode, "showNewVersionNotification", show);
	}
});

test("Pi's bundled virtual host supplies the actual prototypes, not the development copy", async () => {
	const require = createRequire(
		import.meta.resolve("@earendil-works/pi-coding-agent"),
	);
	const manifestPath = require.resolve("jiti/package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const { createJiti } = await import(
		join(dirname(manifestPath), manifest.exports["./static"].import)
	);
	const bundle = await import(
		new URL(
			"./bundle/index.js",
			import.meta.resolve("@earendil-works/pi-coding-agent"),
		).href
	);
	const originalCheck =
		bundle.DefaultPackageManager.prototype.checkForAvailableUpdates;
	const originalShow =
		bundle.InteractiveMode.prototype.showNewVersionNotification;
	assert.equal(typeof originalCheck, "function");
	assert.equal(typeof originalShow, "function");
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		tryNative: false,
		virtualModules: { "@earendil-works/pi-coding-agent": bundle },
	});
	const { observeAvailability: observe } = await jiti.import(
		new URL("../src/auto-update/availability.ts", import.meta.url).pathname,
	);
	const observer = observe("/synthetic-agent", () => {});
	try {
		assert.ok(observer);
		assert.notEqual(
			bundle.DefaultPackageManager.prototype.checkForAvailableUpdates,
			originalCheck,
		);
		assert.notEqual(
			bundle.InteractiveMode.prototype.showNewVersionNotification,
			originalShow,
		);
		assert.notEqual(bundle.DefaultPackageManager, DefaultPackageManager);
		assert.notEqual(bundle.InteractiveMode, InteractiveMode);
	} finally {
		observer?.dispose();
	}
	assert.equal(
		bundle.DefaultPackageManager.prototype.checkForAvailableUpdates,
		originalCheck,
	);
	assert.equal(
		bundle.InteractiveMode.prototype.showNewVersionNotification,
		originalShow,
	);
});
