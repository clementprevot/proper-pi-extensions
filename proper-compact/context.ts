import { isDeepStrictEqual } from "node:util";
import type { Message } from "@earendil-works/pi-ai";
import {
	convertToLlm,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
	type SessionEntry,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";

type AgentMessage =
	SessionBeforeCompactEvent["preparation"]["messagesToSummarize"][number];
type Session = ExtensionContext["sessionManager"];

function content(message: Message): unknown {
	if (typeof message.content === "string") return message.content;
	return message.content.flatMap<unknown>((block) => {
		switch (block.type) {
			case "text":
				return [{ type: "text", text: block.text }];
			case "toolCall":
				return [
					{
						type: "toolCall",
						id: block.id,
						name: block.name,
						arguments: block.arguments,
					},
				];
			case "image":
				return [
					{
						type: "image",
						omitted: "Image not sent to the text summarizer",
						mimeType: block.mimeType,
					},
				];
			default:
				return [];
		}
	});
}

// @lat: [[proper-compact#Evidence input]]
export function serializeMessages(
	messages: AgentMessage[],
	entries: SessionEntry[],
	phase: "history" | "turn-prefix" | "branch" | "recall",
): string {
	const ids = new Map<AgentMessage, string[]>();
	const projections = new Map<
		string,
		{ message: AgentMessage; id: string }[]
	>();
	const key = (message: AgentMessage) => `${message.role}:${message.timestamp}`;
	for (const entry of entries) {
		for (const message of sessionEntryToContextMessages(entry)) {
			const known = ids.get(message) ?? [];
			known.push(entry.id);
			ids.set(message, known);
			// Pi constructs fresh objects for summaries, custom messages, and repairs.
			if (entry.type !== "message" || message !== entry.message) {
				const group = projections.get(key(message)) ?? [];
				group.push({ message, id: entry.id });
				projections.set(key(message), group);
			}
		}
	}
	return messages
		.flatMap((source) => {
			const sourceIds =
				ids.get(source) ??
				(projections.get(key(source)) ?? [])
					.filter(({ message }) => isDeepStrictEqual(message, source))
					.map(({ id }) => id);
			return convertToLlm([source])
				.filter((message) => message.role !== "system")
				.map((message) =>
					JSON.stringify({
						phase,
						...(sourceIds.length === 1
							? { entryId: sourceIds[0] }
							: { entryIds: sourceIds }),
						role: message.role,
						...(message.role === "toolResult"
							? {
									toolCallId: message.toolCallId,
									toolName: message.toolName,
									isError: message.isError,
								}
							: {}),
						content: content(message),
					}),
				);
		})
		.join("\n");
}

export function serializeEntry(entry: SessionEntry): string {
	return serializeMessages(
		sessionEntryToContextMessages(entry),
		[entry],
		"recall",
	);
}

// Current branch plus branches explicitly referenced by its branch summaries.
// No arbitrary session files, hidden custom state, or unrelated branches.
export function recallEntries(session: Session): SessionEntry[] {
	const entries = new Map<string, SessionEntry>();
	const pending = [session.getBranch()];
	for (let index = 0; index < pending.length; index++) {
		for (const entry of pending[index] ?? []) {
			if (entries.has(entry.id)) continue;
			entries.set(entry.id, entry);
			if (entry.type === "branch_summary")
				pending.push(session.getBranch(entry.fromId));
		}
	}
	return [...entries.values()];
}

export interface RecallRequest {
	entryId?: string;
	query?: string;
	offset?: number;
	limit?: number;
}

// @lat: [[proper-compact#Transcript recall]]
export function recall(session: Session, request: RecallRequest): string {
	const { entryId, query } = request;
	if (Boolean(entryId) === Boolean(query))
		throw new TypeError("Specify exactly one of entryId or query.");
	const offset = request.offset ?? 0;
	const limit = request.limit ?? 8000;
	if (
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 16000
	) {
		throw new RangeError(
			"offset must be nonnegative; limit must be between 1 and 16000.",
		);
	}
	const entries = recallEntries(session);
	if (entryId) {
		const entry = entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new ReferenceError(
				"Entry is not available in this session's current or referenced branches.",
			);
		const text = serializeEntry(entry);
		if (!text)
			throw new TypeError("Entry contains no public conversation text.");
		return JSON.stringify({
			entryId,
			offset,
			nextOffset: offset + limit < text.length ? offset + limit : null,
			totalChars: text.length,
			text: text.slice(offset, offset + limit),
		});
	}
	if (!query || query.length > 200)
		throw new RangeError("query must contain 1 to 200 characters.");
	const matches: { entryId: string; offset: number; excerpt: string }[] = [];
	let skipped = 0;
	let more = false;
	for (const entry of entries) {
		const text = serializeEntry(entry);
		const position = text.toLowerCase().indexOf(query.toLowerCase());
		if (position < 0) continue;
		if (skipped++ < offset) continue;
		if (matches.length === 8) {
			more = true;
			break;
		}
		const start = Math.max(0, position - 80);
		matches.push({
			entryId: entry.id,
			offset: start,
			excerpt: text.slice(start, start + 320),
		});
	}
	return JSON.stringify({
		matches,
		nextOffset: more ? offset + matches.length : null,
	});
}
