import type {LanyardStyle} from './custom-theme';
export function resolveLanyardAppearance(selected:LanyardStyle,themeStyle:LanyardStyle){return selected.appearanceMode==='custom'?selected:themeStyle;}
