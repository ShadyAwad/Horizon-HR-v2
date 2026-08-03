import { ChevronsDown, ChevronsUp, ChevronDown, ChevronUp, GripVertical, RotateCcw } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { DashboardNavigationItem } from './DashboardNavigation';
import { moveShortcutPosition, swapShortcutPositions, type ShortcutMove, useLongPressShortcutSwap } from './mobile-shortcut-order';
import { useLanguage } from '../../lib/LanguageContext';

type Props = {
  items: DashboardNavigationItem[];
  shortcuts: string[];
  onChange: (shortcuts: string[]) => void;
};

const recommended = ['geofence', 'roster', 'feed', 'profile'];

export function MobileShortcutSettings({ items, shortcuts, onChange }: Props) {
  const { lang } = useLanguage();
  const [announcement, setAnnouncement] = useState('');
  const text = (english: string, arabic: string) => lang === 'ar' ? arabic : english;
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selected = useMemo(() => {
    const valid = shortcuts.filter((id, index) => itemById.has(id) && shortcuts.indexOf(id) === index);
    if (valid.length >= 4) return valid;

    const next = [...valid];
    for (const id of recommended) {
      if (next.length >= 4) break;
      if (itemById.has(id) && !next.includes(id)) next.push(id);
    }
    for (const item of items) {
      if (next.length >= 4) break;
      if (!next.includes(item.id)) next.push(item.id);
    }
    return next;
  }, [itemById, items, shortcuts]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedItems = useMemo(
    () => selected.map((id) => itemById.get(id)).filter(Boolean) as DashboardNavigationItem[],
    [itemById, selected],
  );
  const orderListRef = useRef<HTMLOListElement>(null);

  const toggle = useCallback((id: string) => {
    if (selectedSet.has(id)) {
      if (selected.length <= 4) return;
      onChange(selected.filter((value) => value !== id));
      return;
    }
    onChange([...selected, id]);
  }, [onChange, selected, selectedSet]);

  const announcePosition = useCallback((id: string, next: string[]) => {
    const item = itemById.get(id);
    const position = next.indexOf(id) + 1;
    if (!item || position < 1) return;
    setAnnouncement(text(
      `${item.label} moved to position ${position} of ${next.length}.`,
      `\u062a\u0645 \u0646\u0642\u0644 ${item.label} \u0625\u0644\u0649 \u0627\u0644\u0645\u0648\u0636\u0639 ${position} \u0645\u0646 ${next.length}.`,
    ));
  }, [itemById, lang]);

  const move = useCallback((id: string, destination: ShortcutMove) => {
    const next = moveShortcutPosition(selected, id, destination);
    if (next.every((value, index) => value === selected[index])) return;
    onChange(next);
    announcePosition(id, next);
  }, [announcePosition, onChange, selected]);
  const swap = useCallback((sourceId: string, targetId: string) => {
    const next = swapShortcutPositions(selected, sourceId, targetId);
    if (next.every((value, index) => value === selected[index])) return;
    onChange(next);
    announcePosition(sourceId, next);
  }, [announcePosition, onChange, selected]);
  const drag = useLongPressShortcutSwap({
    attribute: 'data-mobile-shortcut-order-id',
    onSwap: swap,
    scrollContainerRef: orderListRef,
  });
  const activateMove = (event: React.MouseEvent<HTMLButtonElement>, id: string, destination: ShortcutMove) => {
    event.preventDefault();
    event.stopPropagation();
    move(id, destination);
  };

  return (
    <section className="flex flex-col rounded-xl border border-emerald-500/15 bg-black/5 p-3 dark:bg-black/20">
      <div>
        <h4 className="text-sm font-black">
          {text('Mobile shortcuts', '\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a \u0627\u0644\u0647\u0627\u062a\u0641')}
        </h4>
        <p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/55">
          {text(
            'Choose at least four shortcuts. Stanza and customise remain fixed.',
            '\u0627\u062e\u062a\u0631 \u0623\u0631\u0628\u0639\u0629 \u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644. \u064a\u0628\u0642\u0649 \u0632\u0631 Stanza \u0648\u062e\u064a\u0627\u0631 \u0627\u0644\u062a\u062e\u0635\u064a\u0635 \u062b\u0627\u0628\u062a\u064a\u0646.',
          )}
        </p>
      </div>

      {selected.length > 5 && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-100"
        >
          {text(
            'Adding more shortcuts may make navigation crowded on smaller screens.',
            '\u0642\u062f \u062a\u0624\u062f\u064a \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0632\u064a\u062f \u0645\u0646 \u0627\u0644\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a \u0625\u0644\u0649 \u0627\u0632\u062f\u062d\u0627\u0645 \u0627\u0644\u062a\u0646\u0642\u0644.',
          )}
        </p>
      )}

      <div className="order-2 mt-4">
        <h5 className="text-xs font-black text-slate-600 dark:text-emerald-100/70">
          {text('Available shortcuts', '\u0627\u0644\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u062d\u0629')}
        </h5>
        <div
          data-mobile-shortcut-options
          className="stanza-scrollbar mt-2 max-h-[min(34dvh,18rem)] space-y-2 overflow-y-auto overscroll-contain pe-1"
        >
          {items.map((item) => {
            const checked = selectedSet.has(item.id);
            return (
              <label
                key={item.id}
                htmlFor={`shortcut-${item.id}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-emerald-500/10 px-3 outline-none transition-colors hover:bg-emerald-500/5 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-400"
              >
                <input
                  id={`shortcut-${item.id}`}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.id)}
                  disabled={checked && selected.length <= 4}
                  className="h-5 w-5 shrink-0 accent-emerald-600"
                />
                <span className="min-w-0 flex-1 text-xs font-bold">{item.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="order-1 mt-3">
        <div className="flex items-center justify-between gap-3">
          <h5 className="text-xs font-black text-slate-600 dark:text-emerald-100/70">
            {text('Shortcut order', '\u062a\u0631\u062a\u064a\u0628 \u0627\u0644\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a')}
          </h5>
          <span aria-live="polite" className="text-[11px] text-slate-500 dark:text-emerald-100/50">
            {text(`${selected.length} selected`, `${selected.length} \u0645\u062d\u062f\u062f`)}
          </span>
        </div>
        <ol
          ref={orderListRef}
          data-mobile-shortcut-order
          className="stanza-scrollbar mt-2 max-h-[min(30dvh,15rem)] space-y-2 overflow-y-auto overscroll-contain pe-1"
        >
          {selectedItems.map((item, index) => (
            <li
              key={item.id}
              data-mobile-shortcut-order-id={item.id}
              className={`flex min-h-11 items-center gap-1 rounded-lg border px-1.5 transition-[background-color,border-color,opacity,transform] duration-150 motion-reduce:transition-none ${drag.targetId === item.id && drag.draggedId !== item.id ? 'border-emerald-400 bg-emerald-500/15 ring-2 ring-emerald-400/50' : 'border-emerald-500/10'} ${drag.draggedId === item.id ? 'border-dashed opacity-55' : ''}`}
            >
              <button
                type="button"
                {...drag.bind(item.id)}
                onClick={(event) => { event.preventDefault(); event.stopPropagation(); drag.consumeSuppressedClick(); }}
                aria-label={text(`Reorder ${item.label}`, `\u0625\u0639\u0627\u062f\u0629 \u062a\u0631\u062a\u064a\u0628 ${item.label}`)}
                aria-pressed={drag.draggedId === item.id}
                className="grid h-11 w-10 shrink-0 touch-none place-items-center rounded-lg text-slate-400 outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/45"
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-xs font-black text-emerald-700 dark:text-emerald-200">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-bold">{item.label}</span>
              <button
                type="button"
                onClick={(event) => activateMove(event, item.id, 'start')}
                disabled={index === 0}
                aria-label={text(`Move ${item.label} to start`, `\u0646\u0642\u0644 ${item.label} \u0625\u0644\u0649 \u0627\u0644\u0628\u062f\u0627\u064a\u0629`)}
                className="grid h-10 w-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"
              >
                <ChevronsUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(event) => activateMove(event, item.id, 'up')}
                disabled={index === 0}
                aria-label={text(`Move ${item.label} up`, `\u0646\u0642\u0644 ${item.label} \u0644\u0623\u0639\u0644\u0649`)}
                className="grid h-10 w-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(event) => activateMove(event, item.id, 'down')}
                disabled={index === selected.length - 1}
                aria-label={text(`Move ${item.label} down`, `\u0646\u0642\u0644 ${item.label} \u0644\u0623\u0633\u0641\u0644`)}
                className="grid h-10 w-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(event) => activateMove(event, item.id, 'end')}
                disabled={index === selected.length - 1}
                aria-label={text(`Move ${item.label} to end`, `\u0646\u0642\u0644 ${item.label} \u0625\u0644\u0649 \u0627\u0644\u0646\u0647\u0627\u064a\u0629`)}
                className="grid h-10 w-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"
              >
                <ChevronsDown className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      </div>

      <div className="order-3 mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(recommended.filter((id) => itemById.has(id)))}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {text('Reset to recommended', '\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u062a\u0639\u064a\u064a\u0646 \u0625\u0644\u0649 \u0627\u0644\u062a\u0631\u062a\u064a\u0628 \u0627\u0644\u0645\u0642\u062a\u0631\u062d')}
        </button>
        <button
          type="button"
          onClick={() => onChange(items.map((item) => item.id))}
          className="min-h-10 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold"
        >
          {text('Add all', '\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0643\u0644')}
        </button>
      </div>
      {drag.draggedId && drag.previewPoint && (() => {
        const item = itemById.get(drag.draggedId);
        if (!item) return null;
        return <div
          aria-hidden="true"
          data-mobile-shortcut-drag-preview
          className="pointer-events-none fixed z-[60] flex min-h-11 max-w-[min(18rem,calc(100vw-2rem))] items-center gap-2 rounded-lg border border-emerald-300/60 bg-[#082a1e] px-3 text-xs font-bold text-emerald-50 shadow-xl shadow-black/35"
          style={{ left: drag.previewPoint.x, top: drag.previewPoint.y - (drag.previewPoint.touch ? 48 : 18), transform: 'translate(-50%, -100%)' }}
        >
          <GripVertical className="h-4 w-4 shrink-0 text-emerald-200" />
          <span className="truncate">{item.label}</span>
        </div>;
      })()}
    </section>
  );
}
