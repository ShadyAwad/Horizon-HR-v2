import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import {
  $applyNodeReplacement,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalEditable } from '@lexical/react/useLexicalEditable';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import {
  FEED_IMAGE_ALT_MAX_LENGTH,
  normalizeFeedImageDimensions,
} from '../../lib/feed-editor-contract';
import { useLanguage } from '../../lib/LanguageContext';
import { apiUrl } from '../../lib/api';
import { cn } from '../../lib/utils';

export type SerializedFeedImageNode = Spread<{
  type: 'image';
  version: 1;
  uploadId: string;
  src: string;
  altText: string;
  width: number;
  height: number;
  caption?: string;
  align?: 'start' | 'center' | 'end';
}, SerializedLexicalNode>;

type FeedImagePayload = {
  uploadId: string;
  src: string;
  altText: string;
  width: number;
  height: number;
  caption?: string;
  align?: 'start' | 'center' | 'end';
};

function FeedImageComponent({
  nodeKey,
  src,
  altText,
  width,
  height,
  caption = '', align = 'start',
}: FeedImagePayload & { nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const [selected, setSelected, clearSelected] = useLexicalNodeSelection(nodeKey);
  const [draftAlt, setDraftAlt] = useState(altText);
  const [draftCaption, setDraftCaption] = useState(caption);
  useEffect(()=>setDraftCaption(caption),[caption]);
  const dragRef = useRef<{ pointerId: number; startX: number; width: number; height: number } | null>(null);
  const { t, isRtl } = useLanguage();

  useEffect(() => setDraftAlt(altText), [altText]);

  const updateDimensions = useCallback((nextWidth: number, nextHeight: number) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isFeedImageNode(node)) node.setDimensions(nextWidth, nextHeight);
    });
  }, [editor, nodeKey]);

  const removeSelectedImage = useCallback((event: KeyboardEvent) => {
    const selection = $getSelection();
    if (!$isNodeSelection(selection) || !selection.has(nodeKey)) return false;
    event.preventDefault();
    const node = $getNodeByKey(nodeKey);
    node?.remove();
    return true;
  }, [nodeKey]);

  useEffect(() => {
    if (!editable) return;
    return editor.registerCommand(KEY_DELETE_COMMAND, removeSelectedImage, COMMAND_PRIORITY_LOW);
  }, [editable, editor, removeSelectedImage]);

  useEffect(() => {
    if (!editable) return;
    return editor.registerCommand(KEY_BACKSPACE_COMMAND, removeSelectedImage, COMMAND_PRIORITY_LOW);
  }, [editable, editor, removeSelectedImage]);

  useEffect(() => {
    const endResize = () => {
      dragRef.current = null;
      document.documentElement.classList.remove('stanza-feed-image-resizing');
    };
    const moveResize = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const direction = document.documentElement.dir === 'rtl' ? -1 : 1;
      const nextWidth = drag.width + ((event.clientX - drag.startX) * direction);
      const next = normalizeFeedImageDimensions(nextWidth, drag.height * (nextWidth / drag.width));
      updateDimensions(next.width, next.height);
    };
    window.addEventListener('pointermove', moveResize);
    window.addEventListener('pointerup', endResize);
    window.addEventListener('pointercancel', endResize);
    window.addEventListener('blur', endResize);
    return () => {
      endResize();
      window.removeEventListener('pointermove', moveResize);
      window.removeEventListener('pointerup', endResize);
      window.removeEventListener('pointercancel', endResize);
      window.removeEventListener('blur', endResize);
    };
  }, [updateDimensions]);

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, width, height };
    document.documentElement.classList.add('stanza-feed-image-resizing');
  };

  const commitAltText = () => {
    const nextAlt = draftAlt.trim().slice(0, FEED_IMAGE_ALT_MAX_LENGTH);
    setDraftAlt(nextAlt);
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isFeedImageNode(node)) node.setAltText(nextAlt);
    });
  };

  return (
    <span
      dir={isRtl ? 'rtl' : 'ltr'}
      data-align={align}
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? t('editor.selectImage') : undefined}
      onClick={(event) => {
        if (!editable) return;
        event.stopPropagation();
        clearSelected();
        setSelected(true);
      }}
      onKeyDown={(event) => {
        if (editable && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          clearSelected();
          setSelected(true);
        }
      }}
      className={cn(
        'stanza-document-image relative my-3 flex max-w-full flex-col align-top text-start outline-none',
        selected && editable && 'rounded ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-black',
      )}
    >
      <img
        src={apiUrl(src)}
        alt={altText}
        width={width}
        height={height}
        draggable={false}
        loading="lazy"
        decoding="async"
        className="h-auto max-w-full rounded border border-emerald-500/15 object-contain"
        style={{ width: `${width}px`, aspectRatio: `${width} / ${height}` }}
      />
      {caption && <span className="text-sm">{caption}</span>}
      {editable && selected && (
        <>
          <button
            type="button"
            aria-label={t('editor.resizeImage')}
            title={t('editor.resizeImage')}
            onPointerDown={startResize}
            className="absolute bottom-1 end-1 h-11 w-11 touch-none cursor-nwse-resize rounded border border-emerald-300/60 bg-black/75 text-emerald-100 shadow-lg after:absolute after:bottom-2 after:end-2 after:h-3 after:w-3 after:border-b-2 after:border-e-2 after:border-emerald-300 sm:h-8 sm:w-8"
          />
          <label>{isRtl?'محاذاة الصورة':'Image alignment'}<select aria-label={isRtl?'محاذاة الصورة':'Image alignment'} className="stanza-select stanza-document-control" value={align} onChange={e=>editor.update(()=>{const n=$getNodeByKey(nodeKey);if($isFeedImageNode(n))n.setMetadata({align:e.target.value as 'start' | 'center' | 'end'});})}>{(['start','center','end'] as const).map((v,i)=><option key={v} value={v}>{isRtl?['بداية','وسط','نهاية'][i]:v}</option>)}</select></label>
          <label>{isRtl?'شرح الصورة':'Image caption'}<input aria-label={isRtl?'شرح الصورة':'Image caption'} className="stanza-form-control w-full" value={draftCaption} maxLength={500} onChange={e=>setDraftCaption(e.target.value)} onBlur={()=>editor.update(()=>{const n=$getNodeByKey(nodeKey);if($isFeedImageNode(n))n.setMetadata({caption:draftCaption});})}/></label>
          <label>{isRtl?'عرض الصورة':'Image width'}<input aria-label={isRtl?'عرض الصورة':'Image width'} type="number" min={80} max={1200} value={width} className="stanza-form-control w-full" onChange={e=>updateDimensions(Number(e.target.value),height*Number(e.target.value)/width)}/></label>
          <label className="mt-2 text-xs font-semibold text-neutral-600 dark:text-emerald-100/70">
            {t('editor.imageAltText')}
            <input
              aria-label={t('editor.imageAltText')}
              value={draftAlt}
              maxLength={FEED_IMAGE_ALT_MAX_LENGTH}
              onChange={(event) => setDraftAlt(event.target.value)}
              onBlur={commitAltText}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitAltText();
                  event.currentTarget.blur();
                }
              }}
              className="mt-1 h-11 w-full rounded border border-emerald-500/20 bg-white px-3 text-sm text-neutral-800 outline-none focus:border-emerald-500 dark:bg-black/50 dark:text-emerald-50"
            />
          </label>
        </>
      )}
    </span>
  );
}

