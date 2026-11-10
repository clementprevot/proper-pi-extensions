import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import properBase from "./base-only-fixture.ts";

type Handler = (...args: any[]) => any;

async function createFixture(options?: {
	name?: string;
	priorAssistant?: boolean;
}) {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-session-title-"));
	const handlers = new Map<string, Handler>();
	let transformer:
		| ((
				markdown: string,
				context: { messageType: string; isStreaming: boolean },
		  ) => string)
		| undefined;
	let sessionName = options?.name;
	const branch = options?.priorAssistant
		? [
				{
					type: "message",
					message: { role: "assistant", content: [] },
				},
			]
		: [];
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
		registerCommand() {},
		registerMarkdownTransformer(callback: typeof transformer) {
			transformer = callback;
		},
		getCommands: () => [],
		getSessionName: () => sessionName,
		setSessionName(name: string) {
			sessionName = name;
		},
	} as unknown as Parameters<typeof properBase>[0];
	properBase(pi);

	const ctx = {
		cwd,
		sessionManager: {
			getBranch: () => branch,
			getSessionFile: () => undefined,
		},
		ui: {
			addAutocompleteProvider() {},
			getEditorComponent: () => undefined,
			setEditorComponent() {},
			onTerminalInput() {
				return () => {};
			},
			setEditorText() {},
		},
	};

	await handlers.get("session_start")?.({}, ctx);
	return {
		cleanup: () => rm(cwd, { recursive: true, force: true }),
		ctx,
		handlers,
		getName: () => sessionName,
		getTransformer: () => transformer,
	};
}

// @lat: [[lat.md/proper-base/tests#Verification#Session-title fixture]]
test("first response names a fresh session and hides the title marker", async () => {
	const fixture = await createFixture();
	try {
		const beforeAgentStart = fixture.handlers.get("before_agent_start");
		const messageEnd = fixture.handlers.get("message_end");
		const transformer = fixture.getTransformer();
		assert.ok(beforeAgentStart);
		assert.ok(messageEnd);
		assert.ok(transformer);

		const event = {
			systemPromptOptions: { sections: {} as Record<string, string> },
		};
		assert.equal(await beforeAgentStart(event, fixture.ctx), undefined);
		assert.match(
			event.systemPromptOptions.sections.proper_base_title ?? "",
			/<session_title>/,
		);

		const markdown =
			"Implemented it.\n<session_title>Fix\x1b terminal\x07 tab title</session_title>";
		assert.equal(
			transformer(markdown, {
				messageType: "assistant",
				isStreaming: false,
			}),
			"Implemented it.",
		);

		await messageEnd(
			{
				message: {
					role: "assistant",
					content: [{ type: "text", text: markdown }],
				},
			},
			fixture.ctx,
		);
		assert.equal(fixture.getName(), "Fix terminal tab title");
		assert.equal(
			await beforeAgentStart(
				{ systemPromptOptions: { sections: {} } },
				fixture.ctx,
			),
			undefined,
		);
	} finally {
		await fixture.cleanup();
	}
});

test("an aborted response leaves automatic naming for the retry", async () => {
	const fixture = await createFixture();
	try {
		const beforeAgentStart = fixture.handlers.get("before_agent_start");
		const messageEnd = fixture.handlers.get("message_end");
		assert.ok(beforeAgentStart);
		assert.ok(messageEnd);

		await messageEnd(
			{
				message: {
					role: "assistant",
					stopReason: "aborted",
					content: [
						{
							type: "text",
							text: "<session_title>Incomplete title</session_title>",
						},
					],
				},
			},
			fixture.ctx,
		);
		assert.equal(fixture.getName(), undefined);
		const event = {
			systemPromptOptions: { sections: {} as Record<string, string> },
		};
		await beforeAgentStart(event, fixture.ctx);
		assert.match(
			event.systemPromptOptions.sections.proper_base_title ?? "",
			/<session_title>/,
		);
	} finally {
		await fixture.cleanup();
	}
});

