import { useEffect, useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import type { DashboardNavigationItem } from './DashboardNavigation';
import { MobileShortcutSettings } from './MobileShortcutSettings';
import { useLanguage } from '../../lib/LanguageContext';

type Props = { items: DashboardNavigationItem[]; shortcuts: string[]; onChange: (shortcuts: string[]) => void; onClose: () => void; returnFocusRef: RefObject<HTMLButtonElement | null> };

export function MobileShortcutEditor({ items, shortcuts, onChange, onClose, returnFocusRef }: Props) {
  const { lang, isRtl } = useLanguage();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const text = (english: string, arabic: string) => lang === 'ar' ? arabic : english;
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); } };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); returnFocusRef.current?.focus(); };
  }, [returnFocusRef]);
  return <div className="fixed inset-0 z-40 flex items-end bg-black/45 p-3 pt-[calc(env(safe-area-inset-top)+.75rem)] pb-[calc(env(safe-area-inset-bottom)+.75rem)] md:hidden"><section role="dialog" aria-modal="true" aria-label={text('Mobile shortcuts', '\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a \u0627\u0644\u0647\u0627\u062a\u0641')} dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-xl border border-emerald-500/25 bg-white p-3 shadow-2xl dark:bg-[#061411]"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-black text-slate-900 dark:text-emerald-50">{text('Mobile shortcuts', '\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a \u0627\u0644\u0647\u0627\u062a\u0641')}</h2><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/55">{text('Choose the modules in your bottom bar.', '\u0627\u062e\u062a\u0631 \u0627\u0644\u0648\u062d\u062f\u0627\u062a \u0627\u0644\u0638\u0627\u0647\u0631\u0629 \u0641\u064a \u0627\u0644\u0634\u0631\u064a\u0637 \u0627\u0644\u0633\u0641\u0644\u064a.')}</p></div><button ref={closeRef} type="button" onClick={onClose} aria-label={text('Close mobile shortcuts', '\u0625\u063a\u0644\u0627\u0642 \u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a \u0627\u0644\u0647\u0627\u062a\u0641')} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100"><X className="h-5 w-5" /></button></div><div className="stanza-scrollbar mt-3 min-h-0 max-h-[calc(100dvh-9.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain"><MobileShortcutSettings items={items} shortcuts={shortcuts} onChange={onChange} /></div><button type="button" onClick={onClose} className="mt-3 min-h-11 w-full shrink-0 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-[#020604] outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">{text('Done', '\u062a\u0645')}</button></section></div>;
}
