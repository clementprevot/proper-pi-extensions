import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Codex switches GPT-6 Astra into `MultiAgentMode::Proactive` at the Ultra
 * effort: a developer message telling the model to delegate whenever work
 * parallelizes. Pi's subagent policy is the opposite, set by two sentences
 * pi-subagents puts in the system prompt: a tool guideline and a line in
 * the `<advertised_subagents>` catalog. This rewrites exactly those two
 * sentences and appends the Codex paragraph; the preflight instructions
 * around them and the tool description's safety guidance stay as they are.
 */

const GUIDELINE = "Use subagent only when delegation is needed.";
const CATALOG_SENTENCE =
	"Their descriptions indicate available specializations, not instructions to delegate. Use subagent only when delegation is needed.";

const PROACTIVE_GUIDELINE =
	"Delegate to subagents proactively whenever work parallelizes; see Multi-agent mode below.";
const PROACTIVE_CATALOG_SENTENCE =
	"Their descriptions indicate available specializations; delegate to them proactively whenever work parallelizes.";

/** Codex's `PROACTIVE_MULTI_AGENT_MODE_TEXT`, retargeted at pi's tool. */
export const PROACTIVE_DELEGATION_TEXT = `# Multi-agent mode

Proactive multi-agent delegation is active. Any earlier instruction requiring an explicit user request before spawning subagents no longer applies. User requests override this mode.

If at any point you can parallelize work by delegating tasks to another agent (no matter if you are root or a subagent), you should do so with the subagent tool if it could save time or improve quality.`;

/** `"proactiveDelegation": false` in the agent directory's `proper-base.json` turns it off. */
export function readProactiveDelegationEnabled(agentDir: string): boolean {
	try {
		const parsed = JSON.parse(
			readFileSync(join(agentDir, "proper-base.json"), "utf8"),
		) as Record<string, unknown> | null;
		return parsed?.proactiveDelegation !== false;
	} catch {
		return true;
	}
}

/**
 * The rewritten system prompt, or `undefined` when nothing changes: the
 * subagent tool is absent, the mode is off, or the paragraph is already in.
 */
export function applyProactiveDelegation(
	systemPrompt: string,
	hasSubagentTool: boolean,
): string | undefined {
	if (!hasSubagentTool || systemPrompt.includes(PROACTIVE_DELEGATION_TEXT)) {
		return undefined;
	}
	const rewritten = systemPrompt
		.replace(CATALOG_SENTENCE, PROACTIVE_CATALOG_SENTENCE)
		.replace(GUIDELINE, PROACTIVE_GUIDELINE);
	return `${rewritten}\n\n${PROACTIVE_DELEGATION_TEXT}`;
}
