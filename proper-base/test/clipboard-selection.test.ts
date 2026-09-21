import assert from "node:assert/strict";
import { test } from "node:test";
import {
	Box,
	Container,
	Markdown,
	type MarkdownTheme,
	ScrollView,
	stripTerminalSequences,
	type TUI,
	TuiAltScreen,
} from "@earendil-works/pi-tui";
import { installClipboardSelection } from "../src/clipboard-selection.ts";

const style = (text: string) => `\x1b[3m${text}\x1b[0m`;
const theme: MarkdownTheme = {
	heading: style,
	link: style,
	linkUrl: style,
	code: style,
	codeBlock: style,
	codeBlockBorder: style,
	quote: style,
	quoteBorder: style,
	hr: style,
	listBullet: style,
	bold: style,
	italic: style,
	underline: style,
	strikethrough: style,
};
type Point = {
	row: number;
	col: number;
	scrollView?: ScrollView;
	boundary?: boolean;
};
function fixture(markdown: string, width = 36) {
	const md = new Markdown(markdown, 1, 0, theme);
	const box = new Box(1, 0);
	box.addChild(md);
	const document = new Container();
	document.addChild(box);
	const scrollView = new ScrollView(document);
	const lines = document.render(width);
	let copied: string | undefined;
	const host = Object.assign(Object.create(TuiAltScreen.prototype), {
		currentLayout: {
			root: {
				children: [],
				rect: { width },
				scrollView,
				scrollContentLines: lines,
			},
		},
		previousScreen: lines,
		selectionAnchor: { row: 0, col: 0, scrollView } as Point,
		selectionFocus: {
			row: lines.length - 1,
			col: width,
			scrollView,
			boundary: true,
		} as Point,
		copySelection: async (text: string) => {
			copied = text;
			return true;
		},
		flash() {},
	}) as {
		selectionAnchor: Point;
		selectionFocus: Point;
		getActiveSelectionText(): string | undefined;
		copyActiveSelectionToClipboard(): Promise<boolean>;
	};
	return { host, md, lines, scrollView, copied: () => copied };
}

// @lat: [[lat.md/proper-base/tests#Verification#Clipboard selection fixture]]
test("blockquote clipboard drops borders and soft wraps via the native copy path", async () => {
	const text =
		"Approve adoption of task 1218666590589594. Preserve its description. Ask me for missing priority or requirements; don't invent them. Then reassess readiness.";
	const app = fixture(`> ${text}`);
	assert.match(app.host.getActiveSelectionText() ?? "", /│/u);
	assert.match(app.host.getActiveSelectionText() ?? "", /\n/u);
	const before = [...app.lines];
	const dispose = installClipboardSelection(app.host as unknown as TUI);
	assert.equal(await app.host.copyActiveSelectionToClipboard(), true);
	assert.equal(app.copied(), text);
	assert.deepEqual(
		app.md.render(34),
		before.map((line) => line.slice(1, -1)),
	);
	dispose?.();
	assert.match(app.host.getActiveSelectionText() ?? "", /│/u);
});

test("paragraphs retain logical breaks but remove margins and screen wrapping", () => {
	const text =
		"This is a long paragraph with words that wrap.\nThis is a real source newline.\n\nAnother paragraph.";
	const app = fixture(text, 24);
	installClipboardSelection(app.host as unknown as TUI);
	assert.equal(app.host.getActiveSelectionText(), text);
});

test("code preserves indentation, literal pipes, and real line breaks", () => {
	const code =
		'if (ready) {\n    echo "hello" | somethingVeryLongWithoutSpaces\n\n    next();\n}';
	const app = fixture(`\`\`\`sh\n${code}\n\`\`\``, 30);
	const first = app.lines.findIndex((line) =>
		stripTerminalSequences(line).includes("if (ready)"),
	);
	const last = app.lines.findIndex(
		(line) => stripTerminalSequences(line).trim() === "}",
	);
	app.host.selectionAnchor.row = first;
	app.host.selectionFocus.row = last;
	installClipboardSelection(app.host as unknown as TUI);
	assert.equal(app.host.getActiveSelectionText(), code);
});

test("nested quotes, long paths, partial selections, and wide graphemes", () => {
	const path = "/tmp/pi-clipboard-ceaa8c8c-fafd-4d6b-92f9-025c7d242777.png";
	const app = fixture(`> > ${path}\n> >\n> > 你好 👩‍💻 café`, 26);
	installClipboardSelection(app.host as unknown as TUI);
	assert.equal(app.host.getActiveSelectionText(), `${path}\n\n你好 👩‍💻 café`);
	const first = app.lines.findIndex((line) =>
		stripTerminalSequences(line).includes("/tmp"),
	);
	app.host.selectionAnchor = { row: first, col: 9, scrollView: app.scrollView };
	app.host.selectionFocus = {
		row: first,
		col: 12,
		scrollView: app.scrollView,
		boundary: true,
	};
	const expected = stripTerminalSequences(app.lines[first] ?? "").slice(9, 12);
	assert.equal(app.host.getActiveSelectionText(), expected);
});

test("unsupported content and non-transcript selections retain native behavior", () => {
	const app = fixture("- first list item\n- second list item");
	const native = app.host.getActiveSelectionText();
	installClipboardSelection(app.host as unknown as TUI);
	assert.equal(app.host.getActiveSelectionText(), native);
	delete app.host.selectionAnchor.scrollView;
	delete app.host.selectionFocus.scrollView;
	assert.equal(app.host.getActiveSelectionText(), native);
	assert.equal(installClipboardSelection({} as TUI), undefined);
});

test("reverse drags and partial wide-character selections use native cell bounds", () => {
	const app = fixture("> 你好 👩‍💻 café");
	installClipboardSelection(app.host as unknown as TUI);
	[app.host.selectionAnchor, app.host.selectionFocus] = [
		app.host.selectionFocus,
		app.host.selectionAnchor,
	];
	assert.equal(app.host.getActiveSelectionText(), "你好 👩‍💻 café");
	app.host.selectionAnchor = { row: 0, col: 5, scrollView: app.scrollView };
	app.host.selectionFocus = { row: 0, col: 7, scrollView: app.scrollView };
	assert.equal(app.host.getActiveSelectionText(), "你好");
});

test("stale display text falls back rather than copying undisplayed source", () => {
	const app = fixture("> original visible text");
	const native = app.host.getActiveSelectionText();
	app.md.setText("> changed source text");
	installClipboardSelection(app.host as unknown as TUI);
	assert.equal(app.host.getActiveSelectionText(), native);
});

test("indented Markdown code and literal pipe characters retain their content", () => {
	const app = fixture(
		"    echo foo | bar\n        echo second line with long words that wrap",
		28,
	);
	app.host.selectionAnchor.row = 1;
	app.host.selectionFocus.row = app.lines.length - 2;
	installClipboardSelection(app.host as unknown as TUI);
	assert.equal(
		app.host.getActiveSelectionText(),
		"echo foo | bar\n    echo second line with long words that wrap",
	);
});

test("reload takeover and stale disposers preserve the current wrapper", () => {
	const app = fixture("> copied words");
	const native = app.host.getActiveSelectionText;
	const first = installClipboardSelection(app.host as unknown as TUI);
	const second = installClipboardSelection(app.host as unknown as TUI);
	first?.();
	assert.equal(app.host.getActiveSelectionText(), "copied words");
	second?.();
	assert.equal(app.host.getActiveSelectionText, native);
	assert.equal(Object.hasOwn(app.host, "getActiveSelectionText"), false);
});
