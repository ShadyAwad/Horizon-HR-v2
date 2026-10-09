import type { MouseEventHandler } from 'react';
import { MapPin, Navigation, CheckCircle2, AlertTriangle } from 'lucide-react';

type Props = { state: string; label: string; disabled: boolean; onClick: MouseEventHandler<HTMLButtonElement> };

/** Presentation only: the caller owns every attendance decision and request. */
export function AttendanceTerminal({ state, label, disabled, onClick }: Props) {
  const busy = state === 'locating' || state === 'verifying';
  const Icon = busy ? Navigation : state === 'success' || state === 'clocked_out' ? CheckCircle2
    : state === 'failed' || state === 'outside_geofence' || state === 'open_shift_conflict' ? AlertTriangle : MapPin;
  return (
    <button type="button" className="attendance-terminal" data-geo-interaction="clock"
      data-state={state} aria-busy={busy} disabled={disabled} onClick={onClick}>
      <span className="attendance-terminal-core">
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </span>
    </button>
  );
}
