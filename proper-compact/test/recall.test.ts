import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	collectEntriesForBranchSummary,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { recall, serializeEntry } from "../context.ts";
import {
	addTool,
	checkpoint,
	fixture,
	response,
	usage,
	user,
} from "./fixture.ts";
import { moduleLoader } from "./module-loader.ts";

// @lat: [[proper-compact/tests#Branch summaries and recall]]
test("branch summaries honor opt-in and focus, while custom-format requests delegate", async (t) => {
	const f = await fixture(t);
	f.populate();
	const preparation = {
		targetId: "target",
		oldLeafId: f.manager.getLeafId(),
		commonAncestorId: null,
		entriesToSummarize: f.manager.getBranch(),
		userWantsSummary: false,
		customInstructions: "BRANCH_FOCUS",
	};
	assert.equal(
		await f.runner.emit({
			type: "session_before_tree",
			preparation,
			signal: new AbortController().signal,
		}),
		undefined,
	);
	assert.equal(f.calls.length, 0);
	preparation.userWantsSummary = true;
	const result = await f.runner.emit({
		type: "session_before_tree",
		preparation,
		signal: new AbortController().signal,
	});
	assert.match(result.summary.summary, /## Goal/);
	assert.ok(JSON.stringify(f.calls[0][1]).includes("BRANCH_FOCUS"));
	assert.ok(
		JSON.stringify(f.calls[0][1]).includes('\\"phase\\":\\"branch\\"') ||
			JSON.stringify(f.calls[0][1]).includes('"phase":"branch"'),
	);
	assert.equal(
		await f.runner.emit({
			type: "session_before_tree",
			preparation: { ...preparation, replaceInstructions: true },
			signal: new AbortController().signal,
		}),
		undefined,
	);
	assert.equal(f.calls.length, 1);
	assert.deepEqual(f.errors, []);
});

test("branch summaries and recall retain raw history after context edits", async (t) => {
	const f = await fixture(t);
	const root = f.manager.appendMessage(user("Common ancestor"));
	const replaced = f.manager.appendMessage(
		response("ORIGINAL_BRANCH_EVIDENCE"),
	);
	const omitted = f.manager.appendMessage(response("OMITTED_BRANCH_EVIDENCE"));
	f.manager.appendContextEdit(replaced, { content: "REPLACEMENT_BRANCH_TEXT" });
	f.manager.appendContextEdit(omitted, null);
	const projected = JSON.stringify(f.manager.buildSessionProjection().messages);
	assert.match(projected, /REPLACEMENT_BRANCH_TEXT/);
	assert.doesNotMatch(
		projected,
		/ORIGINAL_BRANCH_EVIDENCE|OMITTED_BRANCH_EVIDENCE/,
	);
	const oldLeafId = f.manager.getLeafId();
	const { entries, commonAncestorId } = collectEntriesForBranchSummary(
		f.manager,
		oldLeafId,
		root,
	);
	await f.runner.emit({
		type: "session_before_tree",
		preparation: {
			targetId: root,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize: entries,
			userWantsSummary: true,
		},
		signal: new AbortController().signal,
	});
	const input = JSON.stringify(f.calls[0][1]);
	assert.match(input, /ORIGINAL_BRANCH_EVIDENCE/);
	assert.match(input, /OMITTED_BRANCH_EVIDENCE/);
	assert.doesNotMatch(input, /REPLACEMENT_BRANCH_TEXT/);
	assert.match(
		recall(f.manager, { entryId: replaced }),
		/ORIGINAL_BRANCH_EVIDENCE/,
	);
	assert.match(
		recall(f.manager, { entryId: omitted }),
		/OMITTED_BRANCH_EVIDENCE/,
	);
	assert.deepEqual(f.errors, []);
});

test("recall pages original text after compaction and literal search finds interior errors", async (t) => {
	const f = await fixture(t);
	const id = f.populate(
		`${"a".repeat(5000)}HIDDEN_MIDDLE_FAILURE${"b".repeat(5000)}`,
	);
	await f.session.compact();
	const matches = JSON.parse(
		recall(f.manager, { query: "hidden_middle_failure" }),
	).matches;
	assert.equal(matches[0].entryId, id);
	let actual = "";
	let offset: number | null = 0;
	while (offset !== null) {
		const page = JSON.parse(
			recall(f.manager, { entryId: id, offset, limit: 173 }),
		);
		actual += page.text;
		offset = page.nextOffset;
	}
	const original = f.manager.getEntry(id);
	assert.ok(original);
	assert.equal(actual, serializeEntry(original));
	assert.ok(actual.includes("HIDDEN_MIDDLE_FAILURE"));
	for (const request of [
		{},
		{ query: "x", entryId: id },
		{ entryId: id, limit: 16001 },
		{ entryId: id, offset: -1 },
	])
		assert.throws(() => recall(f.manager, request));
	assert.throws(
		() => recall(f.manager, { entryId: "../../auth.json" }),
		/not available/,
	);
});

test("recall rejects unrelated branches and follows explicit branch-summary references", async (t) => {
	const f = await fixture(t);
	const common = f.manager.appendMessage(user("Shared request"));
	const abandoned = addTool(f.manager, "abandoned", "ABANDONED_EVIDENCE");
	f.manager.branch(common);
	const destination = f.manager.appendMessage(user("Destination work"));
	assert.throws(
		() => recall(f.manager, { entryId: abandoned }),
		/not available/,
	);
	assert.deepEqual(
		JSON.parse(recall(f.manager, { query: "ABANDONED_EVIDENCE" })).matches,
		[],
	);
	f.manager.branch(abandoned);
	f.manager.branchWithSummary(destination, checkpoint());
	assert.ok(
		recall(f.manager, { entryId: abandoned }).includes("ABANDONED_EVIDENCE"),
	);
	assert.ok(
		recall(f.manager, { entryId: destination }).includes("Destination work"),
	);
});

test("disk resume preserves recall while branch extraction cannot follow absent sources", async (t) => {
	const f = await fixture(t);
	const sessions = join(f.directory, "sessions");
	const manager = SessionManager.create(f.directory, sessions);
	const common = manager.appendMessage(user("Shared persisted request"));
	const abandoned = addTool(manager, "source", "PERSISTED_BRANCH_EVIDENCE");
	manager.branch(common);
	const destination = manager.appendMessage(response("Destination evidence"));
	manager.branch(abandoned);
	manager.branchWithSummary(destination, "Abandoned branch checkpoint");
	const compacted = manager.appendCompaction(
		checkpoint(),
		destination,
		10000,
		{},
		true,
		usage,
	);
	const file = manager.getSessionFile();
	assert.ok(file);
	const resumed = SessionManager.open(file, sessions);
	assert.match(
		recall(resumed, { entryId: abandoned }),
		/PERSISTED_BRANCH_EVIDENCE/,
	);
	assert.deepEqual(resumed.getEntry(compacted), manager.getEntry(compacted));
	const extractedFile = resumed.createBranchedSession(compacted);
	assert.ok(extractedFile);
	const extracted = SessionManager.open(extractedFile, sessions);
	assert.equal(extracted.getEntry(abandoned), undefined);
	assert.throws(
		() => recall(extracted, { entryId: abandoned }),
		/not available/,
	);
	assert.deepEqual(
		JSON.parse(recall(extracted, { query: "PERSISTED_BRANCH_EVIDENCE" }))
			.matches,
		[],
	);
	assert.match(
		recall(extracted, { entryId: destination }),
		/Destination evidence/,
	);
});

test("hidden state, thinking, and image bytes are excluded from summaries and recall", async (t) => {
	const f = await fixture(t);
	const hidden = f.manager.appendCustomEntry("private-state", {
		secret: "SECRET_STATE",
	});
	const publicId = f.manager.appendMessage({
		...response(),
		content: [
			{
				type: "thinking",
				thinking: "PRIVATE_THINKING",
				thinkingSignature: "SIGNED_SECRET",
			},
			{ type: "text", text: "Public result" },
		],
	});
	const image = f.manager.appendMessage({
		role: "user",
		content: [
			{ type: "image", mimeType: "image/png", data: "SECRET_IMAGE_BYTES" },
		],
		timestamp: 1,
	});
	assert.throws(() => recall(f.manager, { entryId: hidden }), /no public/);
	assert.doesNotMatch(
		recall(f.manager, { entryId: publicId }),
		/PRIVATE_THINKING|SIGNED_SECRET/,
	);
	assert.doesNotMatch(
		recall(f.manager, { entryId: image }),
		/SECRET_IMAGE_BYTES/,
	);
	assert.ok(recall(f.manager, { entryId: image }).includes("Image not sent"));
});

test("recall search pagination is bounded and resumes without repeating matches", async (t) => {
	const f = await fixture(t);
	for (let i = 0; i < 12; i++) f.manager.appendMessage(user(`NEEDLE ${i}`));
	const first = JSON.parse(recall(f.manager, { query: "NEEDLE" }));
	const second = JSON.parse(
		recall(f.manager, { query: "NEEDLE", offset: first.nextOffset }),
	);
	assert.equal(first.matches.length, 8);
	assert.equal(second.matches.length, 4);
	assert.equal(second.nextOffset, null);
	assert.equal(
		new Set([...first.matches, ...second.matches].map((match) => match.entryId))
			.size,
		12,
	);
});

// @lat: [[proper-compact/tests#Skill interoperability]]
test("proper-base recovers invoked skills after native custom compaction", async (t) => {
	const f = await fixture(t);
	const loader = await moduleLoader();
	const { pinSkillContext } = await loader.import(
		fileURLToPath(
			new URL("../../proper-base/src/skill-context.ts", import.meta.url),
		),
	);
	f.manager.appendMessage(
		user(
			'<skill name="fixture" location="/tmp/SKILL.md">\nSKILL_INVARIANT: retain authorization.\n</skill>\n\nFix the bug.',
		),
	);
	f.populate();
	await f.session.compact();
	const branch = f.manager.getBranch();
	const restored = pinSkillContext(
		f.manager.buildSessionContext().messages,
		branch,
	);
	assert.equal(JSON.stringify(restored).split("SKILL_INVARIANT").length - 1, 1);
	assert.deepEqual(pinSkillContext(restored, branch), restored);
});
