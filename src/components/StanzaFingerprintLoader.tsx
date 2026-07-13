import { StanzaFingerprintMark, type StanzaFingerprintState } from './StanzaFingerprintMark';

type StanzaFingerprintLoaderProps = {
  size?: 'sm' | 'md' | 'lg';
  state?: Extract<StanzaFingerprintState, 'loading' | 'success' | 'error'>;
  className?: string;
};

const sizeClasses = {
  sm: 'h-5 w-5 rounded-md',
  md: 'h-14 w-14 rounded-xl',
  lg: 'h-16 w-16 rounded-xl',
};

const iconSizes = {
  sm: 13,
  md: 30,
  lg: 34,
};

export function StanzaFingerprintLoader({ size = 'md', state = 'loading', className = '' }: StanzaFingerprintLoaderProps) {
  return (
    <span className={`stanza-fingerprint-loader stanza-fingerprint-loader-${state} ${sizeClasses[size]} ${className}`} aria-hidden="true">
      <StanzaFingerprintMark
        size={iconSizes[size]}
        animated
        state={state}
        className="relative z-10 text-[#020604]"
      />
    </span>
  );
}
