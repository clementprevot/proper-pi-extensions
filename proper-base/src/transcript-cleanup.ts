import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	stripTerminalSequences,
	Text,
	type TUI,
	type TuiInputListener,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.transcript-cleanup");
const SGR_MOUSE_TAIL = /^\[<(\d+);(\d+);(\d+)([Mm])$/;
const LEFT_BUTTON = "0";

type ComponentContainer = Component & { children: Component[] };
type AssistantMessage = {
	content: Array<{ type: string; text?: string; thinking?: string }>;
	stopReason?: string;
	errorMessage?: string;
	timestamp?: number;
};
type AssistantComponent = Component & {
	lastMessage?: AssistantMessage;
	updateContent?(message: AssistantMessage, isStreaming?: boolean): void;
	contentContainer?: ComponentContainer;
};
type MouseEntry = { component: Component; height: number };
type MouseLayoutHost = {
	mouseLayout?: { width: number; children: MouseEntry[] };
};
/** Parts of an assistant message mapped to the children Pi built for them. */
type ContentChildren = { lead?: Component; parts: Map<number, Component> };
type InstalledContainer = ComponentContainer & {
	[INSTALLED]?: TranscriptCleanupController;
};
type DetailHit = {
	owner: object;
	line: string;
	end: number;
};
type State = {
	ctx: ExtensionContext;
	tui: TUI;
	activeStart: number | undefined;
	completed: Set<Component>;
	owned: Set<Component>;
	expanded: Map<object, boolean>;
	hits: Map<number, DetailHit>;
	pendingHits: DetailHit[];
	outline: OutlineEntry[];
	globalExpanded: boolean;
	assistantCache: WeakMap<AssistantComponent, AssistantRenderCache>;
};
type AssistantRenderCache = {
	message: AssistantMessage;
	width: number;
	lines: Map<string, string[]>;
};
type DetailKind = "tool" | "error";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07\x1b]133;C\x07";
/** Stands for rows proper-base draws itself, which take no mouse events. */
const INERT: Component = { render: () => [], invalidate() {} };

/** Rendered rows, plus the component behind each run of rows for mouse routing. */
class Rendered {
	readonly lines: string[] = [];
	readonly layout: MouseEntry[] = [];

	add(lines: string[], component: Component = INERT): void {
		if (!lines.length) return;
		this.lines.push(...lines);
		this.layout.push({ component, height: lines.length });
	}

	append(other: Rendered): void {
		this.lines.push(...other.lines);
		this.layout.push(...other.layout);
	}
}
/**
 * One transcript action, in scroll-content coordinates.
 *
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Session action rail]]
 */
export type OutlineEntry = {
	row: number;
	kind: "user" | "assistant" | "tool" | "error";
	/** Short action-type name: `prompt`, `reply`, or the tool's name. */
	label: string;
};
type Detail = {
	owner: object;
	kind: DetailKind;
	label: string;
	component: Component;
};
type ToolComponent = Component & {
	toolName?: string;
	args?: unknown;
	result?: { isError?: boolean };
	expanded?: boolean;
	setExpanded?(expanded: boolean): void;
};
type MouseTui = TUI & {
	inputListeners?: Set<TuiInputListener>;
	previousLines?: string[];
	previousScreen?: string[];
	getPrimaryScrollView?(): unknown;
	getScrollSelectionPoint?(
		scrollView: unknown,
		x: number,
		y: number,
	): { row: number; col: number } | undefined;
};
type TranscriptContainers = {
	document: ComponentContainer;
	chat: InstalledContainer;
};

export type TranscriptCleanupController = {
	start(): void;
	completeAssistant(message: object): void;
	completeTool(toolCallId: string): void;
	settle(): void;
	outline(): OutlineEntry[];
	update(ctx: ExtensionContext, tui: TUI): void;
	uninstall(): void;
};

