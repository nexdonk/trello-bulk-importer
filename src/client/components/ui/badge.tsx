import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface-2 text-zinc-300',
        outline: 'border-border text-muted',
        success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
        danger: 'border-red-500/20 bg-red-500/10 text-red-300',
        warning: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
        info: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
        solid: 'border-transparent bg-foreground text-background',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
