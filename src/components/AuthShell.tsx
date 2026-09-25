import type { ReactNode } from 'react';
import { FingerprintCanvas } from './FingerprintCanvas';
import type { AuthVisualState } from '../auth/auth-contract';
import { readAuthIdleIsolation } from './dev/auth-idle-isolation';

const idleIsolation = import.meta.env.DEV ? readAuthIdleIsolation(window.location.search) : undefined;

export type { AuthVisualState } from '../auth/auth-contract';

type AuthShellProps = {
  children: ReactNode;
  pulseState: AuthVisualState;
  onPulseComplete: () => void;
};

export function AuthShell({ children, pulseState, onPulseComplete }: AuthShellProps) {
  return (
    <section
      data-auth-state={pulseState}
      data-login-idle-isolation={idleIsolation?.label}
      className="stanza-auth-shell relative isolate min-h-[100dvh] w-full overflow-x-hidden text-[color:var(--stanza-auth-text)]"
    >
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
        {!idleIsolation?.removeCanvas && <FingerprintCanvas pulseState={pulseState} onPulseComplete={onPulseComplete} staticMode={idleIsolation?.freezeCanvas ?? false} />}
      </div>
      <div className="relative z-10 min-h-[100dvh]">{children}</div>
      {idleIsolation?.css && <style>{idleIsolation.css}</style>}
    </section>
  );
}