export function installTranscriptCleanup(
	tui: TUI,
	ctx: ExtensionContext,
): TranscriptCleanupController | undefined {
	const containers = findTranscriptContainers(tui);
	if (!containers) return undefined;
	const { document, chat } = containers;
	if (chat[INSTALLED]) {
		chat[INSTALLED].update(ctx, tui);
		return chat[INSTALLED];
	}

	let state: State = {
		ctx,
		tui,
		activeStart: ctx.isIdle() ? undefined : chat.children.length,
		completed: new Set(),
		owned: new Set(chat.children),
		expanded: new Map(),
		hits: new Map(),
		pendingHits: [],
		outline: [],
		globalExpanded: ctx.ui.getToolsExpanded(),
		assistantCache: new WeakMap(),
	};
	const render = chat.render;
	const invalidate = chat.invalidate;
	const listener: TuiInputListener = (data) => handleClick(data, state);
	const unsubscribe = tui.addInputListener(listener);
	prioritize(tui, listener);
	const controller: TranscriptCleanupController = {
		start() {
			if (state.activeStart === undefined) {
				state = {
					...state,
					activeStart: chat.children.length,
					completed: new Set(),
				};
			}
		},
		completeAssistant(message) {
			const completed = message as AssistantMessage;
			const assistant = chat.children.find((child) => {
				if (componentName(child) !== "AssistantMessageComponent") return false;
				const current = (child as AssistantComponent).lastMessage;
				return (
					current === message ||
					(completed.timestamp !== undefined &&
						current?.timestamp === completed.timestamp)
				);
			});
			if (assistant) {
				state.completed.add(assistant);
				state.owned.add(assistant);
			}
		},
		completeTool(toolCallId) {
			const tool = chat.children.find(
				(child) =>
					componentName(child) === "ToolExecutionComponent" &&
					(child as ToolComponent & { toolCallId?: string }).toolCallId ===
						toolCallId,
			);
			if (tool) {
				state.completed.add(tool);
				state.owned.add(tool);
			}
		},
		settle() {
			const owned = new Set(state.owned);
			for (const child of chat.children.slice(
				state.activeStart ?? chat.children.length,
			)) {
				owned.add(child);
			}
			state = {
				...state,
				activeStart: undefined,
				completed: new Set(),
				owned,
			};
			state.tui.requestRender();
		},
		outline() {
			return state.outline;
		},
		update(nextCtx, nextTui) {
			state = {
				...state,
				ctx: nextCtx,
				tui: nextTui,
			};
		},
		uninstall() {
			if (chat[INSTALLED] !== controller) return;
			unsubscribe();
			chat.render = render;
			chat.invalidate = invalidate;
			delete (chat as MouseLayoutHost).mouseLayout;
			delete chat[INSTALLED];
		},
	};
	// Theme or terminal changes rebuild component content, so drop memoized
	// assistant lines along with the native caches.
	chat.invalidate = () => {
		state = { ...state, assistantCache: new WeakMap() };
		invalidate.call(chat);
	};
	chat.render = (width: number) => {
		const globalExpanded = state.ctx.ui.getToolsExpanded();
		if (globalExpanded !== state.globalExpanded) {
			state = { ...state, globalExpanded, expanded: new Map() };
		}
		state.pendingHits.length = 0;
		const sink: OutlineEntry[] = [];
		let rendered: Rendered;
		if (state.activeStart === undefined && state.ctx.isIdle()) {
			rendered = renderCollapsed(chat.children, width, state, sink);
		} else {
			const start = state.activeStart ?? chat.children.length;
			rendered = renderCollapsed(
				chat.children.slice(0, start),
				width,
				state,
				sink,
			);
			rendered.append(
				renderActive(
					chat.children.slice(start),
					width,
					state,
					sink,
					rendered.lines.length,
				),
			);
		}
		// Container.handleMouse routes clicks through the layout its own render
		// records, which this replacement render skips; record the drawn one.
		(chat as MouseLayoutHost).mouseLayout = {
			width,
			children: rendered.layout,
		};
		const lines = rendered.lines;
		const offset = documentRowOffset(document, chat, width);
		state.outline = sink
			.map((entry) => ({ ...entry, row: offset + entry.row }))
			.sort((a, b) => a.row - b.row);
		indexDetailHits(lines, offset, state);
		return lines;
	};
	chat[INSTALLED] = controller;
	return controller;
}