test("a completed response without metadata ends automatic naming", async () => {
	const fixture = await createFixture();
	try {
		const beforeAgentStart = fixture.handlers.get("before_agent_start");
		const messageEnd = fixture.handlers.get("message_end");
		assert.ok(beforeAgentStart);
		assert.ok(messageEnd);

		await messageEnd(
			{
				message: {
					role: "assistant",
					stopReason: "stop",
					content: [{ type: "text", text: "Completed without metadata." }],
				},
			},
			fixture.ctx,
		);
		assert.equal(
			await beforeAgentStart(
				{ systemPromptOptions: { sections: {} } },
				fixture.ctx,
			),
			undefined,
		);
	} finally {
		await fixture.cleanup();
	}
});

test("automatic naming leaves explicit and established sessions alone", async () => {
	for (const options of [{ name: "Manual name" }, { priorAssistant: true }]) {
		const fixture = await createFixture(options);
		try {
			const beforeAgentStart = fixture.handlers.get("before_agent_start");
			const messageEnd = fixture.handlers.get("message_end");
			assert.ok(beforeAgentStart);
			assert.ok(messageEnd);
			assert.equal(
				await beforeAgentStart(
					{ systemPromptOptions: { sections: {} } },
					fixture.ctx,
				),
				undefined,
			);
			await messageEnd(
				{
					message: {
						role: "assistant",
						content: [
							{
								type: "text",
								text: "<session_title>Replacement</session_title>",
							},
						],
					},
				},
				fixture.ctx,
			);
			assert.equal(fixture.getName(), options.name);
		} finally {
			await fixture.cleanup();
		}
	}
});

function prCreated(number: number, overrides?: Record<string, unknown>) {
	return {
		toolName: "bash",
		input: { command: "gh pr create --draft --fill" },
		content: [
			{ type: "text", text: `https://github.com/o/r/pull/${number}\n` },
		],
		isError: false,
		...overrides,
	};
}

// @lat: [[lat.md/proper-base/tests#Verification#Pull request prefix]]
test("a pull request opened before the first title waits for it", async () => {
	const fixture = await createFixture();
	try {
		const toolResult = fixture.handlers.get("tool_result");
		const messageEnd = fixture.handlers.get("message_end");
		assert.ok(toolResult);
		assert.ok(messageEnd);

		await toolResult(prCreated(42), fixture.ctx);
		assert.equal(fixture.getName(), undefined);

		await messageEnd(
			{
				message: {
					role: "assistant",
					stopReason: "stop",
					content: [
						{
							type: "text",
							text: "Opened.\n<session_title>Ship the fix</session_title>",
						},
					],
				},
			},
			fixture.ctx,
		);
		assert.equal(fixture.getName(), "[#42] Ship the fix");
	} finally {
		await fixture.cleanup();
	}
});

test("a first response without a title still names the pull request", async () => {
	const fixture = await createFixture();
	try {
		await fixture.handlers.get("tool_result")?.(prCreated(7), fixture.ctx);
		await fixture.handlers.get("message_end")?.(
			{
				message: {
					role: "assistant",
					stopReason: "stop",
					content: [{ type: "text", text: "Opened." }],
				},
			},
			fixture.ctx,
		);
		assert.equal(fixture.getName(), "[#7]");
	} finally {
		await fixture.cleanup();
	}
});

test("a named session gets one prefix per created pull request", async () => {
	const fixture = await createFixture({ name: "Manual name" });
	try {
		const toolResult = fixture.handlers.get("tool_result");
		assert.ok(toolResult);

		await toolResult(prCreated(5), fixture.ctx);
		assert.equal(fixture.getName(), "[#5] Manual name");
		await toolResult(prCreated(6), fixture.ctx);
		await toolResult(prCreated(6), fixture.ctx);
		assert.equal(fixture.getName(), "[#5] [#6] Manual name");

		await toolResult(prCreated(8, { isError: true }), fixture.ctx);
		await toolResult(
			prCreated(9, { input: { command: "gh pr view 9" } }),
			fixture.ctx,
		);
		assert.equal(fixture.getName(), "[#5] [#6] Manual name");
	} finally {
		await fixture.cleanup();
	}
});
