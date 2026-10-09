import type { MouseEventHandler } from 'react';
import { Fingerprint, ArrowRight } from 'lucide-react';

type Props = { label: string; busyLabel: string; busy: boolean; disabled: boolean; onClick: MouseEventHandler<HTMLButtonElement> };

export function PasskeyAction({ label, busyLabel, busy, disabled, onClick }: Props) {
  return (
    <button type="button" className="passkey-action" disabled={disabled} onClick={onClick}
      aria-busy={busy} aria-label={busy ? busyLabel : label}>
      <span className="passkey-action-content">
        <Fingerprint aria-hidden="true" />
        <span className="passkey-action-label" aria-hidden="true">
          <span style={{ visibility: busy ? 'hidden' : 'visible' }}>{label}</span>
          <span style={{ visibility: busy ? 'visible' : 'hidden' }}>{busyLabel}</span>
        </span>
        <ArrowRight className="passkey-action-direction" aria-hidden="true" />
      </span>
    </button>
  );
}
