import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

// Keep native keyboard behavior and let callers associate labels/descriptions.
export const Select = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<'select'>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn('stanza-select stanza-form-control', className)} {...props} />;
  },
);
export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn('stanza-form-control', className)} {...props} />;
  },
);
export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn('stanza-form-control', className)} {...props} />;
  },
);
