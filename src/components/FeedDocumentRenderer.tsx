import { SketchPreview } from './document/SketchPreview';
import type { SketchData } from '../lib/stanza-document';
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
  if (type === 'stanza-sketch') return <figure key={key}><SketchPreview drawing={node.drawing as SketchData}/><figcaption>{(node.drawing as SketchData).description}</figcaption></figure>;
  if (type === 'stanza-block') {
    const props = { dir: nodeDirection(node), className:'stanza-document-block', 'data-kind':String(node.kind), 'data-tone':String(node.tone), 'data-border':String(node.border), 'data-shaded':String(node.shaded), style:{'--document-border-width':`${Number(node.thickness)}px`} as CSSProperties };
    const title=String(node.title||''); const children=renderChildren(node,key);
    if(node.kind==='divider') return <hr key={key} {...props}/>;
    if(node.kind==='section') return <details key={key} {...props} open={Boolean(node.open)}><summary>{title}</summary>{children}</details>;
    if(node.kind==='code') return <pre key={key} {...props}><code>{children}</code></pre>;
    if(node.kind==='callout') return <aside key={key} {...props}><strong>{({info:'ⓘ',success:'✓',warning:'⚠',important:'!',neutral:'•'} as Record<string,string>)[String(node.tone)]} {title}</strong>{children}</aside>;
    return <div key={key} {...props}>{children}</div>;
  }
  if (type === 'table') return <div key={key} className="stanza-document-table-scroll" tabIndex={0} role="region" aria-label="Table"><table dir={nodeDirection(node)}><tbody>{renderChildren(node,key)}</tbody></table></div>;
  if (type === 'tablerow') return <tr key={key}>{renderChildren(node,key)}</tr>;
  if (type === 'tablecell') {const props={dir:nodeDirection(node),style: {textAlign:node.format || 'start'} as CSSProperties,children:renderChildren(node,key)};return Number(node.headerState)?<th key={key} {...props} scope="col"/>:<td key={key} {...props}/>;}
  if (type === 'text') return formattedText(node, key);
  if (type === 'linebreak') return <br key={key} />;
  if (type === 'paragraph' && Array.isArray(node.children) && node.children.some(child=>isRecord(child)&&['image','stanza-sketch','stanza-block','table'].includes(String(child.type)))) return <div key={key} dir={nodeDirection(node)} className="mb-2">{renderChildren(node,key)}</div>;
  if (type === 'paragraph') {
    return <p key={key} dir={nodeDirection(node)} style={{textAlign: node.format || undefined} as CSSProperties} className="mb-2 last:mb-0">{renderChildren(node, key)}</p>;
  }
  if (type === 'heading') {
    const children = renderChildren(node, key);
    const props = {
      dir: nodeDirection(node),
      className: 'mb-2 break-words font-black leading-tight [overflow-wrap:anywhere]',
      children,
      style: {textAlign:node.format || undefined} as CSSProperties,
    };
    if (node.tag === 'h1') return <h1 key={key} {...props} className={`${props.className} text-3xl`} />;
    if (node.tag === 'h2') return <h2 key={key} {...props} className={`${props.className} text-2xl`} />;
    if (node.tag === 'h3') return <h3 key={key} {...props} className={`${props.className} text-xl`} />;
    return <h4 key={key} {...props} className={`${props.className} text-lg`} />;
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
    const className = node.listType === 'check' ? 'stanza-document-checklist space-y-1' : '[margin-inline-start:1.25rem] space-y-1';
    return node.listType === 'number' || node.tag === 'ol'
      ? <ol key={key} dir={nodeDirection(node)} className={`${className} list-decimal`}>{renderChildren(node, key)}</ol>
      : <ul key={key} dir={nodeDirection(node)} className={`${className} ${node.listType === 'check' ? 'list-none' : 'list-disc'}`}>{renderChildren(node, key)}</ul>;
  }
  if (type === 'listitem') {
    return <li key={key} dir={nodeDirection(node)} className="[padding-inline-start:0.25rem]">{typeof node.checked === 'boolean' && <span role="img" aria-label={node.checked ? 'Completed / مكتمل' : 'Incomplete / غير مكتمل'}>{node.checked ? '☑' : '☐'} </span>}{renderChildren(node, key)}</li>;
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
      <figure key={key} className="stanza-document-image" data-align={String(node.align || 'start')}><img
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
      />{node.caption ? <figcaption>{String(node.caption)}</figcaption> : null}</figure>
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
        'stanza-document-content stanza-feed-readable-content mt-3 max-w-full overflow-x-hidden text-sm leading-6 text-neutral-700 [unicode-bidi:plaintext] dark:text-emerald-100/70',
        isRtl ? 'text-right' : 'text-left',
      )}
    >
      {renderNode(contentJson.root, 'root')}
    </div>
  );
});

export const StanzaDocumentContent = RichFeedContent;
