import type { Component, TUI } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.widget-transcript");

type ComponentContainer = Component & {
	children: Component[];
	addChild(component: Component): void;
	removeChild(component: Component): void;
};
type InstalledContainer = ComponentContainer & { [INSTALLED]?: () => void };

/**
 * Move above-editor extension widgets into the fullscreen transcript.
 *
 * Pi pins `setWidget` output in a dock between the transcript and the prompt,
 * so a widget neither scrolls with the session nor gives rows back when its
 * content shrinks; pi-subagents in particular locks a row budget on first
 * overflow and pads with blank lines afterwards. The dock container keeps
 * rendering its one-row spacer while a mirror appended to the document draws
 * the widgets, minus trailing blank rows, as the transcript's live tail.
 *
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Transcript widgets]]
 */
export function installWidgetTranscript(
	tui: TUI,
	editor: Component,
): () => void {
	let restore: (() => void) | undefined;
	let disposed = false;
	const wrap = () => {
		if (disposed) return;
		const root = (tui as TUI & { layoutRoot?: Component }).layoutRoot;
		if (!root) return;
		const document = find(root, isDocument) as ComponentContainer | undefined;
		const editorContainer = find(root, (component) =>
			childrenOf(component).includes(editor),
		);
		const dock = editorContainer
			? find(root, (component) =>
					childrenOf(component).includes(editorContainer),
				)
			: undefined;
		const siblings = dock ? childrenOf(dock) : [];
		const widgets = editorContainer
			? (siblings[siblings.indexOf(editorContainer) - 1] as
					| InstalledContainer
					| undefined)
			: undefined;
		if (!document || !widgets || componentName(widgets) !== "Container") {
			return;
		}
		// A reload runs the new factory before the outgoing instance shuts
		// down; take over any wrapper it left.
		widgets[INSTALLED]?.();

		const render = widgets.render;
		const mirror: Component = {
			render(width) {
				const lines = widgets.children
					.filter((child) => componentName(child) !== "Spacer")
					.flatMap((child) => child.render(width));
				while (
					lines.length &&
					!stripTerminalSequences(lines.at(-1) ?? "").trim()
				) {
					lines.pop();
				}
				return lines.length ? ["", ...lines] : [];
			},
			invalidate() {},
		};
		// Pi's dock always holds one spacer row here, with or without widgets.
		const gap = () => [""];
		widgets.render = gap;
		document.addChild(mirror);
		restore = () => {
			if (widgets.render === gap) widgets.render = render;
			document.removeChild(mirror);
			delete widgets[INSTALLED];
			restore = undefined;
		};
		widgets[INSTALLED] = restore;
	};
	// The editor mounts into its container right after the factory returns,
	// so the parent walk has to wait a tick.
	queueMicrotask(wrap);
	return () => {
		disposed = true;
		restore?.();
	};
}

function isDocument(component: Component): boolean {
	const children = childrenOf(component);
	return (
		children.length >= 3 &&
		children.slice(0, 3).every((child) => componentName(child) === "Container")
	);
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

function childrenOf(component: Component): Component[] {
	return (component as Partial<ComponentContainer>).children ?? [];
}

function componentName(component: Component): string | undefined {
	return (component as { constructor?: { name?: string } }).constructor?.name;
}
