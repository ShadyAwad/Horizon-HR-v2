import { StanzaFingerprintMark } from '../StanzaFingerprintMark';
import { useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { AuthUser } from '../../auth/auth-contract';
import { useLanguage } from '../../lib/LanguageContext';
import { resolveLanyardColors, type LanyardStyle } from '../../lib/custom-theme';

export function LanyardDetails({ user, portrait, style, onClose, returnFocus, origin }: {
  origin: { x: number; y: number } | null;
  user: AuthUser; portrait: string | null; style: LanyardStyle; onClose: () => void; returnFocus: HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t, isRtl } = useLanguage();
  const colors = resolveLanyardColors(style);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); returnFocus?.focus({ preventScroll: true }); };
  }, [returnFocus]);
  const company = typeof user.tenant === 'string' ? user.tenant : user.tenant?.companyName;
  return createPortal(<dialog ref={ref} className="stanza-id-dialog" dir={isRtl ? 'rtl' : 'ltr'} aria-labelledby="stanza-id-title"
    style={{ '--id-from-x': `${origin ? (origin.x - window.innerWidth / 2) * .4 : 0}px`, '--id-from-y': `${origin ? (origin.y - window.innerHeight / 2) * .4 : 24}px`, '--id-card': colors.card, '--id-accent': colors.accent, '--id-text': colors.text } as CSSProperties}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article className="stanza-id-details">
      <button autoFocus type="button" className="stanza-close-action stanza-id-close" aria-label={t('lanyard.close')} onClick={onClose}><X size={20} /></button>
      <div className="stanza-id-brand"><StanzaFingerprintMark className="h-7 w-7" /><span>Stanza</span></div>
      {portrait && <img src={portrait} alt="" className="stanza-id-portrait" />}
      <h2 id="stanza-id-title">{user.name}</h2>
      <p>{user.jobTitle || user.role}</p>
      {company && <p>{company}</p>}
      <p dir="ltr">{user.email}</p>
      <dl><dt>{t('lanyard.identifier')}</dt><dd dir="ltr">{user.id}</dd></dl>
    </article>
  </dialog>, document.body);
}

