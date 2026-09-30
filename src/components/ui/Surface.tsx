import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

export type SurfaceVariant = 'auto' | 'solid' | 'glass';
export function Surface({ variant = 'auto', className, ...props }:
  ComponentPropsWithoutRef<'section'> & { variant?: SurfaceVariant }) {
  return <section className={cn('stanza-surface', className)} data-surface={variant} {...props} />;
}
