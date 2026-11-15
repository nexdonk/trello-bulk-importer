import * as React from 'react';
import { AlertCircle, Loader2, type LucideIcon } from 'lucide-react';
import type { ImportStatus } from '@shared/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#fafafa" />
      <rect x="7" y="7" width="7.5" height="15" rx="1.8" fill="#09090b" />
      <rect x="17.5" y="7" width="7.5" height="9.5" rx="1.8" fill="#09090b" fillOpacity="0.55" />
    </svg>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-[12px] text-subtle">{eyebrow}</div>}
        <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_META: Record<ImportStatus, { label: string; variant: 'success' | 'danger' | 'warning' | 'default' | 'info' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'outline' },
  running: { label: 'Running', variant: 'info' },
  completed: { label: 'Completed', variant: 'success' },
  completed_with_errors: { label: 'Partial', variant: 'warning' },
  failed: { label: 'Failed', variant: 'danger' },
  cancelled: { label: 'Cancelled', variant: 'default' },
};

export function StatusBadge({ status, className }: { status: ImportStatus; className?: string }) {
  const meta = STATUS_META[status] ?? { label: status, variant: 'default' as const };
  return (
    <Badge variant={meta.variant} className={className}>
      {status === 'running' ? (
        <Loader2 className="animate-spin" />
      ) : (
        <span
          className={cn(
            'size-1.5 rounded-full',
            meta.variant === 'success' && 'bg-emerald-400',
            meta.variant === 'danger' && 'bg-red-400',
            meta.variant === 'warning' && 'bg-amber-400',
            (meta.variant === 'default' || meta.variant === 'outline') && 'bg-zinc-500',
          )}
        />
      )}
      {meta.label}
    </Badge>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2">
        <Icon className="size-4 text-muted" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Alert variant="danger" className={className}>
      <AlertCircle />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </div>
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry} className="shrink-0">
            Try again
          </Button>
        )}
      </div>
    </Alert>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = React.useState(false);
  const handle = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={handle} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">{label}</span>
      <span className="tabular text-lg font-semibold tracking-tight text-foreground">{value}</span>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} />;
}
