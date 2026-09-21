import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const require = createRequire(
	import.meta.resolve(
		"../proper-pacify/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
	),
);
const host = await import(
	new URL(
		"proper-pacify/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
		root,
	)
);
const tui = await import(
	new URL(
		"proper-pacify/node_modules/@earendil-works/pi-tui/dist/index.js",
		root,
	)
);
const manifestPath = require.resolve("jiti/package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const { createJiti } = await import(
	join(dirname(manifestPath), manifest.exports["./static"].import)
);
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	tryNative: false,
	virtualModules: {
		"@earendil-works/pi-coding-agent": host,
		"@earendil-works/pi-tui": tui,
	},
});
// Pi supplies one virtual host to independently installed packages. Use that
// same loader contract rather than two package-local copies of AgentSession.
const { createPromptDisplay } = await jiti.import(
	fileURLToPath(new URL("proper-base/src/prompt-display.ts", root)),
);
const { installPromptDisplayHost } = await jiti.import(
	fileURLToPath(new URL("proper-base/src/prompt-display-host.ts", root)),
);
const { installHostHooks } = await jiti.import(
	fileURLToPath(new URL("proper-pacify/host.ts", root)),
);
const { createHostFixture } = await jiti.import(
	fileURLToPath(new URL("proper-pacify/test/host-fixture.ts", root)),
);

test("independent packages ship the same versioned host interop protocol", async () => {
	const canonical = await readFile(
		new URL("proper-base/src/host-interop.ts", root),
		"utf8",
	);
	assert.equal(
		await readFile(new URL("proper-pacify/host-interop.ts", root), "utf8"),
		canonical,
	);
});

// @lat: [[proper-base/tests#Verification#Cross-package dispatch fixture]]
for (const baseFirst of [true, false]) {
	for (const reverseShutdown of [false, true]) {
		test(`base ${baseFirst ? "first" : "last"}, shutdown ${reverseShutdown ? "reverse" : "load"} order preserves input and restores methods`, async () => {
			const fixture = createHostFixture(() => {});
			fixture.session._resourceLoader.getPrompts = () => ({
				prompts: [{ name: "review", content: "Expanded $@" }],
			});
			const tracked = [
				[host.AgentSession.prototype, "prompt"],
				[host.AgentSession.prototype, "steer"],
				[host.AgentSession.prototype, "followUp"],
				[host.InteractiveMode.prototype, "getUserMessageText"],
				[host.InteractiveMode.prototype, "addMessageToChat"],
				[fixture.agent, "prompt"],
				[fixture.agent, "steer"],
				[fixture.agent, "followUp"],
				[fixture.manager, "appendMessage"],
			].map(([target, key]) => ({
				target,
				key,
				descriptor: Object.getOwnPropertyDescriptor(target, key),
			}));
			for (let reload = 0; reload < 3; reload++) {
				const display = createPromptDisplay();
				const marker = (text) => text;
				const origins = new WeakMap();
				const hooks = {
					active: true,
					manager: fixture.manager,
					transformer: (text) => text,
					displayRevision: 0,
					async prepare(_ctx, event) {
						return {
							result: {
								action: "transform",
								text: event.text.replace("hostile", "neutral"),
							},
							origin: { entryId: "original", before: event.text },
						};
					},
					bind(message, origin) {
						origins.set(message, origin);
					},
					persist() {},
					transform(_message, text) {
						return text;
					},
				};
				const base = () => {
					const adapter = installPromptDisplayHost(
						display,
						() => [{ name: "review", source: "prompt" }],
						marker,
					);
					adapter.activate(fixture.manager);
					return adapter;
				};
				const pacify = () => installHostHooks(hooks);
				const controllers = (baseFirst ? [base, pacify] : [pacify, base]).map(
					(install) => install(),
				);
				try {
					fixture.session._isAgentRunActive = false;
					await fixture.session.prompt("/review hostile prompt");
					fixture.session._isAgentRunActive = true;
					await fixture.session.steer("/review hostile steer");
					await fixture.session.followUp("/review hostile followup");
					await fixture.session.prompt("/review hostile queued", {
						streamingBehavior: "steer",
					});
					const messages = [fixture.sent.at(-1), ...fixture.queued.slice(-3)];
					const ui = {
						session: fixture.session,
						getMarkdownTransformers: () => [marker, hooks.transformer],
					};
					const displayed = messages.map((message) =>
						host.InteractiveMode.prototype.getUserMessageText.call(ui, message),
					);
					assert.deepEqual(displayed, [
						"/review hostile prompt",
						"/review hostile steer",
						"/review hostile followup",
						"/review hostile queued",
					]);
					assert.deepEqual(
						messages.map((message) => origins.get(message)?.before),
						displayed,
					);
					assert.ok(
						messages.every((message) =>
							message.content[0].text.startsWith("Expanded neutral"),
						),
					);
				} finally {
					for (const controller of reverseShutdown
						? [...controllers].reverse()
						: controllers)
						controller.dispose();
				}
				for (const { target, key, descriptor } of tracked) {
					assert.deepEqual(
						Object.getOwnPropertyDescriptor(target, key),
						descriptor,
						`${key} leaked a wrapper on reload ${reload}`,
					);
				}
			}
		});
	}
}
