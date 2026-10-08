export const FEED_EDITOR_FORMAT = "lexical-v1" as const;
export const FEED_EDITOR_SCHEMA_VERSION = 1 as const;
export const STANZA_DOCUMENT_FORMAT = "stanza-document" as const;
export const STANZA_DOCUMENT_VERSION = 1 as const;
export const CALLOUT_TONES = [
  "info",
  "success",
  "warning",
  "important",
  "neutral",
] as const;
export const BLOCK_BORDERS = ["none", "bottom", "top-bottom", "outer"] as const;
export const SKETCH_COLORS = [
  "#111827",
  "#ffffff",
  "#10b981",
  "#2563eb",
  "#dc2626",
  "#d97706",
] as const;
export type SketchShape = {
  tool: "pen" | "line" | "arrow" | "rectangle" | "ellipse" | "text";
  points: number[][];
  color: string;
  text?: string;
};
export type SketchData = { description: string; shapes: SketchShape[] };
export function wrapStanzaDocument<T>(state: { root: T }) {
  return {
    format: STANZA_DOCUMENT_FORMAT,
    documentVersion: STANZA_DOCUMENT_VERSION,
    root: state.root,
  };
}
export function validateSketch(value: unknown): value is SketchData {
  if (
    !isRecord(value) ||
    typeof value.description !== "string" ||
    value.description.length > 500 ||
    !Array.isArray(value.shapes) ||
    value.shapes.length > 300
  )
    return false;
  return value.shapes.every(
    (shape) =>
      isRecord(shape) &&
      ["pen", "line", "arrow", "rectangle", "ellipse", "text"].includes(
        String(shape.tool),
      ) &&
      SKETCH_COLORS.includes(shape.color as (typeof SKETCH_COLORS)[number]) &&
      (shape.text == null ||
        (typeof shape.text === "string" && shape.text.length <= 240)) &&
      Array.isArray(shape.points) &&
      shape.points.length > 0 &&
      shape.points.length <= 1000 &&
      shape.points.every(
        (point: unknown) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every(
            (n) =>
              typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 800,
          ),
      ),
  );
}

export const FEED_TEXT_COLORS = [
  "#f8fafc",
  "#a3a3a3",
  "#34d399",
  "#a3e635",
  "#2dd4bf",
  "#22d3ee",
  "#60a5fa",
  "#c084fc",
  "#f472b6",
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#fde047",
] as const;

export const FEED_FONT_SIZES = [
  "10px",
  "12px",
  "14px",
  "16px",
  "18px",
  "20px",
  "24px",
  "28px",
  "32px",
] as const;

const ALLOWED_NODE_TYPES = new Set([
  "root",
  "paragraph",
  "text",
  "linebreak",
  "heading",
  "quote",
  "list",
  "listitem",
  "link",
  "image",
  "stanza-block",
  "stanza-sketch",
  "table",
  "tablerow",
  "tablecell",
]);
const ALLOWED_TEXT_FORMAT_MASK = 1 | 2 | 4 | 8;
const MAX_DOCUMENT_DEPTH = 32;
const MAX_DOCUMENT_NODES = 2_000;
const MAX_LINK_LENGTH = 2_048;
export const FEED_IMAGE_ALT_MAX_LENGTH = 240;
export const FEED_IMAGE_MIN_DISPLAY_WIDTH = 80;
export const FEED_IMAGE_MAX_DISPLAY_WIDTH = 1_200;
export const FEED_IMAGE_MAX_DISPLAY_HEIGHT = 1_200;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEED_IMAGE_URL_PATTERN =
  /^\/api\/company-feed\/images\/([0-9a-f-]{36})$/i;
const COLOR_SET = new Set<string>(FEED_TEXT_COLORS);
const FONT_SIZE_SET = new Set<string>(FEED_FONT_SIZES);

type JsonRecord = Record<string, unknown>;

export type FeedEditorDocumentValidation =
  | { ok: true; document: JsonRecord; extractedText: string }
  | { ok: false; error: string };

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateDirection(value: unknown) {
  return value == null || value === "" || value === "ltr" || value === "rtl";
}

function validateInlineStyle(style: unknown) {
  if (style == null || style === "") return true;
  if (typeof style !== "string" || style.length > 128) return false;

  const declarations = style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);

  return declarations.every((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator <= 0) return false;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration
      .slice(separator + 1)
      .trim()
      .toLowerCase();

    if (property === "color") return COLOR_SET.has(value);
    if (property === "font-size") return FONT_SIZE_SET.has(value);
    return false;
  });
}

export function isSafeFeedLink(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_LINK_LENGTH
  )
    return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      url.protocol === "http:" ||
      url.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

