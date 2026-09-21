import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { getPackageDir, parseArgs } from "@earendil-works/pi-coding-agent";
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
} from "../src/auto-update/runtime.ts";

const options = () => ({
	cwd: process.cwd(),
	env: process.env,
	signal: new AbortController().signal,
});

// @lat: [[auto-update-tests#Restart safety]]
test("restart preserves option values and pins continuation to the selected session", () => {
	const raw = [
		"--model",
		"model",
		"--append-system-prompt",
		"--session",
		"-c",
		"--session",
		"old-id",
		"--",
	];
	assert.deepEqual(restartArgs(raw, parseArgs(raw), "/saved/session.jsonl"), [
		"--model",
		"model",
		"--append-system-prompt",
		"--session",
		"--session",
		"/saved/session.jsonl",
	]);
	assert.deepEqual(restartArgs([], parseArgs([])), []);
	assert.deepEqual(restartArgs(["--no-session"], parseArgs(["--no-session"])), [
		"--no-session",
	]);
	assert.equal(restartArgs(["-c"], parseArgs(["-c"])), undefined);
});

test("restart refuses prompts, files, selectors, unknown flags and invalid arguments", () => {
	for (const args of [
		["hi"],
		["@file"],
		["--", "--model"],
		["--resume"],
		["--fork", "abc"],
		["--session-id", "abc"],
		["--custom"],
		["--thinking", "invalid"],
	]) {
		assert.equal(
			restartArgs(args, parseArgs(args), "/saved/session.jsonl"),
			undefined,
			args.join(" "),
		);
	}
});

test("one-shot restart marker only suppresses the same process image", () => {
	const env = { [RESTART_MARKER]: "42" };
	assert.equal(consumeRestartMarker(env, 42), true);
	assert.equal(consumeRestartMarker(env, 42), false);
	assert.deepEqual(env, {});
	const descendant = { [RESTART_MARKER]: "42" };
	assert.equal(consumeRestartMarker(descendant, 43), false);
	assert.deepEqual(descendant, {});
	for (const value of ["1", "true", "YES"]) assert.equal(enabled(value), true);
	for (const value of [undefined, "", "0", "false"])
		assert.equal(enabled(value), false);
});

// @lat: [[auto-update-tests#Change detection]]
test("actual revisions determine restart, including partial update success and missing installs", () => {
	const before = {
		pi: { name: "Pi", revision: "1" },
		pkg: { name: "pkg", revision: "1" },
	};
	assert.deepEqual(changes(before, structuredClone(before)), []);
	assert.deepEqual(
		changes(before, { ...before, pkg: { name: "pkg", revision: "2" } }),
		["pkg 1 → 2"],
	);
	assert.deepEqual(changes({}, before), ["Pi missing → 1", "pkg missing → 1"]);
	assert.deepEqual(changes(before, {}), ["Pi 1 → missing", "pkg 1 → missing"]);
	assert.equal(summary(["1", "2", "3", "4", "5"]), "1; 2; 3; 4; +1 more");
	assert.deepEqual(
		changes({}, { x: { name: "\x1b[31mpkg\n", revision: "2" } }),
		["pkg  missing → 2"],
	);
});

test("inventory parser fails closed on malformed data", () => {
	for (const value of [
		"null",
		"[]",
		"1",
		'{"x":{}}',
		'{"x":{"name":"x","revision":1}}',
	]) {
		assert.throws(() => parseSnapshot(value), TypeError);
	}
	assert.throws(() => parseSnapshot("invalid"), SyntaxError);
	assert.deepEqual(parseSnapshot('{"pi":{"name":"Pi","revision":"1"}}'), {
		pi: { name: "Pi", revision: "1" },
	});
});

// @lat: [[auto-update-tests#Live progress]]
test("native progress becomes concise status without exposing command output", () => {
	const cases = new Map([
		["\x1b[2mUpdating npm:proper-base...\x1b[0m", "Updating proper-base…"],
		["Updating npm:@scope/pkg@latest...", "Updating @scope/pkg…"],
		["Updating user npm packages...", "Updating global packages…"],
		["Updating project npm packages...", "Updating project packages…"],
		["Updating git:https://secret@host/private...", "Updating git package…"],
		["Updated packages", "Checking Pi version…"],
		[
			"Updating pi with npm --registry=https://secret@host install...",
			"Updating Pi…",
		],
		["pi is already up to date (v0.86.1)", "Pi is up to date"],
		["Updated pi from 0.86.0 to 0.86.1", "Pi updated"],
	]);
	for (const [line, expected] of cases)
		assert.equal(updateStatus(line), expected);
	for (const line of [
		"SECRET",
		"npm warn private registry",
		"Updating npm:invalid/name...",
	])
		assert.equal(updateStatus(line), undefined);
});

test("stdout progress streams before completion and handles split and oversized lines", async () => {
	const lines: string[] = [];
	let firstLine!: () => void;
	const first = new Promise<void>((resolve) => {
		firstLine = resolve;
	});
	let finished = false;
	const result = run(
		process.execPath,
		[
			"-e",
			`process.stdout.write('first\\r\\npartial');setTimeout(()=>{process.stdout.write(' line\\n'+'x'.repeat(5000)+'\\nlast')},50);`,
		],
		{
			...options(),
			onLine: (line) => {
				if (line) lines.push(line);
				if (line === "first") firstLine();
			},
		},
	).then((result) => {
		finished = true;
		return result;
	});
	await first;
	assert.equal(finished, false);
	assert.equal((await result).code, 0);
	assert.deepEqual(lines, ["first", "partial line", "last"]);
});

