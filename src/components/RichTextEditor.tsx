import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { $createParagraphNode, $getRoot, $getSelection, $isRangeSelection, COMMAND_PRIORITY_LOW, FORMAT_TEXT_COMMAND, REDO_COMMAND, SELECTION_CHANGE_COMMAND, UNDO_COMMAND, type EditorState } from 'lexical';
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
import { Bold, Italic, Link, List, ListOrdered, Palette, Pilcrow, Redo2, Smile, Strikethrough, Type, Underline, Undo2, Unlink } from 'lucide-react';
import { useLanguage, type TranslationKey } from '../lib/LanguageContext';
import { FEED_FONT_SIZES, FEED_TEXT_COLORS, isSafeFeedLink } from '../lib/feed-editor-contract';
import { cn } from '../lib/utils';

type RichTextPayload = {
  json: unknown;
  text: string;
};

type RichTextEditorProps = {
  valueJson?: unknown | null;
  onChange: (payload: RichTextPayload) => void;
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
        'flex h-8 w-8 items-center justify-center rounded border text-emerald-100/70 transition hover:border-emerald-400/50 hover:text-emerald-200',
        active
          ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.12)]'
          : 'border-emerald-500/15 bg-black/30',
      )}
    >
      {children}
    </button>
  );
}

function EditorToolbar() {
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
    if (openPicker !== 'link') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLinkPicker();
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
    <div className="flex flex-wrap items-center gap-2 border-b border-emerald-500/15 bg-black/25 p-2">
      <label className="sr-only" htmlFor="stanza-editor-block-type">{t('editor.blockType')}</label>
      <select
        id="stanza-editor-block-type"
        value={['bullet', 'number'].includes(blockType) ? 'paragraph' : blockType}
        onChange={(event) => applyBlockType(event.target.value as 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote')}
        className="h-8 rounded border border-emerald-500/15 bg-black/30 px-2 text-[11px] font-bold text-emerald-100 outline-none focus:border-emerald-400/60"
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
      <span className="mx-1 h-5 w-px bg-emerald-500/15" />
      <ToolbarButton active={blockType === 'bullet'} label={t('editor.bulletedList')} onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}>
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton active={blockType === 'number'} label={t('editor.numberedList')} onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t('editor.removeList')} onClick={removeCurrentList}>
        <Pilcrow className="h-4 w-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-emerald-500/15" />
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
            'flex h-8 w-8 items-center justify-center rounded border transition hover:border-emerald-400/50 hover:text-emerald-200',
            linkActive
              ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
              : 'border-emerald-500/15 bg-black/30 text-emerald-100/70',
          )}
        >
          <Link className="h-4 w-4" />
        </button>
        {openPicker === 'link' && (
          <div
            role="dialog"
            aria-label={t('editor.link')}
            className={cn("absolute top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-emerald-500/20 bg-black/95 p-3 shadow-2xl shadow-black/40", isRtl ? "right-0" : "left-0")}
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
              className="h-10 w-full rounded border border-emerald-500/20 bg-black/50 px-3 text-sm text-emerald-50 outline-none focus:border-emerald-400"
            />
            {linkError && <p id="stanza-editor-link-error" className="mt-2 text-xs text-red-300">{linkError}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={applyLink} className="min-h-10 flex-1 rounded bg-emerald-500 px-3 text-xs font-bold text-black">
                {linkActive ? t('editor.updateLink') : t('editor.addLink')}
              </button>
              {linkActive && (
                <button type="button" onClick={removeLink} aria-label={t('editor.removeLink')} title={t('editor.removeLink')} className="flex min-h-10 min-w-10 items-center justify-center rounded border border-emerald-500/20 text-emerald-100">
                  <Unlink className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={closeLinkPicker} className="min-h-10 rounded border border-emerald-500/20 px-3 text-xs font-bold text-emerald-100">
                {t('dash.close')}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          aria-label={t('editor.textColor')}
          title={t('editor.textColor')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpenPicker((current) => current === 'color' ? null : 'color')}
          className="flex h-8 items-center gap-2 rounded border border-emerald-500/15 bg-black/30 px-2 text-[11px] font-bold uppercase tracking-widest text-emerald-100/75 transition hover:border-emerald-400/50 hover:text-emerald-200"
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
          <div className={cn("absolute top-full z-40 mt-2 w-64 rounded-lg border border-emerald-500/20 bg-black/95 p-3 shadow-2xl shadow-black/40", isRtl ? "right-0" : "left-0")}>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-100/45">{t('editor.textColor')}</div>
            <div className="grid grid-cols-7 gap-2">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color.label}
                  type="button"
                  aria-label={`${t(color.translationKey)} ${t('editor.textColor')}`}
                  title={t(color.translationKey)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelectedColor(color.value);
                    applyTextStyle({ color: color.value || null });
                    setOpenPicker(null);
                  }}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border transition hover:scale-105',
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
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpenPicker((current) => current === 'size' ? null : 'size')}
          className="flex h-8 items-center gap-2 rounded border border-emerald-500/15 bg-black/30 px-2 text-[11px] font-bold uppercase tracking-widest text-emerald-100/75 transition hover:border-emerald-400/50 hover:text-emerald-200"
        >
          <Type className="h-4 w-4" />
          {selectedFontSize ? selectedFontSize.replace('px', '') : t('editor.size')}
        </button>
        {openPicker === 'size' && (
          <div className={cn("absolute top-full z-40 mt-2 grid w-36 grid-cols-2 gap-1 rounded-lg border border-emerald-500/20 bg-black/95 p-2 shadow-2xl shadow-black/40", isRtl ? "right-0" : "left-0")}>
            {FONT_SIZES.map((size) => (
              <button
                key={size.label}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSelectedFontSize(size.value);
                  applyTextStyle({ 'font-size': size.value || null });
                  setOpenPicker(null);
                }}
                className={cn(
                  'rounded border px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest transition',
                  selectedFontSize === size.value
                    ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100'
                    : 'border-emerald-500/15 bg-black/40 text-emerald-100/65 hover:border-emerald-400/50 hover:text-emerald-100',
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
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpenPicker((current) => current === 'emoji' ? null : 'emoji')}
          className="flex h-8 items-center gap-2 rounded border border-emerald-500/15 bg-black/30 px-2 text-[11px] font-bold uppercase tracking-widest text-emerald-100/75 transition hover:border-emerald-400/50 hover:text-emerald-200"
        >
          <Smile className="h-4 w-4" />
          {t('editor.emoji')}
        </button>
        {openPicker === 'emoji' && (
          <div className={cn("absolute top-full z-40 mt-2 w-72 rounded-lg border border-emerald-500/20 bg-black/95 p-3 shadow-2xl shadow-black/40", isRtl ? "right-0" : "left-0")}>
            <div className="space-y-3">
              {EMOJI_CATEGORIES.map((category) => (
                <div key={category.label}>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-100/45">{t(category.translationKey)}</div>
                  <div className="flex flex-wrap gap-1">
                    {category.emojis.map((emoji) => (
                      <button
                        key={`${category.label}-${emoji}`}
                        type="button"
                        aria-label={`${t('editor.insertEmoji')} ${emoji}`}
                        title={`${t('editor.insertEmoji')} ${emoji}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertEmoji(emoji)}
                        className="flex h-8 w-8 items-center justify-center rounded border border-emerald-500/10 bg-black/40 text-lg transition hover:border-emerald-400/40 hover:bg-emerald-500/10"
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
      <span className="mx-1 h-5 w-px bg-emerald-500/15" />
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
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
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
        ul: 'ml-5 list-disc space-y-1',
        ol: 'ml-5 list-decimal space-y-1',
        listitem: 'pl-1',
      },
      quote: 'border-l-2 border-emerald-500/30 pl-3 text-emerald-100/70',
    },
  }), [readOnly, valueJson]);

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={cn(
        'overflow-visible rounded border border-emerald-500/15 bg-black/40 text-sm text-emerald-50 shadow-inner shadow-black/20 focus-within:border-emerald-400/60',
        className,
      )}>
        {!readOnly && <EditorToolbar />}
        <div className={cn('relative', readOnly ? 'min-h-0' : 'min-h-[150px]')}>
          <RichTextPlugin
            contentEditable={(
              <ContentEditable
                className={cn(
                  'min-h-[150px] px-3 py-3 text-sm leading-6 text-emerald-50 outline-none',
                  isRtl ? 'text-right' : 'text-left',
                  readOnly && 'min-h-0 px-0 py-0 text-slate-700 dark:text-emerald-100/70',
                )}
                aria-placeholder={resolvedPlaceholder}
                placeholder={!readOnly ? (
                  <div className={cn("pointer-events-none absolute top-3 text-sm text-emerald-100/35", isRtl ? "right-3 text-right" : "left-3 text-left")}>
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