export function validateFeedImageAttributes(node: JsonRecord) {
  const uploadId = typeof node.uploadId === "string" ? node.uploadId : "";
  const sourceMatch =
    typeof node.src === "string" ? FEED_IMAGE_URL_PATTERN.exec(node.src) : null;
  const altText = typeof node.altText === "string" ? node.altText : "";
  const width = Number(node.width);
  const height = Number(node.height);

  return Boolean(
    UUID_PATTERN.test(uploadId) &&
    sourceMatch?.[1]?.toLowerCase() === uploadId.toLowerCase() &&
    altText.length <= FEED_IMAGE_ALT_MAX_LENGTH &&
    Number.isInteger(width) &&
    width >= FEED_IMAGE_MIN_DISPLAY_WIDTH &&
    width <= FEED_IMAGE_MAX_DISPLAY_WIDTH &&
    Number.isInteger(height) &&
    height >= 1 &&
    height <= FEED_IMAGE_MAX_DISPLAY_HEIGHT,
  );
}

export function normalizeFeedImageDimensions(width: number, height: number) {
  const safeWidth = Math.round(
    Math.min(
      FEED_IMAGE_MAX_DISPLAY_WIDTH,
      Math.max(
        FEED_IMAGE_MIN_DISPLAY_WIDTH,
        Number.isFinite(width) ? width : FEED_IMAGE_MIN_DISPLAY_WIDTH,
      ),
    ),
  );
  const ratio = width > 0 && height > 0 ? height / width : 1;
  const safeHeight = Math.round(
    Math.min(FEED_IMAGE_MAX_DISPLAY_HEIGHT, Math.max(1, safeWidth * ratio)),
  );
  return { width: safeWidth, height: safeHeight };
}

function validateNode(
  node: unknown,
  depth: number,
  state: { count: number },
  allowLegacyRoot = false,
): string | null {
  if (!isRecord(node)) return "Every editor node must be an object.";
  if (depth > MAX_DOCUMENT_DEPTH) return "Editor document nesting is too deep.";
  state.count += 1;
  if (state.count > MAX_DOCUMENT_NODES)
    return "Editor document contains too many nodes.";

  const type = allowLegacyRoot && node.type == null ? "root" : node.type;
  if (typeof type !== "string" || !ALLOWED_NODE_TYPES.has(type)) {
    return "Editor document contains an unsupported node type.";
  }
  if (!validateDirection(node.direction))
    return "Editor document contains an unsupported text direction.";
  if (node.version != null && node.version !== 1)
    return "Unsupported node version.";
  if (
    type !== "text" &&
    node.format != null &&
    !["", "left", "right", "center", "justify", "start", "end", 0].includes(
      node.format as string,
    )
  )
    return "Unsupported block alignment.";

  if (type === "text") {
    if (typeof node.text !== "string")
      return "Editor text nodes must contain text.";
    if (
      node.format != null &&
      (!Number.isInteger(node.format) ||
        ((node.format as number) & ~ALLOWED_TEXT_FORMAT_MASK) !== 0)
    ) {
      return "Editor text contains an unsupported format.";
    }
    if (!validateInlineStyle(node.style))
      return "Editor text contains an unsupported style.";
    return null;
  }

  if (type === "linebreak") return null;

  if (type === "image") {
    return validateFeedImageAttributes(node) &&
      (node.caption == null ||
        (typeof node.caption === "string" && node.caption.length <= 500)) &&
      (node.align == null ||
        ["start", "center", "end"].includes(String(node.align)))
      ? null
      : "Editor image attributes are invalid.";
  }

  if (type === "stanza-sketch")
    return validateSketch(node.drawing) ? null : "Invalid sketch data.";
  if (
    type === "stanza-block" &&
    (!["callout", "section", "box", "code", "divider"].includes(
      String(node.kind),
    ) ||
      !CALLOUT_TONES.includes(node.tone as (typeof CALLOUT_TONES)[number]) ||
      !BLOCK_BORDERS.includes(node.border as (typeof BLOCK_BORDERS)[number]) ||
      typeof node.shaded !== "boolean" ||
      ![1, 2].includes(Number(node.thickness)) ||
      typeof node.title !== "string" ||
      node.title.length > 240 ||
      typeof node.open !== "boolean")
  )
    return "Invalid rich block attributes.";
  if (
    type === "table" &&
    (!Array.isArray(node.children) ||
      node.children.length < 1 ||
      node.children.length > 20 ||
      node.children.some((row) => !isRecord(row) || row.type !== "tablerow"))
  )
    return "Tables require 1–20 rows.";
  if (
    type === "tablerow" &&
    (!Array.isArray(node.children) ||
      node.children.length < 1 ||
      node.children.length > 8 ||
      node.children.some(
        (cell) => !isRecord(cell) || cell.type !== "tablecell",
      ))
  )
    return "Tables require 1–8 columns.";
  if (
    type === "table" &&
    node.colWidths != null &&
    (!Array.isArray(node.colWidths) ||
      node.colWidths.length > 8 ||
      node.colWidths.some(
        (w) =>
          typeof w !== "number" || !Number.isFinite(w) || w < 40 || w > 1200,
      ))
  )
    return "Invalid table widths.";
  if (
    type === "tablerow" &&
    node.height != null &&
    (typeof node.height !== "number" ||
      !Number.isFinite(node.height) ||
      node.height < 1 ||
      node.height > 800)
  )
    return "Invalid row height.";
  if (
    type === "tablecell" &&
    (node.colSpan !== 1 ||
      node.rowSpan !== 1 ||
      ![0, 1, 2, 3].includes(Number(node.headerState)) ||
      node.backgroundColor != null ||
      (node.width != null &&
        (typeof node.width !== "number" ||
          !Number.isFinite(node.width) ||
          node.width < 40 ||
          node.width > 1200)))
  )
    return "Invalid table cell attributes.";
  if (
    type === "listitem" &&
    node.checked != null &&
    typeof node.checked !== "boolean"
  )
    return "Invalid checklist state.";
  if (
    type === "heading" &&
    !["h1", "h2", "h3", "h4"].includes(String(node.tag))
  ) {
    return "Editor heading level is not supported.";
  }

  if (type === "list") {
    if (
      node.listType != null &&
      !["bullet", "number", "check"].includes(String(node.listType))
    ) {
      return "Editor list type is not supported.";
    }
    if (node.tag != null && !["ul", "ol"].includes(String(node.tag))) {
      return "Editor list tag is not supported.";
    }
  }

  if (type === "link" && !isSafeFeedLink(node.url)) {
    return "Editor link URL is not supported.";
  }

  if (!Array.isArray(node.children))
    return `Editor ${type} nodes must contain a children array.`;
  for (const child of node.children) {
    const error = validateNode(child, depth + 1, state);
    if (error) return error;
  }
  return null;
}

