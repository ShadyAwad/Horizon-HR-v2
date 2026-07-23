import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { $createParagraphNode, $getRoot, $getSelection, $insertNodes, $isRangeSelection, COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_LOW, DROP_COMMAND, FORMAT_TEXT_COMMAND, PASTE_COMMAND, REDO_COMMAND, SELECTION_CHANGE_COMMAND, UNDO_COMMAND, type EditorState } from 'lexical';
import { $isLinkNode, $toggleLink, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from '@lexical/list';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { $getSelectionStyleValueForProperty, $patchStyleText, $setBlocksType } from '@lexical/selection';
import { $getNearestNodeOfType, mergeRegister } from '@lexical/utils';
import { Bold, ImagePlus, Italic, Link, List, ListOrdered, Palette, Pilcrow, Redo2, RefreshCw, Smile, Strikethrough, Type, Underline, Undo2, Unlink } from 'lucide-react';
import { useLanguage, type TranslationKey } from '../lib/LanguageContext';
import { FEED_FONT_SIZES, FEED_TEXT_COLORS, isSafeFeedLink } from '../lib/feed-editor-contract';
import { apiUrl } from '../lib/api';
import { cn } from '../lib/utils';
import { $createFeedImageNode, FeedImageNode } from './lexical/FeedImageNode';

type RichTextPayload = {
  json: unknown;
  text: string;
};

type RichTextEditorProps = {
  valueJson?: unknown | null;
  onChange: (payload: RichTextPayload) => void;
  onImageUploadPendingChange?: (pending: boolean) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
};

const TEXT_COLORS: Array<{ label: string; value: string; swatch: string; translationKey: TranslationKey }> = [
  { label: 'Default', value: '', swatch: 'transparent', translationKey: 'editor.defaultColor' },
  { label: 'White', value: FEED_TEXT_COLORS[0], swatch: FEED_TEXT_COLORS[0], translationKey: 'editor.white' },
  { label: 'Muted Gray', value: FEED_TEXT_COLORS[1], swatch: FEED_TEXT_COLORS[1], translationKey: 'editor.mutedGray' },
  { label: 'Emerald', value: FEED_TEXT_COLORS[2], swatch: FEED_TEXT_COLORS[2], translationKey: 'editor.emerald' },
  { label: 'Lime', value: FEED_TEXT_COLORS[3], swatch: FEED_TEXT_COLORS[3], translationKey: 'editor.lime' },
  { label: 'Teal', value: FEED_TEXT_COLORS[4], swatch: FEED_TEXT_COLORS[4], translationKey: 'editor.teal' },
  { label: 'Cyan', value: FEED_TEXT_COLORS[5], swatch: FEED_TEXT_COLORS[5], translationKey: 'editor.cyan' },
  { label: 'Blue', value: FEED_TEXT_COLORS[6], swatch: FEED_TEXT_COLORS[6], translationKey: 'editor.blue' },
  { label: 'Purple', value: FEED_TEXT_COLORS[7], swatch: FEED_TEXT_COLORS[7], translationKey: 'editor.purple' },
  { label: 'Pink', value: FEED_TEXT_COLORS[8], swatch: FEED_TEXT_COLORS[8], translationKey: 'editor.pink' },
  { label: 'Red', value: FEED_TEXT_COLORS[9], swatch: FEED_TEXT_COLORS[9], translationKey: 'editor.red' },
  { label: 'Orange', value: FEED_TEXT_COLORS[10], swatch: FEED_TEXT_COLORS[10], translationKey: 'editor.orange' },
  { label: 'Amber', value: FEED_TEXT_COLORS[11], swatch: FEED_TEXT_COLORS[11], translationKey: 'editor.amber' },
  { label: 'Yellow', value: FEED_TEXT_COLORS[12], swatch: FEED_TEXT_COLORS[12], translationKey: 'editor.yellow' },
];

const FONT_SIZES = [
  { label: 'Reset', value: '' },
  ...FEED_FONT_SIZES.map((value) => ({ label: value.replace('px', ''), value })),
];

const EMOJI_CATEGORIES: Array<{ label: string; translationKey: TranslationKey; emojis: string[] }> = [
  { label: 'Announcements', translationKey: 'editor.announcements', emojis: ['📢', '📣', '📰', '🔔', '✅', '❗', '⚠️', '🎉'] },
  { label: 'Calendar/events', translationKey: 'editor.calendarEvents', emojis: ['📅', '🗓️', '⏰', '⌛', '🎯', '📌'] },
  { label: 'Work/HR', translationKey: 'editor.workHr', emojis: ['💼', '🧾', '📋', '📝', '👥', '🏢', '🏆'] },
  { label: 'Positive/team', translationKey: 'editor.positiveTeam', emojis: ['🙌', '👏', '💪', '🚀', '⭐', '💚', '🤝'] },
  { label: 'Status', translationKey: 'editor.status', emojis: ['✅', '❌', '⚠️', '🔴', '🟡', '🟢', '🔒'] },
];

function getInitialEditorState(valueJson: unknown | null | undefined) {
  if (!valueJson) return undefined;
  if (typeof valueJson === 'string') return valueJson;

  try {
    return JSON.stringify(valueJson);
  } catch {
    return undefined;
  }
}

function EditableStatePlugin({ readOnly }: { readOnly: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  return null;
}

function EditorDirectionPlugin({ direction }: { direction: 'ltr' | 'rtl' }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerRootListener((rootElement) => {
    if (!rootElement) return;
    rootElement.dir = direction;
    rootElement.dataset.feedDirection = direction;
  }), [direction, editor]);

  return null;
}

function ChangePlugin({ onChange }: { onChange: (payload: RichTextPayload) => void }) {
  return (
    <OnChangePlugin
      onChange={(editorState: EditorState) => {
        editorState.read(() => {
          onChange({
            json: editorState.toJSON(),
            text: $getRoot().getTextContent().trim(),
          });
        });
      }}
    />
  );
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded border text-neutral-600 transition hover:border-emerald-500/50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-emerald-100/70 dark:hover:border-emerald-400/50 dark:hover:text-emerald-200 sm:h-8 sm:w-8',
        active
          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 shadow-[0_0_12px_rgba(16,185,129,0.12)] dark:text-emerald-200'
          : 'border-emerald-500/20 bg-white/80 dark:border-emerald-500/15 dark:bg-black/30',
      )}
    >
      {children}
    </button>
  );
}

