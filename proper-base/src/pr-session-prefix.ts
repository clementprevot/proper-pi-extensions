const PR_CREATE_COMMAND = /\bgh\s+pr\s+create\b/;
const PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/g;
const PR_PREFIX = /^(?:\[#\d+\]\s*)+/;
const PR_TAG = /\[#(\d+)\]/g;

/**
 * Number of the pull request a `gh pr create` call opened, read from the URL
 * it prints last.
 */
export function createdPullRequestNumber(
	command: string,
	output: string,
): string | undefined {
	if (!PR_CREATE_COMMAND.test(command)) return undefined;
	return [...output.matchAll(PR_URL)].at(-1)?.[1];
}

/** Prefixes `name` with one `[#<n>]` tag per pull request, oldest first. */
export function withPullRequestPrefix(
	name: string | undefined,
	numbers: readonly string[],
): string | undefined {
	const current = name?.trim() ?? "";
	const prefix = PR_PREFIX.exec(current)?.[0] ?? "";
	const tagged = [...prefix.matchAll(PR_TAG)].map((match) => match[1]);
	const added = numbers.filter(
		(number, index) =>
			!tagged.includes(number) && numbers.indexOf(number) === index,
	);
	if (!added.length) return name;

	const tags = [...tagged, ...added].map((number) => `[#${number}]`).join(" ");
	const title = current.slice(prefix.length).trim();
	return title ? `${tags} ${title}` : tags;
}
