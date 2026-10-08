import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "../src/lib/LanguageContext";
import { RichFeedContent } from "../src/components/FeedDocumentRenderer";
import assert from "node:assert/strict";
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $parseSerializedNode,
} from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNodeWithDimensions,
} from "@lexical/table";
import {
  DocumentBlockNode,
  $createDocumentBlock,
} from "../src/components/document/DocumentBlockNode";
import {
  SketchNode,
  $createSketchNode,
} from "../src/components/document/SketchNode";
import { FeedImageNode } from "../src/components/lexical/FeedImageNode";
import {
  validateFeedEditorDocument,
  wrapStanzaDocument,
  validateSketch,
} from "../src/lib/stanza-document";
import { createSerialSaveQueue } from "../src/lib/document-save-queue";
const nodes = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  DocumentBlockNode,
  SketchNode,
  FeedImageNode,
];
const editor = createEditor({
  namespace: "integrity",
  nodes,
  onError: (e) => {
    throw e;
  },
});
editor.update(
  () => {
    const root = $getRoot();
    for (const kind of [
      "callout",
      "section",
      "box",
      "code",
      "divider",
    ] as const) {
      const block = $createDocumentBlock({
        kind,
        title: kind === "callout" || kind === "section" ? "Arabic العربية" : "",
        tone: "warning",
        border: "outer",
        shaded: true,
        thickness: 2,
      });
      if (kind !== "divider")
        block.append($createParagraphNode().append($createTextNode("Body نص")));
      root.append(block);
    }
    root.append(
      $createTableNodeWithDimensions(3, 3, { rows: true, columns: false }),
    );
    root.append(
      $createSketchNode({
        description: "Accessible drawing وصف",
        shapes: [
          {
            tool: "arrow",
            color: "#10b981",
            points: [
              [10, 20],
              [100, 200],
            ],
          },
        ],
      }),
    );
  },
  { discrete: true },
);
const doc = wrapStanzaDocument(editor.getEditorState().toJSON());
const validation = validateFeedEditorDocument(doc);
assert(validation.ok, JSON.stringify(validation));
const reload = createEditor({
  namespace: "integrity",
  nodes,
  onError: (e) => {
    throw e;
  },
});
reload.setEditorState(reload.parseEditorState(JSON.stringify(doc)));
assert.deepEqual(wrapStanzaDocument(reload.getEditorState().toJSON()), doc);
reload.update(
  () => {
    $getRoot()
      .getFirstChild()!
      .insertAfter($parseSerializedNode(doc.root.children[0]));
  },
  { discrete: true },
);
assert.equal(reload.getEditorState().toJSON().root.children.length, 8);
assert.equal(
  validateFeedEditorDocument({ ...doc, documentVersion: 99 }).ok,
  false,
);
assert.equal(
  validateFeedEditorDocument({
    root: {
      type: "root",
      children: [{ type: "stanza-block", kind: "script", children: [] }],
    },
  }).ok,
  false,
);
assert.equal(
  validateSketch({
    description: "x",
    shapes: [{ tool: "pen", color: "url(javascript:x)", points: [[1, 2]] }],
  }),
  false,
);
assert.equal(
  validateSketch({
    description: "x",
    shapes: [{ tool: "pen", color: "#10b981", points: [[Infinity, 2]] }],
  }),
  false,
);
const unsafe = JSON.parse(JSON.stringify(doc));
unsafe.root.children[5].children[0].children[0].colSpan = 100;
assert.equal(validateFeedEditorDocument(unsafe).ok, false);
console.log(
  "PASS all rich blocks create/serialize/reload/edit/duplicate with legacy-safe versions and bounded table/sketch validation",
);
const queue = createSerialSaveQueue();
let active = 0,
  max = 0;
const versions: number[] = [];
let version = 0;
await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    queue.run(async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 2));
      versions.push(++version);
      active--;
      return i;
    }),
  ),
);
assert.equal(max, 1);
assert.deepEqual(
  versions,
  Array.from({ length: 20 }, (_, i) => i + 1),
);
await assert.rejects(
  queue.run(async () => {
    throw Error("offline");
  }),
);
assert.equal(await queue.run(async () => 42), 42);
console.log(
  "PASS saves never overlap, preserve version ordering, and recover after rejection",
);

const markup = renderToStaticMarkup(
  createElement(LanguageProvider, {
    children: createElement(RichFeedContent, {
      contentJson: doc,
      contentText: validation.ok ? validation.extractedText : "",
    }),
  }),
);
for (const semantic of [
  "<aside",
  "<details",
  "<summary",
  "<table",
  "<th",
  "<svg",
  "<pre",
  "<hr",
])
  assert(markup.includes(semantic), semantic);
assert(markup.includes("Body نص"));
assert(!markup.includes("contenteditable"));
assert(!markup.includes("dangerouslySetInnerHTML"));
const fallback = renderToStaticMarkup(
  createElement(LanguageProvider, {
    children: createElement(RichFeedContent, {
      contentJson: { ...doc, documentVersion: 99 },
      contentText: "Safe legacy fallback",
    }),
  }),
);
assert(fallback.includes("Safe legacy fallback"));
assert(!fallback.includes("<table"));
console.log(
  "PASS shared preview/publication renderer semantics and safe future-version fallback",
);

const longEditor = createEditor({
  namespace: "long",
  nodes,
  onError: (e) => {
    throw e;
  },
});
longEditor.update(
  () => {
    for (let i = 0; i < 400; i++)
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode(`Paragraph ${i}: العربية English text`),
        ),
      );
  },
  { discrete: true },
);
const long = wrapStanzaDocument(longEditor.getEditorState().toJSON());
assert(validateFeedEditorDocument(long).ok);
const times: number[] = [];
for (let i = 0; i < 30; i++) {
  const start = performance.now();
  assert(validateFeedEditorDocument(long).ok);
  renderToStaticMarkup(
    createElement(LanguageProvider, {
      children: createElement(RichFeedContent, {
        contentJson: long,
        contentText: "",
      }),
    }),
  );
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(
  "PERFORMANCE 400-paragraph validate/render p50/p95 ms",
  times[15].toFixed(2),
  times[28].toFixed(2),
  "nodes",
  801,
  "bytes",
  JSON.stringify(long).length,
);
