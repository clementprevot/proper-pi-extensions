import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

/** Compose normally; never turn structured input into an opaque replacement. */
export function appendPromptSection(
	options: NormalizedBuildSystemPromptOptions,
	name: string,
	text: string,
): void {
	if (options.forceSystemPrompt !== undefined) {
		// A prior extension explicitly replaced the prompt. Preserve that choice;
		// Pi ignores structured sections in this mode, so append to its text.
		options.forceSystemPrompt += `\n\n<${name}>\n${text}\n</${name}>`;
	} else {
		options.sections[name] = text;
	}
}
