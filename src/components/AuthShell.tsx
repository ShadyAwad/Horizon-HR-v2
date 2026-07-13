import type { ReactNode } from 'react';
import { FingerprintCanvas } from './FingerprintCanvas';

export type AuthVisualState = 'idle' | 'loading' | 'success' | 'error';

type AuthShellProps = {
  children: ReactNode;
  pulseState: AuthVisualState;
  onPulseComplete: () => void;
};

export function AuthShell({ children, pulseState, onPulseComplete }: AuthShellProps) {
  return (
    <section
      data-auth-state={pulseState}
      className="relative isolate min-h-[100dvh] w-full overflow-x-hidden bg-[#020604] text-emerald-50"
    >
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
        <FingerprintCanvas pulseState={pulseState} onPulseComplete={onPulseComplete} />
      </div>
      <div className="relative z-10 min-h-[100dvh]">{children}</div>
    </section>
  );
}