type UploadedFeedImage = {
  id: string;
  url: string;
  altText: string;
  width: number;
  height: number;
};

function uploadFeedImage(
  file: File,
  altText: string,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  return new Promise<UploadedFeedImage>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abortRequest = () => request.abort();
    const cleanup = () => signal.removeEventListener('abort', abortRequest);
    request.open('POST', apiUrl('/api/company-feed/images'));
    request.withCredentials = true;
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      try {
        const payload = JSON.parse(request.responseText) as {
          success?: boolean;
          image?: UploadedFeedImage;
          error?: string;
        };
        if (request.status === 201 && payload.success && payload.image) resolve(payload.image);
        else reject(new Error(payload.error || 'Unable to upload image.'));
      } catch {
        reject(new Error('Unable to upload image.'));
      } finally {
        cleanup();
      }
    });
    request.addEventListener('error', () => {
      cleanup();
      reject(new Error('Unable to upload image.'));
    });
    request.addEventListener('abort', () => {
      cleanup();
      reject(new Error('Image upload was cancelled.'));
    });
    signal.addEventListener('abort', abortRequest, { once: true });
    const form = new FormData();
    form.append('image', file);
    form.append('altText', altText);
    if (signal.aborted) {
      request.abort();
      return;
    }
    request.send(form);
  });
}

