import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import type { DashboardNavigationItem } from './DashboardNavigation';
import { useLanguage } from '../../lib/LanguageContext';

type Props = {
  items: DashboardNavigationItem[];
  shortcuts: string[];
  onChange: (shortcuts: string[]) => void;
};

const recommended = ['geofence', 'roster', 'feed', 'profile'];

export function MobileShortcutSettings({ items, shortcuts, onChange }: Props) {
  const { lang } = useLanguage();
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

  const toggle = useCallback((id: string) => {
    if (selectedSet.has(id)) {
      if (selected.length <= 4) return;
      onChange(selected.filter((value) => value !== id));
      return;
    }
    onChange([...selected, id]);
  }, [onChange, selected, selectedSet]);

  const move = useCallback((index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }, [onChange, selected]);

  return (
    <section className="rounded-xl border border-emerald-500/15 bg-black/5 p-3 dark:bg-black/20">
      <div>
        <h4 className="text-sm font-black">
          {text('Mobile shortcuts', '\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a \u0627\u0644\u0647\u0627\u062a\u0641')}
        </h4>
        <p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/55">
          {text(
            'Choose at least four shortcuts. Stanza and customise remain fixed.',
            '\u0627\u062e\u062a\u0631 \u0623\u0631\u0628\u0639\u0629 \u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644.',
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

      <div className="mt-3">
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

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <h5 className="text-xs font-black text-slate-600 dark:text-emerald-100/70">
            {text('Shortcut order', '\u062a\u0631\u062a\u064a\u0628 \u0627\u0644\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a')}
          </h5>
          <span aria-live="polite" className="text-[11px] text-slate-500 dark:text-emerald-100/50">
            {text(`${selected.length} selected`, `${selected.length} \u0645\u062d\u062f\u062f`)}
          </span>
        </div>
        <ol
          data-mobile-shortcut-order
          className="stanza-scrollbar mt-2 max-h-56 space-y-2 overflow-y-auto overscroll-contain pe-1"
        >
          {selectedItems.map((item, index) => (
            <li
              key={item.id}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-emerald-500/10 px-2"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-xs font-black text-emerald-700 dark:text-emerald-200">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-bold">{item.label}</span>
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); move(index, -1); }}
                disabled={index === 0}
                aria-label={text(`Move ${item.label} up`, `\u0646\u0642\u0644 ${item.label} \u0644\u0623\u0639\u0644\u0649`)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); move(index, 1); }}
                disabled={index === selected.length - 1}
                aria-label={text(`Move ${item.label} down`, `\u0646\u0642\u0644 ${item.label} \u0644\u0623\u0633\u0641\u0644`)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(recommended.filter((id) => itemById.has(id)))}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {text('Reset to recommended', '\u0625\u0639\u0627\u062f\u0629 \u0625\u0644\u0649 \u0627\u0644\u0645\u0642\u062a\u0631\u062d')}
        </button>
        <button
          type="button"
          onClick={() => onChange(items.map((item) => item.id))}
          className="min-h-10 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold"
        >
          {text('Add all', '\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0643\u0644')}
        </button>
      </div>
    </section>
  );
}