function renderActive(
	children: Component[],
	width: number,
	state: State,
	sink: OutlineEntry[],
	base: number,
): Rendered {
	const output: Rendered[] = Array.from({ length: children.length });
	const hits: DetailHit[][] = Array.from({ length: children.length });
	let hasTextBelow = false;
	for (let index = children.length - 1; index >= 0; index--) {
		const child = children[index];
		if (!child) continue;
		const hitStart = state.pendingHits.length;
		const native = isUserBoundary(child)
			? renderExpandable(child, width, state)
			: child.render(width);
		if (state.completed.has(child) && hasTextBelow) {
			output[index] = renderGroup([child], width, state, [], 0);
		} else {
			const rendered = new Rendered();
			rendered.add(native, child);
			output[index] = rendered;
		}
		hits[index] = state.pendingHits.splice(hitStart);
		if (hasSectionText(native)) hasTextBelow = true;
	}
	// Outline rows are recorded on a forward pass because the render loop above
	// walks backwards; the discarded renderGroup sink avoids double records.
	const rendered = new Rendered();
	for (let index = 0; index < children.length; index++) {
		const part = output[index];
		state.pendingHits.push(...(hits[index] ?? []));
		const child = children[index];
		if (child && part?.lines.length) {
			const entry = actionEntry(child);
			if (entry) sink.push({ ...entry, row: base + rendered.lines.length });
		}
		if (part) rendered.append(part);
	}
	return rendered;
}

function actionEntry(child: Component): Omit<OutlineEntry, "row"> | undefined {
	if (isUserBoundary(child)) {
		return { kind: "user", label: "prompt" };
	}
	const name = componentName(child);
	if (name === "AssistantMessageComponent") {
		return { kind: "assistant", label: "reply" };
	}
	if (name === "ToolExecutionComponent") {
		const tool = child as ToolComponent;
		return {
			kind: tool.result?.isError === true ? "error" : "tool",
			label: tool.toolName ?? "tool",
		};
	}
	return undefined;
}

function renderCollapsed(
	children: Component[],
	width: number,
	state: State,
	sink: OutlineEntry[],
): Rendered {
	const rendered = new Rendered();
	let group: Component[] = [];
	const flush = () => {
		if (!group.length) return;
		rendered.append(
			renderGroup(group, width, state, sink, rendered.lines.length),
		);
		group = [];
	};

	for (let index = 0; index < children.length; index++) {
		const child = children[index];
		if (!child) continue;
		if (
			componentName(child) === "Spacer" &&
			isUserBoundary(children[index + 1])
		) {
			flush();
			rendered.add(child.render(width), child);
			continue;
		}
		if (isUserBoundary(child)) {
			flush();
			group = [child];
		} else if (
			group.length ||
			componentName(child) === "AssistantMessageComponent"
		) {
			group.push(child);
		} else {
			rendered.add(renderExpandable(child, width, state), child);
		}
	}
	flush();
	return rendered;
}

