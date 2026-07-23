export const FEED_EDITOR_FORMAT = 'lexical-v1' as const;
export const FEED_EDITOR_SCHEMA_VERSION = 1 as const;

export const FEED_TEXT_COLORS = [
  '#f8fafc',
  '#a3a3a3',
  '#34d399',
  '#a3e635',
  '#2dd4bf',
  '#22d3ee',
  '#60a5fa',
  '#c084fc',
  '#f472b6',
  '#f87171',
  '#fb923c',
  '#fbbf24',
  '#fde047',
] as const;

export const FEED_FONT_SIZES = [
  '10px',
  '12px',
  '14px',
  '16px',
  '18px',
  '20px',
  '24px',
  '28px',
  '32px',
] as const;

const ALLOWED_NODE_TYPES = new Set([
  'root',
  'paragraph',
  'text',
  'linebreak',
  'heading',
  'quote',
  'list',
  'listitem',
  'link',
  'image',
]);
const ALLOWED_TEXT_FORMAT_MASK = 1 | 2 | 4 | 8;
const MAX_DOCUMENT_DEPTH = 32;
const MAX_DOCUMENT_NODES = 2_000;
const MAX_LINK_LENGTH = 2_048;
export const FEED_IMAGE_ALT_MAX_LENGTH = 240;
export const FEED_IMAGE_MIN_DISPLAY_WIDTH = 80;
export const FEED_IMAGE_MAX_DISPLAY_WIDTH = 1_200;
export const FEED_IMAGE_MAX_DISPLAY_HEIGHT = 1_200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEED_IMAGE_URL_PATTERN = /^\/api\/company-feed\/images\/([0-9a-f-]{36})$/i;
const COLOR_SET = new Set<string>(FEED_TEXT_COLORS);
const FONT_SIZE_SET = new Set<string>(FEED_FONT_SIZES);

type JsonRecord = Record<string, unknown>;

export type FeedEditorDocumentValidation =
  | { ok: true; document: JsonRecord; extractedText: string }
  | { ok: false; error: string };

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateDirection(value: unknown) {
  return value == null || value === '' || value === 'ltr' || value === 'rtl';
}

function validateInlineStyle(style: unknown) {
  if (style == null || style === '') return true;
  if (typeof style !== 'string' || style.length > 128) return false;

  const declarations = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean);

  return declarations.every((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator <= 0) return false;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim().toLowerCase();

    if (property === 'color') return COLOR_SET.has(value);
    if (property === 'font-size') return FONT_SIZE_SET.has(value);
    return false;
  });
}

export function isSafeFeedLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LINK_LENGTH) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function validateFeedImageAttributes(node: JsonRecord) {
  const uploadId = typeof node.uploadId === 'string' ? node.uploadId : '';
  const sourceMatch = typeof node.src === 'string' ? FEED_IMAGE_URL_PATTERN.exec(node.src) : null;
  const altText = typeof node.altText === 'string' ? node.altText : '';
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
  const safeWidth = Math.round(Math.min(
    FEED_IMAGE_MAX_DISPLAY_WIDTH,
    Math.max(FEED_IMAGE_MIN_DISPLAY_WIDTH, Number.isFinite(width) ? width : FEED_IMAGE_MIN_DISPLAY_WIDTH),
  ));
  const ratio = width > 0 && height > 0 ? height / width : 1;
  const safeHeight = Math.round(Math.min(
    FEED_IMAGE_MAX_DISPLAY_HEIGHT,
    Math.max(1, safeWidth * ratio),
  ));
  return { width: safeWidth, height: safeHeight };
}

function validateNode(
  node: unknown,
  depth: number,
  state: { count: number },
  allowLegacyRoot = false,
): string | null {
  if (!isRecord(node)) return 'Every editor node must be an object.';
  if (depth > MAX_DOCUMENT_DEPTH) return 'Editor document nesting is too deep.';
  state.count += 1;
  if (state.count > MAX_DOCUMENT_NODES) return 'Editor document contains too many nodes.';

  const type = allowLegacyRoot && node.type == null ? 'root' : node.type;
  if (typeof type !== 'string' || !ALLOWED_NODE_TYPES.has(type)) {
    return 'Editor document contains an unsupported node type.';
  }
  if (!validateDirection(node.direction)) return 'Editor document contains an unsupported text direction.';

  if (type === 'text') {
    if (typeof node.text !== 'string') return 'Editor text nodes must contain text.';
    if (
      node.format != null &&
      (!Number.isInteger(node.format) || ((node.format as number) & ~ALLOWED_TEXT_FORMAT_MASK) !== 0)
    ) {
      return 'Editor text contains an unsupported format.';
    }
    if (!validateInlineStyle(node.style)) return 'Editor text contains an unsupported style.';
    return null;
  }

  if (type === 'linebreak') return null;

  if (type === 'image') {
    return validateFeedImageAttributes(node) ? null : 'Editor image attributes are invalid.';
  }

  if (type === 'heading' && !['h1', 'h2', 'h3', 'h4'].includes(String(node.tag))) {
    return 'Editor heading level is not supported.';
  }

  if (type === 'list') {
    if (node.listType != null && !['bullet', 'number'].includes(String(node.listType))) {
      return 'Editor list type is not supported.';
    }
    if (node.tag != null && !['ul', 'ol'].includes(String(node.tag))) {
      return 'Editor list tag is not supported.';
    }
  }

  if (type === 'link' && !isSafeFeedLink(node.url)) {
    return 'Editor link URL is not supported.';
  }

  if (!Array.isArray(node.children)) return `Editor ${type} nodes must contain a children array.`;
  for (const child of node.children) {
    const error = validateNode(child, depth + 1, state);
    if (error) return error;
  }
  return null;
}

function extractNodeText(node: JsonRecord): string {
  const type = node.type == null && Array.isArray(node.children) ? 'root' : String(node.type || '');
  if (type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (type === 'linebreak') return '\n';
  if (type === 'image') return typeof node.altText === 'string' ? node.altText : '';
  if (!Array.isArray(node.children)) return '';

  const childText = node.children
    .filter(isRecord)
    .map(extractNodeText);
  if (type === 'root' || type === 'list') return childText.join('\n');
  return childText.join('');
}

export function collectFeedImageIds(value: unknown) {
  if (!isRecord(value) || !isRecord(value.root)) return [];
  const ids = new Set<string>();

  const visit = (node: JsonRecord) => {
    if (node.type === 'image' && typeof node.uploadId === 'string' && UUID_PATTERN.test(node.uploadId)) {
      ids.add(node.uploadId.toLowerCase());
    }
    if (Array.isArray(node.children)) node.children.filter(isRecord).forEach(visit);
  };

  visit(value.root);
  return [...ids];
}

export function normalizeFeedEditorText(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

export function validateFeedEditorDocument(
  value: unknown,
  expectedText?: string,
): FeedEditorDocumentValidation {
  if (!isRecord(value) || !isRecord(value.root)) {
    return { ok: false, error: 'contentJson must contain a Lexical root node.' };
  }

  const state = { count: 0 };
  const error = validateNode(value.root, 0, state, true);
  if (error) return { ok: false, error };

  const extractedText = extractNodeText(value.root);
  if (
    expectedText != null &&
    normalizeFeedEditorText(extractedText) !== normalizeFeedEditorText(expectedText)
  ) {
    return { ok: false, error: 'contentText does not match the editor document.' };
  }

  return { ok: true, document: value, extractedText };
}
