import type { SessionManager } from "@earendil-works/pi-coding-agent";

export const PROMPT_DISPLAY_ENTRY = "proper-prompt-display";
type Message = Parameters<SessionManager["appendMessage"]>[0];
type Entry = ReturnType<SessionManager["getBranch"]>[number];
export type PromptDisplayRecord = { messageEntryId: string; raw: string };

/** Display metadata belongs to a message, never to its text or submission order. */
export function createPromptDisplay() {
	let display = new WeakMap<Message, string>();
	const pending: PromptDisplayRecord[] = [];
	return {
		bind(message: Message, raw: string) {
			display.set(message, raw);
		},
		rawFor(message: Message): string | undefined {
			return display.get(message);
		},
		persist(message: Message, messageEntryId: string) {
			const raw = display.get(message);
			if (raw !== undefined) pending.push({ messageEntryId, raw });
		},
		drain(): PromptDisplayRecord[] {
			return pending.splice(0);
		},
		restore(entries: Entry[]) {
			display = new WeakMap();
			pending.length = 0;
			const messages = new Map(
				entries.flatMap((entry) =>
					entry.type === "message" && entry.message.role === "user"
						? [[entry.id, entry.message] as const]
						: [],
				),
			);
			for (const entry of entries) {
				if (
					entry.type !== "custom" ||
					entry.customType !== PROMPT_DISPLAY_ENTRY
				)
					continue;
				const data = entry.data as { prompts?: unknown } | undefined;
				if (!data || !Array.isArray(data.prompts)) continue;
				for (const record of data.prompts) {
					if (
						!record ||
						typeof record !== "object" ||
						typeof record.messageEntryId !== "string" ||
						typeof record.raw !== "string"
					)
						continue;
					const message = messages.get(record.messageEntryId);
					if (message) display.set(message, record.raw);
				}
			}
		},
		clear() {
			display = new WeakMap();
			pending.length = 0;
		},
	};
}
export type PromptDisplayController = ReturnType<typeof createPromptDisplay>;
