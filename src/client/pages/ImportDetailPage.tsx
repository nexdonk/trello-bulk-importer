import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleSlash,
  Download,
  ExternalLink,
  Loader2,
  RotateCcw,
  SkipForward,
  Square,
  XCircle,
} from 'lucide-react';
import type { CardResult, ImportPhase, ImportProgress } from '@shared/types';
import { api, errorMessage } from '@/lib/api';
import { cn, formatDateTime, formatDuration, formatNumber } from '@/lib/utils';
import { useImportProgress, type LogEntry, type StreamState } from '@/hooks/useImportProgress';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog, ErrorState, PageHeader, StatusBadge } from '@/components/common';

const PHASES: { id: string; label: string; phases: ImportPhase[] }[] = [
  { id: 'creds', label: 'Validating credentials', phases: ['queued', 'validating_credentials'] },
  { id: 'board', label: 'Preparing board', phases: ['preparing_board', 'fetching_lists'] },
  { id: 'lists', label: 'Lists', phases: ['creating_lists'] },
  { id: 'labels', label: 'Labels', phases: ['creating_labels'] },
  { id: 'cards', label: 'Cards', phases: ['creating_cards'] },
  { id: 'final', label: 'Finalizing', phases: ['finalizing', 'done'] },
];

function phaseIndex(phase: ImportPhase): number {
  const i = PHASES.findIndex((p) => p.phases.includes(phase));
  return i === -1 ? 0 : i;
}

function PhaseStepper({ progress }: { progress: ImportProgress }) {
  const current = phaseIndex(progress.phase);
  const terminal = progress.status !== 'running' && progress.status !== 'pending';
  const success = progress.status === 'completed' || progress.status === 'completed_with_errors';
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {PHASES.map((p, i) => {
        const done = success || i < current || (progress.phase === 'done' && i <= current);
        const active = !terminal && i === current;
        const stopped = terminal && !success && i === current;
        return (
          <li
            key={p.id}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] transition-colors duration-150',
              active ? 'border-white/25 bg-white/[0.04] text-foreground' : 'border-border text-muted',
              done && 'text-zinc-300',
              stopped && 'border-red-500/25 text-red-300',
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {done ? (
                <Check className="size-3.5 text-emerald-400" />
              ) : active ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : stopped ? (
                <XCircle className="size-3.5" />
              ) : (
                <span className="size-1.5 rounded-full bg-zinc-600" />
              )}
            </span>
            <span className="truncate">{p.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'danger' | 'warning' }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">{label}</div>
      <div
        className={cn(
          'tabular mt-1 text-lg font-semibold',
          tone === 'success' && value > 0 && 'text-emerald-300',
          tone === 'danger' && value > 0 && 'text-red-300',
          tone === 'warning' && value > 0 && 'text-amber-300',
        )}
      >
        {formatNumber(value)}
      </div>
    </div>
  );
}

function StreamIndicator({ stream }: { stream: StreamState }) {
  const map: Record<StreamState, { label: string; dot: string }> = {
    connecting: { label: 'Connecting', dot: 'bg-zinc-500 animate-pulse' },
    live: { label: 'Live', dot: 'bg-emerald-400 animate-pulse' },
    reconnecting: { label: 'Reconnecting', dot: 'bg-amber-400 animate-pulse' },
    closed: { label: 'Ended', dot: 'bg-zinc-600' },
  };
  const m = map[stream];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
      <span className={cn('size-1.5 rounded-full', m.dot)} /> {m.label}
    </span>
  );
}

function CardStatusIcon({ status }: { status: CardResult['status'] }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="size-3.5 text-emerald-400" />;
    case 'failed':
      return <XCircle className="size-3.5 text-red-400" />;
    case 'skipped':
      return <SkipForward className="size-3.5 text-zinc-500" />;
    case 'cancelled':
      return <CircleSlash className="size-3.5 text-zinc-500" />;
    default:
      return <span className="size-1.5 rounded-full bg-zinc-600" />;
  }
}

