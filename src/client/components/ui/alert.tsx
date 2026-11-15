import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface text-zinc-200 [&>svg]:text-muted',
        danger: 'border-red-500/20 bg-red-500/[0.06] text-red-200 [&>svg]:text-red-400',
        warning: 'border-amber-500/20 bg-amber-500/[0.06] text-amber-100 [&>svg]:text-amber-400',
        success: 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100 [&>svg]:text-emerald-400',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-0.5 font-medium leading-5 tracking-tight', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-[13px] leading-relaxed opacity-85', className)} {...props} />
  ),
);
AlertDescription.displayName = 'AlertDescription';
