import * as React from 'react';
import { ChevronRight, Copy } from 'lucide-react';
import type { CsvParseResult, ParsedCard } from '@shared/types';
import { cn, formatNumber } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Stat } from '@/components/common';
import type { ListPlanEntry } from './BoardStep';
import { LabelChip } from './shared';

const PAGE = 50;

function CardRow({ card, skipped }: { card: ParsedCard; skipped: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const long = card.description.length > 220 || card.description.split('\n').length > 3;
  return (
    <li className={cn('px-4 py-3', skipped && 'opacity-50')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="tabular w-8 shrink-0 text-[11px] text-subtle">#{card.row}</span>
            <span className="min-w-0 break-words text-[13px] font-medium text-zinc-100">{card.cardName}</span>
            {card.isDuplicate && (
              <Badge variant="warning">
                <Copy /> {skipped ? 'Duplicate · skipped' : 'Duplicate'}
              </Badge>
            )}
          </div>
          {card.description && (
            <div className="ml-10 mt-1.5">
              <div
                className={cn(
                  'whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-muted',
                  !expanded && long && 'line-clamp-3',
                )}
              >
                {card.description}
              </div>
              {long && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  className="mt-1 cursor-pointer text-[12px] text-zinc-400 hover:text-foreground"
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
        </div>
        {card.labels.length > 0 && (
          <div className="ml-10 flex flex-wrap gap-1 sm:ml-0 sm:max-w-[45%] sm:justify-end">
            {card.labels.map((l) => (
              <LabelChip key={l} name={l} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function ListSection({
  entry,
  name,
  cards,
  skipDuplicates,
  defaultOpen,
}: {
  entry: ListPlanEntry | undefined;
  name: string;
  cards: ParsedCard[];
  skipDuplicates: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [limit, setLimit] = React.useState(PAGE);
  const effective = cards.filter((c) => !(skipDuplicates && c.isDuplicate)).length;
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.02]"
      >
        <ChevronRight className={cn('size-4 shrink-0 text-subtle transition-transform duration-150', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
        <span className="tabular text-[12px] text-muted">
          {effective} card{effective === 1 ? '' : 's'}
        </span>
        {entry &&
          (entry.action === 'reuse' ? (
            <Badge>Reuse</Badge>
          ) : entry.action === 'create' ? (
            <Badge variant="info">New list</Badge>
          ) : (
            <Badge variant="danger">Missing</Badge>
          ))}
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border bg-background/40">
          {cards.slice(0, limit).map((c) => (
            <CardRow key={c.row} card={c} skipped={skipDuplicates && c.isDuplicate} />
          ))}
          {cards.length > limit && (
            <li className="px-4 py-2">
              <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE * 4)}>
                Show more ({cards.length - limit} remaining)
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function PreviewStep({
  result,
  plan,
  skipDuplicates,
  boardLabel,
}: {
  result: CsvParseResult;
  plan: ListPlanEntry[];
  skipDuplicates: boolean;
  boardLabel: string;
}) {
  const grouped = React.useMemo(() => {
    const m = new Map<string, ParsedCard[]>();
    for (const c of result.cards) {
      const arr = m.get(c.listName);
      if (arr) arr.push(c);
      else m.set(c.listName, [c]);
    }
    return m;
  }, [result.cards]);

  const effectiveCards = result.cards.filter((c) => !(skipDuplicates && c.isDuplicate));
  const listsToCreate = plan.filter((p) => p.action === 'create').length;
  const listsReused = plan.filter((p) => p.action === 'reuse').length;
  const missing = plan.filter((p) => p.action === 'missing');
  const labelSet = new Set<string>();
  effectiveCards.forEach((c) => c.labels.forEach((l) => labelSet.add(l)));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Cards to import" value={formatNumber(effectiveCards.length)} hint={skipDuplicates && result.duplicateCount ? `${result.duplicateCount} duplicates skipped` : undefined} />
          <Stat label="Lists" value={formatNumber(plan.length)} hint={`${listsToCreate} new · ${listsReused} reused`} />
          <Stat label="Labels" value={formatNumber(labelSet.size)} hint="Created if missing" />
          <Stat label="Board" value={<span className="block truncate text-base">{boardLabel}</span>} />
        </CardContent>
      </Card>

      {missing.length > 0 && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-[13px] text-red-200">
          {missing.length} list{missing.length === 1 ? '' : 's'} do not exist on the board and "Create missing lists" is off.
          Cards in {missing.map((m) => `"${m.name}"`).join(', ')} will fail.
        </p>
      )}

      {labelSet.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Array.from(labelSet).map((l) => (
            <LabelChip key={l} name={l} />
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        {result.lists.map((l, i) => (
          <ListSection
            key={l.name}
            name={l.name}
            entry={plan.find((p) => p.name === l.name)}
            cards={grouped.get(l.name) ?? []}
            skipDuplicates={skipDuplicates}
            defaultOpen={i < 2}
          />
        ))}
      </Card>
    </div>
  );
}
