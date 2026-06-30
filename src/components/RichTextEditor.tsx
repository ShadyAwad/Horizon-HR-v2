import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { $getRoot, $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND, REDO_COMMAND, SELECTION_CHANGE_COMMAND, UNDO_COMMAND, type EditorState } from 'lexical';
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
import { Bold, Italic, List, ListOrdered, Pilcrow, Redo2, Underline, Undo2 } from 'lucide-react';
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

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          setActiveFormats({
            bold: selection.hasFormat('bold'),
            italic: selection.hasFormat('italic'),
            underline: selection.hasFormat('underline'),
          });
        }
        return false;
      },
      1,
    );
  }, [editor]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-emerald-500/15 bg-black/25 p-2">
      <ToolbarButton label="Bold" active={activeFormats.bold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={activeFormats.italic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Underline" active={activeFormats.underline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}>
        <Underline className="h-4 w-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-emerald-500/15" />
      <ToolbarButton label="Bulleted list" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}>
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Remove list" onClick={() => editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)}>
        <Pilcrow className="h-4 w-4" />
      </ToolbarButton>
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
