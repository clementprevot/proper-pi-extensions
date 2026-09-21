import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { DEFAULTS, loadConfig, saveConfig } from "../compact.ts";
import { fixture, model } from "./fixture.ts";

type Fixture = Awaited<ReturnType<typeof fixture>>;
function dialogs(
	f: Fixture,
	selections: (string | undefined)[],
	inputs: (string | undefined)[] = [],
) {
	const menus: { title: string; options: string[] }[] = [];
	const ui = {
		async select(
			title: string,
			options: string[],
			dialog: { signal: AbortSignal },
		) {
			assert.ok(dialog.signal instanceof AbortSignal);
			menus.push({ title, options });
			const answer = selections.shift();
			if (answer === undefined) return undefined;
			const option = options.find(
				(option) => option === answer || option.startsWith(`${answer}:`),
			);
			assert.ok(option, `Missing option ${answer} in ${title}`);
			return option;
		},
		async input(
			_title: string,
			_placeholder: string,
			dialog: { signal: AbortSignal },
		) {
			assert.ok(dialog.signal instanceof AbortSignal);
			return inputs.shift();
		},
		notify(message: string) {
			f.notices.push(message);
		},
	};
	f.runner.setUIContext(ui, "tui");
	return { menus, ui };
}
const open = (f: Fixture) =>
	f.commands.get("compact-config").handler("", f.runner.createContext());

// @lat: [[proper-compact/tests#Settings menu]]
test("settings menu edits every field and shows persisted current values", async (t) => {
	const f = await fixture(t);
	const { menus } = dialogs(
		f,
		[
			"Enabled",
			"off",
			"Model",
			"fixture/summary",
			"Thinking",
			"high",
			"Input token limit",
			"Output token limit",
			"Maximum calls",
			"Timeout (ms)",
			"On error",
			"Cancel (keep original history)",
			"Done",
		],
		["6000", "2048", "8", "10000"],
	);
	await open(f);
	assert.deepEqual(await loadConfig(f.configPath), {
		enabled: false,
		model: "fixture/summary",
		thinking: "high",
		maxInputTokens: 6000,
		maxOutputTokens: 2048,
		maxCalls: 8,
		timeoutMs: 10000,
		onError: "cancel",
	});
	assert.deepEqual(menus.at(-1)?.options, [
		"Enabled: off",
		"Model: fixture/summary",
		"Thinking: high",
		"Input token limit: 6000",
		"Output token limit: 2048",
		"Maximum calls: 8",
		"Timeout (ms): 10000",
		"On error: cancel",
		"Done",
	]);
	assert.equal(f.calls.length, 0);
	const again = dialogs(f, ["On error", undefined, "Done"]);
	await open(f);
	assert.equal(again.menus[1]?.options[0], "Cancel (keep original history)");
});

test("model menu respects authentication and scope, with current and inherited defaults", async (t) => {
	const f = await fixture(t);
	await saveConfig(f.configPath, {
		...DEFAULTS,
		model: "fixture/summary",
		thinking: "high",
		maxInputTokens: 9000,
	});
	f.registry.getAvailable = () => [model, { ...model, id: "out-of-scope" }];
	f.runner.getScopedModels = () => [
		{ model },
		{ model: { ...model, id: "unauthenticated" } },
	];
	const { menus } = dialogs(
		f,
		[
			"Model",
			"Current session model",
			"Thinking",
			"Inherit session",
			"Input token limit",
			"Done",
		],
		["auto"],
	);
	await open(f);
	assert.deepEqual(menus.find((menu) => menu.title === "Model")?.options, [
		"fixture/summary",
		"Current session model",
	]);
	assert.deepEqual(await loadConfig(f.configPath), {
		...DEFAULTS,
		thinking: null,
	});
	f.registry.getAvailable = () => [];
	const empty = dialogs(f, ["Model", undefined, "Done"]);
	await open(f);
	assert.deepEqual(
		empty.menus.find((menu) => menu.title === "Model")?.options,
		["Current session model"],
	);
});

test("cancelling or entering invalid limits keeps settings unchanged and menu usable", async (t) => {
	const f = await fixture(t);
	dialogs(f, [undefined]);
	await open(f);
	await assert.rejects(readFile(f.configPath), { code: "ENOENT" });
	await saveConfig(f.configPath, DEFAULTS);
	const before = await readFile(f.configPath, "utf8");
	dialogs(
		f,
		[
			"Model",
			undefined,
			"Maximum calls",
			"Maximum calls",
			"Maximum calls",
			"Output token limit",
			"Done",
		],
		["0", "1.5", "not a number", undefined],
	);
	await open(f);
	assert.equal(await readFile(f.configPath, "utf8"), before);
	assert.equal(
		f.notices.filter((notice) => notice.includes("maxCalls must be an integer"))
			.length,
		3,
	);
});

test("a menu edit merges fresh disk values instead of overwriting unrelated updates", async (t) => {
	const f = await fixture(t);
	const { ui } = dialogs(f, ["Maximum calls", "Done"]);
	ui.input = async () => {
		await saveConfig(f.configPath, {
			...DEFAULTS,
			enabled: false,
			thinking: "high",
		});
		return "6";
	};
	await open(f);
	assert.deepEqual(await loadConfig(f.configPath), {
		...DEFAULTS,
		enabled: false,
		thinking: "high",
		maxCalls: 6,
	});
});

test("shutdown dismisses menu work without accepting a late dialog response", async (t) => {
	const f = await fixture(t);
	const { ui } = dialogs(f, ["Maximum calls"]);
	ui.input = async (_title, _placeholder, options) => {
		await f.runner.emit({ type: "session_shutdown", reason: "reload" });
		assert.equal(options.signal.aborted, true);
		return "16";
	};
	await open(f);
	await assert.rejects(readFile(f.configPath), { code: "ENOENT" });
});

test("headless settings remain readable and JSON updates work without a dialog", async (t) => {
	const f = await fixture(t);
	const output: string[] = [];
	t.mock.method(console, "error", (text: string) => output.push(text));
	const { menus } = dialogs(f, []);
	f.runner.setUIContext(undefined, "print");
	assert.equal(f.runner.createContext().hasUI, false);
	await open(f);
	assert.equal(menus.length, 0);
	assert.ok(
		output.some(
			(text) => text.includes(f.configPath) && text.includes("requires a UI"),
		),
	);
	await f.commands
		.get("compact-config")
		.handler('{"enabled":false}', f.runner.createContext());
	assert.equal((await loadConfig(f.configPath)).enabled, false);
	assert.ok(output.some((text) => text.includes("settings saved")));
});

test("malformed configuration is reported without opening a menu or replacing the file", async (t) => {
	const f = await fixture(t);
	await writeFile(f.configPath, "{broken");
	const { menus } = dialogs(f, ["Enabled", "off"]);
	await open(f);
	assert.equal(menus.length, 0);
	assert.ok(f.notices.some((text) => text.includes("Invalid JSON")));
	assert.equal(await readFile(f.configPath, "utf8"), "{broken");
});
