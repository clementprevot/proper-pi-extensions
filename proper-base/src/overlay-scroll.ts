import {
	getKeybindings,
	isKeyRelease,
	type TUI,
	type TuiInputListener,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.overlay-scroll");
// ESC prefix is matched separately: biome bans control characters in
// regexes, and string literals carry it fine.
const SGR_MOUSE_TAIL = /^\[<(\d+);(\d+);(\d+)[Mm]$/;
/** Mirrors pi-tui's private PAGE_SCROLL_OVERLAP. */
const PAGE_OVERLAP = 4;

/** Alternate-screen renderer surface, duck-typed since most of it is private. */
type ScrollHost = TUI & {
	scrollBy(lines: number): void;
	scrollToTop(): void;
	scrollToBottom(): void;
	isOverlayFocused?(): boolean;
	getPrimaryScrollView?(): { viewportHeight: number };
	routeWheel?(event: {
		direction: number;
		x: number;
		y: number;
		button: number;
	}): void;
	wheelScrollLines?: number;
	[INSTALLED]?: () => void;
};

/** Same shape pi-tui's parseWheelEvent produces. */
export function parseWheel(data: string) {
	if (!data.startsWith("\x1b")) return undefined;
	const match = SGR_MOUSE_TAIL.exec(data.slice(1));
	if (!match) return undefined;
	const button = Number.parseInt(match[1] ?? "", 10);
	if ((button & 64) === 0) return undefined;
	const direction = button & 3;
	if (direction !== 0 && direction !== 1) return undefined;
	return {
		direction: direction === 0 ? -1 : 1,
		x: Number.parseInt(match[2] ?? "", 10) - 1,
		y: Number.parseInt(match[3] ?? "", 10) - 1,
		button,
	};
}

/**
 * Keep the fullscreen transcript scrollable while an overlay owns focus.
 *
 * Pi's viewport listener declines wheel events and every `tui.altScreen`
 * scroll key as soon as a capturing overlay is focused, so an
 * `ask_user_question` questionnaire freezes the transcript behind it. This
 * listener registers after the renderer's own, so it only ever sees input the
 * viewport (or an overlay's own mouse handler) already passed on, and routes
 * that to the same scroll methods the renderer would have used. Keys are
 * consumed so the overlay never receives a scroll chord; wheel events fall
 * through untouched when no overlay is focused because the renderer already
 * consumed them.
 *
 * Regular mode and renderer shapes without the scroll surface install
 * nothing; a renamed private field only loses the wheel step or page size,
 * not scrolling itself.
 *
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Overlay transcript scrolling]]
 */
export function installOverlayScroll(tui: TUI): (() => void) | undefined {
	const host = tui as ScrollHost;
	if (
		typeof host.scrollBy !== "function" ||
		typeof host.scrollToTop !== "function" ||
		typeof host.scrollToBottom !== "function"
	) {
		return undefined;
	}
	host[INSTALLED]?.();

	const page = () =>
		Math.max(
			1,
			(host.getPrimaryScrollView?.().viewportHeight ?? 1) - PAGE_OVERLAP,
		);
	const half = () =>
		Math.max(
			1,
			Math.floor((host.getPrimaryScrollView?.().viewportHeight ?? 1) / 2),
		);

	const listener: TuiInputListener = (data) => {
		if (host.isOverlayFocused?.() !== true) return undefined;
		const wheel = parseWheel(data);
		if (wheel) {
			if (typeof host.routeWheel === "function") host.routeWheel(wheel);
			else host.scrollBy(wheel.direction * (host.wheelScrollLines ?? 1));
			return { consume: true };
		}
		if (!data.startsWith("\x1b")) return undefined;
		const kb = getKeybindings();
		const action = kb.matches(data, "tui.altScreen.pageUp")
			? () => host.scrollBy(-page())
			: kb.matches(data, "tui.altScreen.pageDown")
				? () => host.scrollBy(page())
				: kb.matches(data, "tui.altScreen.halfPageUp")
					? () => host.scrollBy(-half())
					: kb.matches(data, "tui.altScreen.halfPageDown")
						? () => host.scrollBy(half())
						: kb.matches(data, "tui.altScreen.lineUp")
							? () => host.scrollBy(-1)
							: kb.matches(data, "tui.altScreen.lineDown")
								? () => host.scrollBy(1)
								: kb.matches(data, "tui.altScreen.top")
									? () => host.scrollToTop()
									: kb.matches(data, "tui.altScreen.bottom")
										? () => host.scrollToBottom()
										: undefined;
		if (!action) return undefined;
		if (!isKeyRelease(data)) action();
		return { consume: true };
	};
	const unsubscribe = tui.addInputListener(listener);

	const dispose = () => {
		if (host[INSTALLED] !== dispose) return;
		unsubscribe();
		delete host[INSTALLED];
	};
	host[INSTALLED] = dispose;
	return dispose;
}
