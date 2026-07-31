import {
  CornerDownLeft,
  Search,
  X,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { normaliseRecentCommandIds } from './command-palette-state';
import { searchCommands } from './command-search';
import type { CommandGroup, StanzaCommand } from './command-palette-types';

type DisplayGroup = CommandGroup | 'recent';

export type CommandPaletteLabels = {
  title: string;
  searchPlaceholder: string;
  close: string;
  clearSearch: string;
  noResults: string;
  resultCount: (count: number) => string;
  keyboardHelp: string;
  groups: Record<DisplayGroup, string>;
};

type Props = {
  commands: readonly StanzaCommand[];
  recentCommandIds: readonly string[];
  currentContextId?: string;
  focusRequest: number;
  isRtl: boolean;
  labels: CommandPaletteLabels;
  onClose: () => void;
  onExecute: (command: StanzaCommand) => void;
};

const GROUP_ORDER: readonly CommandGroup[] = [
  'workspace',
  'peopleOperations',
  'administration',
  'quickActions',
  'settings',
];

export function CommandPalette({
  commands,
  recentCommandIds,
  currentContextId,
  focusRequest,
  isRtl,
  labels,
  onClose,
  onExecute,
}: Props) {
  const titleId = useId();
  const resultsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const availableIds = useMemo(() => new Set(commands.map((command) => command.id)), [commands]);
  const validRecentIds = useMemo(
    () => normaliseRecentCommandIds(recentCommandIds, availableIds),
    [availableIds, recentCommandIds],
  );
  const orderedResults = useMemo(
    () => searchCommands(commands, query, { recentCommandIds: validRecentIds, currentContextId }),
    [commands, currentContextId, query, validRecentIds],
  );
  const groupedResults = useMemo(() => {
    const groups: Array<{ id: DisplayGroup; commands: StanzaCommand[] }> = [];
    const recentSet = new Set(validRecentIds);

    if (!query.trim() && validRecentIds.length) {
      const byId = new Map(commands.map((command) => [command.id, command]));
      const recent = validRecentIds
        .map((id) => byId.get(id))
        .filter(Boolean) as StanzaCommand[];
      if (recent.length) groups.push({ id: 'recent', commands: recent });
    }

    for (const group of GROUP_ORDER) {
      const matches = orderedResults.filter((command) => (
        command.group === group && (query.trim() || !recentSet.has(command.id))
      ));
      if (matches.length) groups.push({ id: group, commands: matches });
    }
    return groups;
  }, [commands, orderedResults, query, validRecentIds]);
  const flatResults = useMemo(
    () => groupedResults.flatMap((group) => group.commands),
    [groupedResults],
  );
  const selectedCommand = flatResults[Math.min(selectedIndex, Math.max(0, flatResults.length - 1))];

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex < flatResults.length) return;
    setSelectedIndex(Math.max(0, flatResults.length - 1));
  }, [flatResults.length, selectedIndex]);

  useEffect(() => {
    if (!selectedCommand) return;
    optionRefs.current.get(selectedCommand.id)?.scrollIntoView({ block: 'nearest' });
  }, [selectedCommand]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const moveSelection = (nextIndex: number) => {
    if (!flatResults.length) return;
    setSelectedIndex(Math.max(0, Math.min(flatResults.length - 1, nextIndex)));
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(selectedIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(selectedIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveSelection(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveSelection(flatResults.length - 1);
    } else if (event.key === 'Enter' && !event.repeat && selectedCommand) {
      event.preventDefault();
      onExecute(selectedCommand);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ) || []).filter((element) => !element.hasAttribute('hidden'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-3 pt-[calc(env(safe-area-inset-top)+.75rem)] pb-[calc(env(safe-area-inset-bottom)+.75rem)] sm:items-start sm:pt-[10dvh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={isRtl ? 'rtl' : 'ltr'}
        onKeyDown={trapFocus}
        className="flex max-h-[min(82dvh,42rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-emerald-500/25 bg-white shadow-2xl shadow-black/35 dark:bg-[#061411]"
      >
        <div className="border-b border-emerald-500/15 p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <label className="min-w-0 flex-1">
              <span id={titleId} className="sr-only">{labels.title}</span>
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={labels.searchPlaceholder}
                aria-controls={resultsId}
                aria-activedescendant={selectedCommand ? `stanza-command-${selectedCommand.id}` : undefined}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-transparent py-2 text-base font-semibold text-slate-900 outline-none placeholder:text-slate-400 dark:text-emerald-50 dark:placeholder:text-emerald-100/40"
              />
            </label>
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label={labels.clearSearch}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/65"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={labels.close}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/65"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-1 px-7 text-[11px] text-slate-500 dark:text-emerald-100/45">
            {labels.keyboardHelp}
          </p>
        </div>

        <div
          id={resultsId}
          role="listbox"
          aria-label={labels.title}
          className="stanza-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-3"
        >
          {groupedResults.map((group) => {
            const groupId = `${resultsId}-${group.id}`;
            return (
              <section key={group.id} role="group" aria-labelledby={groupId} className="mb-3 last:mb-0">
                <h2
                  id={groupId}
                  className="px-2 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-emerald-100/45"
                >
                  {labels.groups[group.id]}
                </h2>
                <div className="space-y-1">
                  {group.commands.map((command) => {
                    const resultIndex = flatResults.findIndex((item) => item.id === command.id);
                    const selected = resultIndex === selectedIndex;
                    return (
                      <button
                        key={command.id}
                        ref={(element) => {
                          if (element) optionRefs.current.set(command.id, element);
                          else optionRefs.current.delete(command.id);
                        }}
                        id={`stanza-command-${command.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => setSelectedIndex(resultIndex)}
                        onClick={() => onExecute(command)}
                        className={cn(
                          'grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2.5 py-2 text-start outline-none transition-colors motion-reduce:transition-none sm:gap-3 sm:px-3',
                          selected
                            ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-800 ring-1 ring-emerald-500/15 dark:text-emerald-100'
                            : 'border-transparent text-slate-700 hover:bg-emerald-500/7 focus-visible:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/80',
                        )}
                      >
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                          {command.icon}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{command.label}</span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-emerald-100/45">
                            {command.description}
                          </span>
                        </span>
                        {selected && (
                          <span className="hidden items-center gap-1 rounded border border-emerald-500/20 px-1.5 py-1 text-[10px] font-bold text-slate-500 sm:inline-flex dark:text-emerald-100/55">
                            <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
                            Enter
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {!flatResults.length && (
            <div className="grid min-h-48 place-items-center px-5 text-center">
              <div>
                <Search className="mx-auto h-8 w-8 text-emerald-500/45" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold text-slate-700 dark:text-emerald-100/75">{labels.noResults}</p>
              </div>
            </div>
          )}
        </div>

        <div
          role="status"
          aria-live="polite"
          className="border-t border-emerald-500/15 px-4 py-2 text-[11px] text-slate-500 dark:text-emerald-100/45"
        >
          {labels.resultCount(flatResults.length)}
        </div>
      </section>
    </div>,
    document.body,
  );
}
