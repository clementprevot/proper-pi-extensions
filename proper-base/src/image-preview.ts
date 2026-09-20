import { basename, extname, isAbsolute } from "node:path";
import {
	type Component,
	getCapabilities,
	getCellDimensions,
	Image,
	type ImageTheme,
	Loader,
	type OverlayHandle,
	type OverlayMargin,
	type OverlayOptions,
	setCapabilities,
	type TUI,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import sharp from "sharp";

import { isMounted, rowsBelow } from "./autocomplete-details.ts";
import { setTextKeepingPastes } from "./editor-navigation.ts";

const INSTALLED = Symbol.for("pi-proper-base.image-preview");
const ACTIVE_OVERLAY = Symbol.for("pi-proper-base.image-preview-overlay");
const FOCUS_REFRESH = Symbol.for("pi-proper-base.image-preview-focus-refresh");
const FOCUS_IN = "\x1b[I";
const CLIPBOARD_IMAGE = /^pi-clipboard-[0-9a-f-]+\.(?:gif|jpe?g|png|webp)$/i;
const CLIPBOARD_IMAGE_PATH =
	/(?:[A-Za-z]:[\\/]|\/)[^\s]*?pi-clipboard-[0-9a-f-]+\.(?:gif|jpe?g|png|webp)/gi;
const PREVIEW_WIDTH = 24;
const PREVIEW_HEIGHT = 6;
const THUMBNAIL_TIMEOUT_SECONDS = 5;

const MIME_TYPES: Record<string, string> = {
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};

type PreviewEditor = Component & {
	getText?(): string;
	setText?(text: string): void;
	getCursor?(): { line: number; col: number };
	state?: { lines?: string[]; cursorLine: number; cursorCol: number };
	historyIndex?: number;
	setCursorCol?(column: number): void;
	onChange?: (text: string) => void;
	autocompleteList?: {
		getSelectedItem(): { description?: string } | null;
	};
};

type PreviewImage = {
	base64: string;
	mimeType: string;
};

type PreviewTheme = ImageTheme & {
	loadingColor?: (value: string) => string;
};

type Thumbnailer = (
	path: string,
	widthPx: number,
	heightPx: number,
	done: (image: PreviewImage | undefined) => void,
) => () => void;

type Preview = {
	marker: string;
	path: string;
	image: PreviewImage | undefined;
	cancelThumbnail: (() => void) | undefined;
};

export type ImagePreviewController = {
	prepare(text: string): string;
	clear(): void;
	dispose(): void;
};

type InstalledEditor = PreviewEditor & {
	[INSTALLED]?: ImagePreviewController;
};
type OverlayTui = TUI & { [ACTIVE_OVERLAY]?: OverlayHandle };
type FocusRefreshController = {
	restore(): void;
};
type FocusRefreshTui = OverlayTui & {
	handleViewportInput?(data: string): unknown;
	uploadedKittyImages?: Map<unknown, unknown>;
	[FOCUS_REFRESH]?: FocusRefreshController;
};

function installFocusRefresh(tui: TUI, refresh: () => void): () => void {
	const host = tui as FocusRefreshTui;
	host[FOCUS_REFRESH]?.restore();
	const original = host.handleViewportInput;
	if (!original) return () => {};
	const controller: FocusRefreshController = {
		restore() {
			if (host[FOCUS_REFRESH] !== controller) return;
			host.handleViewportInput = original;
			delete host[FOCUS_REFRESH];
		},
	};
	host.handleViewportInput = function (data: string) {
		const result = original.call(this, data);
		if (data === FOCUS_IN) refresh();
		return result;
	};
	host[FOCUS_REFRESH] = controller;
	return () => controller.restore();
}

/**
 * Pi's terminal allowlist does not know Scribe, so detection leaves Kitty
 * images and OSC 8 hyperlinks off. Scribe supports both. Hyperlinks matter
 * because Pi reopens the OSC 8 sequence on every wrapped physical row, so
 * the terminal's ctrl+click opens the full URL instead of one row's
 * fragment of a hard-wrapped link.
 */
export function enableScribeCapabilities(): void {
	if (process.env.TERM_PROGRAM?.toLowerCase() !== "scribe") return;
	const capabilities = getCapabilities();
	if (capabilities.images !== "kitty" || !capabilities.hyperlinks) {
		setCapabilities({ ...capabilities, images: "kitty", hyperlinks: true });
	}
}

function sharpThumbnail(
	path: string,
	widthPx: number,
	heightPx: number,
	done: (image: PreviewImage | undefined) => void,
): () => void {
	let cancelled = false;
	const metadataPipeline = sharp(path, { pages: 1 }).timeout({
		seconds: THUMBNAIL_TIMEOUT_SECONDS,
	});
	let outputPipeline: ReturnType<typeof sharp> | undefined;
	void metadataPipeline
		.metadata()
		.then((metadata) => {
			if (cancelled) return undefined;
			const orientation = metadata.orientation ?? 1;
			const width = orientation >= 5 ? metadata.height : metadata.width;
			const height = orientation >= 5 ? metadata.width : metadata.height;
			outputPipeline = sharp(path, { pages: 1 }).timeout({
				seconds: THUMBNAIL_TIMEOUT_SECONDS,
			});
			if (width && height && width <= widthPx && height <= heightPx) {
				return outputPipeline
					.rotate()
					.toBuffer()
					.then((output) => ({
						base64: output.toString("base64"),
						mimeType: MIME_TYPES[extname(path).toLowerCase()] ?? "image/png",
					}));
			}
			return outputPipeline
				.rotate()
				.resize({
					width: widthPx,
					height: heightPx,
					fit: "inside",
					withoutEnlargement: true,
				})
				.png()
				.toBuffer()
				.then((output) => ({
					base64: output.toString("base64"),
					mimeType: "image/png",
				}));
		})
		.then((image) => {
			if (!cancelled && image) done(image);
		})
		.catch(() => {
			if (!cancelled) done(undefined);
		});
	return () => {
		cancelled = true;
		metadataPipeline.destroy();
		outputPipeline?.destroy();
	};
}

export function previewPixelBounds(): { widthPx: number; heightPx: number } {
	const cells = getCellDimensions();
	return {
		widthPx: Math.max(1, PREVIEW_WIDTH * cells.widthPx),
		heightPx: Math.max(1, PREVIEW_HEIGHT * cells.heightPx),
	};
}

function singleDeletionIndex(
	before: string,
	after: string,
): number | undefined {
	if (before.length !== after.length + 1) return undefined;
	let index = 0;
	while (index < after.length && before[index] === after[index]) index++;
	return before.slice(0, index) + before.slice(index + 1) === after
		? index
		: undefined;
}

export function installImagePreview(
	editor: Component,
	tui: TUI,
	theme: PreviewTheme = { fallbackColor: (value) => value },
	thumbnailer: Thumbnailer = sharpThumbnail,
): ImagePreviewController | undefined {
	const target = editor as InstalledEditor;
	const existing = target[INSTALLED];
	if (existing) return existing;
	if (!target.getText || !target.setText) return undefined;

	let counter = 0;
	let changingText = false;
	let previousText = target.getText();
	let visibleMarkers = "";
	let activePreviews: Preview[] = [];
	let activeImages: Array<Image | undefined> = [];
	let handler = target.onChange;
	const previews = new Map<string, Preview>();
	const markersByPath = new Map<string, string>();
	const render = target.render;
	const host = tui as OverlayTui;
	const margin: OverlayMargin = { bottom: 0 };
	let overlay: OverlayHandle | undefined;
	let loader: Loader | undefined;
	let removeFocusRefresh = () => {};

	const stopLoader = () => {
		loader?.stop();
		loader = undefined;
	};
	const renderLoader = (width: number) => {
		loader ??= new Loader(
			tui,
			theme.loadingColor ?? theme.fallbackColor,
			(value) => value,
			"",
		);
		return loader.render(Math.min(width, PREVIEW_WIDTH + 2));
	};
	const releaseOverlay = () => {
		const active = overlay;
		if (!active) return;
		active.hide();
		stopLoader();
		overlay = undefined;
		if (host[ACTIVE_OVERLAY] === active) delete host[ACTIVE_OVERLAY];
	};
	const hasDescription = () =>
		Boolean(target.autocompleteList?.getSelectedItem()?.description);
	const isVisible = () => activePreviews.length > 0 && !hasDescription();
	const scheduleReleaseOverlay = () => {
		const inactive = overlay;
		if (!inactive) return;
		queueMicrotask(() => {
			if (overlay === inactive && (!isVisible() || !isMounted(tui, target))) {
				releaseOverlay();
			}
		});
	};
	const component: Component = {
		render(width: number) {
			return activePreviews.flatMap((preview, index) => {
				const image = getCapabilities().images
					? activeImages[index]
					: undefined;
				if (image) return image.render(Math.min(width, PREVIEW_WIDTH + 2));
				if (preview.cancelThumbnail) return renderLoader(width);
				return wrapTextWithAnsi(`${preview.marker} ${preview.path}`, width);
			});
		},
		invalidate() {
			for (const image of activeImages) image?.invalidate();
		},
	};
	const options: OverlayOptions = {
		anchor: "bottom-left",
		margin,
		nonCapturing: true,
		width: "100%",
		visible: () => {
			const visible = isVisible() && isMounted(tui, target);
			if (!visible) scheduleReleaseOverlay();
			return visible;
		},
	};
	const ensureOverlay = () => {
		const active = host[ACTIVE_OVERLAY];
		if (overlay && active === overlay) return;
		active?.hide();
		overlay = tui.showOverlay(component, options);
		host[ACTIVE_OVERLAY] = overlay;
	};

	const sync = (text: string) => {
		const active = [...previews.values()].filter((preview) =>
			text.includes(preview.marker),
		);
		const signature = active.map((preview) => preview.marker).join("\0");
		if (signature !== visibleMarkers) {
			visibleMarkers = signature;
			activePreviews = active;
			activeImages = active.map((preview) =>
				preview.image
					? new Image(preview.image.base64, preview.image.mimeType, theme, {
							filename: preview.path,
							maxWidthCells: PREVIEW_WIDTH,
							maxHeightCells: PREVIEW_HEIGHT,
						})
					: undefined,
			);
		}
		if (!active.some((preview) => preview.cancelThumbnail)) stopLoader();
		if (isVisible() && isMounted(tui, target)) ensureOverlay();
		else releaseOverlay();
	};

	const cursorOffset = (text: string): number | undefined => {
		const cursor = target.getCursor?.();
		if (!cursor) return undefined;
		const lines = text.split("\n");
		let offset = 0;
		for (let line = 0; line < cursor.line; line++) {
			offset += (lines[line]?.length ?? 0) + 1;
		}
		return offset + cursor.col;
	};
	const restoreCursor = (text: string, offset: number | undefined) => {
		const state = target.state;
		if (offset === undefined || !state) return;
		const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
		const lines = before.split("\n");
		state.cursorLine = lines.length - 1;
		const column = lines.at(-1)?.length ?? 0;
		if (target.setCursorCol) target.setCursorCol(column);
		else state.cursorCol = column;
	};
	const replaceText = (text: string, offset: number | undefined) => {
		const state = target.state;
		if ((target.historyIndex ?? -1) >= 0 && state?.lines) {
			state.lines = text.split("\n");
			restoreCursor(text, offset);
			previousText = text;
			sync(text);
			handler?.(text);
			return;
		}
		changingText = true;
		try {
			// Not plain setText: that would wipe pi-tui's large-paste registry and
			// orphan any [paste #N] marker sharing the editor with this image.
			setTextKeepingPastes(target, text);
		} finally {
			changingText = false;
		}
		restoreCursor(text, offset);
	};
	const markerForPath = (path: string): string | undefined => {
		const known = markersByPath.get(path);
		if (known) return known;
		if (!isAbsolute(path) || !CLIPBOARD_IMAGE.test(basename(path))) return;
		if (!MIME_TYPES[extname(path).toLowerCase()]) return;
		const marker = `[image ${++counter}]`;
		const preview: Preview = {
			marker,
			path,
			image: undefined,
			cancelThumbnail: undefined,
		};
		previews.set(marker, preview);
		markersByPath.set(path, marker);
		const bounds = previewPixelBounds();
		try {
			let completed = false;
			const cancel = thumbnailer(
				path,
				bounds.widthPx,
				bounds.heightPx,
				(image) => {
					completed = true;
					preview.cancelThumbnail = undefined;
					if (!image || previews.get(marker) !== preview) return;
					preview.image = image;
					visibleMarkers = "";
					sync(target.getText?.() ?? "");
					tui.requestRender();
				},
			);
			if (!completed) preview.cancelThumbnail = cancel;
		} catch {
			previews.delete(marker);
			markersByPath.delete(path);
			return;
		}
		return marker;
	};
	const ingest = (text: string, cursor: number | undefined) => {
		let mappedCursor = cursor;
		let delta = 0;
		const ingested = text.replace(
			CLIPBOARD_IMAGE_PATH,
			(path, offset: number) => {
				const marker = markerForPath(path);
				if (!marker) return path;
				const end = offset + path.length;
				const difference = marker.length - path.length;
				if (cursor !== undefined) {
					if (cursor >= end) mappedCursor = cursor + delta + difference;
					else if (cursor > offset)
						mappedCursor = offset + delta + marker.length;
				}
				delta += difference;
				return marker;
			},
		);
		return { text: ingested, cursor: mappedCursor };
	};
	const onChange = (text: string) => {
		if (changingText) {
			previousText = text;
			sync(text);
			handler?.(text);
			return;
		}

		const deletedIndex = singleDeletionIndex(previousText, text);
		if (deletedIndex !== undefined) {
			for (const preview of previews.values()) {
				const markerStart = previousText.indexOf(preview.marker);
				if (
					markerStart < 0 ||
					deletedIndex < markerStart ||
					deletedIndex >= markerStart + preview.marker.length
				) {
					continue;
				}
				preview.cancelThumbnail?.();
				previews.delete(preview.marker);
				markersByPath.delete(preview.path);
				const cleaned =
					text.slice(0, markerStart) +
					text.slice(markerStart + preview.marker.length - 1);
				replaceText(cleaned, markerStart);
				return;
			}
		}

		const ingested = ingest(text, cursorOffset(text));
		if (ingested.text !== text) {
			replaceText(ingested.text, ingested.cursor);
			return;
		}
		previousText = text;
		sync(text);
		handler?.(text);
	};

	const controller: ImagePreviewController = {
		prepare(text) {
			stopLoader();
			let prepared = text;
			for (const preview of previews.values()) {
				prepared = prepared.replaceAll(preview.marker, preview.path);
				preview.cancelThumbnail?.();
				preview.cancelThumbnail = undefined;
			}
			visibleMarkers = "";
			activePreviews = [];
			activeImages = [];
			releaseOverlay();
			return prepared;
		},
		clear() {
			stopLoader();
			// A paste during an agent run registers a marker the user has not yet
			// submitted. Wiping it here orphans the display-only `[image N]` tag
			// still in the editor, so the next submit would hand that tag to the
			// model instead of the source path. Only previews whose marker has
			// left the editor are dropped.
			const text = target.getText?.() ?? "";
			for (const preview of previews.values()) {
				if (text.includes(preview.marker)) continue;
				preview.cancelThumbnail?.();
				preview.cancelThumbnail = undefined;
				previews.delete(preview.marker);
				markersByPath.delete(preview.path);
			}
			visibleMarkers = "";
			activePreviews = [];
			activeImages = [];
			releaseOverlay();
			if (previews.size) sync(text);
		},
		dispose() {
			if (target[INSTALLED] !== controller) return;
			removeFocusRefresh();
			for (const preview of previews.values()) preview.cancelThumbnail?.();
			previews.clear();
			markersByPath.clear();
			controller.clear();
			target.render = render;
			delete target.onChange;
			if (handler) target.onChange = handler;
			delete target[INSTALLED];
		},
	};

	try {
		Object.defineProperty(target, "onChange", {
			configurable: true,
			enumerable: true,
			get: () => onChange,
			set: (next: ((text: string) => void) | undefined) => {
				handler = next;
			},
		});
	} catch {
		return undefined;
	}
	removeFocusRefresh = installFocusRefresh(tui, () => {
		if (!isVisible() || !activeImages.some(Boolean)) return;
		const uploaded = (host as FocusRefreshTui).uploadedKittyImages;
		if (!uploaded) return;
		uploaded.clear();
		tui.requestRender(true);
	});
	target.render = (width: number) => {
		const lines = render.call(target, width);
		sync(target.getText?.() ?? "");
		// rowsBelow re-renders every component below the editor, so frames
		// without a visible preview skip the measurement entirely.
		if (isVisible()) {
			margin.bottom = lines.length + rowsBelow(tui, target, width);
		}
		return lines;
	};
	target[INSTALLED] = controller;
	onChange(target.getText());
	return controller;
}
