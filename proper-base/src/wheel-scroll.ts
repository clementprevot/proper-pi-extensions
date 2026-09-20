/**
 * Pi's fullscreen renderer scrolls its transcript exactly one line per
 * mouse-wheel report. Proper-base raises that to the terminal convention.
 */

const DEFAULT_WHEEL_SCROLL_LINES = 3;
const INSTALLED = Symbol.for("pi-proper-base.wheel-scroll-lines");

type WheelController = { restore(): void };
type WheelHost = {
	wheelScrollLines?: unknown;
	[INSTALLED]?: WheelController;
};

/** Lines per wheel event: a positive integer override, else three. */
export function resolveWheelScrollLines(
	env: Record<string, string | undefined> = process.env,
): number {
	const parsed = Number.parseInt(env.PROPER_WHEEL_SCROLL_LINES ?? "", 10);
	return parsed >= 1 ? parsed : DEFAULT_WHEEL_SCROLL_LINES;
}

/** Patch a fullscreen renderer and return an ownership-checked restoration. */
export function installWheelScrollLines(
	tui: unknown,
	lines: number = resolveWheelScrollLines(),
): (() => void) | undefined {
	const host = tui as WheelHost;
	host[INSTALLED]?.restore();
	if (typeof host.wheelScrollLines !== "number") return undefined;
	const original = host.wheelScrollLines;
	const applied = Math.floor(lines);
	const controller: WheelController = {
		restore() {
			if (host[INSTALLED] !== controller) return;
			if (host.wheelScrollLines === applied) host.wheelScrollLines = original;
			delete host[INSTALLED];
		},
	};
	host.wheelScrollLines = applied;
	host[INSTALLED] = controller;
	return () => controller.restore();
}
