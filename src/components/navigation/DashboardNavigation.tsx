import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { LogOut, Menu, Plus, Search, Settings, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../lib/LanguageContext';
import { StanzaFingerprintMark } from '../StanzaFingerprintMark';
import { AttentionBadge } from '../AttentionBadge';

export type DashboardNavigationItem = {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  badge?: number;
  active: boolean;
  onSelect: () => void;
};

type Props = {
  items: DashboardNavigationItem[];
  desktopMode?: 'launcher' | 'rail';
  railOrder?: string[];
  onRailOrderChange?: (order: string[]) => void;
  mobileShortcuts: string[];
  onShortcutsChange: (value: string[]) => void;
  onOpenMobileShortcutEditor: () => void;
  mobileShortcutEditorTriggerRef: RefObject<HTMLButtonElement | null>;
  onOpenCommandPalette: (returnFocusTarget?: HTMLElement | null) => void;
  onOpenControlCenter: () => void;
  onOpenChange?: (open: boolean) => void;
  showLanyardDock?: boolean;
  onLogout: () => void;
  userName: string;
  userEmail: string;
  lanyardSlot?: ReactNode;
};

const recommended = ['geofence', 'roster', 'feed', 'profile'];

function itemButton(item: DashboardNavigationItem, className: string, onSelect: () => void) {
  return <button key={item.id} type="button" onClick={onSelect} aria-current={item.active ? 'page' : undefined} aria-label={item.badge ? `${item.label}: ${item.badge} action items` : item.label} title={item.label} className={cn(className, item.active ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-200' : 'border-transparent text-slate-500 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-100/65 dark:hover:text-emerald-100')}><span className="relative">{item.icon}{item.badge ? <AttentionBadge count={item.badge} ariaLabel={`${item.label}: ${item.badge} action items`} className="absolute -end-2 -top-2" /> : null}</span></button>;
}

export function DashboardNavigation({ items, desktopMode = 'launcher', railOrder = [], onRailOrderChange, mobileShortcuts, onShortcutsChange, onOpenMobileShortcutEditor, mobileShortcutEditorTriggerRef, onOpenCommandPalette, onOpenControlCenter, onOpenChange, showLanyardDock = false, onLogout, userName, userEmail, lanyardSlot }: Props) {
  const { isRtl, lang, t } = useLanguage();
  const text = (english: string, arabic: string) => lang === 'ar' ? arabic : english;
  const [open, setOpen] = useState(false);
  const [draggedRailId, setDraggedRailId] = useState<string | null>(null);
  const [draggedShortcutId, setDraggedShortcutId] = useState<string | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null); const panelRef = useRef<HTMLDivElement>(null);
  const suppressRailClickRef = useRef(false);
  const suppressShortcutClickRef = useRef(false);
  const shortcutHoldRef = useRef<number | null>(null);
  const allowedIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const validShortcuts = useMemo(() => {
    const valid = mobileShortcuts.filter((id, index, value) => allowedIds.has(id) && value.indexOf(id) === index);
    const fallback = recommended.filter((id) => allowedIds.has(id));
    for (const item of items) if (valid.length < 4 && !valid.includes(item.id)) valid.push(item.id);
    return (valid.length >= 4 ? valid : fallback).slice(0, 20);
  }, [allowedIds, items, mobileShortcuts]);
  useEffect(() => { if (validShortcuts.join('|') !== mobileShortcuts.join('|')) onShortcutsChange(validShortcuts); }, [mobileShortcuts, onShortcutsChange, validShortcuts]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (open && !panelRef.current?.contains(event.target as Node) && !launcherRef.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && open) { setOpen(false); launcherRef.current?.focus(); } };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); };
  }, [open]);
  useEffect(() => { onOpenChange?.(open); }, [onOpenChange, open]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  const choose = (item: DashboardNavigationItem) => { item.onSelect(); setOpen(false); launcherRef.current?.focus(); };
  const groups = [...new Set(items.map((item) => item.group))];
  const shortcutItems = validShortcuts.map((id) => items.find((item) => item.id === id)).filter(Boolean) as DashboardNavigationItem[];
  const orderedRailItems = useMemo(() => {
    const saved = railOrder.filter((id, index) => allowedIds.has(id) && railOrder.indexOf(id) === index);
    return [...saved, ...items.map((item) => item.id).filter((id) => !saved.includes(id))]
      .map((id) => items.find((item) => item.id === id))
      .filter(Boolean) as DashboardNavigationItem[];
  }, [allowedIds, items, railOrder]);
  const reorderRail = (sourceId: string, destinationId: string) => {
    if (!onRailOrderChange || sourceId === destinationId) return;
    const ids = orderedRailItems.map((item) => item.id);
    const source = ids.indexOf(sourceId); const destination = ids.indexOf(destinationId);
    if (source < 0 || destination < 0) return;
    const next = [...ids]; const [moved] = next.splice(source, 1); next.splice(destination, 0, moved);
    onRailOrderChange(next);
  };
  const clearShortcutHold = () => { if (shortcutHoldRef.current !== null) window.clearTimeout(shortcutHoldRef.current); shortcutHoldRef.current = null; };
  const swapShortcuts = (sourceId: string, destinationId: string) => {
    if (sourceId === destinationId) return;
    const source = validShortcuts.indexOf(sourceId); const destination = validShortcuts.indexOf(destinationId);
    if (source < 0 || destination < 0) return;
    const next = [...validShortcuts]; [next[source], next[destination]] = [next[destination], next[source]]; onShortcutsChange(next);
  };
  return <>
    <aside className={cn(
      'fixed inset-x-3 bottom-[calc(.75rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-1 rounded-2xl border border-emerald-500/15 bg-white/95 p-2 shadow-xl backdrop-blur-[6px] dark:bg-[#061411]/95',
      desktopMode === 'rail'
        ? 'md:static md:inset-auto md:z-20 md:m-3 md:flex-col md:self-start md:p-2'
        : 'md:fixed md:start-3 md:top-3 md:bottom-auto md:inset-x-auto md:z-20 md:m-0 md:flex-row md:self-auto',
      isRtl && desktopMode === 'rail' ? 'md:order-last' : '',
    )}>
      <div data-stanza-lanyard-anchor className="relative shrink-0">
        <button ref={launcherRef} id="stanza-control-center-trigger" type="button" aria-label={text('Open Stanza navigation', 'فتح تنقل Stanza')} title={text('Open Stanza navigation', 'فتح تنقل Stanza')} aria-expanded={open} aria-controls="stanza-navigation-panel" onClick={() => setOpen((value) => !value)} className={cn('relative flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-300/45 bg-emerald-500 text-[#020604] shadow-[0_0_18px_rgba(16,185,129,.24)] transition-[transform,box-shadow,background-color,border-color] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-px hover:scale-[1.015] hover:shadow-[0_0_22px_rgba(16,185,129,.30)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 active:translate-y-0 active:scale-[.97] active:duration-100 motion-reduce:transform-none motion-reduce:transition-none', open && 'scale-[1.025] border-emerald-100/80 bg-emerald-400 shadow-[0_0_24px_rgba(16,185,129,.34)]')}><StanzaFingerprintMark size={24} /></button>
        {showLanyardDock && !open && <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-full hidden h-7 w-px -translate-x-1/2 bg-gradient-to-b from-emerald-400/75 via-emerald-500/40 to-transparent md:block"><span className="absolute -bottom-0.5 -left-1 h-2 w-2 rounded-full border border-emerald-300/60 bg-emerald-500/50" /></span>}
      </div>
      {desktopMode === 'rail' && <nav aria-label={text('Quick navigation', 'التنقل السريع')} className="hidden w-full flex-1 flex-col items-center gap-1 md:flex">{orderedRailItems.map((item) => <button key={item.id} type="button" draggable={Boolean(onRailOrderChange)} onDragStart={(event) => { setDraggedRailId(item.id); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={(event) => { if (draggedRailId) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (draggedRailId) reorderRail(draggedRailId, item.id); suppressRailClickRef.current = true; setDraggedRailId(null); }} onDragEnd={() => { if (draggedRailId) suppressRailClickRef.current = true; setDraggedRailId(null); }} onClick={() => { if (suppressRailClickRef.current) { suppressRailClickRef.current = false; return; } choose(item); }} aria-current={item.active ? 'page' : undefined} aria-label={item.badge ? `${item.label}: ${item.badge} action items` : item.label} title={item.label} className={cn('flex h-10 w-10 items-center justify-center rounded-lg border transition duration-150 motion-reduce:transition-none', draggedRailId === item.id && 'scale-95 opacity-45', item.active ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-200' : 'border-transparent text-slate-500 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-100/65 dark:hover:text-emerald-100')}><span className="relative pointer-events-none">{item.icon}{item.badge ? <AttentionBadge count={item.badge} ariaLabel={`${item.label}: ${item.badge} action items`} className="absolute -end-2 -top-2" /> : null}</span></button>)}</nav>}
      {desktopMode === 'rail' && <button type="button" onClick={onOpenControlCenter} aria-label={text('Settings', 'الإعدادات')} title={text('Settings', 'الإعدادات')} className="hidden h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-emerald-500/10 dark:text-emerald-100/65 md:flex"><Settings className="h-5 w-5" /></button>}
      <div className="stanza-mobile-shortcuts flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain md:hidden">{shortcutItems.map((item) => <button key={item.id} data-mobile-shortcut-id={item.id} type="button" onPointerDown={(event) => { if (event.pointerType === 'mouse') return; clearShortcutHold(); shortcutHoldRef.current = window.setTimeout(() => { setDraggedShortcutId(item.id); suppressShortcutClickRef.current = true; }, 350); }} onPointerMove={(event) => { if (!draggedShortcutId) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-mobile-shortcut-id]')?.dataset.mobileShortcutId; if (target) swapShortcuts(draggedShortcutId, target); }} onPointerUp={() => { clearShortcutHold(); setDraggedShortcutId(null); }} onPointerCancel={() => { clearShortcutHold(); setDraggedShortcutId(null); }} onClick={() => { if (suppressShortcutClickRef.current) { suppressShortcutClickRef.current = false; return; } choose(item); }} aria-current={item.active ? 'page' : undefined} aria-label={item.badge ? `${item.label}: ${item.badge} action items` : item.label} title={item.label} className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition duration-150 motion-reduce:transition-none', draggedShortcutId === item.id && 'scale-95 opacity-50 ring-2 ring-emerald-400', item.active ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-200' : 'border-transparent text-slate-500 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-100/65 dark:hover:text-emerald-100')}><span className="relative pointer-events-none">{item.icon}{item.badge ? <AttentionBadge count={item.badge} ariaLabel={`${item.label}: ${item.badge} action items`} className="absolute -end-2 -top-2" /> : null}</span></button>)}</div>
      <button ref={mobileShortcutEditorTriggerRef} type="button" onClick={onOpenMobileShortcutEditor} aria-label={text('Customise shortcuts', '\u062a\u062e\u0635\u064a\u0635 \u0627\u0644\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a')} title={text('Customise shortcuts', '\u062a\u062e\u0635\u064a\u0635 \u0627\u0644\u0627\u062e\u062a\u0635\u0627\u0631\u0627\u062a')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-emerald-500/10 dark:text-emerald-100/65 md:hidden"><Plus className="h-5 w-5" /></button>
    </aside>
    {open && <div id="stanza-navigation-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={text('Stanza navigation', 'تنقل Stanza')} className={cn('fixed z-30 w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-emerald-500/20 bg-white/98 shadow-2xl transition duration-200 ease-out motion-reduce:transition-none dark:bg-[#061411]/98 md:start-[5.5rem] md:top-4', 'inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] max-h-[76dvh] md:inset-x-auto md:bottom-auto md:max-h-[calc(100dvh-2rem)]')}>
      <div className="border-b border-emerald-500/15 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-base font-black tracking-normal text-slate-900 dark:text-emerald-50">{lang === 'ar' ? <span>Stanza</span> : <><span className="text-emerald-600 dark:text-emerald-400">S</span><span>tanza</span></>}</p><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/55">{userName}</p><p className="text-xs text-slate-500 dark:text-emerald-100/45">{userEmail}</p></div><button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-emerald-500/10" aria-label={text('Close navigation', 'إغلاق التنقل')}><X className="h-4 w-4" /></button></div>{lanyardSlot && <div className="mt-3 h-16 overflow-hidden rounded-lg border border-emerald-500/15">{lanyardSlot}</div>}<button type="button" onClick={() => { setOpen(false); onOpenCommandPalette(launcherRef.current); }} className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-lg border border-emerald-500/20 px-3 py-2 text-start text-slate-500 outline-none hover:bg-emerald-500/5 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/55" aria-label={text('Search Stanza', 'البحث في Stanza')}><Search className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 text-sm">{text('Search Stanza...', 'البحث في Stanza...')}</span><kbd className="hidden rounded border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold sm:inline">Ctrl K</kbd></button></div>
      <nav className="stanza-scrollbar max-h-[48dvh] overflow-y-auto p-2" aria-label={text('All authorised modules', 'كل الوحدات المصرح بها')}>{groups.map((group) => <section key={group} className="mb-3"><h2 className="px-2 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-emerald-100/45">{t(`nav.group.${group}` as never)}</h2>{items.filter((item) => item.group === group).map((item) => <button key={item.id} type="button" onClick={() => choose(item)} aria-current={item.active ? 'page' : undefined} className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-sm font-bold transition', item.active ? 'bg-emerald-500/12 font-extrabold tracking-normal text-emerald-700 dark:text-emerald-200' : 'text-slate-700 hover:bg-emerald-500/10 dark:text-emerald-100/75')}><span className="relative">{item.icon}{item.badge ? <AttentionBadge count={item.badge} ariaLabel={`${item.label}: ${item.badge} action items`} className="absolute -end-2 -top-2" /> : null}</span><span className="flex-1">{item.label}</span></button>)}</section>)}</nav>
      <div className="flex gap-2 border-t border-emerald-500/15 p-3"><button type="button" onClick={() => { setOpen(false); onOpenControlCenter(); }} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-500/20 text-xs font-bold"><Settings className="h-4 w-4" />{text('Settings', 'الإعدادات')}</button><button type="button" onClick={onLogout} className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-500/25 px-3 text-xs font-bold text-red-700 dark:text-red-200"><LogOut className={cn('h-4 w-4', isRtl && '-scale-x-100')} />{text('Logout', 'تسجيل الخروج')}</button></div>
    </div>}
  </>;
}
