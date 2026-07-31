import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import type { DashboardNavigationItem } from './DashboardNavigation';
import { useLanguage } from '../../lib/LanguageContext';

type Props = {
  items: DashboardNavigationItem[];
  order: string[];
  onChange: (order: string[]) => void;
};

export function normaliseDesktopRailOrder(order: string[], items: DashboardNavigationItem[]) {
  const allowedIds = new Set(items.map((item) => item.id));
  const saved = order.filter((id, index) => allowedIds.has(id) && order.indexOf(id) === index);
  return [...saved, ...items.map((item) => item.id).filter((id) => !saved.includes(id))];
}

export function DesktopRailOrderSettings({ items, order, onChange }: Props) {
  const { lang } = useLanguage();
  const orderedIds = normaliseDesktopRailOrder(order, items);
  const orderedItems = orderedIds.map((id) => items.find((item) => item.id === id)).filter(Boolean) as DashboardNavigationItem[];
  if (orderedItems.length < 2) return null;

  const text = (english: string, arabic: string) => lang === 'ar' ? arabic : english;
  const move = (index: number, destination: number) => {
    if (destination < 0 || destination >= orderedIds.length || destination === index) return;
    const next = [...orderedIds];
    const [id] = next.splice(index, 1);
    next.splice(destination, 0, id);
    onChange(next);
  };

  return (
    <section className="stanza-preference-surface min-w-0 border border-emerald-500/15 bg-white/75 p-3 dark:border-emerald-500/20 dark:bg-black/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-neutral-800 dark:text-emerald-50">{text('Compact rail order', '\u062a\u0631\u062a\u064a\u0628 \u0627\u0644\u0634\u0631\u064a\u0637 \u0627\u0644\u0645\u062e\u062a\u0635\u0631')}</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-emerald-100/50">{text('Reorder only the modules you can access.', '\u0623\u0639\u062f \u062a\u0631\u062a\u064a\u0628 \u0627\u0644\u0648\u062d\u062f\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u062d\u0629 \u0644\u0643 \u0641\u0642\u0637.')}</p>
        </div>
        <button type="button" onClick={() => onChange([])} className="flex min-h-9 items-center gap-1 rounded-md border border-emerald-500/20 px-2 text-xs font-bold text-emerald-700 outline-none hover:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-300">
          <RotateCcw className="h-3.5 w-3.5" />{text('Reset', '\u0625\u0639\u0627\u062f\u0629')}
        </button>
      </div>
      <ol className="mt-3 space-y-1.5" aria-label={text('Compact rail order', '\u062a\u0631\u062a\u064a\u0628 \u0627\u0644\u0634\u0631\u064a\u0637 \u0627\u0644\u0645\u062e\u062a\u0635\u0631')}>
        {orderedItems.map((item, index) => (
          <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-md border border-emerald-500/10 px-2 py-1.5">
            <span className="text-emerald-600 dark:text-emerald-300">{item.icon}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-neutral-700 dark:text-emerald-50">{item.label}</span>
            <span className="sr-only">{text(`Position ${index + 1} of ${orderedItems.length}`, `\u0627\u0644\u0645\u0648\u0642\u0639 ${index + 1} \u0645\u0646 ${orderedItems.length}`)}</span>
            <button type="button" disabled={index === 0} onClick={() => move(index, index - 1)} aria-label={text(`Move ${item.label} up`, `\u062a\u062d\u0631\u064a\u0643 ${item.label} \u0644\u0623\u0639\u0644\u0649`)} className="grid h-8 w-8 place-items-center rounded text-emerald-700 outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30 dark:text-emerald-300"><ArrowUp className="h-4 w-4" /></button>
            <button type="button" disabled={index === orderedItems.length - 1} onClick={() => move(index, index + 1)} aria-label={text(`Move ${item.label} down`, `\u062a\u062d\u0631\u064a\u0643 ${item.label} \u0644\u0623\u0633\u0641\u0644`)} className="grid h-8 w-8 place-items-center rounded text-emerald-700 outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-30 dark:text-emerald-300"><ArrowDown className="h-4 w-4" /></button>
          </li>
        ))}
      </ol>
    </section>
  );
}
