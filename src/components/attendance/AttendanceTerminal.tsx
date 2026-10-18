import type { MouseEventHandler } from 'react';
import { MapPin, Navigation, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

type Props = { state: string; label: string; disabled: boolean; clockedIn?: boolean; onClick: MouseEventHandler<HTMLButtonElement> };

/** Presentation only: the caller owns every attendance decision and request. */
export function AttendanceTerminal({ state, label, disabled, onClick, clockedIn=false }: Props) {
  const busy = state === 'locating' || state === 'verifying';
  const Icon = state === 'verifying' ? ShieldCheck : state === 'locating' ? Navigation : state === 'success' || state === 'clocked_out' ? CheckCircle2
    : state === 'failed' || state === 'outside_geofence' || state === 'open_shift_conflict' ? AlertTriangle : MapPin;
  return (
    <button type="button" className="attendance-terminal" data-geo-interaction="clock"
      data-state={state} data-clocked-in={clockedIn} aria-busy={busy} disabled={disabled} onClick={onClick}>
      <span className="attendance-terminal-face">
      <span key={state} className="attendance-terminal-core">
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </span>
      </span>
    </button>
  );
}
