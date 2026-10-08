import {useMemo, type CSSProperties} from 'react';
// Body bounds measured from card.glb; clip hardware is deliberately excluded.
export const IDENTITY_CARD_ASPECT = 0.716417908668518 / 1.0000001192092896;
export const IDENTITY_CARD_RADIUS = '4% / 2.8657%';
export function IdentityCardArtwork({svg,face,hidden,label}:{svg:string;face:'front'|'back';hidden:boolean;label:string}) {
 const src=useMemo(()=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),[svg]);
 return <img data-identity-artwork={face} className={'stanza-card-'+face} src={src} alt={label} aria-hidden={hidden} style={{borderRadius:IDENTITY_CARD_RADIUS} as CSSProperties}/>;
}
