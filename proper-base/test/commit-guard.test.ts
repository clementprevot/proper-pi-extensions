import assert from "node:assert/strict";
import { test } from "node:test";

import {
	COMMIT_GUARD_DEFAULTS,
	type CommitGuardConfig,
	commitGuardReason,
	extractMessageFromCommand,
	validateMessageText,
} from "../src/commit-guard.ts";

const strict = (overrides: Partial<CommitGuardConfig>): CommitGuardConfig => ({
	...COMMIT_GUARD_DEFAULTS,
	...overrides,
});

// @lat: [[lat.md/proper-base/tests#Verification#Commit guard fixtures]]
test("valid direct commits pass", () => {
	const commands = [
		'git commit -m "feat: add thing"',
		'git commit -m "feat: add thing" -m "Body line one\nbody line two."',
		'git commit --message "fix: short subject"',
		'git commit --message="fix: short subject"',
		'git commit --amend -m "fix: reworded subject"',
		'git -C /tmp/repo commit -m "chore: scoped git dir"',
		'git commit -m "docs: paths" README.md docs/guide.md',
	];
	for (const command of commands) {
		assert.equal(commitGuardReason(command), undefined, command);
	}
});

test("non-commit commands pass untouched", () => {
	const commands = [
		"ls -la",
		"git status",
		"git log --grep=commit",
		"echo git commit",
		// Odd quoting is skipped entirely unless git AND commit both appear.
		'echo "don\'t commit yet"',
		'echo "git only, no c-word" | grep "don\'t"',
	];
	for (const command of commands) {
		assert.equal(commitGuardReason(command), undefined, command);
	}
});

test("unparseable commands mentioning git commit block fail-safe", () => {
	// Passing on parse failure would let `git commit -F- <<EOF` slip through,
	// so anything naming git commit that the tokenizer cannot parse is denied.
	const reason = commitGuardReason(
		'cat <<EOF > notes.md\nrun git commit -m "x" later, don\'t forget\nEOF',
	);
	assert.ok(reason);
	assert.match(reason, /Unable to parse git commit command/);
});

test("compound commands pass by default", () => {
	const commands = [
		'git add -A && git commit -m "feat: x"',
		'cd /repo && git commit -m "feat: x"',
		'git commit -m "feat: x" && git status',
		'git commit -m "feat: x" | tail',
		'git commit -m "feat: x"; git log',
	];
	for (const command of commands) {
		assert.equal(commitGuardReason(command), undefined, command);
	}
});

test("compound commands can be re-banned through the config", () => {
	const commands = [
		'git add -A && git commit -m "feat: x"',
		'git commit -m "feat: x" && git status',
		'git commit -m "feat: x" | tail',
		'git commit -m "feat: x"; git log',
	];
	for (const command of commands) {
		const reason = commitGuardReason(
			command,
			strict({ allowCompoundCommands: false }),
		);
		assert.ok(reason, command);
		assert.match(reason, /without compound shell/, command);
	}
});

test("wrapped invocations stay rejected", () => {
	const commands = [
		"bash -c 'git commit -m \"feat: x\"'",
		'sudo git commit -m "feat: x"',
		'env GIT_AUTHOR_NAME=x git commit -m "feat: x"',
		'GIT_AUTHOR_NAME=x git commit -m "feat: x"',
	];
	for (const command of commands) {
		const reason = commitGuardReason(command);
		assert.ok(reason, command);
		assert.match(reason, /direct `git \.\.\. commit \.\.\.` invocation/);
	}
});

test("the guard can be disabled outright", () => {
	const reason = commitGuardReason(
		'git commit -m "feat: x" -m "Co-Authored-By: Claude <c@anthropic.com>"',
		strict({ enabled: false }),
	);
	assert.equal(reason, undefined);
});

test("dynamic tokens in commit arguments are rejected", () => {
	const commands = [
		'git commit -m "$(cat /tmp/msg)"',
		'git commit -m "feat: $VAR"',
		"git commit -m `date`",
	];
	for (const command of commands) {
		const reason = commitGuardReason(command);
		assert.ok(reason, command);
		assert.match(reason, /shell expansion|literal/i);
	}
});

test("message-mutating flags stay rejected with hook wording", () => {
	const cases: [string, RegExp][] = [
		['git commit -e -m "feat: x"', /Do not open the editor/],
		['git commit -s -m "feat: x"', /--signoff/],
		['git commit --no-verify -m "feat: x"', /bypasses commit hooks/],
		['git commit --fixup=HEAD~1 -m "feat: x"', /--fixup/],
		["git commit -C HEAD", /reuse commit messages/],
	];
	for (const [command, pattern] of cases) {
		const reason = commitGuardReason(command);
		assert.ok(reason, command);
		assert.match(reason, pattern, command);
	}
});