function renderGroup(
	group: Component[],
	width: number,
	state: State,
	sink: OutlineEntry[],
	base: number,
): Rendered {
	const rendered = new Rendered();

	for (const child of group) {
		const name = componentName(child);
		if (isUserBoundary(child)) {
			sink.push({
				kind: "user",
				row: base + rendered.lines.length,
				label: "prompt",
			});
			rendered.add(renderExpandable(child, width, state), child);
			continue;
		}
		if (name === "Spacer") {
			if (!state.owned.has(child)) rendered.add(child.render(width), child);
			continue;
		}
		if (name === "AssistantMessageComponent") {
			const startRow = rendered.lines.length;
			const assistant = child as AssistantComponent;
			const message = assistant.lastMessage;
			if (!message || !assistant.updateContent) {
				rendered.add(child.render(width), child);
				if (rendered.lines.length > startRow) {
					sink.push({
						kind: "assistant",
						row: base + startRow,
						label: "reply",
					});
				}
				continue;
			}
			const hasToolCall = message.content.some(
				(part) => part.type === "toolCall",
			);
			const shown = new Set<Component>();
			message.content.forEach((part) => {
				if (part.type === "thinking" && part.thinking?.trim()) {
					rendered.append(
						renderAssistantContent(
							assistant,
							message,
							[part],
							width,
							state,
							shown,
						),
					);
				}
				if (hasToolCall && part.type === "text" && part.text?.trim()) {
					const text = renderAssistantContent(
						assistant,
						message,
						[part],
						width,
						state,
						shown,
					);
					if (text.lines.length) {
						rendered.add([""]);
						rendered.append(text);
						rendered.add([""]);
					}
				}
			});
			if (["aborted", "error", "length"].includes(message.stopReason ?? "")) {
				const error =
					message.errorMessage ??
					(message.stopReason === "length"
						? "Response was truncated before completion."
						: "Operation aborted");
				rendered.append(
					renderDetail(
						{
							owner: child,
							kind: "error",
							label: `error · ${oneLine(error)}`,
							component: new Text(state.ctx.ui.theme.fg("error", error), 1, 0),
						},
						width,
						state,
					),
				);
			}
			if (!hasToolCall) {
				const direct = message.content.filter(
					(part) => part.type === "text" && part.text?.trim(),
				);
				if (direct.length) {
					rendered.append(
						renderAssistantContent(
							assistant,
							message,
							direct,
							width,
							state,
							shown,
						),
					);
				}
			}
			// A turn whose reply was only tool calls emits nothing of its own; its
			// visible actions are the tool rows, so no assistant entry is recorded.
			if (rendered.lines.length > startRow) {
				sink.push({
					kind: "assistant",
					row: base + startRow,
					label: "reply",
				});
			}
			continue;
		}
		if (name === "ToolExecutionComponent") {
			const tool = child as ToolComponent;
			const error = tool.result?.isError === true;
			sink.push({
				kind: error ? "error" : "tool",
				row: base + rendered.lines.length,
				label: tool.toolName ?? "tool",
			});
			rendered.append(
				renderDetail(
					{
						owner: child,
						kind: error ? "error" : "tool",
						label: describeTool(tool, error),
						component: child,
					},
					width,
					state,
				),
			);
			continue;
		}
		const lines = renderExpandable(child, width, state);
		if (!state.owned.has(child) || !lines.length) {
			rendered.add(lines, child);
			continue;
		}
		rendered.add([""]);
		rendered.add(lines, child);
		rendered.add([""]);
	}
	return rendered;
}

/**
 * Extension entry renderers draw their own disclosure marker from Pi's global
 * tool-expansion state, so without a hit row the marker is decoration that only
 * `app.tools.expand` moves. Drive the same per-item state the tool summaries use
 * and register the header row, so one entry opens on click.
 */
function renderExpandable(
	child: Component,
	width: number,
	state: State,
): string[] {
	const expandable = child as ToolComponent;
	if (typeof expandable.setExpanded !== "function") return child.render(width);
	expandable.setExpanded(state.expanded.get(child) ?? state.globalExpanded);
	const lines = child.render(width);
	const header = lines.find((line) => stripTerminalSequences(line).trim());
	if (header) {
		state.pendingHits.push({
			owner: child,
			line: header,
			end: visibleWidth(stripTerminalSequences(header).trimEnd()),
		});
	}
	return lines;
}

/**
 * Draws a subset of an assistant message from the children Pi already built
 * for it, so those children stay the ones clicks reach. Children in `shown`
 * are skipped: a thinking run serves several parts.
 */
