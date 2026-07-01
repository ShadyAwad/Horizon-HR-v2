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
  { label: 'Default color', value: '' },
  { label: 'Emerald', value: '#34d399' },
  { label: 'Mint', value: '#a7f3d0' },
  { label: 'Ivory', value: '#ecfdf5' },
  { label: 'Amber', value: '#fbbf24' },
  { label: 'Rose', value: '#fb7185' },
];

const FONT_SIZES = [
  { label: 'Default size', value: '' },
  { label: 'Small', value: '12px' },
  { label: 'Normal', value: '14px' },
  { label: 'Large', value: '18px' },
  { label: 'Display', value: '22px' },
];

const EMOJIS = ['😀', '🎉', '👏', '✅', '📌', '⭐'];

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
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    editor.getEditorState().read(() => {
      refreshToolbar();
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
        const selection = $getSelection();
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
      <label className="flex h-8 items-center gap-1 rounded border border-emerald-500/15 bg-black/30 px-2 text-emerald-100/70 transition focus-within:border-emerald-400/50 hover:border-emerald-400/50">
        <Palette className="h-4 w-4" />
        <span className="sr-only">Text color</span>
        <select
          value={selectedColor}
          onChange={(event) => {
            const color = event.target.value;
            setSelectedColor(color);
            applyTextStyle({ color: color || null });
          }}
          className="h-full bg-transparent text-[11px] font-bold uppercase tracking-widest text-emerald-100/75 outline-none"
        >
          {TEXT_COLORS.map((color) => (
            <option key={color.label} value={color.value} className="bg-black text-emerald-50">
              {color.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex h-8 items-center gap-1 rounded border border-emerald-500/15 bg-black/30 px-2 text-emerald-100/70 transition focus-within:border-emerald-400/50 hover:border-emerald-400/50">
        <Type className="h-4 w-4" />
        <span className="sr-only">Font size</span>
        <select
          value={selectedFontSize}
          onChange={(event) => {
            const fontSize = event.target.value;
            setSelectedFontSize(fontSize);
            applyTextStyle({ 'font-size': fontSize || null });
          }}
          className="h-full bg-transparent text-[11px] font-bold uppercase tracking-widest text-emerald-100/75 outline-none"
        >
          {FONT_SIZES.map((size) => (
            <option key={size.label} value={size.value} className="bg-black text-emerald-50">
              {size.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex h-8 items-center gap-1 rounded border border-emerald-500/15 bg-black/30 px-1 text-emerald-100/70">
        <Smile className="ml-1 h-4 w-4" aria-hidden="true" />
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`Insert ${emoji}`}
            title={`Insert ${emoji}`}
            onClick={() => insertEmoji(emoji)}
            className="flex h-6 w-6 items-center justify-center rounded text-sm transition hover:bg-emerald-500/10 hover:text-emerald-100"
          >
            {emoji}
          </button>
        ))}
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
        'overflow-hidden rounded border border-emerald-500/15 bg-black/40 text-sm text-emerald-50 shadow-inner shadow-black/20 focus-within:border-emerald-400/60',
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