function ImageUploadControl({
  onPendingChange,
}: {
  onPendingChange?: (pending: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const [uploadState, setUploadState] = useState<{
    status: 'idle' | 'uploading' | 'error';
    progress: number;
    error: string;
  }>({ status: 'idle', progress: 0, error: '' });

  const insertUploadedImage = useCallback((image: UploadedFeedImage) => {
    editor.update(() => {
      const imageNode = $createFeedImageNode({
        uploadId: image.id,
        src: image.url,
        altText: image.altText,
        width: image.width,
        height: image.height,
      });
      $insertNodes([imageNode]);
      const paragraph = $createParagraphNode();
      imageNode.insertAfter(paragraph);
      paragraph.select();
    });
  }, [editor]);

  const upload = useCallback(async (file: File) => {
    if (uploadState.status === 'uploading') return;
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    lastFileRef.current = file;
    setUploadState({ status: 'uploading', progress: 0, error: '' });
    onPendingChange?.(true);
    const defaultAlt = file.name.replace(/\.[^.]+$/u, '').slice(0, 240);
    try {
      const image = await uploadFeedImage(file, defaultAlt, (progress) => {
        setUploadState({ status: 'uploading', progress, error: '' });
      }, controller.signal);
      insertUploadedImage(image);
      setUploadState({ status: 'idle', progress: 100, error: '' });
    } catch (error) {
      setUploadState({
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : t('editor.imageUploadFailed'),
      });
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
        onPendingChange?.(false);
      }
    }
  }, [insertUploadedImage, onPendingChange, t, uploadState.status]);

  useEffect(() => () => {
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    onPendingChange?.(false);
  }, [onPendingChange]);

  useEffect(() => mergeRegister(
    editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const file = Array.from(event.clipboardData?.files || []).find((entry) => entry.type.startsWith('image/'));
        if (!file) return false;
        event.preventDefault();
        void upload(file);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DROP_COMMAND,
      (event: DragEvent) => {
        const file = Array.from(event.dataTransfer?.files || []).find((entry) => entry.type.startsWith('image/'));
        if (!file) return false;
        event.preventDefault();
        void upload(file);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  ), [editor, upload]);

  return (
    <div className="relative flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        aria-label={t('editor.insertImage')}
        title={t('editor.insertImage')}
        disabled={uploadState.status === 'uploading'}
        onClick={() => inputRef.current?.click()}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-emerald-500/20 bg-white/80 text-neutral-600 transition hover:border-emerald-500/50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/15 dark:bg-black/30 dark:text-emerald-100/70 sm:h-8 sm:w-8"
      >
        <ImagePlus className="h-4 w-4" />
      </button>
      {uploadState.status === 'uploading' && (
        <span role="status" aria-live="polite" className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
          {uploadState.progress}%
        </span>
      )}
      {uploadState.status === 'error' && (
        <div role="alert" className="absolute left-0 top-full z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded border border-red-300/40 bg-white p-3 text-xs text-red-700 shadow-xl dark:bg-neutral-950 dark:text-red-300">
          <p>{uploadState.error}</p>
          <button
            type="button"
            disabled={!lastFileRef.current}
            onClick={() => {
              if (lastFileRef.current) void upload(lastFileRef.current);
            }}
            className="mt-2 flex min-h-11 items-center gap-2 rounded border border-red-400/30 px-3 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <RefreshCw className="h-4 w-4" />
            {t('editor.retryUpload')}
          </button>
        </div>
      )}
    </div>
  );
}

function EditorToolbar({
  onImageUploadPendingChange,
}: {
  onImageUploadPendingChange?: (pending: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const { t, isRtl } = useLanguage();
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false, strike: false });
  const [blockType, setBlockType] = useState<'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote' | 'bullet' | 'number'>('paragraph');
  const [linkActive, setLinkActive] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedFontSize, setSelectedFontSize] = useState('');
  const [openPicker, setOpenPicker] = useState<'color' | 'size' | 'emoji' | 'link' | null>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null);

  const refreshToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      setActiveFormats({ bold: false, italic: false, underline: false, strike: false });
      return;
    }

    setActiveFormats({
      bold: selection.hasFormat('bold'),
      italic: selection.hasFormat('italic'),
      underline: selection.hasFormat('underline'),
      strike: selection.hasFormat('strikethrough'),
    });
    setSelectedColor($getSelectionStyleValueForProperty(selection, 'color', ''));
    setSelectedFontSize($getSelectionStyleValueForProperty(selection, 'font-size', ''));

    const anchorNode = selection.anchor.getNode();
    const listNode = $getNearestNodeOfType(anchorNode, ListNode);
    const topLevelNode = anchorNode.getTopLevelElementOrThrow();
    if (listNode) {
      setBlockType(listNode.getListType() === 'number' ? 'number' : 'bullet');
    } else if ($isHeadingNode(topLevelNode)) {
      const tag = topLevelNode.getTag();
      setBlockType(['h1', 'h2', 'h3', 'h4'].includes(tag) ? tag as 'h1' | 'h2' | 'h3' | 'h4' : 'paragraph');
    } else if ($isQuoteNode(topLevelNode)) {
      setBlockType('quote');
    } else {
      setBlockType('paragraph');
    }

    const linkNode = $getNearestNodeOfType(anchorNode, LinkNode);
    setLinkActive($isLinkNode(linkNode));
    if (linkNode) setLinkUrl(linkNode.getURL());
  }, []);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          refreshToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          refreshToolbar();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, refreshToolbar]);

  const formatText = (format: 'bold' | 'italic' | 'underline' | 'strikethrough') => {
    const stateKey = format === 'strikethrough' ? 'strike' : format;
    setActiveFormats((current) => ({ ...current, [stateKey]: !current[stateKey] }));
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    queueMicrotask(() => {
      editor.getEditorState().read(() => {
        refreshToolbar();
      });
    });
  };

  const applyBlockType = (nextType: 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote') => {
    const apply = () => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (nextType === 'paragraph') $setBlocksType(selection, () => $createParagraphNode());
        else if (nextType === 'quote') $setBlocksType(selection, () => $createQuoteNode());
        else $setBlocksType(selection, () => $createHeadingNode(nextType));
      });
    };

    if (blockType === 'bullet' || blockType === 'number') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      queueMicrotask(apply);
    } else {
      apply();
    }
  };

  const openLinkPicker = () => {
    setLinkError('');
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const linkNode = $getNearestNodeOfType(selection.anchor.getNode(), LinkNode);
      setLinkUrl(linkNode?.getURL() || '');
    });
    setOpenPicker('link');
    window.setTimeout(() => linkInputRef.current?.focus(), 0);
  };

  const closeLinkPicker = () => {
    setOpenPicker(null);
    setLinkError('');
    window.setTimeout(() => linkButtonRef.current?.focus(), 0);
  };

  const togglePicker = (
    picker: 'color' | 'size' | 'emoji',
    trigger: HTMLButtonElement,
  ) => {
    pickerTriggerRef.current = trigger;
    setOpenPicker((current) => current === picker ? null : picker);
  };

  const closeFormattingPicker = () => {
    setOpenPicker(null);
    window.setTimeout(() => pickerTriggerRef.current?.focus(), 0);
  };

  const applyLink = () => {
    const normalizedUrl = linkUrl.trim();
    if (!isSafeFeedLink(normalizedUrl)) {
      setLinkError(t('editor.invalidLink'));
      return;
    }

    editor.update(() => {
      const isExternal = normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://');
      $toggleLink(normalizedUrl, {
        target: isExternal ? '_blank' : null,
        rel: isExternal ? 'noopener noreferrer' : null,
      });
    });
    closeLinkPicker();
  };

  const removeLink = () => {
    editor.update(() => $toggleLink(null));
    closeLinkPicker();
  };

  useEffect(() => {
    if (!openPicker) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (openPicker === 'link') closeLinkPicker();
        else closeFormattingPicker();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openPicker]);

  const applyTextStyle = (style: Record<string, string | null>) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, style);
      }
    });
  };

  const removeCurrentList = () => {
    let isInsideList = false;

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      const anchorNode = selection.anchor.getNode();
      isInsideList = Boolean(
        $getNearestNodeOfType(anchorNode, ListItemNode) ||
        $getNearestNodeOfType(anchorNode, ListNode),
      );
    });

    if (isInsideList) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    }
  };

  const insertEmoji = (emoji: string) => {
    editor.focus(() => {
      editor.update(() => {
        let selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          selection = $getRoot().selectEnd();
        }
        if ($isRangeSelection(selection)) {
          selection.insertText(emoji);
        }
      });
    });
  };

  return (
    <div dir="ltr" role="toolbar" aria-label={t('editor.formattingToolbar')} className="flex max-w-full flex-wrap items-center gap-1.5 overflow-x-clip border-b border-emerald-500/20 bg-neutral-50/90 p-2 dark:border-emerald-500/15 dark:bg-black/25 sm:gap-2">
      <label className="sr-only" htmlFor="stanza-editor-block-type">{t('editor.blockType')}</label>
      <select
        id="stanza-editor-block-type"
        value={['bullet', 'number'].includes(blockType) ? 'paragraph' : blockType}
        onChange={(event) => applyBlockType(event.target.value as 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote')}
        className="h-11 max-w-[9rem] rounded border border-emerald-500/20 bg-white px-2 text-[11px] font-bold text-neutral-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-emerald-500/15 dark:bg-black/30 dark:text-emerald-100 sm:h-8"
        aria-label={t('editor.blockType')}
      >
        <option value="paragraph">{t('editor.paragraph')}</option>
        <option value="h1">{t('editor.heading1')}</option>
        <option value="h2">{t('editor.heading2')}</option>
        <option value="h3">{t('editor.heading3')}</option>
        <option value="h4">{t('editor.heading4')}</option>
        <option value="quote">{t('editor.blockQuote')}</option>
      </select>
      <ToolbarButton label={t('editor.bold')} active={activeFormats.bold} onClick={() => formatText('bold')}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t('editor.italic')} active={activeFormats.italic} onClick={() => formatText('italic')}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t('editor.underline')} active={activeFormats.underline} onClick={() => formatText('underline')}>
        <Underline className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t('editor.strike')} active={activeFormats.strike} onClick={() => formatText('strikethrough')}>
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <span aria-hidden="true" className="mx-0.5 hidden h-5 w-px bg-emerald-500/15 sm:block" />
      <ToolbarButton active={blockType === 'bullet'} label={t('editor.bulletedList')} onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}>
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton active={blockType === 'number'} label={t('editor.numberedList')} onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t('editor.removeList')} onClick={removeCurrentList}>
        <Pilcrow className="h-4 w-4" />
      </ToolbarButton>
      <span aria-hidden="true" className="mx-0.5 hidden h-5 w-px bg-emerald-500/15 sm:block" />
      <div className="relative">
        <button
          ref={linkButtonRef}
          type="button"
          aria-label={t('editor.link')}
          title={t('editor.link')}
          aria-expanded={openPicker === 'link'}
          aria-haspopup="dialog"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLinkPicker}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded border text-neutral-600 transition hover:border-emerald-500/50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-emerald-100/70 dark:hover:text-emerald-200 sm:h-8 sm:w-8',
            linkActive
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
              : 'border-emerald-500/20 bg-white/80 dark:border-emerald-500/15 dark:bg-black/30',
          )}
        >
          <Link className="h-4 w-4" />
        </button>
        {openPicker === 'link' && (
          <div
            role="dialog"
            aria-label={t('editor.link')}
            dir={isRtl ? 'rtl' : 'ltr'}
            className="absolute left-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-emerald-500/20 bg-white p-3 text-neutral-800 shadow-2xl shadow-black/20 dark:bg-neutral-950 dark:text-emerald-50 dark:shadow-black/40"
          >
            <label htmlFor="stanza-editor-link-url" className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-emerald-100/60">
              {t('editor.linkUrl')}
            </label>
            <input
              ref={linkInputRef}
              id="stanza-editor-link-url"
              type="url"
              value={linkUrl}
              onChange={(event) => {
                setLinkUrl(event.target.value);
                setLinkError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyLink();
                }
              }}
              placeholder="https://"
              aria-invalid={Boolean(linkError)}
              aria-describedby={linkError ? 'stanza-editor-link-error' : undefined}
              className="h-11 w-full rounded border border-emerald-500/20 bg-white px-3 text-sm text-neutral-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:bg-black/50 dark:text-emerald-50"
            />
            {linkError && <p id="stanza-editor-link-error" className="mt-2 text-xs text-red-300">{linkError}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={applyLink} className="min-h-11 flex-1 rounded bg-emerald-500 px-3 text-xs font-bold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                {linkActive ? t('editor.updateLink') : t('editor.addLink')}
              </button>
              {linkActive && (
                <button type="button" onClick={removeLink} aria-label={t('editor.removeLink')} title={t('editor.removeLink')} className="flex min-h-11 min-w-11 items-center justify-center rounded border border-emerald-500/20 text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-100">
                  <Unlink className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={closeLinkPicker} className="min-h-11 rounded border border-emerald-500/20 px-3 text-xs font-bold text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-100">
                {t('dash.close')}
              </button>
            </div>
          </div>
        )}
      </div>
      <ImageUploadControl onPendingChange={onImageUploadPendingChange} />
      <div className="relative">
        <button
          type="button"
          aria-label={t('editor.textColor')}
          title={t('editor.textColor')}
          aria-expanded={openPicker === 'color'}
          aria-haspopup="menu"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => togglePicker('color', event.currentTarget)}
          className="flex h-11 items-center gap-2 rounded border border-emerald-500/20 bg-white/80 px-2 text-[11px] font-bold uppercase tracking-widest text-neutral-600 transition hover:border-emerald-500/50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500/15 dark:bg-black/30 dark:text-emerald-100/75 dark:hover:text-emerald-200 sm:h-8"
        >
          <Palette className="h-4 w-4" />
          <span
            className={cn(
              'h-3.5 w-3.5 rounded-full border',
              selectedColor ? 'border-black/30' : 'border-emerald-400/50 bg-black/20',
            )}
            style={selectedColor ? { backgroundColor: selectedColor } : undefined}
          />
          {t('editor.color')}
        </button>
        {openPicker === 'color' && (
          <div role="menu" aria-label={t('editor.textColor')} className="absolute left-0 top-full z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-emerald-500/20 bg-white p-3 text-neutral-800 shadow-2xl shadow-black/20 dark:bg-neutral-950 dark:text-emerald-50 dark:shadow-black/40">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-100/45">{t('editor.textColor')}</div>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color.label}
                  type="button"
                  role="menuitem"
                  aria-label={`${t(color.translationKey)} ${t('editor.textColor')}`}
                  title={t(color.translationKey)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelectedColor(color.value);
                    applyTextStyle({ color: color.value || null });
                    setOpenPicker(null);
                  }}
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-full border transition motion-reduce:transform-none sm:h-8 sm:w-8',
                    selectedColor === color.value
                      ? 'border-emerald-300 ring-2 ring-emerald-400/30'
                      : 'border-emerald-500/20',
                    !color.value && 'bg-[linear-gradient(135deg,transparent_46%,rgba(52,211,153,0.85)_48%,rgba(52,211,153,0.85)_52%,transparent_54%)]',
                  )}
                >
                  <span
                    className={cn('h-5 w-5 rounded-full border border-black/30', !color.value && 'border-emerald-400/50 bg-black')}
                    style={color.value ? { backgroundColor: color.swatch } : undefined}
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          aria-label={t('editor.fontSize')}
          title={t('editor.fontSize')}
          aria-expanded={openPicker === 'size'}
          aria-haspopup="menu"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => togglePicker('size', event.currentTarget)}
          className="flex h-11 items-center gap-2 rounded border border-emerald-500/20 bg-white/80 px-2 text-[11px] font-bold uppercase tracking-widest text-neutral-600 transition hover:border-emerald-500/50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500/15 dark:bg-black/30 dark:text-emerald-100/75 dark:hover:text-emerald-200 sm:h-8"
        >
          <Type className="h-4 w-4" />
          {selectedFontSize ? selectedFontSize.replace('px', '') : t('editor.size')}
        </button>
        {openPicker === 'size' && (
          <div role="menu" aria-label={t('editor.fontSize')} className="absolute left-0 top-full z-40 mt-2 grid w-36 max-w-[calc(100vw-2rem)] grid-cols-2 gap-1 rounded-lg border border-emerald-500/20 bg-white p-2 shadow-2xl shadow-black/20 dark:bg-neutral-950 dark:shadow-black/40">
            {FONT_SIZES.map((size) => (
              <button
                key={size.label}
                type="button"
                role="menuitem"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSelectedFontSize(size.value);
                  applyTextStyle({ 'font-size': size.value || null });
                  setOpenPicker(null);
                }}
                className={cn(
                  'min-h-11 rounded border px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest transition sm:min-h-8',
                  selectedFontSize === size.value
                    ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100'
                    : 'border-emerald-500/20 bg-white text-neutral-600 hover:border-emerald-500/50 hover:text-emerald-700 dark:border-emerald-500/15 dark:bg-black/40 dark:text-emerald-100/65 dark:hover:text-emerald-100',
                )}
              >
                {size.value ? size.label : t('editor.reset')}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          aria-label={t('editor.insertEmoji')}
          title={t('editor.insertEmoji')}
          aria-expanded={openPicker === 'emoji'}
          aria-haspopup="menu"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => togglePicker('emoji', event.currentTarget)}
          className="flex h-11 items-center gap-2 rounded border border-emerald-500/20 bg-white/80 px-2 text-[11px] font-bold uppercase tracking-widest text-neutral-600 transition hover:border-emerald-500/50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500/15 dark:bg-black/30 dark:text-emerald-100/75 dark:hover:text-emerald-200 sm:h-8"
        >
          <Smile className="h-4 w-4" />
          {t('editor.emoji')}
        </button>
        {openPicker === 'emoji' && (
          <div role="menu" aria-label={t('editor.insertEmoji')} className="absolute left-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-emerald-500/20 bg-white p-3 text-neutral-800 shadow-2xl shadow-black/20 dark:bg-neutral-950 dark:text-emerald-50 dark:shadow-black/40">
            <div className="space-y-3">
              {EMOJI_CATEGORIES.map((category) => (
                <div key={category.label}>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-100/45">{t(category.translationKey)}</div>
                  <div className="flex flex-wrap gap-1">
                    {category.emojis.map((emoji) => (
                      <button
                        key={`${category.label}-${emoji}`}
                        type="button"
                        role="menuitem"
                        aria-label={`${t('editor.insertEmoji')} ${emoji}`}
                        title={`${t('editor.insertEmoji')} ${emoji}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertEmoji(emoji)}
                        className="flex h-11 w-11 items-center justify-center rounded border border-emerald-500/20 bg-white text-lg transition hover:border-emerald-500/50 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500/10 dark:bg-black/40 sm:h-8 sm:w-8"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <span aria-hidden="true" className="mx-0.5 hidden h-5 w-px bg-emerald-500/15 sm:block" />
      <ToolbarButton label={t('editor.undo')} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}>
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t('editor.redo')} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}>
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

export function RichTextEditor({
  valueJson,
  onChange,
  onImageUploadPendingChange,
  placeholder,
  readOnly = false,
  className,
}: RichTextEditorProps) {
  const { t, isRtl } = useLanguage();
  const resolvedPlaceholder = placeholder ?? t('editor.writeUpdate');
  const initialConfig = useMemo(() => ({
    namespace: readOnly ? 'StanzaFeedReader' : 'StanzaFeedComposer',
    editable: !readOnly,
    editorState: getInitialEditorState(valueJson),
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, FeedImageNode],
    onError(error: Error) {
      throw error;
    },
    theme: {
      paragraph: 'mb-2 last:mb-0',
      text: {
        bold: 'font-bold text-emerald-50',
        italic: 'italic',
        strikethrough: 'line-through',
        underline: 'underline decoration-emerald-300/70 underline-offset-2',
      },
      heading: {
        h1: 'mb-3 text-3xl font-black leading-tight',
        h2: 'mb-2 text-2xl font-black leading-tight',
        h3: 'mb-2 text-xl font-bold leading-snug',
        h4: 'mb-2 text-lg font-bold leading-snug',
      },
      link: 'break-words text-emerald-600 underline decoration-emerald-400/60 underline-offset-2 dark:text-emerald-300',
      list: {
        ul: '[margin-inline-start:1.25rem] list-disc space-y-1',
        ol: '[margin-inline-start:1.25rem] list-decimal space-y-1',
        listitem: '[padding-inline-start:0.25rem]',
      },
      quote: '[border-inline-start-width:2px] [padding-inline-start:0.75rem] border-emerald-500/30 text-neutral-600 dark:text-emerald-100/70',
    },
  }), [readOnly, valueJson]);

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={cn(
        'max-w-full overflow-visible rounded border border-emerald-500/20 bg-white/90 text-sm text-neutral-800 shadow-inner shadow-neutral-200/40 focus-within:border-emerald-500/60 dark:border-emerald-500/15 dark:bg-black/40 dark:text-emerald-50 dark:shadow-black/20',
        className,
      )}>
        {!readOnly && <EditorToolbar onImageUploadPendingChange={onImageUploadPendingChange} />}
        <div className={cn('relative', readOnly ? 'min-h-0' : 'min-h-[150px]')}>
          <RichTextPlugin
            contentEditable={(
              <ContentEditable
                dir={isRtl ? 'rtl' : 'ltr'}
                className={cn(
                  'stanza-feed-editor-surface min-h-[150px] max-w-full overflow-x-hidden break-words px-3 py-3 text-sm leading-6 text-neutral-800 outline-none [overflow-wrap:anywhere] [unicode-bidi:plaintext] dark:text-emerald-50',
                  isRtl ? 'text-right' : 'text-left',
                  readOnly && 'min-h-0 px-0 py-0 text-neutral-700 dark:text-emerald-100/70',
                )}
                aria-placeholder={resolvedPlaceholder}
                placeholder={!readOnly ? (
                  <div
                    dir={isRtl ? 'rtl' : 'ltr'}
                    className={cn("pointer-events-none absolute top-3 text-sm text-neutral-400 dark:text-emerald-100/35", isRtl ? "right-3 text-right" : "left-3 text-left")}
                  >
                    {resolvedPlaceholder}
                  </div>
                ) : null}
              />
            )}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        {!readOnly && (
          <>
            <HistoryPlugin />
            <ChangePlugin onChange={onChange} />
          </>
        )}
        <ListPlugin />
        <LinkPlugin
          validateUrl={isSafeFeedLink}
          attributes={{ target: '_blank', rel: 'noopener noreferrer' }}
        />
        <EditorDirectionPlugin direction={isRtl ? 'rtl' : 'ltr'} />
        <EditableStatePlugin readOnly={readOnly} />
      </div>
    </LexicalComposer>
  );
}

export function RichFeedContent({
  contentJson,
  contentText,
}: {
  contentJson?: unknown | null;
  contentText: string;
}) {
  const { isRtl } = useLanguage();
  const hasLexicalRoot = Boolean(
    contentJson &&
    typeof contentJson === 'object' &&
    'root' in contentJson,
  );

  if (!hasLexicalRoot) {
    return <p className={cn("mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-emerald-100/70", isRtl ? "text-right" : "text-left")}>{contentText}</p>;
  }

  return (
    <div className="mt-3">
      <RichTextEditor
        valueJson={contentJson}
        onChange={() => undefined}
        readOnly
      />
    </div>
  );
}
