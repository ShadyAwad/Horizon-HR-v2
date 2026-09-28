import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Native top-layer modality avoids transformed workspace clipping and traps focus. */
export function GoalDialog({ children, onClose, busy, labelledBy, dir, alert = false }: {
  children: ReactNode; onClose: () => void; busy: boolean; labelledBy: string;
  dir: 'rtl' | 'ltr'; alert?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={ref} dir={dir} aria-labelledby={labelledBy}
    role={alert ? 'alertdialog' : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    } }}
    className="stanza-scrollbar fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border-0 bg-transparent p-0 text-[color:var(--stanza-text-primary)] backdrop:bg-black/55">
    {children}
  </dialog>, document.body);
}