function LiveLog({ log }: { log: LogEntry[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Activity</h2>
        <span className="tabular text-[12px] text-subtle">{log.length} events</span>
      </div>
      <div className="scrollbar-thin h-80 overflow-y-auto font-mono text-[12px]">
        {log.length === 0 ? (
          <div className="flex h-full items-center justify-center text-subtle">Waiting for card events…</div>
        ) : (
          <ul>
            {log.map((e) => (
              <li key={e.key} className="flex items-start gap-3 border-b border-border/60 px-5 py-1.5 animate-fade-in">
                <span className="tabular shrink-0 text-subtle">
                  {new Date(e.at).toLocaleTimeString(undefined, { hour12: false })}
                </span>
                <span className="mt-0.5 shrink-0">
                  <CardStatusIcon status={e.card.status} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-zinc-200">{e.card.cardName}</span>
                  <span className="text-subtle"> → {e.card.listName}</span>
                  {e.card.error && <span className="block text-red-300/90">{e.card.error}</span>}
                </span>
                {e.card.trelloCardUrl && (
                  <a
                    href={e.card.trelloCardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-subtle hover:text-foreground"
                    aria-label="Open card in Trello"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default function ImportDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { record, progress, cards, log, stream, loading, error, isDone, reload } = useImportProgress(id);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState(false);

  if (loading && !progress) {
    return (
      <>
        <Skeleton className="mb-2 h-4 w-24" />
        <Skeleton className="mb-8 h-7 w-64" />
        <Skeleton className="mb-4 h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  if (!progress) {
    return (
      <>
        <PageHeader title="Import" />
        <ErrorState title="Could not load import" message={error ?? 'Import not found.'} onRetry={reload} />
        <Button asChild variant="ghost" className="mt-4">
          <Link to="/history">
            <ArrowLeft /> Back to history
          </Link>
        </Button>
      </>
    );
  }

  const p = progress;
  const running = p.status === 'running' || p.status === 'pending';
  const failedCards = cards.filter((c) => c.status === 'failed');
  const processed = p.cardsImported + p.cardsFailed + p.cardsSkipped;
  const duration = formatDuration(p.startedAt, p.finishedAt);
  const boardUrl = p.boardUrl ?? record?.boardUrl ?? null;
  const boardName = p.boardName ?? record?.boardName ?? null;

  const cancel = async () => {
    setActionError(null);
    try {
      await api.cancelImport(id);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const retry = async () => {
    setActionError(null);
    setRetrying(true);
    try {
      const res = await api.retryImport(id);
      navigate(`/imports/${encodeURIComponent(res.importId)}`);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/history" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> History
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <span className="truncate">{boardName ?? record?.filename ?? 'Import'}</span>
            <StatusBadge status={p.status} />
          </span>
        }
        description={
          <>
            {record?.filename && <span className="font-mono text-[12.5px]">{record.filename}</span>}
            {record?.createdAt && <> · {formatDateTime(record.createdAt)}</>}
            {duration && <> · {duration}</>}
            {record?.retryOf && (
              <>
                {' '}
                · retry of{' '}
                <Link to={`/imports/${encodeURIComponent(record.retryOf)}`} className="underline underline-offset-4 hover:text-foreground">
                  previous import
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            {!isDone && <StreamIndicator stream={stream} />}
            {boardUrl && (
              <Button asChild variant="secondary" size="sm">
                <a href={boardUrl} target="_blank" rel="noopener noreferrer">
                  Open board in Trello <ExternalLink />
                </a>
              </Button>
            )}
            {running && (
              <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>
                <Square /> Cancel
              </Button>
            )}
          </>
        }
      />

      {actionError && <ErrorState className="mb-6" message={actionError} />}
      {error && progress && !isDone && (
        <p className="mb-4 text-[12px] text-amber-300">Connection issue: {error}. Retrying…</p>
      )}

      {p.fatalError && (
        <Alert variant="danger" className="mb-6">
          <XCircle />
          <AlertTitle>Import failed</AlertTitle>
          <AlertDescription>{p.fatalError}</AlertDescription>
        </Alert>
      )}

      {isDone && p.status !== 'failed' && (
        <Card className="mb-6">
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
            <div>
              <div className="tabular text-2xl font-semibold">{formatNumber(processed)}</div>
              <div className="text-[12px] text-muted">cards processed</div>
            </div>
            <div>
              <div className="tabular text-2xl font-semibold text-emerald-300">{formatNumber(p.cardsImported)}</div>
              <div className="text-[12px] text-muted">successfully imported</div>
            </div>
            <div>
              <div className={cn('tabular text-2xl font-semibold', p.cardsFailed > 0 && 'text-red-300')}>
                {formatNumber(p.cardsFailed)}
              </div>
              <div className="text-[12px] text-muted">failed</div>
            </div>
            <div>
              <div className="tabular text-2xl font-semibold">{formatNumber(p.listsCreated)}</div>
              <div className="text-[12px] text-muted">lists created</div>
            </div>
            <div>
              <div className="tabular text-2xl font-semibold">{formatNumber(p.labelsCreated)}</div>
              <div className="text-[12px] text-muted">labels created</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="tabular text-5xl font-semibold tracking-tight">
                {Math.round(p.percent)}
                <span className="text-2xl text-subtle">%</span>
              </div>
              <div className="tabular mt-1 text-[12px] text-subtle">
                {formatNumber(p.completedOperations)} / {formatNumber(p.totalOperations)} Trello operations
              </div>
            </div>
            <div className="min-w-0 max-w-full text-right sm:max-w-[60%]">
              <div className="truncate text-[13px] text-zinc-200" title={p.currentOperation}>
                {p.currentOperation || (running ? 'Working…' : '—')}
              </div>
              {p.currentList && <div className="truncate text-[12px] text-subtle">List: {p.currentList}</div>}
            </div>
          </div>
          <Progress
            value={p.percent}
            className="h-2.5"
            indicatorClassName={cn(
              p.status === 'failed' && 'bg-red-400',
              p.status === 'completed_with_errors' && 'bg-amber-300',
              p.status === 'cancelled' && 'bg-zinc-500',
            )}
          />
          <PhaseStepper progress={p} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Counter label="Imported" value={p.cardsImported} tone="success" />
            <Counter label="Remaining" value={p.cardsRemaining} />
            <Counter label="Failed" value={p.cardsFailed} tone="danger" />
            <Counter label="Skipped" value={p.cardsSkipped} tone="warning" />
            <Counter label="Lists created" value={p.listsCreated} />
            <Counter label="Lists reused" value={p.listsReused} />
            <Counter label="Labels created" value={p.labelsCreated} />
            <Counter label="Labels reused" value={p.labelsReused} />
          </div>
        </CardContent>
      </Card>

      {isDone && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {failedCards.length > 0 && (
            <>
              <Button onClick={retry} disabled={retrying}>
                {retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                Retry failed cards
              </Button>
              <Button asChild variant="secondary">
                <a href={api.errorsCsvUrl(id)} download>
                  <Download /> Export error report (CSV)
                </a>
              </Button>
            </>
          )}
          <Button asChild variant="ghost">
            <Link to="/">Return to dashboard</Link>
          </Button>
        </div>
      )}

      {isDone && failedCards.length > 0 && (
        <Card className="mb-6 overflow-hidden">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold tracking-tight">Failed cards</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-16">Row</TableHead>
                <TableHead>List</TableHead>
                <TableHead>Card</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="w-20 text-right">Attempts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failedCards.map((c) => (
                <TableRow key={c.row}>
                  <TableCell className="tabular text-muted">{c.row}</TableCell>
                  <TableCell className="max-w-[160px] truncate">{c.listName}</TableCell>
                  <TableCell className="max-w-[240px] truncate">{c.cardName}</TableCell>
                  <TableCell className="text-[13px] text-red-300">{c.error ?? 'Unknown error'}</TableCell>
                  <TableCell className="tabular text-right text-muted">{c.attempts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {(!isDone || log.length > 0) && <LiveLog log={log} />}

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this import?"
        description="Cards already created in Trello will stay. Remaining cards will be marked as cancelled."
        confirmLabel="Cancel import"
        cancelLabel="Keep running"
        destructive
        onConfirm={cancel}
      />
    </>
  );
}
