import type {ReactNode} from 'react';
/** Contextual utilities stay beside one another below the page title in reading order. */
export function PageHeaderActions({navigation,navigationLabel,label,children}:{navigation:ReactNode;navigationLabel:string;label:string;children:ReactNode}){
 return <div className="stanza-module-toolbar stanza-page-header-actions"><nav aria-label={navigationLabel}>{navigation}</nav><div role="group" aria-label={label} className="stanza-page-header-utilities">{children}</div></div>;
}
