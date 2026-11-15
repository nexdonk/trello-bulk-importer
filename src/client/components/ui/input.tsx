import * as React from 'react';
import { cn } from '@/lib/utils';

export const inputBase =
  'w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-subtle transition-colors duration-150 hover:border-border-strong focus-visible:border-white/30 focus-visible:ring-2 focus-visible:ring-white/10 disabled:cursor-not-allowed disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input ref={ref} type={type} className={cn(inputBase, 'h-9', className)} {...props} />
  ),
);
Input.displayName = 'Input';
