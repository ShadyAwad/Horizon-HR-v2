import {useLayoutEffect, useRef} from 'react';
import { useLanguage } from '../lib/LanguageContext';
import { StanzaFingerprintLoader } from './StanzaFingerprintLoader';

export type AuthTransition =
  | 'opening-signup'
  | 'returning-login'
  | 'logging-in'
  | 'logging-out'
  | 'creating-workspace';

const transitionMessageKeys = {
  'opening-signup': 'authTransition.preparingSignup',
  'returning-login': 'authTransition.returningLogin',
  'logging-in': 'authTransition.openingWorkspace',
  'logging-out': 'authTransition.signingOut',
  'creating-workspace': 'authTransition.creatingWorkspace',
} as const;

export function AuthTransitionLoader({ transition, overlay = false, contained = false }: { transition: AuthTransition; overlay?: boolean; contained?: boolean }) {
  const { t, isRtl } = useLanguage();
  const state = transition === 'logging-in' ? 'success' : 'loading';

  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (transition !== 'logging-in') return;
    const mark = root.current?.querySelector<HTMLElement>('.stanza-fingerprint-loader');
    if (!mark) return;
    return () => {
      const start = mark.getBoundingClientRect();
      if (!start.width) return;
      const panel = mark.parentElement;
      const panelRect = panel?.getBoundingClientRect();
      const backdrop = root.current?.cloneNode(true) as HTMLElement | undefined;
      const presenter = mark.cloneNode(true) as HTMLElement;
      presenter.setAttribute('aria-hidden', 'true');
      presenter.style.cssText = `position:fixed;pointer-events:none;z-index:81;margin:0;left:${start.x}px;top:${start.y}px;width:${start.width}px;height:${start.height}px;transform-origin:0 0`;
      const paint = getComputedStyle(mark);
      presenter.style.background = paint.background;
      presenter.style.color = paint.color;
      presenter.style.animation = 'none';
      requestAnimationFrame(() => {
        const anchor = document.querySelector<HTMLElement>('#stanza-control-center-trigger');
        const app = document.querySelector<HTMLElement>('.stanza-dashboard');
        // StrictMode and nested Suspense fallbacks can retire loaders before
        // the dashboard commits. Only the ready destination owns a handoff.
        if (!anchor || !app || !anchor.getClientRects().length ||
            document.querySelector('.stanza-auth-loader, [data-stanza-travelling-mark]')) return;
        presenter.dataset.stanzaTravellingMark = '';
        if (backdrop && panelRect) {
          backdrop.inert = true;
          backdrop.setAttribute('aria-hidden', 'true');
          backdrop.style.cssText = 'position:fixed;inset:0;z-index:80;pointer-events:none;background:transparent';
          const retiringPanel = backdrop.querySelector<HTMLElement>('[role=status]');
          retiringPanel?.removeAttribute('role');
          retiringPanel?.removeAttribute('aria-live');
          if (retiringPanel) Object.assign(retiringPanel.style, {
            position:'fixed', top:panelRect.top+'px', left:panelRect.left+'px', width:panelRect.width+'px',
          });
          const oldMark = backdrop.querySelector<HTMLElement>('.stanza-fingerprint-loader');
          if (oldMark) oldMark.style.visibility = 'hidden';
          document.body.append(backdrop);
        }
        document.body.append(presenter);
        const end = anchor.getBoundingClientRect();
        const x = end.x + end.width / 2;
        const y = end.y + end.height / 2;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const duration = reduced ? 90 : 680;
        const retiring = backdrop?.animate([{opacity:1},{opacity:0}], {duration:reduced ? 70 : 145, fill:'both'});
        const shortcut = document.querySelector('.stanza-mode-shortcut')?.animate([{opacity:0},{opacity:1}], {
          duration: duration*.25, delay:duration*.65, fill:'both'
        });
        const destination = `translate(${end.x-start.x}px,${end.y-start.y}px) scale(${end.width/start.width},${end.height/start.height})`;
        const motion = presenter.animate([{transform: reduced ? destination : 'none', boxShadow:'0 0 16px color-mix(in srgb,var(--stanza-accent) 30%,transparent)'},
          {transform: destination, boxShadow:'0 0 0 transparent'}], {
          duration, fill: 'both', easing: 'cubic-bezier(.22,.78,.18,1)'
        });
        const covered = anchor.animate([{opacity:0},{opacity:0}], {duration, fill:'both'});
        const reveal = app.animate(reduced ? [{opacity:.88},{opacity:1}] : [
          {clipPath:`circle(0px at ${x}px ${y}px)`},
          {clipPath:`circle(${Math.hypot(innerWidth,innerHeight)}px at ${x}px ${y}px)`}
        ], {duration:duration*.72, delay:duration*.28, fill:'both', easing:'cubic-bezier(.2,.7,.2,1)'});
        const finish = () => {
          backdrop?.remove(); retiring?.cancel(); shortcut?.cancel();
          presenter.remove();
          covered.cancel(); reveal.cancel(); motion.cancel();
          window.removeEventListener('resize', finish);
        };
        window.addEventListener('resize', finish, {once:true});
        motion.onfinish = finish;
      });
    };
  }, [transition]);

  return (
    <div ref={root} className={overlay
      ? 'stanza-auth-loader fixed inset-0 z-[80] flex min-h-[100dvh] items-center justify-center bg-[#020604]/88 px-4 text-emerald-50'
      : contained
        ? 'stanza-auth-loader absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-[#030b08]/82 px-4 text-emerald-50'
        : 'stanza-auth-loader flex min-h-[100dvh] items-center justify-center px-4 text-emerald-50'}
    >
      <div
        role="status"
        aria-live="polite"
        dir={isRtl ? 'rtl' : 'ltr'}
        className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-emerald-500/15 bg-[#030b08]/88 px-6 py-9 text-center shadow-xl shadow-black/35 backdrop-blur-xl"
      >
        <StanzaFingerprintLoader size="lg" state={state} className="mb-5" />
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-100/80">
          {t(transitionMessageKeys[transition])}
        </p>
      </div>
    </div>
  );
}
