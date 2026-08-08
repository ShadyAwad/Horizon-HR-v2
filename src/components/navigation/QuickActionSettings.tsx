import {
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  GripVertical,
  RotateCcw,
  X,
} from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { useLanguage } from '../../lib/LanguageContext';
import type { StanzaCommand } from '../command-palette/command-palette-types';
import {
  MAX_PINNED_QUICK_ACTIONS,
  getPinnableCommands,
} from '../command-palette/pinned-quick-actions';
import {
  moveShortcutPosition,
  swapShortcutPositions,
  type ShortcutMove,
  useLongPressShortcutSwap,
} from './mobile-shortcut-order';

type Props = {
  commands: readonly StanzaCommand[];
  selectedIds: readonly string[];
  onChange: (commandIds: string[]) => void;
  onReset: () => void;
};

export function QuickActionSettings({ commands, selectedIds, onChange, onReset }: Props) {
  const { lang } = useLanguage();
  const [announcement, setAnnouncement] = useState('');
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const text = (english: string, arabic: string) => lang === 'ar' ? arabic : english;
  const pinnableCommands = useMemo(() => getPinnableCommands(commands), [commands]);
  const commandById = useMemo(
    () => new globalThis.Map(pinnableCommands.map((command) => [command.id, command])),
    [pinnableCommands],
  );
  const selected = useMemo(
    () => selectedIds.filter((id, index) => commandById.has(id) && selectedIds.indexOf(id) === index).slice(0, MAX_PINNED_QUICK_ACTIONS),
    [commandById, selectedIds],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedCommands = useMemo(
    () => selected.map((id) => commandById.get(id)).filter(Boolean) as StanzaCommand[],
    [commandById, selected],
  );

  const announcePosition = useCallback((commandId: string, next: string[]) => {
    const command = commandById.get(commandId);
    const position = next.indexOf(commandId) + 1;
    if (!command || position < 1) return;
    setAnnouncement(text(
      `${command.label} moved to position ${position} of ${next.length}.`,
      `تم نقل ${command.label} إلى الموضع ${position} من ${next.length}.`,
    ));
  }, [commandById, lang]);
  const move = useCallback((commandId: string, destination: ShortcutMove) => {
    const next = moveShortcutPosition(selected, commandId, destination);
    if (next.every((value, index) => value === selected[index])) return;
    onChange(next);
    announcePosition(commandId, next);
  }, [announcePosition, onChange, selected]);
  const swap = useCallback((sourceId: string, targetId: string) => {
    const next = swapShortcutPositions(selected, sourceId, targetId);
    if (next.every((value, index) => value === selected[index])) return;
    onChange(next);
    announcePosition(sourceId, next);
  }, [announcePosition, onChange, selected]);
  const drag = useLongPressShortcutSwap({ attribute: 'data-quick-action-order-id', onSwap: swap });
  const activateMove = (event: React.MouseEvent<HTMLButtonElement>, commandId: string, destination: ShortcutMove) => {
    event.preventDefault();
    event.stopPropagation();
    move(commandId, destination);
  };
  const toggle = (commandId: string) => {
    if (selectedSet.has(commandId)) {
      onChange(selected.filter((id) => id !== commandId));
      return;
    }
    if (selected.length >= MAX_PINNED_QUICK_ACTIONS) return;
    onChange([...selected, commandId]);
  };

  if (pinnableCommands.length === 0) return null;

  return (
    <section className="stanza-preference-surface min-w-0 border border-emerald-500/15 bg-white/75 p-3 dark:border-emerald-500/20 dark:bg-black/40">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full flex-wrap items-start justify-between gap-3 rounded-lg text-start outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <div className="min-w-0">
          <p className="text-sm font-bold text-neutral-800 dark:text-emerald-50">{text('Quick Actions', 'الإجراءات السريعة')}</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-emerald-100/50">
            {text('Pin up to six workflows for faster access.', 'ثبّت ما يصل إلى ستة إجراءات للوصول إليها بسرعة.')}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
          {text(`${selected.length} pinned`, `${selected.length} مثبّت`)}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-emerald-500 transition-transform duration-200 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      <div id={contentId} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${expanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
      <div className="min-h-0 overflow-hidden">
      {selected.length >= MAX_PINNED_QUICK_ACTIONS && (
        <p role="status" className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-100">
          {text('You can pin up to six quick actions.', 'يمكنك تثبيت ما يصل إلى ستة إجراءات سريعة.')}
        </p>
      )}

      <div className="mt-3">
        <p className="text-xs font-black text-slate-600 dark:text-emerald-100/70">{text('Available actions', 'الإجراءات المتاحة')}</p>
        <div className="stanza-scrollbar mt-2 max-h-56 space-y-2 overflow-y-auto overscroll-contain pe-1">
          {pinnableCommands.map((command) => {
            const checked = selectedSet.has(command.id);
            return (
              <label key={command.id} htmlFor={`quick-action-${command.id}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-emerald-500/10 px-3 outline-none transition-colors hover:bg-emerald-500/5 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-400 motion-reduce:transition-none">
                <input id={`quick-action-${command.id}`} type="checkbox" checked={checked} onChange={() => toggle(command.id)} disabled={!checked && selected.length >= MAX_PINNED_QUICK_ACTIONS} className="h-5 w-5 shrink-0 accent-emerald-600" />
                <span className="shrink-0 text-emerald-700 dark:text-emerald-300">{command.icon}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-bold">{command.label}</span>
                {checked && <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{text('Pinned', 'مثبّت')}</span>}
              </label>
            );
          })}
        </div>
      </div>

      {selectedCommands.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-black text-slate-600 dark:text-emerald-100/70">{text('Pinned order', 'ترتيب الإجراءات المثبّتة')}</p>
          <ol className="stanza-scrollbar mt-2 max-h-56 space-y-2 overflow-y-auto overscroll-contain pe-1">
            {selectedCommands.map((command, index) => (
              <li key={command.id} data-quick-action-order-id={command.id} className={`flex min-h-11 items-center gap-1 rounded-lg border px-1.5 transition-colors ${drag.targetId === command.id && drag.draggedId !== command.id ? 'border-emerald-400 bg-emerald-500/15 ring-2 ring-emerald-400/50' : 'border-emerald-500/10'} ${drag.draggedId === command.id ? 'opacity-55' : ''}`}>
                <button type="button" {...drag.bind(command.id)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); drag.consumeSuppressedClick(); }} aria-label={text(`Long press to drag ${command.label}`, `اضغط مطولاً لسحب ${command.label}`)} className="grid h-10 w-8 shrink-0 touch-none place-items-center rounded-lg text-slate-400 outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/45"><GripVertical className="h-4 w-4" /></button>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-xs font-black text-emerald-700 dark:text-emerald-200">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-bold">{command.label}</span>
                <button type="button" onClick={(event) => activateMove(event, command.id, 'start')} disabled={index === 0} aria-label={text(`Move ${command.label} to start`, `نقل ${command.label} إلى البداية`)} className="grid h-10 w-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"><ChevronsUp className="h-4 w-4" /></button>
                <button type="button" onClick={(event) => activateMove(event, command.id, 'up')} disabled={index === 0} aria-label={text(`Move ${command.label} up`, `نقل ${command.label} لأعلى`)} className="grid h-10 w-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                <button type="button" onClick={(event) => activateMove(event, command.id, 'down')} disabled={index === selectedCommands.length - 1} aria-label={text(`Move ${command.label} down`, `نقل ${command.label} لأسفل`)} className="grid h-10 w-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                <button type="button" onClick={(event) => activateMove(event, command.id, 'end')} disabled={index === selectedCommands.length - 1} aria-label={text(`Move ${command.label} to end`, `نقل ${command.label} إلى النهاية`)} className="grid h-10 w-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"><ChevronsDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => onChange(selected.filter((id) => id !== command.id))} aria-label={text(`Unpin ${command.label}`, `إلغاء تثبيت ${command.label}`)} className="grid h-10 w-8 shrink-0 place-items-center rounded-lg text-slate-500 outline-none hover:bg-red-500/10 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/60 dark:hover:text-red-200"><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onReset} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold text-emerald-700 outline-none hover:border-emerald-400 hover:bg-emerald-500/5 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-300"><RotateCcw className="h-3.5 w-3.5" />{text('Reset to recommended', 'إعادة التعيين إلى المقترحة')}</button>
        <button type="button" onClick={() => onChange([])} disabled={selected.length === 0} className="min-h-10 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold text-slate-700 outline-none hover:border-emerald-400 hover:bg-emerald-500/5 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-35 dark:text-emerald-100/80">{text('Clear pinned actions', 'مسح الإجراءات المثبّتة')}</button>
      </div>
      </div>
      </div>
    </section>
  );
}