function renderAssistantContent(
	assistant: AssistantComponent,
	message: AssistantMessage,
	content: AssistantMessage["content"],
	width: number,
	state: State,
	shown: Set<Component>,
): Rendered {
	const rendered = new Rendered();
	const mapped = contentChildren(assistant, message);
	if (!mapped) {
		rendered.add(
			swappedContentLines(assistant, message, content, width, state),
		);
		return rendered;
	}
	const children = [
		...new Set(
			content.map((part) => mapped.parts.get(message.content.indexOf(part))),
		),
	].filter((child): child is Component => !!child && !shown.has(child));
	if (!children.length) return rendered;
	// Copies: Markdown returns its cached arrays, and the zone markers below
	// must not leak into them.
	const runs = [
		{ lines: [...(mapped.lead?.render(width) ?? [])], component: mapped.lead },
		...children.map((child) => {
			shown.add(child);
			return { lines: [...child.render(width)], component: child };
		}),
	].filter((run) => run.lines.length);
	const first = runs[0];
	const last = runs.at(-1);
	if (first && last) {
		first.lines[0] = OSC133_ZONE_START + first.lines[0];
		const end = last.lines.length - 1;
		last.lines[end] = OSC133_ZONE_END + last.lines[end];
	}
	for (const run of runs) rendered.add(run.lines, run.component);
	return rendered;
}

/**
 * Maps message parts to the children Pi's AssistantMessageComponent built in
 * updateContent: a leading Spacer, one Markdown per text part, one MouseRegion
 * per thinking run followed by a Spacer when visible content comes after.
 * Undefined when the children do not follow that layout.
 */
function contentChildren(
	assistant: AssistantComponent,
	message: AssistantMessage,
): ContentChildren | undefined {
	const children = assistant.contentContainer?.children;
	if (!children || assistant.lastMessage !== message) return undefined;
	const parts = message.content;
	const visible = (part: AssistantMessage["content"][number] | undefined) =>
		(part?.type === "text" && !!part.text?.trim()) ||
		(part?.type === "thinking" && !!part.thinking?.trim());
	let next = 0;
	const take = (name: string): Component | undefined => {
		const child = children[next];
		if (!child || componentName(child) !== name) return undefined;
		next++;
		return child;
	};
	const mapped: ContentChildren = { parts: new Map() };
	if (parts.some(visible)) {
		const lead = take("Spacer");
		if (!lead) return undefined;
		mapped.lead = lead;
	}
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (part?.type === "text" && visible(part)) {
			const child = take("Markdown");
			if (!child) return undefined;
			mapped.parts.set(index, child);
		} else if (part?.type === "thinking") {
			let end = index;
			while (parts[end + 1]?.type === "thinking") end++;
			const run = parts.slice(index, end + 1);
			if (run.some(visible)) {
				const child = take("MouseRegion");
				if (!child) return undefined;
				run.forEach((item, offset) => {
					if (visible(item)) mapped.parts.set(index + offset, child);
				});
				if (parts.slice(end + 1).some(visible) && !take("Spacer")) {
					return undefined;
				}
			}
			index = end;
		}
	}
	return mapped;
}

/**
 * Fallback for assistant components whose children do not follow Pi's
 * layout: render the subset through an updateContent swap. Clicks on these
 * rows reach nothing, since the swapped children are discarded.
 */
function swappedContentLines(
	assistant: AssistantComponent,
	message: AssistantMessage,
	content: AssistantMessage["content"],
	width: number,
	state: State,
): string[] {
	if (!assistant.updateContent) return assistant.render(width);
	// The updateContent swap below rebuilds the component's children and
	// discards their internal render caches, so re-running it every frame
	// re-parses the whole transcript's markdown. Memoize per content subset.
	let cache = state.assistantCache.get(assistant);
	if (!cache || cache.message !== message || cache.width !== width) {
		cache = { message, width, lines: new Map() };
		state.assistantCache.set(assistant, cache);
	}
	const key = content.map((part) => message.content.indexOf(part)).join(",");
	const cached = cache.lines.get(key);
	if (cached) return cached;
	const { errorMessage: _errorMessage, ...rest } = message;
	assistant.updateContent({ ...rest, content, stopReason: "stop" }, false);
	try {
		const lines = assistant.render(width);
		cache.lines.set(key, lines);
		return lines;
	} finally {
		assistant.updateContent(message, false);
	}
}