// @lat: [[auto-update-tests#Process isolation]]
test("one updater owns the lock; release permits the next launch", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proper-updater-lock-"));
	try {
		const release = await acquireLock(dir);
		assert.ok(release);
		assert.equal(
			(await readFile(join(dir, "proper-updater.lock"), "utf8")).trim(),
			String(process.pid),
		);
		assert.equal(await acquireLock(dir), undefined);
		await release();
		const next = await acquireLock(dir);
		assert.ok(next);
		await next();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("subprocesses capture output without a shell and preserve failure status", async () => {
	const result = await run(
		process.execPath,
		[
			"-e",
			"process.stdout.write(process.argv[1]);process.stderr.write('private');process.exitCode=7",
			"$(touch nope); literal",
		],
		options(),
	);
	assert.deepEqual(result, {
		code: 7,
		stdout: "$(touch nope); literal",
		stopped: false,
	});
});

test("subprocess output stays bounded and cannot masquerade as valid inventory", async () => {
	const result = await run(
		process.execPath,
		["-e", "process.stdout.write('x'.repeat(2000000))"],
		options(),
	);
	assert.equal(result.stdout.length, 1_048_576);
	assert.equal(result.code, 1);
});

test("timeout and abort terminate subprocesses", async () => {
	const result = await run(
		process.execPath,
		["-e", "setInterval(()=>{},1000)"],
		{ ...options(), timeout: 100 },
	);
	assert.equal(result.stopped, true);
	const controller = new AbortController();
	controller.abort();
	assert.deepEqual(
		await run("must-not-spawn", [], {
			...options(),
			signal: controller.signal,
		}),
		{ code: 1, stdout: "", stopped: true },
	);
	await assert.rejects(
		run("/nonexistent-proper-updater-command", [], options()),
		{ code: "ENOENT" },
	);
});

test("abort kills ready detached install descendants even when they ignore SIGTERM", async () => {
	const controller = new AbortController();
	const descendant = `process.on('SIGTERM',()=>{});process.send(process.pid);setInterval(()=>{},1000);`;
	const script = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']});c.once('message',pid=>console.log(String(pid)));setInterval(()=>{},1000);`;
	const result = await run(process.execPath, ["-e", script], {
		...options(),
		// Numeric console output is ANSI-colored when FORCE_COLOR is inherited.
		env: { ...process.env, FORCE_COLOR: "1" },
		signal: controller.signal,
		// Bound startup, but exercise the shared timeout/abort cleanup only after
		// the descendant confirms its SIGTERM handler is installed.
		timeout: 10_000,
		onLine: () => controller.abort(),
	});
	assert.equal(
		controller.signal.aborted,
		true,
		"descendant never became ready",
	);
	assert.equal(result.stopped, true);
	const pid = Number(result.stdout.trim());
	assert.ok(pid > 0);
	// A killed orphan may remain a zombie until PID 1 reaps it on Linux.
	if (process.platform === "linux") {
		const deadline = Date.now() + 1000;
		while (true) {
			try {
				const state = await readFile(`/proc/${pid}/stat`, "utf8");
				if (/\) Z /.test(state)) break;
				assert.ok(
					Date.now() < deadline,
					"installer descendant survived SIGKILL",
				);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				// Reaping before open yields ENOENT; after open can yield ESRCH.
				if (code === "ENOENT" || code === "ESRCH") break;
				throw error;
			}
			await delay(10);
		}
	}
});

test("inventory uses isolated settings, includes npm pins and ignores local checkout mutation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proper-updater-inventory-"));
	try {
		const agentDir = join(dir, "agent");
		const pkg = join(agentDir, "npm", "node_modules", "example");
		await mkdir(pkg, { recursive: true });
		await writeFile(
			join(pkg, "package.json"),
			JSON.stringify({ name: "example", version: "1.2.3" }),
		);
		await writeFile(
			join(agentDir, "settings.json"),
			JSON.stringify({ packages: ["npm:example@1.2.3", "./local"] }),
		);
		const projectDir = join(dir, ".pi");
		await mkdir(join(projectDir, "npm", "node_modules", "untrusted"), {
			recursive: true,
		});
		await writeFile(
			join(projectDir, "settings.json"),
			JSON.stringify({ packages: ["npm:untrusted"] }),
		);
		const result = await run(
			process.execPath,
			[
				fileURLToPath(
					new URL("../src/auto-update/inventory.mjs", import.meta.url),
				),
				getPackageDir(),
				agentDir,
				dir,
				"false",
			],
			{
				...options(),
				cwd: dir,
				env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
			},
		);
		assert.equal(result.code, 0);
		const inventory = parseSnapshot(result.stdout);
		assert.equal(inventory["user:npm:example@1.2.3"]?.revision, "1.2.3");
		assert.ok(inventory.pi);
		assert.ok(
			!Object.keys(inventory).some(
				(key) => key.includes("local") || key.includes("untrusted"),
			),
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("execve from the exit boundary preserves PID and runs after awaited cleanup", async () => {
	if (!process.execve || process.platform === "win32") return;
	const child = `console.log('replacement:'+process.pid);`;
	const script = `console.log('original:'+process.pid);process.once('exit',()=>process.execve(process.execPath,[process.execPath,'-e',${JSON.stringify(child)}],process.env));await new Promise(r=>setTimeout(r,5));console.log('cleanup');process.exit(0);`;
	const result = await run(
		process.execPath,
		["--input-type=module", "-e", script],
		options(),
	);
	assert.equal(result.code, 0);
	const [first, cleanup, last] = result.stdout.trim().split("\n");
	assert.equal(cleanup, "cleanup");
	assert.equal(first?.split(":")[1], last?.split(":")[1]);
	assert.match(last ?? "", /^replacement:/);
});
