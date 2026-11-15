import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Inbox, KeyRound, Loader2, PlugZap, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatNumber, formatRelative } from '@/lib/utils';
import { useAsync } from '@/hooks/useAsync';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { CsvDropzone } from '@/components/CsvDropzone';
import { ImportsTable } from '@/components/ImportsTable';
import * as React from 'react';

function ConnectionCard() {
  const { status, loading, error, testing, test } = useConnectionStatus();
  const [testError, setTestError] = React.useState<string | null>(null);

  const runTest = async () => {
    setTestError(null);
    try {
      await test();
    } catch (err) {
      setTestError(errorMessage(err));
    }
  };

  const connected = status?.state === 'connected';
  const member = status?.member;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Trello connection</CardTitle>
          {status && (
            <Badge variant={connected ? 'success' : status.state === 'failed' ? 'danger' : 'outline'}>
              <span
                className={`size-1.5 rounded-full ${connected ? 'bg-emerald-400' : status.state === 'failed' ? 'bg-red-400' : 'bg-zinc-500'}`}
              />
              {connected ? 'Connected' : status.state === 'failed' ? 'Failed' : 'Not connected'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {loading && !status ? (
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ) : error && !status ? (
          <ErrorState title="Could not load status" message={error} />
        ) : connected && member ? (
          <div className="flex items-center gap-3">
            {member.avatarUrl ? (
              <img
                src={member.avatarUrl}
                alt=""
                className="size-10 rounded-full border border-border object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex size-10 items-center justify-center rounded-full border border-border bg-surface-2 text-sm font-semibold">
                {(member.fullName || member.username).slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{member.fullName || member.username}</div>
              <a
                href={member.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[12px] text-muted hover:text-foreground"
              >
                @{member.username}
              </a>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2">
              {status?.state === 'failed' ? (
                <PlugZap className="size-4 text-red-300" />
              ) : (
                <KeyRound className="size-4 text-muted" />
              )}
            </div>
            <div className="text-[13px] text-muted">
              {status?.state === 'failed'
                ? status.error ?? 'Trello rejected the saved credentials.'
                : 'Add your Trello API key and token to start importing.'}
            </div>
          </div>
        )}
        {testError && <p className="text-[13px] text-red-300">{testError}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {status?.keyConfigured && status.tokenConfigured && (
            <Button size="sm" variant="secondary" onClick={runTest} disabled={testing}>
              {testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Test connection
            </Button>
          )}
          {!connected && (
            <Button size="sm" variant={status?.keyConfigured ? 'ghost' : 'default'} asChild>
              <Link to="/settings">
                Open settings <ArrowRight />
              </Link>
            </Button>
          )}
          {status?.checkedAt && (
            <span className="ml-auto text-[11px] text-subtle">Checked {formatRelative(status.checkedAt)}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatTile({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }) {
  return (
    <Card className="p-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">{label}</div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-16" />
      ) : (
        <div className="tabular mt-2 text-2xl font-semibold tracking-tight">{formatNumber(value ?? 0)}</div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const stats = useAsync(() => api.getStats(), []);
  const imports = useAsync(() => api.listImports(), []);

  const s = stats.data;
  const finished = s ? s.successfulImports + s.partialImports + s.failedImports : 0;
  const successRate = s && finished > 0 ? Math.round((s.successfulImports / finished) * 100) : null;
  const recent = (imports.data ?? []).slice(0, 5);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Bulk import cards into Trello from a CSV file."
        actions={
          <Button asChild size="sm">
            <Link to="/import">New import</Link>
          </Button>
        }
      />

      {stats.error && <ErrorState className="mb-4" title="Could not load stats" message={stats.error} onRetry={stats.reload} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ConnectionCard />
        <div className="grid grid-cols-2 gap-4 lg:col-span-2 lg:grid-cols-3">
          <StatTile label="Cards imported" value={s?.totalCardsImported} loading={stats.loading} />
          <StatTile label="Lists created" value={s?.totalListsCreated} loading={stats.loading} />
          <StatTile label="Labels created" value={s?.totalLabelsCreated} loading={stats.loading} />
          <Card className="col-span-2 p-5 lg:col-span-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">Imports</div>
              {s && (
                <div className="tabular text-[12px] text-muted">
                  {formatNumber(s.totalImports)} total
                  {successRate !== null && <> · {successRate}% success rate</>}
                </div>
              )}
            </div>
            {stats.loading ? (
              <Skeleton className="mt-3 h-12 w-full" />
            ) : (
              <>
                <div className="mt-3 grid grid-cols-3 gap-4">
                  <div>
                    <div className="tabular text-xl font-semibold">{formatNumber(s?.successfulImports ?? 0)}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                      <span className="size-1.5 rounded-full bg-emerald-400" /> Successful
                    </div>
                  </div>
                  <div>
                    <div className="tabular text-xl font-semibold">{formatNumber(s?.partialImports ?? 0)}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                      <span className="size-1.5 rounded-full bg-amber-400" /> Partial
                    </div>
                  </div>
                  <div>
                    <div className="tabular text-xl font-semibold">{formatNumber(s?.failedImports ?? 0)}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                      <span className="size-1.5 rounded-full bg-red-400" /> Failed
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
                  {s && finished > 0 && (
                    <>
                      <div className="h-full bg-emerald-400/80" style={{ width: `${(s.successfulImports / finished) * 100}%` }} />
                      <div className="h-full bg-amber-400/80" style={{ width: `${(s.partialImports / finished) * 100}%` }} />
                      <div className="h-full bg-red-400/80" style={{ width: `${(s.failedImports / finished) * 100}%` }} />
                    </>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Upload CSV</h2>
        </div>
        <CsvDropzone />
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Recent imports</h2>
          {recent.length > 0 && (
            <Link to="/history" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-foreground">
              View all <ArrowUpRight className="size-3.5" />
            </Link>
          )}
        </div>
        <Card className="overflow-hidden">
          {imports.error ? (
            <div className="p-4">
              <ErrorState title="Could not load imports" message={imports.error} onRetry={imports.reload} />
            </div>
          ) : !imports.loading && recent.length === 0 ? (
            <EmptyState icon={Inbox} title="No imports yet" description="Upload a CSV above to run your first import." />
          ) : (
            <ImportsTable records={recent} loading={imports.loading} compact />
          )}
        </Card>
        {!imports.loading && recent.length > 0 && (
          <CardDescription className="mt-2">Click a row to view its details.</CardDescription>
        )}
      </section>
    </>
  );
}