function hasSectionText(lines: string[]): boolean {
	return lines.some((line) => {
		const text = stripTerminalSequences(line).trim();
		return (
			text.length > 0 &&
			// Pi 0.85.0 dropped the ellipsis from its default working label.
			!/(?:^|\s)Working(?:\.\.\.|…)?(?:\s+\([^)]*\))?$/.test(text)
		);
	});
}

function renderDetail(detail: Detail, width: number, state: State): Rendered {
	const expanded = state.expanded.get(detail.owner) ?? state.globalExpanded;
	const marker = state.ctx.ui.theme.fg(
		"borderAccent",
		state.ctx.ui.theme.bold(expanded ? "⌄" : "›"),
	);
	const label = state.ctx.ui.theme.fg(detailColor(detail.kind), detail.label);
	const header = truncateToWidth(`${marker} ${label}`, width, "");
	const headerLine = `${header}${" ".repeat(Math.max(0, width - visibleWidth(header)))}`;
	state.pendingHits.push({
		owner: detail.owner,
		line: headerLine,
		end: visibleWidth(header),
	});
	const result = new Rendered();
	result.add([headerLine]);
	const expandable = detail.component as ToolComponent;
	// setExpanded rebuilds the tool's result renderer even when the state is
	// unchanged, which re-sanitizes full outputs on every frame. Skip no-ops.
	if (expandable.expanded !== expanded) expandable.setExpanded?.(expanded);
	if (expanded) {
		result.add(detail.component.render(width), detail.component);
		const button = `\x1b[7m ${state.ctx.ui.theme.fg(detailColor(detail.kind), "collapse")} \x1b[27m`;
		const rendered = truncateToWidth(button, width, "");
		const buttonLine = `${rendered}${" ".repeat(Math.max(0, width - visibleWidth(rendered)))}`;
		state.pendingHits.push({
			owner: detail.owner,
			line: buttonLine,
			end: visibleWidth(rendered),
		});
		result.add([buttonLine]);
	}
	return result;
}

function detailColor(
	kind: DetailKind,
): Parameters<ExtensionContext["ui"]["theme"]["fg"]>[0] {
	switch (kind) {
		case "tool":
			return "mdLink";
		case "error":
			return "error";
	}
}

function describeTool(tool: ToolComponent, error: boolean): string {
	return `${error ? "error" : "tool"} · ${toolLabel(tool)}`;
}

function toolLabel(tool: ToolComponent): string {
	const name = tool.toolName ?? "tool";
	const args = asRecord(tool.args);
	const value = [
		"tool",
		"path",
		"command",
		"pattern",
		"query",
		"task",
		"url",
		"action",
	]
		.map((key) => args?.[key])
		.find((candidate): candidate is string => typeof candidate === "string");
	return value ? `${name} · ${oneLine(value)}` : name;
}

