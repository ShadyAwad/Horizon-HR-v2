import type {ButtonHTMLAttributes} from 'react';
import {RefreshCw} from 'lucide-react';
/** Utility presentation only; loading always comes from the owning request. */
export function RefreshButton({loading=false,disabled,children,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{loading?:boolean}){
 return <button {...props} type="button" disabled={disabled||loading} aria-busy={loading} className={`stanza-refresh-action ${className}`}><RefreshCw aria-hidden="true"/>{children}</button>;
}
