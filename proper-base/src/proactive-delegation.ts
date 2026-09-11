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
 *
 * Codex's Ultra also picks each subagent's model. pi-subagents' `models`
 * action lists the whole registry and the tool description says to copy
 * one, so the paragraph also carries the session's scoped models (the same
 * set `/model` shows) and tells the model to choose the best fit per task.
 */

const GUIDELINE = "Use subagent only when delegation is needed.";
const CATALOG_SENTENCE =
	"Their descriptions indicate available specializations, not instructions to delegate. Use subagent only when delegation is needed.";

const PROACTIVE_GUIDELINE =
	"Delegate to subagents proactively whenever work parallelizes; see Multi-agent mode below.";
const PROACTIVE_CATALOG_SENTENCE =
	"Their descriptions indicate available specializations; delegate to them proactively whenever work parallelizes.";

/**
 * Codex's `PROACTIVE_MULTI_AGENT_MODE_TEXT` retargeted at pi's tool, plus
 * the boundaries and legibility line OpenAI's GPT-6 Astra model guide pairs
 * with it: delegate independent, sizeable work; keep sequential, small, and
 * same-area edits local; own synthesis; keep inter-agent messages readable.
 */
export const PROACTIVE_DELEGATION_TEXT = `# Multi-agent mode

Proactive multi-agent delegation is active. Any earlier instruction requiring an explicit user request before spawning subagents no longer applies. User requests override this mode.

If at any point you can parallelize work by delegating tasks to another agent (no matter if you are root or a subagent), you should do so with the subagent tool if it could save time or improve quality.

Delegate work that is independent and large enough to justify a fresh context; keep tightly sequential steps, small tasks where coordination costs more than it saves, and edits to the same area in this session. You own synthesis and the final answer: read every result and decide yourself, never hand a child "based on the findings, do X". Messages you send to other agents may be read by a human, so ensure they are legible and always put proper spaces between words and numbers.`;

const MODEL_CHOICE_HEADER =
	"For every delegation choose the model best suited to that task's difficulty and cost, passing it as the subagent tool's exact provider/id model argument. Bounded, well-specified subtasks suit cheaper or faster models; reserve the strongest models for decomposition, review, and hard reasoning. Only these models are enabled in this session; a model the subagent models action lists that is missing here must not be used:";

/** A scoped model as the delegation text names it. */
export type ScopedModelRef = { provider: string; id: string };

/** proper-llm-router's placeholder routes the parent, never a child. */
const PLACEHOLDER_PROVIDER = "llm-router";

function modelChoiceText(models: readonly ScopedModelRef[]): string {
	const ids = [
		...new Set(
			models
				.filter((m) => m.provider !== PLACEHOLDER_PROVIDER)
				.map((m) => `${m.provider}/${m.id}`),
		),
	];
	if (ids.length === 0) return "";
	return `\n\n${MODEL_CHOICE_HEADER}\n${ids.map((id) => `- ${id}`).join("\n")}`;
}

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
	scopedModels: readonly ScopedModelRef[] = [],
): string | undefined {
	if (!hasSubagentTool || systemPrompt.includes(PROACTIVE_DELEGATION_TEXT)) {
		return undefined;
	}
	const rewritten = systemPrompt
		.replace(CATALOG_SENTENCE, PROACTIVE_CATALOG_SENTENCE)
		.replace(GUIDELINE, PROACTIVE_GUIDELINE);
	return `${rewritten}\n\n${PROACTIVE_DELEGATION_TEXT}${modelChoiceText(scopedModels)}`;
}