test("file message sources pass by default and skip text validation", () => {
	const commands = [
		"git commit -F /tmp/msg",
		'git commit --file=/tmp/msg -m "feat: x"',
		"git commit -F/tmp/msg",
	];
	for (const command of commands) {
		assert.equal(commitGuardReason(command), undefined, command);
		const { message, errors } = extractMessageFromCommand(command);
		if (command.includes("-m")) {
			assert.equal(message, "feat: x", command);
		} else {
			assert.equal(message, null, command);
		}
		assert.deepEqual(errors, [], command);
	}
});

test("file message sources can be re-banned through the config", () => {
	const config = strict({ allowFileMessage: false });
	const commands = ["git commit -F /tmp/msg", "git commit --file=/tmp/msg"];
	for (const command of commands) {
		const reason = commitGuardReason(command, config);
		assert.ok(reason, command);
		assert.match(reason, /file cannot be validated/, command);
	}
});

test("commits without literal message content are rejected", () => {
	for (const command of ["git commit", "git commit --amend", "git commit -m"]) {
		const reason = commitGuardReason(command);
		assert.ok(reason, command);
	}
	assert.match(
		commitGuardReason("git commit") as string,
		/no literal -m\/--message content/,
	);
	assert.match(
		commitGuardReason("git commit -m") as string,
		/missing after -m/,
	);
});

test("multiple -m arguments join as paragraphs", () => {
	const { message, errors } = extractMessageFromCommand(
		'git commit -m "feat: subject" -m "Body first line.\nBody second line."',
	);
	assert.deepEqual(errors, []);
	assert.equal(message, "feat: subject\n\nBody first line.\nBody second line.");
});

test("attached -m values are extracted", () => {
	const { message, errors } = extractMessageFromCommand(
		'git commit -m"feat: attached subject"',
	);
	assert.deepEqual(errors, []);
	assert.equal(message, "feat: attached subject");
});

test("message text rules match the hook", () => {
	assert.deepEqual(
		validateMessageText("feat: fine subject\n\nWrapped body."),
		[],
	);
	assert.deepEqual(validateMessageText(""), [
		"line 1: subject line is missing or empty",
	]);
	assert.deepEqual(
		validateMessageText("feat: subject\nbody without blank", true),
		["line 2: body must start with a blank line after the subject"],
	);
	assert.deepEqual(validateMessageText(`feat: subject\nbody without blank`), [
		"line 2: body must start with a blank line after the subject",
	]);
});

test("the line length limit applies only when enforced", () => {
	const longSubject = `feat: ${"x".repeat(70)}`;
	const longBody = `feat: subject\n\n${"y".repeat(73)}`;
	assert.deepEqual(validateMessageText(longSubject), []);
	assert.deepEqual(validateMessageText(longBody), []);
	assert.deepEqual(validateMessageText(longSubject, true), [
		"line 1: line exceeds 72 characters",
	]);
	assert.deepEqual(validateMessageText(longBody, true), [
		"line 3: line exceeds 72 characters",
	]);
});

test("final trailer block is exempt from line length", () => {
	const longTrailer = `Reviewed-by: ${"z".repeat(80)}`;
	assert.deepEqual(
		validateMessageText(`feat: subject\n\nBody text.\n\n${longTrailer}`, true),
		[],
	);
	// The same long line inside the body still fails.
	assert.deepEqual(
		validateMessageText(`feat: subject\n\n${longTrailer}\n\nBody text.`, true),
		["line 3: line exceeds 72 characters"],
	);
});

test("forbidden attribution lines are rejected everywhere", () => {
	const cases: [string, string][] = [
		["Co-Authored-By: Claude <c@anthropic.com>", "co-authored-by"],
		["reply to noreply@anthropic.com", "noreply@anthropic"],
		["Generated with Claude Code", "Claude attribution"],
	];
	for (const [line, label] of cases) {
		const errors = validateMessageText(`feat: subject\n\n${line}`);
		assert.ok(
			errors.some((error) => error.includes(label)),
			line,
		);
	}
	const reason = commitGuardReason(
		'git commit -m "feat: x" -m "Co-Authored-By: Claude <c@anthropic.com>"',
	);
	assert.ok(reason);
	assert.match(reason, /forbidden attribution line/);
});

test("blocked reasons report every error at once", () => {
	const reason = commitGuardReason(
		`git commit -m "feat: ${"x".repeat(70)}" -m "${"y".repeat(80)}"`,
		strict({ enforceLineLength: true }),
	);
	assert.ok(reason);
	assert.match(reason, /^Commit message validation failed:/);
	assert.match(reason, /line 1: line exceeds 72 characters/);
	assert.match(reason, /line 3: line exceeds 72 characters/);
});
