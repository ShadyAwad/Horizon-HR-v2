import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { $getRoot, $getSelection, $isRangeSelection, COMMAND_PRIORITY_LOW, FORMAT_TEXT_COMMAND, REDO_COMMAND, SELECTION_CHANGE_COMMAND, UNDO_COMMAND, type EditorState } from 'lexical';
import { ListItemNode, ListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from '@lexical/list';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { $patchStyleText } from '@lexical/selection';
import { $getNearestNodeOfType, mergeRegister } from '@lexical/utils';
import { Bold, Italic, List, ListOrdered, Palette, Pilcrow, Redo2, Smile, Type, Underline, Undo2 } from 'lucide-react';
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

const TEXT_COLORS = [
  { label: 'Default', value: '', swatch: 'transparent' },
  { label: 'White', value: '#f8fafc', swatch: '#f8fafc' },
  { label: 'Muted Gray', value: '#a3a3a3', swatch: '#a3a3a3' },
  { label: 'Emerald', value: '#34d399', swatch: '#34d399' },
  { label: 'Lime', value: '#a3e635', swatch: '#a3e635' },
  { label: 'Teal', value: '#2dd4bf', swatch: '#2dd4bf' },
  { label: 'Cyan', value: '#22d3ee', swatch: '#22d3ee' },
  { label: 'Blue', value: '#60a5fa', swatch: '#60a5fa' },
  { label: 'Purple', value: '#c084fc', swatch: '#c084fc' },
  { label: 'Pink', value: '#f472b6', swatch: '#f472b6' },
  { label: 'Red', value: '#f87171', swatch: '#f87171' },
  { label: 'Orange', value: '#fb923c', swatch: '#fb923c' },
  { label: 'Amber', value: '#fbbf24', swatch: '#fbbf24' },
  { label: 'Yellow', value: '#fde047', swatch: '#fde047' },
];

const FONT_SIZES = [
  { label: 'Reset', value: '' },
  { label: '10', value: '10px' },
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
  { label: '28', value: '28px' },
  { label: '32', value: '32px' },
];

const EMOJI_CATEGORIES = [
  { label: 'Announcements', emojis: ['📢', '📣', '📰', '🔔', '✅', '❗', '⚠️', '🎉'] },
  { label: 'Calendar/events', emojis: ['📅', '🗓️', '⏰', '⌛', '🎯', '📌'] },
  { label: 'Work/HR', emojis: ['💼', '🧾', '📋', '📝', '👥', '🏢', '🏆'] },
  { label: 'Positive/team', emojis: ['🙌', '👏', '💪', '🚀', '⭐', '💚', '🤝'] },
  { label: 'Status', emojis: ['✅', '❌', '⚠️', '🔴', '🟡', '🟢', '🔒'] },
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
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false });
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedFontSize, setSelectedFontSize] = useState('');
  const [openPicker, setOpenPicker] = useState<'color' | 'size' | 'emoji' | null>(null);

  const refreshToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      setActiveFormats({ bold: false, italic: false, underline: false });
      return;
    }

    setActiveFormats({
      bold: selection.hasFormat('bold'),
      italic: selection.hasFormat('italic'),
      underline: selection.hasFormat('underline'),
    });
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

  const formatText = (format: 'bold' | 'italic' | 'underline') => {
    setActiveFormats((current) => ({ ...current, [format]: !current[format] }));
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    queueMicrotask(() => {
      editor.getEditorState().read(() => {
        refreshToolbar();
      });
    });
  };

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
      <ToolbarButton label="Bold" active={activeFormats.bold} onClick={() => formatText('bold')}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={activeFormats.italic} onClick={() => formatText('italic')}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Underline" active={activeFormats.underline} onClick={() => formatText('underline')}>
        <Underline className="h-4 w-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-emerald-500/15" />
      <ToolbarButton label="Bulleted list" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}>
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Remove list" onClick={removeCurrentList}>
        <Pilcrow className="h-4 w-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-emerald-500/15" />
      <div className="relative">
        <button
          type="button"
          aria-label="Text color"
          title="Text color"
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
          Color
        </button>
        {openPicker === 'color' && (
          <div className="absolute left-0 top-full z-40 mt-2 w-64 rounded-lg border border-emerald-500/20 bg-black/95 p-3 shadow-2xl shadow-black/40">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-100/45">Text color</div>
            <div className="grid grid-cols-7 gap-2">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color.label}
                  type="button"
                  aria-label={`${color.label} text color`}
                  title={color.label}
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
          aria-label="Font size"
          title="Font size"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpenPicker((current) => current === 'size' ? null : 'size')}
          className="flex h-8 items-center gap-2 rounded border border-emerald-500/15 bg-black/30 px-2 text-[11px] font-bold uppercase tracking-widest text-emerald-100/75 transition hover:border-emerald-400/50 hover:text-emerald-200"
        >
          <Type className="h-4 w-4" />
          {selectedFontSize ? selectedFontSize.replace('px', '') : 'Size'}
        </button>
        {openPicker === 'size' && (
          <div className="absolute left-0 top-full z-40 mt-2 grid w-36 grid-cols-2 gap-1 rounded-lg border border-emerald-500/20 bg-black/95 p-2 shadow-2xl shadow-black/40">
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
                {size.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          aria-label="Insert emoji"
          title="Insert emoji"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpenPicker((current) => current === 'emoji' ? null : 'emoji')}
          className="flex h-8 items-center gap-2 rounded border border-emerald-500/15 bg-black/30 px-2 text-[11px] font-bold uppercase tracking-widest text-emerald-100/75 transition hover:border-emerald-400/50 hover:text-emerald-200"
        >
          <Smile className="h-4 w-4" />
          Emoji
        </button>
        {openPicker === 'emoji' && (
          <div className="absolute left-0 top-full z-40 mt-2 w-72 rounded-lg border border-emerald-500/20 bg-black/95 p-3 shadow-2xl shadow-black/40">
            <div className="space-y-3">
              {EMOJI_CATEGORIES.map((category) => (
                <div key={category.label}>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-100/45">{category.label}</div>
                  <div className="flex flex-wrap gap-1">
                    {category.emojis.map((emoji) => (
                      <button
                        key={`${category.label}-${emoji}`}
                        type="button"
                        aria-label={`Insert ${emoji}`}
                        title={`Insert ${emoji}`}
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
      <ToolbarButton label="Undo" onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}>
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Redo" onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}>
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

export function RichTextEditor({
  valueJson,
  onChange,
  placeholder = 'Write an update...',
  readOnly = false,
  className,
}: RichTextEditorProps) {
  const initialConfig = useMemo(() => ({
    namespace: readOnly ? 'StanzaFeedReader' : 'StanzaFeedComposer',
    editable: !readOnly,
    editorState: getInitialEditorState(valueJson),
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
    onError(error: Error) {
      throw error;
    },
    theme: {
      paragraph: 'mb-2 last:mb-0',
      text: {
        bold: 'font-bold text-emerald-50',
        italic: 'italic',
        underline: 'underline decoration-emerald-300/70 underline-offset-2',
      },
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
                  readOnly && 'min-h-0 px-0 py-0 text-slate-700 dark:text-emerald-100/70',
                )}
                aria-placeholder={placeholder}
                placeholder={!readOnly ? (
                  <div className="pointer-events-none absolute left-3 top-3 text-sm text-emerald-100/35">
                    {placeholder}
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
  const hasLexicalRoot = Boolean(
    contentJson &&
    typeof contentJson === 'object' &&
    'root' in contentJson,
  );

  if (!hasLexicalRoot) {
    return <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-emerald-100/70">{contentText}</p>;
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
