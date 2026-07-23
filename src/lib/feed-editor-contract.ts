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
]);
const ALLOWED_TEXT_FORMAT_MASK = 1 | 2 | 4 | 8;
const MAX_DOCUMENT_DEPTH = 32;
const MAX_DOCUMENT_NODES = 2_000;
const MAX_LINK_LENGTH = 2_048;
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
  if (!Array.isArray(node.children)) return '';

  const childText = node.children
    .filter(isRecord)
    .map(extractNodeText);
  if (type === 'root' || type === 'list') return childText.join('\n');
  return childText.join('');
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
