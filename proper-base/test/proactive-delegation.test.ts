import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	applyProactiveDelegation,
	PROACTIVE_DELEGATION_TEXT,
	readProactiveDelegationEnabled,
} from "../src/proactive-delegation.ts";

const PROMPT = [
	"Guidelines:",
	"- Use bash for file operations like ls, rg, find",
	"- Use subagent only when delegation is needed.",
	"- Be concise in your responses",
	"",
	"<advertised_subagents>",
	'The following file-defined subagents opted into discovery. Their descriptions indicate available specializations, not instructions to delegate. Use subagent only when delegation is needed. Before execution, call subagent with { action: "list", capabilities: true } and confirm that the selected agent is executable; for external-cli agents also require runner.available === true.',
	"  <subagent>",
	"    <name>reviewer</name>",
	"  </subagent>",
	"</advertised_subagents>",
].join("\n");

// @lat: [[lat.md/proper-base/tests#Verification#Proactive delegation fixture]]
test("rewrites both explicit-only sentences and appends the mode paragraph", () => {
	const result = applyProactiveDelegation(PROMPT, true);
	assert.ok(result);
	assert.ok(!result.includes("only when delegation is needed"));
	assert.ok(!result.includes("not instructions to delegate"));
	assert.ok(result.includes("- Delegate to subagents proactively"));
	assert.ok(
		result.includes(
			'Before execution, call subagent with { action: "list", capabilities: true }',
		),
	);
	assert.ok(result.includes("- Use bash for file operations"));
	assert.ok(result.endsWith(PROACTIVE_DELEGATION_TEXT));
	for (const rule of [
		"If at any point you can parallelize work",
		"keep tightly sequential steps, small tasks",
		"You own synthesis and the final answer",
		"proper spaces between words and numbers",
	]) {
		assert.ok(result.includes(rule), rule);
	}
});

test("scoped models are listed as the only delegation choices", () => {
	const result = applyProactiveDelegation("You are pi.", true, [
		{ provider: "llm-router", id: "auto" },
		{ provider: "cliproxyapi", id: "gpt-6-astra" },
		{ provider: "cliproxyapi", id: "claude-opus-5" },
		{ provider: "cliproxyapi", id: "gpt-6-astra" },
	]);
	assert.ok(result);
	const tail = result.slice(result.indexOf(PROACTIVE_DELEGATION_TEXT));
	assert.ok(tail.includes("Only these models are enabled in this session"));
	assert.deepEqual(
		tail.split("\n").filter((line) => line.startsWith("- ")),
		["- cliproxyapi/gpt-6-astra", "- cliproxyapi/claude-opus-5"],
	);
	assert.ok(!tail.includes("llm-router"));
	assert.equal(
		applyProactiveDelegation("You are pi.", true, [
			{ provider: "llm-router", id: "auto" },
		]),
		`You are pi.\n\n${PROACTIVE_DELEGATION_TEXT}`,
	);
});

test("a prompt without the guideline still gains the paragraph", () => {
	const result = applyProactiveDelegation("You are pi.", true);
	assert.equal(result, `You are pi.\n\n${PROACTIVE_DELEGATION_TEXT}`);
});

test("no subagent tool or already applied leaves the prompt alone", () => {
	assert.equal(applyProactiveDelegation(PROMPT, false), undefined);
	const applied = applyProactiveDelegation(PROMPT, true) as string;
	assert.equal(applyProactiveDelegation(applied, true), undefined);
});

test("proper-base.json proactiveDelegation=false disables, else enabled", () => {
	const dir = mkdtempSync(join(tmpdir(), "proper-base-proactive-"));
	assert.equal(readProactiveDelegationEnabled(dir), true);
	writeFileSync(join(dir, "proper-base.json"), '{"sessionRail":true}');
	assert.equal(readProactiveDelegationEnabled(dir), true);
	writeFileSync(join(dir, "proper-base.json"), '{"proactiveDelegation":false}');
	assert.equal(readProactiveDelegationEnabled(dir), false);
	writeFileSync(join(dir, "proper-base.json"), "not json");
	assert.equal(readProactiveDelegationEnabled(dir), true);
});
