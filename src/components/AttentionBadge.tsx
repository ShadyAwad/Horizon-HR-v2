import { cn } from '../lib/utils';

type AttentionBadgeProps = {
  count: number;
  ariaLabel: string;
  className?: string;
};

export function AttentionBadge({ count, ariaLabel, className }: AttentionBadgeProps) {
  if (count <= 0) return null;

  return (
    <span
      key={count}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        'stanza-attention-badge inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full',
        'border border-emerald-200/70 bg-emerald-500 px-1 text-[9px] font-black leading-none text-[#020604]',
        'shadow-[0_0_10px_rgba(16,185,129,0.24)]',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
