import {
  $applyNodeReplacement,
  ElementNode,
  type NodeKey,
  type SerializedElementNode,
  type LexicalNode,
  type DOMExportOutput,
} from "lexical";
export type BlockKind = "callout" | "section" | "box" | "code" | "divider";
export type BlockOptions = {
  kind: BlockKind;
  title: string;
  tone: string;
  border: string;
  shaded: boolean;
  thickness: number;
  open: boolean;
};
export type SerializedDocumentBlock = SerializedElementNode &
  BlockOptions & { type: "stanza-block"; version: 1 };
export const BLOCK_ICONS: Record<string, string> = {
  info: "ⓘ",
  success: "✓",
  warning: "⚠",
  important: "!",
  neutral: "•",
};
export class DocumentBlockNode extends ElementNode {
  __options: BlockOptions;
  static getType() {
    return "stanza-block";
  }
  static clone(node: DocumentBlockNode) {
    return new DocumentBlockNode({ ...node.__options }, node.__key);
  }
  constructor(options?: Partial<BlockOptions>, key?: NodeKey) {
    super(key);
    this.__options = {
      kind: options?.kind || "box",
      title: options?.title || "",
      tone: options?.tone || "neutral",
      border: options?.border || "none",
      shaded: options?.shaded ?? false,
      thickness: options?.thickness || 1,
      open: options?.open ?? true,
    };
  }
  static importJSON(data: SerializedDocumentBlock) {
    return $createDocumentBlock(data).updateFromJSON(data);
  }
  exportJSON(): SerializedDocumentBlock {
    return {
      ...super.exportJSON(),
      ...this.getLatest().__options,
      type: "stanza-block",
      version: 1,
    };
  }
  setOptions(options: Partial<BlockOptions>) {
    this.getWritable().__options = {
      ...this.getLatest().__options,
      ...options,
    };
    return this;
  }
  createDOM() {
    const o = this.__options;
    const element = document.createElement(
      o.kind === "section"
        ? "details"
        : o.kind === "code"
          ? "pre"
          : o.kind === "callout"
            ? "aside"
            : "div",
    );
    element.className = "stanza-document-block";
    element.dataset.documentBlockKey = this.getKey();
    element.dataset.kind = o.kind;
    element.dataset.tone = o.tone;
    element.dataset.border = o.border;
    element.dataset.shaded = String(o.shaded);
    element.style.setProperty("--document-border-width", `${o.thickness}px`);
    if (o.kind === "section") (element as HTMLDetailsElement).open = o.open;
    if (o.kind === "divider") {
      element.setAttribute("role", "separator");
      element.contentEditable = "false";
    }
    if (o.title || o.kind === "section") {
      const title = document.createElement(
        o.kind === "section" ? "summary" : "strong",
      );
      title.contentEditable = "false";
      title.className = "stanza-document-block-title";
      title.textContent =
        (o.kind === "callout" ? `${BLOCK_ICONS[o.tone]} ` : "") + o.title;
      element.append(title);
    }
    const body = document.createElement("div");
    body.dataset.documentBody = "true";
    element.append(body);
    return element;
  }
  getDOMSlot(element: HTMLElement) {
    return super
      .getDOMSlot(element)
      .withElement(element.querySelector<HTMLElement>("[data-document-body]")!);
  }
  updateDOM(previous: DocumentBlockNode) {
    return (
      JSON.stringify(previous.__options) !== JSON.stringify(this.__options)
    );
  }
  exportDOM(): DOMExportOutput {
    return { element: this.createDOM() };
  }
  getTextContent() {
    return [this.getLatest().__options.title, super.getTextContent()]
      .filter(Boolean)
      .join("\n");
  }
  isShadowRoot() {
    return false;
  }
}
export function $createDocumentBlock(options?: Partial<BlockOptions>) {
  return $applyNodeReplacement(new DocumentBlockNode(options));
}
export function $isDocumentBlock(
  node: LexicalNode | null | undefined,
): node is DocumentBlockNode {
  return node instanceof DocumentBlockNode;
}
