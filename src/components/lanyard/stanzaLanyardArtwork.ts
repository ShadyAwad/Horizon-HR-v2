import {
  STANZA_FINGERPRINT_GROOVES,
  STANZA_FINGERPRINT_VIEW_BOX
} from '../stanzaFingerprintGeometry';

const fingerprintPaths = STANZA_FINGERPRINT_GROOVES
  .map(path => `<path d="${path}"/>`)
  .join('');

export function buildStanzaLanyardSvg() {
  const brandRepeat = (x: number) => `
    <g transform="translate(${x} 0)">
      <g transform="translate(8 19) scale(1.08)" fill="none" stroke="#42E8AD" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" opacity=".58">
        <svg width="26" height="26" viewBox="${STANZA_FINGERPRINT_VIEW_BOX}">${fingerprintPaths}</svg>
      </g>
      <text x="43" y="39" fill="#78D7B4" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" letter-spacing="3.2" opacity=".72">STANZA</text>
    </g>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="64" viewBox="0 0 512 64">
    <defs>
      <linearGradient id="fabric" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#041C15"/>
        <stop offset=".45" stop-color="#0A3A2A"/>
        <stop offset=".58" stop-color="#083225"/>
        <stop offset="1" stop-color="#041C15"/>
      </linearGradient>
      <pattern id="weave" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="skewX(-14)">
        <path d="M-3 3L3-3M0 12L12 0M9 15L15 9" stroke="#42E8AD" stroke-width="1" opacity=".075"/>
        <path d="M-3 9L9-3M3 15L15 3" stroke="#03130E" stroke-width="1.4" opacity=".28"/>
      </pattern>
    </defs>
    <rect width="512" height="64" fill="url(#fabric)"/>
    <rect y="7" width="512" height="50" fill="url(#weave)"/>
    <rect width="512" height="7" fill="#03130E"/>
    <rect y="57" width="512" height="7" fill="#03130E"/>
    <path d="M0 8.5H512M0 55.5H512" stroke="#18C98B" stroke-width="1" opacity=".32" stroke-dasharray="2 5"/>
    ${brandRepeat(0)}
    ${brandRepeat(171)}
    ${brandRepeat(342)}
    <rect width="512" height="64" fill="none" stroke="#020D09" stroke-width="2"/>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const STANZA_LANYARD_TEXTURE = buildStanzaLanyardSvg();
