import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createdPullRequestNumber,
	withPullRequestPrefix,
} from "../src/pr-session-prefix.ts";

const URL = "https://github.com/DataDog/web-ui/pull/39609";

// @lat: [[lat.md/proper-base/tests#Verification#Pull request prefix]]
test("reads the pull request number only from gh pr create output", () => {
	assert.equal(
		createdPullRequestNumber(
			"gh pr create --draft --title x",
			`Warning: 1 uncommitted change\n${URL}\n`,
		),
		"39609",
	);
	assert.equal(
		createdPullRequestNumber(
			"cd repo && gh pr create --body-file b.md",
			"https://github.com/o/r/pull/1\nhttps://github.com/o/r/pull/2",
		),
		"2",
	);
	assert.equal(createdPullRequestNumber("gh pr view 39609", URL), undefined);
	assert.equal(
		createdPullRequestNumber("gh pr create", "no url here"),
		undefined,
	);
});

test("prefixes the session name once per pull request, oldest first", () => {
	assert.equal(withPullRequestPrefix("Fix tabs", ["12"]), "[#12] Fix tabs");
	assert.equal(
		withPullRequestPrefix("[#12] Fix tabs", ["12"]),
		"[#12] Fix tabs",
	);
	assert.equal(
		withPullRequestPrefix("[#12] Fix tabs", ["13", "13"]),
		"[#12] [#13] Fix tabs",
	);
	assert.equal(withPullRequestPrefix(undefined, ["7"]), "[#7]");
	assert.equal(withPullRequestPrefix("Fix tabs", []), "Fix tabs");
	assert.equal(withPullRequestPrefix(undefined, []), undefined);
});
