import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function LabelChip({ name, className }: { name: string; className?: string }) {
  const hue = hashHue(name.toLowerCase());
  return (
    <span
      className={cn(
        'inline-flex max-w-[180px] items-center gap-1.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-zinc-300',
        className,
      )}
      title={name}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${hue} 55% 60%)` }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export interface StepDef {
  id: string;
  label: string;
}

export function Stepper({
  steps,
  current,
  maxReachable,
  onSelect,
}: {
  steps: StepDef[];
  current: number;
  maxReachable: number;
  onSelect: (i: number) => void;
}) {
  return (
    <ol className="scrollbar-thin flex items-center gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1.5">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = i <= maxReachable;
        return (
          <React.Fragment key={s.id}>
            <li className="shrink-0">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onSelect(i)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed',
                  active ? 'bg-white/[0.07] text-foreground' : reachable ? 'text-muted hover:text-foreground' : 'text-subtle/70',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border text-[11px] tabular',
                    active && 'border-foreground bg-foreground text-background',
                    done && 'border-border-strong bg-surface-3 text-foreground',
                    !active && !done && 'border-border text-subtle',
                  )}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
            {i < steps.length - 1 && <li aria-hidden className="h-px w-4 shrink-0 bg-border" />}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

export function SectionTitle({ title, description, right }: { title: string; description?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {right}
    </div>
  );
}
