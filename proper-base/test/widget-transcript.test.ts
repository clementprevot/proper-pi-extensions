import assert from "node:assert/strict";
import { test } from "node:test";

import { Container, Spacer } from "@earendil-works/pi-tui";
import { installWidgetTranscript } from "../src/widget-transcript.ts";

// @lat: [[lat.md/proper-base/tests#Verification#Transcript widget fixture]]

const text = (...lines: string[]) => ({ render: () => lines, invalidate() {} });

function harness() {
	const chat = new Container();
	const document = new Container();
	document.addChild(new Container());
	document.addChild(new Container());
	document.addChild(chat);
	const widgets = new Container();
	widgets.addChild(new Spacer(1));
	const editor = { render: () => ["> prompt"], invalidate() {} };
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	const dock = new Container();
	dock.addChild(new Container());
	dock.addChild(new Container());
	dock.addChild(widgets);
	dock.addChild(editorContainer);
	const layoutRoot = new Container();
	layoutRoot.addChild(document);
	layoutRoot.addChild(dock);
	return { chat, document, widgets, editor, dock, tui: { layoutRoot } };
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("widgets render in the document without their padding rows", async () => {
	const { chat, document, widgets, editor, tui } = harness();
	chat.addChild(text("assistant: done"));
	const dispose = installWidgetTranscript(tui as never, editor);
	await tick();

	assert.deepEqual(document.render(40), ["assistant: done"]);
	assert.deepEqual(widgets.render(40), [""]);

	// pi-subagents pads a locked row budget with blank lines.
	widgets.addChild(
		text("○ Async agents · 1 total", "  × worker", " ", " ", " "),
	);
	assert.deepEqual(document.render(40), [
		"assistant: done",
		"",
		"○ Async agents · 1 total",
		"  × worker",
	]);
	assert.deepEqual(widgets.render(40), [""]);

	widgets.clear();
	widgets.addChild(new Spacer(1));
	assert.deepEqual(document.render(40), ["assistant: done"]);

	dispose();
	widgets.addChild(text("late"));
	assert.deepEqual(document.render(40), ["assistant: done"]);
	assert.deepEqual(widgets.render(40), ["", "late"]);
});

test("regular mode and reinstallation leave one mirror", async () => {
	const { document, widgets, editor, tui } = harness();
	const regular = installWidgetTranscript({ children: [] } as never, editor);
	await tick();
	assert.equal(document.children.length, 3);
	regular();

	const first = installWidgetTranscript(tui as never, editor);
	await tick();
	const second = installWidgetTranscript(tui as never, editor);
	await tick();
	widgets.addChild(text("one"));
	assert.deepEqual(document.render(40), ["", "one"]);
	first();
	assert.deepEqual(document.render(40), ["", "one"]);
	second();
	assert.deepEqual(document.render(40), []);
});
