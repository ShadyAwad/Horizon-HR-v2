import type { CSSProperties } from 'react';

import type { AuthVisualState } from './AuthShell';
import { STANZA_FINGERPRINT_GROOVES, STANZA_FINGERPRINT_VIEW_BOX } from './stanzaFingerprintGeometry';

export type StanzaFingerprintState = AuthVisualState;

type StanzaFingerprintMarkProps = {
  size?: number;
  className?: string;
  animated?: boolean;
  state?: StanzaFingerprintState;
  decorative?: boolean;
};

export function StanzaFingerprintMark({
  size = 24,
  className = '',
  animated = false,
  state = 'idle',
  decorative = true,
}: StanzaFingerprintMarkProps) {
  return (
    <svg
      viewBox={STANZA_FINGERPRINT_VIEW_BOX}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={decorative || undefined}
      className={className}
    >
      {STANZA_FINGERPRINT_GROOVES.map((groove, index) => animated ? (
        <g key={groove}>
          <path d={groove} className="stanza-fingerprint-groove-base" />
          <path
            d={groove}
            className={state === 'success'
              ? 'stanza-fingerprint-groove stanza-fingerprint-groove-success'
              : state === 'error'
                ? 'stanza-fingerprint-groove stanza-fingerprint-groove-error'
                : 'stanza-fingerprint-groove'}
            style={{ '--stanza-groove-index': index } as CSSProperties}
          />
        </g>
      ) : <path key={groove} d={groove} />)}
    </svg>
  );
}
