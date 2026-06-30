import { cn } from '../lib/utils';

type BrandWordmarkProps = {
  className?: string;
};

export function BrandWordmark({ className }: BrandWordmarkProps) {
  return (
    <span className={cn('font-bold tracking-tight', className)} aria-label="Stanza">
      <span className="text-emerald-500 drop-shadow-[0_0_10px_rgba(52,211,153,0.55)] dark:text-emerald-400">
        S
      </span>
      <span className="text-slate-900 dark:text-emerald-50">tanza</span>
    </span>
  );
}
