import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeCpaTransientError } from "../src/transient-retry.ts";

const CPA_ERROR =
	"Codex error: empty_stream: upstream stream closed before first payload";

// @lat: [[lat.md/proper-base/tests#Verification#Transient retry fixture]]
test("CPA empty_stream errors are rewritten into pi's retryable form", () => {
	const errored = {
		role: "assistant",
		stopReason: "error",
		errorMessage: CPA_ERROR,
	};
	const normalized = normalizeCpaTransientError(errored);
	assert.notEqual(normalized, errored);
	assert.equal(normalized.errorMessage, `network error: ${CPA_ERROR}`);
});

test("Astra at-capacity errors are rewritten into pi's retryable form", () => {
	const errorMessage =
		"Codex error: Selected model is at capacity. Please try a different model.";
	const normalized = normalizeCpaTransientError({
		role: "assistant",
		stopReason: "error",
		errorMessage,
	});
	assert.equal(normalized.errorMessage, `network error: ${errorMessage}`);
});

test("non-matching messages pass through by reference", () => {
	const cases = [
		{ role: "user", stopReason: "error", errorMessage: CPA_ERROR },
		{ role: "assistant", stopReason: "stop" },
		{ role: "assistant", stopReason: "error", errorMessage: "HTTP 401" },
		{
			role: "assistant",
			stopReason: "error",
			errorMessage: `network error: ${CPA_ERROR}`,
		},
	];
	for (const message of cases) {
		assert.equal(normalizeCpaTransientError(message), message);
	}
});
