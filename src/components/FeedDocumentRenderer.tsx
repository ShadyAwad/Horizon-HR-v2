import { Fragment, memo, type CSSProperties, type ReactNode } from 'react';
import { validateFeedEditorDocument } from '../lib/feed-editor-contract';
import { useLanguage } from '../lib/LanguageContext';
import { apiUrl } from '../lib/api';
import { cn } from '../lib/utils';

type JsonNode = Record<string, unknown>;

const validationCache = new WeakMap<object, ReturnType<typeof validateFeedEditorDocument>>();

function isRecord(value: unknown): value is JsonNode {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validatedDocument(value: unknown) {
  if (!isRecord(value)) return validateFeedEditorDocument(value);
  const cached = validationCache.get(value);
  if (cached) return cached;
  const result = validateFeedEditorDocument(value);
  validationCache.set(value, result);
  return result;
}

function textStyle(value: unknown): CSSProperties | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const style: CSSProperties = {};
  for (const declaration of value.split(';')) {
    const [rawProperty, rawValue] = declaration.split(':', 2);
    const property = rawProperty?.trim().toLowerCase();
    const normalizedValue = rawValue?.trim().toLowerCase();
    if (property === 'color') style.color = normalizedValue;
    if (property === 'font-size') style.fontSize = normalizedValue;
  }
  return style;
}

function formattedText(node: JsonNode, key: string) {
  const text = typeof node.text === 'string' ? node.text : '';
  const format = Number(node.format) || 0;
  let content: ReactNode = text;
  if ((format & 1) !== 0) content = <strong>{content}</strong>;
  if ((format & 2) !== 0) content = <em>{content}</em>;
  if ((format & 4) !== 0) content = <s>{content}</s>;
  if ((format & 8) !== 0) content = <u>{content}</u>;
  return <span key={key} style={textStyle(node.style)}>{content}</span>;
}

function renderChildren(node: JsonNode, key: string): ReactNode[] {
  if (!Array.isArray(node.children)) return [];
  return node.children
    .filter(isRecord)
    .map((child, index) => renderNode(child, `${key}-${index}`));
}

function nodeDirection(node: JsonNode) {
  return node.direction === 'rtl' || node.direction === 'ltr' ? node.direction : undefined;
}

function renderNode(node: JsonNode, key: string): ReactNode {
  const type = String(node.type || '');
  if (type === 'text') return formattedText(node, key);
  if (type === 'linebreak') return <br key={key} />;
  if (type === 'paragraph') {
    return <p key={key} dir={nodeDirection(node)} className="mb-2 last:mb-0">{renderChildren(node, key)}</p>;
  }
  if (type === 'heading') {
    const children = renderChildren(node, key);
    const props = {
      key,
      dir: nodeDirection(node),
      className: 'mb-2 break-words font-black leading-tight [overflow-wrap:anywhere]',
      children,
    };
    if (node.tag === 'h1') return <h1 {...props} className={`${props.className} text-3xl`} />;
    if (node.tag === 'h2') return <h2 {...props} className={`${props.className} text-2xl`} />;
    if (node.tag === 'h3') return <h3 {...props} className={`${props.className} text-xl`} />;
    return <h4 {...props} className={`${props.className} text-lg`} />;
  }
  if (type === 'quote') {
    return (
      <blockquote
        key={key}
        dir={nodeDirection(node)}
        className="my-2 [border-inline-start-width:2px] [padding-inline-start:0.75rem] border-emerald-500/30 text-neutral-600 dark:text-emerald-100/70"
      >
        {renderChildren(node, key)}
      </blockquote>
    );
  }
  if (type === 'list') {
    const className = '[margin-inline-start:1.25rem] space-y-1';
    return node.listType === 'number' || node.tag === 'ol'
      ? <ol key={key} dir={nodeDirection(node)} className={`${className} list-decimal`}>{renderChildren(node, key)}</ol>
      : <ul key={key} dir={nodeDirection(node)} className={`${className} list-disc`}>{renderChildren(node, key)}</ul>;
  }
  if (type === 'listitem') {
    return <li key={key} dir={nodeDirection(node)} className="[padding-inline-start:0.25rem]">{renderChildren(node, key)}</li>;
  }
  if (type === 'link') {
    const href = String(node.url);
    const external = href.startsWith('https://') || href.startsWith('http://');
    return (
      <a
        key={key}
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className="break-words text-emerald-700 underline decoration-emerald-500/60 underline-offset-2 [overflow-wrap:anywhere] dark:text-emerald-300"
      >
        {renderChildren(node, key)}
      </a>
    );
  }
  if (type === 'image') {
    return (
      <img
        key={key}
        src={apiUrl(String(node.src))}
        alt={String(node.altText || '')}
        width={Number(node.width)}
        height={Number(node.height)}
        loading="lazy"
        decoding="async"
        className="my-3 h-auto max-w-full rounded border border-emerald-500/15 object-contain"
        style={{
          width: `${Number(node.width)}px`,
          aspectRatio: `${Number(node.width)} / ${Number(node.height)}`,
        }}
      />
    );
  }
  if (type === 'root') return <Fragment key={key}>{renderChildren(node, key)}</Fragment>;
  return null;
}

export const RichFeedContent = memo(function RichFeedContent({
  contentJson,
  contentText,
}: {
  contentJson?: unknown | null;
  contentText: string;
}) {
  const { isRtl } = useLanguage();
  const validation = validatedDocument(contentJson);

  if (validation.ok === false || !isRecord(contentJson) || !isRecord(contentJson.root)) {
    return (
      <p
        dir={isRtl ? 'rtl' : 'ltr'}
        className={cn(
          'mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-700 [overflow-wrap:anywhere] dark:text-emerald-100/70',
          isRtl ? 'text-right' : 'text-left',
        )}
      >
        {contentText}
      </p>
    );
  }

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={cn(
        'stanza-feed-readable-content mt-3 max-w-full overflow-x-hidden text-sm leading-6 text-neutral-700 [unicode-bidi:plaintext] dark:text-emerald-100/70',
        isRtl ? 'text-right' : 'text-left',
      )}
    >
      {renderNode(contentJson.root, 'root')}
    </div>
  );
});
