import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { stickyDefaultsEnabled } from "../src/startup-defaults.ts";
import { installStickyDefaultsAdapter } from "../src/sticky-defaults.ts";

// @lat: [[lat.md/proper-base/tests#Verification#Sticky defaults fixture]]
test("sticky defaults can be disabled without disturbing sibling config", () => {
	const dir = mkdtempSync(join(tmpdir(), "startup-defaults-"));
	assert.equal(stickyDefaultsEnabled(dir), true);
	writeFileSync(
		join(dir, "proper-base.json"),
		JSON.stringify({ sessionRail: false, stickyDefaults: false }),
	);
	assert.equal(stickyDefaultsEnabled(dir), false);
});

test("the live AgentSession settings cache follows explicit choices only", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "sticky-host-"));
	const settings = SettingsManager.inMemory({
		defaultProvider: "openai",
		defaultModel: "gpt-5",
		defaultThinkingLevel: "medium",
	});
	const modelRuntime = await ModelRuntime.create({
		refreshOnCreate: false,
		modelsPath: null,
	});
	await modelRuntime.setRuntimeApiKey("openai", "test-key");
	modelRuntime.registerProvider("llm-router", {
		baseUrl: "http://127.0.0.1:1",
		apiKey: "test-key",
		api: "openai-completions",
		models: [
			{
				id: "auto",
				name: "Auto",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1,
				maxTokens: 1,
			},
		],
	});
	const reasoning = modelRuntime.getModel("openai", "gpt-5");
	const nonReasoning = modelRuntime.getModel("openai", "gpt-4o");
	const placeholder = modelRuntime.getModel("llm-router", "auto");
	assert.ok(reasoning && nonReasoning && placeholder);

	const originalThinking = AgentSession.prototype.setThinkingLevel;
	let adapter: ReturnType<typeof installStickyDefaultsAdapter> | undefined;
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: cwd,
		settingsManager: settings,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionFactories: [
			(pi) => {
				adapter = installStickyDefaultsAdapter(() => true);
				pi.on("session_start", (_event, ctx) =>
					adapter?.activate(ctx.sessionManager),
				);
				pi.on("session_shutdown", () => adapter?.restore());
			},
		],
	});
	await loader.reload();
	const { session } = await createAgentSession({
		cwd,
		agentDir: cwd,
		model: reasoning,
		thinkingLevel: "medium",
		modelRuntime,
		settingsManager: settings,
		sessionManager: SessionManager.inMemory(cwd),
		resourceLoader: loader,
	});
	await session.extensionRunner.emit({
		type: "session_start",
		reason: "startup",
	});

	try {
		session.setThinkingLevel("high");
		assert.equal(settings.getDefaultThinkingLevel(), "high");
		assert.equal(
			(
				session as unknown as {
					_getThinkingLevelForModelSwitch(model: typeof reasoning): string;
				}
			)._getThinkingLevelForModelSwitch(reasoning),
			"high",
		);

		// Switching to a non-reasoning model clamps the session to off, but that
		// automatic clamp is not a user preference.
		await session.setModel(nonReasoning);
		assert.equal(session.thinkingLevel, "off");
		assert.equal(settings.getDefaultThinkingLevel(), "high");
		assert.equal(settings.getDefaultModel(), "gpt-4o");

		// An explicit off choice is durable even when the effective level already
		// equals off and therefore Pi emits no thinking-level event.
		session.setThinkingLevel("off");
		assert.equal(settings.getDefaultThinkingLevel(), "off");

		await session.setModel(reasoning);
		session.setThinkingLevel("high");
		await session.setModel(placeholder);
		assert.equal(session.thinkingLevel, "off");
		assert.equal(settings.getDefaultProvider(), "openai");
		assert.equal(settings.getDefaultModel(), "gpt-5");
		assert.equal(settings.getDefaultThinkingLevel(), "high");

		settings.setDefaultThinkingLevel("medium");
		settings.setModelThinkingLevel("openai", "gpt-5", "high");
		await session.setModel(reasoning);
		assert.equal(session.thinkingLevel, "high");
		session.setThinkingLevel("high");
		assert.equal(settings.getDefaultThinkingLevel(), "medium");

		// A later extension can retain our wrapper. Disposal must make it inert.
		const ownedThinking = AgentSession.prototype.setThinkingLevel;
		AgentSession.prototype.setThinkingLevel = function (level, options) {
			ownedThinking.call(this, level, options);
		};
		adapter?.restore();
		session.setThinkingLevel("low");
		assert.equal(settings.getDefaultThinkingLevel(), "medium");
	} finally {
		AgentSession.prototype.setThinkingLevel = originalThinking;
		await session.extensionRunner.emit({
			type: "session_shutdown",
			reason: "quit",
		});
		session.dispose();
	}
});
