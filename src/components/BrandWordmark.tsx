import {useEffect,useRef} from 'react';
import {startBrandFlicker} from './navigation/brand-neon';
import { cn } from '../lib/utils';

type BrandWordmarkProps = {
  className?: string;
  neon?: boolean;
};

export function BrandWordmark({ className,neon=false }: BrandWordmarkProps) {
  const mark=useRef<HTMLSpanElement>(null);
  useEffect(()=>{if(!neon||!mark.current)return;return startBrandFlicker(mark.current,{document,queries:['(prefers-reduced-motion: reduce)','(prefers-reduced-transparency: reduce)','(prefers-contrast: more)'].map(q=>matchMedia(q)),setTimeout:(fn,ms)=>window.setTimeout(fn,ms),clearTimeout:id=>window.clearTimeout(id),random:Math.random});},[neon]);
  return (
    <span className={cn('font-bold tracking-tight', className)} aria-label="Stanza" dir="ltr">
      <span ref={mark} className={neon?"stanza-brand-neon":"stanza-brand-source"}>
        S
      </span>
      <span className="text-slate-900 dark:text-emerald-50">tanza</span>
    </span>
  );
}