export class FeedImageNode extends DecoratorNode<JSX.Element> {
  __uploadId: string;
  __src: string;
  __altText: string;
  __width: number;
  __height: number;
  __caption = '';
  __align: 'start' | 'center' | 'end' = 'start';

  static getType() {
    return 'image';
  }

  static clone(node: FeedImageNode) {
    const clone = new FeedImageNode(
      node.__uploadId,
      node.__src,
      node.__altText,
      node.__width,
      node.__height,
      node.__key,
    );
    clone.__caption=node.__caption; clone.__align=node.__align; return clone;
  }

  static importJSON(serialized: SerializedFeedImageNode) {
    return $createFeedImageNode(serialized);
  }

  constructor(uploadId: string, src: string, altText: string, width: number, height: number, key?: NodeKey) {
    super(key);
    const dimensions = normalizeFeedImageDimensions(width, height);
    this.__uploadId = uploadId;
    this.__src = src;
    this.__altText = altText.slice(0, FEED_IMAGE_ALT_MAX_LENGTH);
    this.__width = dimensions.width;
    this.__height = dimensions.height;
  }

  exportJSON(): SerializedFeedImageNode {
    return {
      ...super.exportJSON(),
      type: 'image',
      version: 1,
      uploadId: this.__uploadId,
      src: this.__src,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
      caption:this.__caption, align:this.__align,
    };
  }

  createDOM(_config: EditorConfig) {
    return document.createElement('span');
  }

  updateDOM() {
    return false;
  }

  isInline() {
    return false;
  }

  getTextContent() {
    return [this.getLatest().__altText,this.getLatest().__caption].filter(Boolean).join('\n');
  }

  setMetadata(meta: {caption?:string;align?:'start'|'center'|'end'}) { const n=this.getWritable(); if(meta.caption!=null)n.__caption=meta.caption.slice(0,500);if(meta.align)n.__align=meta.align;return n; }

  setAltText(altText: string) {
    const writable = this.getWritable();
    writable.__altText = altText.slice(0, FEED_IMAGE_ALT_MAX_LENGTH);
    return writable;
  }

  setDimensions(width: number, height: number) {
    const dimensions = normalizeFeedImageDimensions(width, height);
    const writable = this.getWritable();
    writable.__width = dimensions.width;
    writable.__height = dimensions.height;
    return writable;
  }

  decorate() {
    return (
      <FeedImageComponent
        nodeKey={this.getKey()}
        uploadId={this.__uploadId}
        src={this.__src}
        altText={this.__altText}
        width={this.__width}
        height={this.__height}
        caption={this.__caption} align={this.__align}
      />
    );
  }
}

export function $createFeedImageNode(payload: FeedImagePayload) {
  const n = $applyNodeReplacement(new FeedImageNode(
    payload.uploadId,
    payload.src,
    payload.altText,
    payload.width,
    payload.height,
  ));
  return n.setMetadata({caption:payload.caption || '',align:payload.align || 'start'});
}

export function $isFeedImageNode(node: LexicalNode | null | undefined): node is FeedImageNode {
  return node instanceof FeedImageNode;
}
