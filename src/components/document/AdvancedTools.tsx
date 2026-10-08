import {
  Heading2,
  Table2,
  MessageSquare,
  ListChecks,
  Minus,
  ImagePlus,
  Pencil,
  Quote,
  Code2,
  ChevronDown,
  PanelLeft,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  $parseSerializedNode,
  $getRoot,
  $getSelection,
  $setSelection,
  type BaseSelection,
  $isRangeSelection,
  $isTextNode,
  $createParagraphNode,
  $createTextNode,
  $insertNodes,
  $getNodeByKey,
  $isElementNode,
  KEY_DOWN_COMMAND,
  COMMAND_PRIORITY_HIGH,
  FORMAT_ELEMENT_COMMAND,
  type LexicalNode,
} from "lexical";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { INSERT_CHECK_LIST_COMMAND } from "@lexical/list";
import {
  $createTableNodeWithDimensions,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableRowAtSelection,
  $insertTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $deleteTableColumnAtSelection,
  TableCellHeaderStates,
  TableCellNode,
} from "@lexical/table";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createDocumentBlock,
  $isDocumentBlock,
  type BlockKind,
} from "./DocumentBlockNode";
import { $createSketchNode } from "./SketchNode";
import { BLOCK_BORDERS, CALLOUT_TONES } from "../../lib/stanza-document";
import { useLanguage } from "../../lib/LanguageContext";
function nearestBlock(
  node: LexicalNode | null,
): ReturnType<typeof $createDocumentBlock> | null {
  while (node) {
    if ($isDocumentBlock(node)) return node;
    node = node.getParent();
  }
  return null;
}
export default function AdvancedTools({ advanced }: { advanced: boolean }) {
  const [editor] = useLexicalComposerContext();
  const menuId = useId();
  const { isRtl } = useLanguage();
  const l = (e: string, a: string) => (isRtl ? a : e);
  const [query, setQuery] = useState<string | null>(null),
    [index, setIndex] = useState(0),
    [rows, setRows] = useState(3),
    [columns, setColumns] = useState(3),
    [title, setTitle] = useState(""),
    [tone, setTone] = useState("info"),
    [border, setBorder] = useState("none"),
    [shaded, setShaded] = useState(false),
    [thickness, setThickness] = useState(1);
  const [expanded, setExpanded] = useState(true);
  const [outline, setOutline] = useState<{ key: string; text: string }[]>([]);
  const [current, setCurrent] = useState("");
  const [panel, setPanel] = useState<"table" | "format" | "outline" | null>(
    null,
  );
  const [context, setContext] = useState<"table" | "block" | "text" | null>(
    null,
  );
  const [trayOpen, setTrayOpen] = useState(false);
  const [blockKind, setBlockKind] = useState<string>("");
  const icons = [
    Heading2,
    Table2,
    MessageSquare,
    ListChecks,
    Minus,
    ImagePlus,
    Pencil,
    Quote,
    Code2,
    ChevronDown,
  ];
  const englishLabels = [
    "Heading",
    "Table",
    "Callout",
    "Checklist",
    "Divider",
    "Image",
    "Sketch",
    "Quote",
    "Code",
    "Collapsible",
  ];

  const choices = [
    ["heading", "عنوان"],
    ["table", "جدول"],
    ["callout", "تنبيه"],
    ["checklist", "قائمة تحقق"],
    ["divider", "فاصل"],
    ["image", "صورة"],
    ["sketch", "رسم"],
    ["quote", "اقتباس"],
    ["code", "كود"],
    ["section", "قسم قابل للطي"],
  ];
  const filtered = choices.filter(([en, ar]) =>
    `${en} ${ar}`.toLowerCase().includes((query || "").toLowerCase()),
  );
  const selectedBlockRef = useRef("");
  const focusedBlockRef = useRef<string>("");
  useEffect(() => {
    const pointer = (event: Event) => {
      focusedBlockRef.current =
        (event.target as Element).closest<HTMLElement>(
          "[data-document-block-key]",
        )?.dataset.documentBlockKey || "";
      editor.getEditorState().read(() => {
        const n = $getNodeByKey(focusedBlockRef.current);
        if ($isDocumentBlock(n)) {
          const o = n.__options;
          setContext("block");
          setBlockKind(o.kind);
          setTitle(o.title);
          setTone(o.tone);
          setBorder(o.border);
          setShaded(o.shaded);
          setThickness(o.thickness);
          setExpanded(o.open);
        } else if ((event.target as Element).closest("td,th"))
          setContext("table");
      });
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(event.key)
      )
        focusedBlockRef.current = "";
    };
    return editor.registerRootListener((root, previous) => {
      previous?.removeEventListener("pointerup", pointer);
      previous?.removeEventListener("keydown", keyboard);
      root?.addEventListener("pointerup", pointer);
      root?.addEventListener("keydown", keyboard);
    });
  }, [editor]);
  const savedSelectionRef = useRef<BaseSelection | null>(null);
  const restoreSelection = () => {
    if (!$getSelection() && savedSelectionRef.current)
      $setSelection(savedSelectionRef.current.clone());
  };
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    root.setAttribute("aria-expanded", String(query !== null));
    if (query !== null) {
      root.setAttribute("aria-controls", menuId);
      root.setAttribute("aria-activedescendant", `${menuId}-${index}`);
    } else {
      root.removeAttribute("aria-controls");
      root.removeAttribute("aria-activedescendant");
    }
    return () => {
      root.removeAttribute("aria-expanded");
      root.removeAttribute("aria-controls");
      root.removeAttribute("aria-activedescendant");
    };
  }, [editor, query, index, menuId]);
  const menuRef = useRef({ query, index, filtered });
  menuRef.current = { query, index, filtered };
  const insert = (kind: string, removeSlash = false) => {
    if (kind === "image") {
      if (removeSlash)
        editor.update(() => {
          restoreSelection();
          const s = $getSelection();
          if ($isRangeSelection(s)) {
            s.anchor.set(s.anchor.key, 0, "text");
            s.insertText("");
          }
        });
      editor
        .getRootElement()
        ?.closest(".stanza-document-editor")
        ?.querySelector<HTMLInputElement>("input[type=file]")
        ?.click();
      setQuery(null);
      return;
    }
    editor.update(() => {
      restoreSelection();
      const s = $getSelection();
      if (!$isRangeSelection(s)) return;
      if (removeSlash) {
        s.anchor.set(s.anchor.key, 0, "text");
        s.insertText("");
      }
      if (kind === "heading" || kind === "quote") {
        $setBlocksType(s, () =>
          kind === "heading" ? $createHeadingNode("h2") : $createQuoteNode(),
        );
        return;
      }
      if (kind === "checklist") {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
        return;
      }
      let node: LexicalNode;
      if (kind === "table")
        node = $createTableNodeWithDimensions(rows, columns, {
          rows: true,
          columns: false,
        });
      else if (kind === "sketch") node = $createSketchNode();
      else {
        const b = $createDocumentBlock({
          kind: kind as BlockKind,
          title:
            kind === "callout" || kind === "section"
              ? title ||
                l(
                  kind === "section" ? "Section" : "Note",
                  kind === "section" ? "قسم" : "ملاحظة",
                )
              : "",
          tone,
          border,
          shaded,
          thickness,
        });
        if (kind !== "divider") b.append($createParagraphNode());
        node = b;
      }
      $insertNodes([node, $createParagraphNode()]);
      if ($isElementNode(node) && kind !== "divider") node.selectEnd();
    });
    setQuery(null);
    setPanel(null);
  };
  const insertRef = useRef(insert);
  insertRef.current = insert;
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const s = $getSelection();
          if ($isRangeSelection(s)) savedSelectionRef.current = s.clone();
          if ($isRangeSelection(s)) {
            const anchor = s.anchor.getNode();
            const tableCell = $getTableCellNodeFromLexicalNode(anchor);
            const focused = $getNodeByKey(focusedBlockRef.current);
            const block = $isDocumentBlock(focused)
              ? focused
              : nearestBlock(s.anchor.getNode());
            setContext(tableCell ? "table" : block ? "block" : "text");
            setBlockKind(block?.__options.kind || "");
            const key = block?.getKey() || "";
            if (key !== selectedBlockRef.current) {
              selectedBlockRef.current = key;
              if (block) {
                const o = block.__options;
                setTitle(o.title);
                setTone(o.tone);
                setBorder(o.border);
                setShaded(o.shaded);
                setThickness(o.thickness);
                setExpanded(o.open);
              }
            }
          }
          let next: string | null = null;
          if (advanced && $isRangeSelection(s) && s.isCollapsed()) {
            const n = s.anchor.getNode();
            if ($isTextNode(n)) {
              const before = n.getTextContent().slice(0, s.anchor.offset);
              const match = /^\/([\p{L}\p{N} -]{0,32})$/u.exec(before);
              if (match) next = match[1];
            }
          }
          setQuery(next);
          setIndex(0);
        });
      }),
    [editor, advanced],
  );
  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (e) => {
          const m = menuRef.current;
          if (m.query === null) return false;
          if (e.key === "Escape") {
            e.preventDefault();
            setQuery(null);
            return true;
          }
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            setIndex(
              (i) =>
                (i + (e.key === "ArrowDown" ? 1 : -1) + m.filtered.length) %
                Math.max(1, m.filtered.length),
            );
            return true;
          }
          if (e.key === "Enter" && m.filtered[m.index]) {
            e.preventDefault();
            insertRef.current(m.filtered[m.index][0], true);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );
  useEffect(() => {
    if (!advanced) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          editor.getEditorState().read(() => {
            const headings: { key: string; text: string }[] = [];
            const visit = (n: LexicalNode) => {
              if (n.getType() === "heading")
                headings.push({ key: n.getKey(), text: n.getTextContent() });
              if ($isElementNode(n)) n.getChildren().forEach(visit);
            };
            visit($getRoot());
            setOutline(headings);
          }),
        200,
      );
    };
    refresh();
    const cleanup = editor.registerUpdateListener(refresh);
    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [editor, advanced]);
  const layout = () =>
    editor.update(() => {
      restoreSelection();
      const s = $getSelection();
      const focused = $getNodeByKey(focusedBlockRef.current);
      let block = $isDocumentBlock(focused)
        ? focused
        : $isRangeSelection(s)
          ? nearestBlock(s.anchor.getNode())
          : null;
      if (!block && !$isRangeSelection(s)) return;
      const n = $isRangeSelection(s) ? s.anchor.getNode() : block!;
      if (!block) {
        const top = n.getTopLevelElementOrThrow();
        if (top.getType() === "table") return;
        block = $createDocumentBlock();
        top.insertBefore(block);
        block.append(top);
      }
      block.setOptions({
        border,
        shaded,
        thickness,
        open: expanded,
        ...(block.__options.kind === "callout" ||
        block.__options.kind === "section"
          ? { title, tone }
          : {}),
      });
    });
  const editTable = (action: string) =>
    editor.update(() => {
      restoreSelection();
      const s = $getSelection();
      if (!$isRangeSelection(s)) return;
      const cell = $getTableCellNodeFromLexicalNode(s.anchor.getNode());
      if (!cell) return;
      const table = $getTableNodeFromLexicalNodeOrThrow(cell);
      if (action === "row" && table.getChildrenSize() < 20)
        $insertTableRowAtSelection();
      if (
        action === "column" &&
        (
          table.getChildren()[0] as import("lexical").ElementNode
        ).getChildrenSize() < 8
      )
        $insertTableColumnAtSelection();
      if (action === "removeRow") $deleteTableRowAtSelection();
      if (action === "removeColumn") $deleteTableColumnAtSelection();
      if (action === "header") {
        const first = table.getChildren()[0] as import("lexical").ElementNode;
        first.getChildren().forEach((n) => {
          if (n instanceof TableCellNode)
            n.setHeaderStyles(
              n.hasHeaderState(TableCellHeaderStates.ROW)
                ? 0
                : TableCellHeaderStates.ROW,
            );
        });
      }
    });
  const blockAction = (action: "duplicate" | "delete") =>
    editor.update(() => {
      restoreSelection();
      const s = $getSelection();
      const focused = $getNodeByKey(focusedBlockRef.current);
      const n = $isDocumentBlock(focused)
        ? focused
        : $isRangeSelection(s)
          ? nearestBlock(s.anchor.getNode()) ||
            s.anchor.getNode().getTopLevelElementOrThrow()
          : null;
      if (!n) return;
      if (action === "delete") {
        n.remove();
        return;
      }
      const serialize = (
        node: LexicalNode,
      ): import("lexical").SerializedLexicalNode => ({
        ...node.exportJSON(),
        ...($isElementNode(node)
          ? { children: node.getChildren().map(serialize) }
          : {}),
      });
      n.insertAfter($parseSerializedNode(serialize(n)));
    });
  if (!advanced) return null;
  return (
    <aside
      className="stanza-document-advanced"
      aria-label={l("Advanced document tools", "أدوات المستند المتقدمة")}
      onKeyDown={(e) => {
        if (e.key === "Escape" && panel) {
          e.preventDefault();
          e.stopPropagation();
          setPanel(null);
        }
      }}
    >
      <p className="stanza-document-rail-label">{l("Insert", "إدراج")}</p>
      <button
        type="button"
        className="stanza-document-mobile-tray stanza-document-rail-button"
        aria-expanded={trayOpen}
        onClick={() => setTrayOpen(!trayOpen)}
      >
        <ChevronDown size={16} />
        {l("All blocks", "كل الكتل")}
      </button>
      <div
        className={`stanza-document-insert-grid ${trayOpen ? "" : "stanza-document-tray-compact"}`}
      >
        {choices.map(([en, ar], i) => {
          const Icon = icons[i];
          return (
            <button
              type="button"
              key={en}
              className="stanza-document-rail-button"
              title={isRtl ? ar : englishLabels[i]}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                en === "table"
                  ? setPanel(panel === "table" ? null : "table")
                  : insert(en)
              }
            >
              <Icon size={17} aria-hidden="true" />
              <span>{isRtl ? ar : englishLabels[i]}</span>
            </button>
          );
        })}
      </div>
      <p className="stanza-document-rail-label">{l("Document", "المستند")}</p>
      <button
        type="button"
        className="stanza-document-rail-button"
        aria-expanded={panel === "outline"}
        onClick={() => setPanel(panel === "outline" ? null : "outline")}
      >
        <PanelLeft size={17} aria-hidden="true" />
        {l("Outline", "المخطط")}
        {outline.length > 0 && (
          <span className="stanza-document-count" aria-hidden="true">
            {outline.length}
          </span>
        )}
      </button>
      <button
        type="button"
        className="stanza-document-rail-button"
        disabled={!context || context === "table"}
        aria-expanded={panel === "format"}
        onClick={() => setPanel(panel === "format" ? null : "format")}
      >
        <SlidersHorizontal size={17} aria-hidden="true" />
        {l("Block formatting", "تنسيق الكتلة")}
      </button>
      {context === "table" && (
        <section
          className="stanza-document-context"
          aria-label={l("Table controls", "أدوات الجدول")}
        >
          <p className="stanza-document-rail-label">
            {l("Selected table", "الجدول المحدد")}
          </p>
          {[
            ["row", "Add row", "إضافة صف"],
            ["column", "Add column", "إضافة عمود"],
            ["removeRow", "Remove row", "حذف صف"],
            ["removeColumn", "Remove column", "حذف عمود"],
            ["header", "Toggle header row", "صف العنوان"],
          ].map(([a, en, ar]) => (
            <button
              key={a}
              type="button"
              className="stanza-document-rail-button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editTable(a)}
            >
              {l(en, ar)}
            </button>
          ))}
          {["left", "center", "right"].map((a, i) => (
            <button
              key={a}
              type="button"
              className="stanza-document-control"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                editor.dispatchCommand(
                  FORMAT_ELEMENT_COMMAND,
                  a as "left" | "center" | "right",
                )
              }
            >
              {isRtl ? ["يسار", "وسط", "يمين"][i] : a}
            </button>
          ))}
        </section>
      )}
      {panel === "table" && (
        <section
          className="stanza-document-tool-panel"
          aria-label={l("Insert table", "إدراج جدول")}
        >
          <h3>{l("Insert table", "إدراج جدول")}</h3>{" "}
          <div className="stanza-document-tools">
            <label>
              {l("Rows", "صفوف")}
              <input
                aria-label={l("Table rows", "صفوف الجدول")}
                className="stanza-form-control w-20"
                type="number"
                min={1}
                max={20}
                value={rows}
                onChange={(e) =>
                  setRows(
                    Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                  )
                }
              />
            </label>
            <label>
              {l("Columns", "أعمدة")}
              <input
                aria-label={l("Table columns", "أعمدة الجدول")}
                className="stanza-form-control w-20"
                type="number"
                min={1}
                max={8}
                value={columns}
                onChange={(e) =>
                  setColumns(
                    Math.max(1, Math.min(8, Number(e.target.value) || 1)),
                  )
                }
              />
            </label>
          </div>
          <button
            type="button"
            className="stanza-document-control"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert("table")}
          >
            {l("Insert table", "إدراج جدول")}
          </button>
        </section>
      )}
      {panel === "format" && context !== "table" && context && (
        <section
          className="stanza-document-tool-panel"
          aria-label={l("Block formatting", "تنسيق الكتلة")}
        >
          <h3>{l("Block formatting", "تنسيق الكتلة")}</h3>{" "}
          <div className="stanza-document-tools">
            {(blockKind === "callout" || blockKind === "section") && (
              <label>
                {l("Block title", "عنوان الكتلة")}
                <input
                  className="stanza-form-control"
                  maxLength={240}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
            )}
            {blockKind === "callout" && (
              <label>
                {l("Callout tone", "نوع التنبيه")}
                <select
                  className="stanza-select stanza-document-control"
                  aria-label={l("Callout tone", "نوع التنبيه")}
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                >
                  {CALLOUT_TONES.map((t, i) => (
                    <option key={t} value={t}>
                      {isRtl
                        ? ["معلومات", "نجاح", "تحذير", "مهم", "محايد"][i]
                        : t}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {l("Border", "الحدود")}
              <select
                className="stanza-select stanza-document-control"
                aria-label={l("Border", "الحدود")}
                value={border}
                onChange={(e) => setBorder(e.target.value)}
              >
                {BLOCK_BORDERS.map((b, i) => (
                  <option key={b} value={b}>
                    {isRtl ? ["بدون", "أسفل", "أعلى وأسفل", "خارجي"][i] : b}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {l("Thickness", "السماكة")}
              <select
                className="stanza-select stanza-document-control"
                aria-label={l("Thickness", "السماكة")}
                value={thickness}
                onChange={(e) => setThickness(Number(e.target.value))}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={shaded}
                onChange={(e) => setShaded(e.target.checked)}
              />
              {l("Subtle shade", "تظليل خفيف")}
            </label>
            {blockKind === "section" && (
              <label>
                <input
                  type="checkbox"
                  checked={expanded}
                  onChange={(e) => setExpanded(e.target.checked)}
                />
                {l("Initially expanded section", "القسم موسع مبدئيًا")}
              </label>
            )}
            <button
              type="button"
              className="stanza-document-control"
              onMouseDown={(e) => e.preventDefault()}
              onClick={layout}
            >
              {l("Apply to selected block", "تطبيق على الكتلة المحددة")}
            </button>
            {(["left", "center", "right"] as const).map((a, i) => (
              <button
                type="button"
                className="stanza-document-control"
                key={a}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, a)
                }
              >
                {isRtl ? ["يسار", "وسط", "يمين"][i] : a}
              </button>
            ))}
            <button
              type="button"
              className="stanza-document-control"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => blockAction("duplicate")}
            >
              {l("Duplicate block", "نسخ الكتلة")}
            </button>
            <button
              type="button"
              className="stanza-document-control"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => blockAction("delete")}
            >
              {l("Delete block", "حذف الكتلة")}
            </button>
          </div>
        </section>
      )}
      {panel === "outline" && (
        <nav
          aria-label={l("Document outline", "مخطط المستند")}
          className="stanza-document-outline"
        >
          {outline.length === 0 && (
            <p className="stanza-document-helper">
              {l(
                "Add headings to navigate your document.",
                "أضف عناوين للتنقل في المستند.",
              )}
            </p>
          )}
          {outline.map((h) => (
            <button
              type="button"
              className="stanza-document-control"
              key={h.key}
              aria-current={current === h.key ? "location" : undefined}
              onClick={() => {
                editor
                  .getElementByKey(h.key)
                  ?.scrollIntoView({ block: "center", behavior: "auto" });
                editor.update(() => $getNodeByKey(h.key)?.selectStart());
                setCurrent(h.key);
              }}
            >
              {h.text || l("Untitled heading", "عنوان فارغ")}
            </button>
          ))}
        </nav>
      )}
      <p className="stanza-document-helper">
        {l(
          "Type / for blocks and advanced content",
          "اكتب / للكتل والمحتوى المتقدم",
        )}
      </p>
      {query !== null && (
        <div
          className="stanza-document-slash"
          id={menuId}
          role="listbox"
          aria-label={l("Insert block", "إدراج كتلة")}
        >
          {filtered.map(([en, ar], i) => (
            <button
              type="button"
              role="option"
              id={`${menuId}-${i}`}
              aria-selected={index === i}
              className="stanza-document-control"
              key={en}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(en, true)}
            >
              {isRtl ? ar : en}
            </button>
          ))}
          {!filtered.length && (
            <p>{l("No matching blocks", "لا توجد كتل مطابقة")}</p>
          )}
        </div>
      )}
    </aside>
  );
}