function extractNodeText(node: JsonRecord): string {
  const type =
    node.type == null && Array.isArray(node.children)
      ? "root"
      : String(node.type || "");
  if (type === "text") return typeof node.text === "string" ? node.text : "";
  if (type === "linebreak") return "\n";
  if (type === "image")
    return [node.altText, node.caption]
      .filter((v) => typeof v === "string")
      .join("\n");
  if (type === "stanza-sketch")
    return isRecord(node.drawing) ? String(node.drawing.description) : "";
  if (!Array.isArray(node.children)) return "";

  const childText = node.children.filter(isRecord).map(extractNodeText);
  if (type === "stanza-block")
    return [node.title, ...childText].filter(Boolean).join("\n");
  if (["root", "list", "table", "tablerow", "tablecell"].includes(type))
    return childText.join("\n");
  return childText.join("");
}

export function collectFeedImageIds(value: unknown) {
  if (!isRecord(value) || !isRecord(value.root)) return [];
  const ids = new Set<string>();

  const visit = (node: JsonRecord) => {
    if (
      node.type === "image" &&
      typeof node.uploadId === "string" &&
      UUID_PATTERN.test(node.uploadId)
    ) {
      ids.add(node.uploadId.toLowerCase());
    }
    if (Array.isArray(node.children))
      node.children.filter(isRecord).forEach(visit);
  };

  visit(value.root);
  return [...ids];
}

export function normalizeFeedEditorText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

export function validateFeedEditorDocument(
  value: unknown,
  expectedText?: string,
): FeedEditorDocumentValidation {
  if (!isRecord(value) || !isRecord(value.root)) {
    return {
      ok: false,
      error: "contentJson must contain a Lexical root node.",
    };
  }

  if (
    value.format != null &&
    (value.format !== STANZA_DOCUMENT_FORMAT ||
      value.documentVersion !== STANZA_DOCUMENT_VERSION)
  )
    return { ok: false, error: "Unsupported Stanza document version." };
  if (JSON.stringify(value).length > 200_000)
    return { ok: false, error: "Document exceeds the size limit." };
  const state = { count: 0 };
  const error = validateNode(value.root, 0, state, true);
  if (error) return { ok: false, error };

  const extractedText = extractNodeText(value.root);
  if (
    expectedText != null &&
    normalizeFeedEditorText(extractedText) !==
      normalizeFeedEditorText(expectedText)
  ) {
    return {
      ok: false,
      error: "contentText does not match the editor document.",
    };
  }

  return { ok: true, document: value, extractedText };
}

export const validateStanzaDocument = validateFeedEditorDocument;