function oneLine(text: string): string {
	return stripTerminalSequences(text).replace(/\s+/g, " ").trim().slice(0, 120);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function documentRowOffset(
	document: ComponentContainer,
	chat: ComponentContainer,
	width: number,
): number {
	const chatIndex = document.children.indexOf(chat);
	if (chatIndex <= 0) return 0;
	return document.children
		.slice(0, chatIndex)
		.reduce((rows, child) => rows + child.render(width).length, 0);
}

function indexDetailHits(lines: string[], offset: number, state: State): void {
	state.hits.clear();
	let nextRow = 0;
	for (const hit of state.pendingHits) {
		const relativeRow = lines.indexOf(hit.line, nextRow);
		if (relativeRow < 0) continue;
		state.hits.set(offset + relativeRow, hit);
		nextRow = relativeRow + 1;
	}
}

function handleClick(
	data: string,
	state: State,
): { consume: true } | undefined {
	if (!data.startsWith("\x1b")) return undefined;
	const match = SGR_MOUSE_TAIL.exec(data.slice(1));
	if (!match || match[1] !== LEFT_BUTTON) return undefined;
	const column = Number.parseInt(match[2] ?? "", 10) - 1;
	const row = Number.parseInt(match[3] ?? "", 10) - 1;
	const point = contentPoint(state.tui, column, row);
	if (!point) return undefined;
	const screenLine = screenLines(state.tui)[row];
	if (!screenLine) return undefined;
	const hit = findHit(state, point.row, screenLine);
	if (!hit || point.col < 0 || point.col >= hit.end) return undefined;
	if (match[4] === "M") {
		state.expanded.set(
			hit.owner,
			!(state.expanded.get(hit.owner) ?? state.globalExpanded),
		);
		state.tui.requestRender();
	}
	return { consume: true };
}

/**
 * A wheel or keyboard scroll moves `scrollTop` immediately while the repaint
 * is throttled, so the mapped content row can name a different item than the
 * frame the click landed on. Fall back to the painted screen text whenever it
 * identifies exactly one control.
 */
function findHit(
	state: State,
	contentRow: number,
	screenLine: string,
): DetailHit | undefined {
	const direct = state.hits.get(contentRow);
	if (direct && sameHitText(screenLine, direct)) return direct;
	let match: DetailHit | undefined;
	for (const hit of state.hits.values()) {
		if (!sameHitText(screenLine, hit)) continue;
		if (match) return undefined;
		match = hit;
	}
	return match;
}

function contentPoint(
	tui: TUI,
	column: number,
	row: number,
): { row: number; col: number } | undefined {
	const host = tui as MouseTui;
	const scrollView = host.getPrimaryScrollView?.();
	return scrollView !== undefined && host.getScrollSelectionPoint
		? host.getScrollSelectionPoint(scrollView, column, row)
		: { row, col: column };
}

function sameHitText(line: string, hit: DetailHit): boolean {
	return (
		truncateToWidth(stripTerminalSequences(line), hit.end, "") ===
		truncateToWidth(stripTerminalSequences(hit.line), hit.end, "")
	);
}

function screenLines(tui: TUI): string[] {
	const host = tui as MouseTui;
	return host.previousScreen ?? host.previousLines ?? [];
}

function prioritize(tui: TUI, listener: TuiInputListener): void {
	const listeners = (tui as MouseTui).inputListeners;
	if (!listeners?.has(listener)) return;
	const rest = [...listeners].filter((entry) => entry !== listener);
	listeners.clear();
	listeners.add(listener);
	for (const entry of rest) listeners.add(entry);
}

function findTranscriptContainers(tui: TUI): TranscriptContainers | undefined {
	for (const root of roots(tui)) {
		const document = find(root, (component) => {
			const children = childrenOf(component);
			return (
				children.length >= 3 &&
				children
					.slice(0, 3)
					.every((child) => componentName(child) === "Container")
			);
		});
		const chat = document ? childrenOf(document)[2] : undefined;
		if (document && chat) {
			return {
				document: document as ComponentContainer,
				chat: chat as InstalledContainer,
			};
		}
	}
	return undefined;
}

function find(
	root: Component,
	matches: (component: Component) => boolean,
): Component | undefined {
	if (matches(root)) return root;
	for (const child of childrenOf(root)) {
		const found = find(child, matches);
		if (found) return found;
	}
	return undefined;
}

function roots(tui: TUI): Component[] {
	const layoutRoot = (tui as TUI & { layoutRoot?: Component }).layoutRoot;
	return layoutRoot ? [layoutRoot] : tui.children;
}

function childrenOf(component: Component): Component[] {
	return (component as Partial<ComponentContainer>).children ?? [];
}

function componentName(component: Component): string | undefined {
	return (component as { constructor?: { name?: string } }).constructor?.name;
}

function isUserBoundary(component: Component | undefined): boolean {
	if (!component) return false;
	const name = componentName(component);
	return (
		name === "UserMessageComponent" ||
		name === "SkillInvocationMessageComponent"
	);
}
