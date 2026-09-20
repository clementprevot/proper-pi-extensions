import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type EditorFactory = NonNullable<
	ReturnType<ExtensionContext["ui"]["getEditorComponent"]>
>;
type EditorKeybindings = Parameters<EditorFactory>[2];
type BindingValue = ReturnType<EditorKeybindings["getUserBindings"]>[string];

const INSTALLED = Symbol.for("pi-proper-base.fullscreen-keybindings");
const LEGACY_INSTALLED = Symbol.for("pi-proper-customs.fullscreen-keybindings");
const FULLSCREEN_KEYS = {
	"tui.altScreen.pageUp": "ctrl+shift+pageUp",
	"tui.altScreen.pageDown": "ctrl+shift+pageDown",
	"tui.altScreen.top": "ctrl+shift+home",
	"tui.altScreen.bottom": "ctrl+shift+end",
} as const;
const OWNED_ACTIONS = [
	...Object.keys(FULLSCREEN_KEYS),
	"app.clipboard.pasteImage",
	"tui.input.newLine",
	"app.message.followUp",
] as const;

type Controller = { apply(capture?: boolean): void; restore?(): void };
type PatchedKeybindings = EditorKeybindings & {
	[INSTALLED]?: true | Controller;
	[LEGACY_INSTALLED]?: true | Controller;
};

function sameBinding(a: BindingValue, b: BindingValue): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** Install proper-base bindings and return an ownership-checked restoration. */
export function installBaseKeybindings(
	keybindings: EditorKeybindings,
): () => void {
	const patched = keybindings as PatchedKeybindings;
	const previous = patched[INSTALLED] ?? patched[LEGACY_INSTALLED];
	if (previous && previous !== true) {
		if (previous.restore) previous.restore();
		else previous.apply = () => {};
	}

	const originalReload = keybindings.reload;
	let installed = true;
	let baseline: Record<string, BindingValue> = {};
	let applied: Record<string, BindingValue> = {};
	const captureBaseline = () => {
		const current = keybindings.getUserBindings();
		baseline = Object.fromEntries(
			OWNED_ACTIONS.filter((action) => action in current).map((action) => [
				action,
				current[action],
			]),
		);
	};
	const controller: Controller = {
		apply(capture = false) {
			if (!installed) return;
			if (capture) captureBaseline();
			const imagePasteKeys = [
				...new Set([
					...keybindings.getKeys("app.clipboard.pasteImage"),
					"ctrl+v" as const,
					"ctrl+shift+v" as const,
				]),
			];
			const newLineKeys = [
				...new Set([
					...keybindings.getKeys("tui.input.newLine"),
					"alt+enter" as const,
				]),
			];
			const followUpKeys = keybindings
				.getKeys("app.message.followUp")
				.filter((key) => key !== "alt+enter");
			const next: Record<string, BindingValue> = {
				...keybindings.getUserBindings(),
				...FULLSCREEN_KEYS,
				"app.clipboard.pasteImage": imagePasteKeys,
				"tui.input.newLine": newLineKeys,
				"app.message.followUp": followUpKeys,
			};
			keybindings.setUserBindings(next);
			applied = Object.fromEntries(
				OWNED_ACTIONS.map((action) => [action, next[action]]),
			);
		},
		restore() {
			installed = false;
			if (patched[INSTALLED] !== controller) return;
			if (keybindings.reload === reload) keybindings.reload = originalReload;
			const current = keybindings.getUserBindings();
			const next = { ...current };
			for (const action of OWNED_ACTIONS) {
				if (!sameBinding(current[action], applied[action])) continue;
				if (action in baseline) next[action] = baseline[action];
				else delete next[action];
			}
			keybindings.setUserBindings(next);
			delete patched[INSTALLED];
		},
	};
	function reload(): void {
		originalReload.call(keybindings);
		controller.apply(true);
	}
	keybindings.reload = reload;
	patched[INSTALLED] = controller;
	delete patched[LEGACY_INSTALLED];
	controller.apply(true);
	return () => controller.restore?.();
}
