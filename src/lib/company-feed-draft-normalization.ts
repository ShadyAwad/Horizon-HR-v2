import { collectFeedImageIds, FEED_EDITOR_FORMAT, validateFeedEditorDocument } from './feed-editor-contract';

export type CompanyFeedDraftContent = {
  title: string;
  contentText: string;
  contentJson: unknown | null;
};

export type CompanyFeedDraftRecord = CompanyFeedDraftContent & {
  id: string;
  contentFormat: string;
  attachmentReferences: { imageIds: string[] };
  version: number;
  createdAt: string;
  updatedAt: string;
};

export function normaliseText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normaliseAttachmentReferences(value: unknown, document: unknown) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { imageIds?: unknown }).imageIds
    : null;
  const imageIds = Array.isArray(candidate)
    ? candidate.filter((id): id is string => typeof id === 'string')
    : collectFeedImageIds(document);
  return { imageIds: [...new Set(imageIds)] };
}

export function normaliseCompanyFeedDraft(value: unknown): CompanyFeedDraftRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  const contentJson = draft.contentJson ?? draft.content_json ?? null;
  const suppliedText = normaliseText(draft.contentText ?? draft.content_text);
  const validation = validateFeedEditorDocument(contentJson, suppliedText || undefined);
  if (!validation.ok) return null;

  const id = normaliseText(draft.id);
  const version = Number(draft.version);
  const updatedAt = normaliseText(draft.updatedAt ?? draft.updated_at);
  const createdAt = normaliseText(draft.createdAt ?? draft.created_at) || updatedAt;
  if (!id || !Number.isInteger(version) || version < 1 || !Number.isFinite(new Date(updatedAt).getTime())) return null;

  return {
    id,
    title: normaliseText(draft.title).slice(0, 160),
    contentText: validation.extractedText,
    contentJson: validation.document,
    contentFormat: normaliseText(draft.contentFormat ?? draft.content_format) || FEED_EDITOR_FORMAT,
    attachmentReferences: normaliseAttachmentReferences(draft.attachmentReferences ?? draft.attachment_references, validation.document),
    version,
    createdAt,
    updatedAt,
  };
}

export function normaliseCompanyFeedDraftContent(value: CompanyFeedDraftContent | null | undefined): CompanyFeedDraftContent | null {
  const contentJson = value?.contentJson ?? null;
  const contentText = normaliseText(value?.contentText);
  const validation = validateFeedEditorDocument(contentJson, contentText || undefined);
  if (!validation.ok) return null;
  return {
    title: normaliseText(value?.title).slice(0, 160),
    contentText: validation.extractedText,
    contentJson: validation.document,
  };
}

export function hasMeaningfulContent(title: unknown, document: unknown) {
  const safeTitle = normaliseText(title).trim();
  const validation = validateFeedEditorDocument(document);
  if (!validation.ok) return false;
  return Boolean(safeTitle || validation.extractedText.trim() || collectFeedImageIds(validation.document).length);
}
