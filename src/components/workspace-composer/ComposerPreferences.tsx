import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthUser } from '../../auth/auth-contract';
import { readPreferences, reduceComposer, storageKey, type ComposerAction, type ComposerPreferences } from './workspace-model';
const Context=createContext<{state:ComposerPreferences;dispatch:(action:ComposerAction)=>void;saveError:boolean}|null>(null);
export function ComposerPreferencesProvider({user,children}:{user:AuthUser;children:ReactNode}) {
 const key=storageKey(user.tenantId,user.id);
 return <ScopedProvider key={key} storage={key}>{children}</ScopedProvider>;
}
function ScopedProvider({storage,children}:{storage:string;children:ReactNode}){
 const [state,setState]=useState(()=>{try{return readPreferences(localStorage.getItem(storage));}catch{return readPreferences(null);}});
 const current=useRef(state);const [saveError,setSaveError]=useState(false);
 const dispatch=useCallback((action:ComposerAction)=>{
  const next=reduceComposer(current.current,action);current.current=next;setState(next);
  try{localStorage.setItem(storage,JSON.stringify(next));setSaveError(false);}catch{setSaveError(true);}
 },[storage]);
 useEffect(()=>{const sync=(event:StorageEvent)=>{if(event.storageArea===localStorage&&(event.key===storage||event.key===null)){const next=readPreferences(event.newValue);current.current=next;setState(next);}};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[storage]);
 const value=useMemo(()=>({state,dispatch,saveError}),[state,dispatch,saveError]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useComposerPreferences(){const value=useContext(Context);if(!value)throw new Error('Composer preferences provider missing');return value;}
