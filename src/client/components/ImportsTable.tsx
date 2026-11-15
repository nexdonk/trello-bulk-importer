import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import type { ImportRecord } from '@shared/types';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/common';

export function ImportsTable({
  records,
  loading,
  compact,
  skeletonRows = 5,
}: {
  records: ImportRecord[];
  loading?: boolean;
  compact?: boolean;
  skeletonRows?: number;
}) {
  const navigate = useNavigate();
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Date</TableHead>
          <TableHead>File</TableHead>
          <TableHead>Board</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Success</TableHead>
          <TableHead className="text-right">Failed</TableHead>
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && records.length === 0
          ? Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                {Array.from({ length: 7 }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full max-w-24" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : records.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => navigate(`/imports/${encodeURIComponent(r.id)}`)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(`/imports/${encodeURIComponent(r.id)}`);
                }}
              >
                <TableCell className="whitespace-nowrap text-muted" title={formatDateTime(r.createdAt)}>
                  {compact ? formatRelative(r.createdAt) : formatDateTime(r.createdAt)}
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[12.5px] text-zinc-200">{r.filename}</span>
                    {r.retryOf && (
                      <span title="Retry of a previous import" className="text-subtle">
                        <RotateCcw className="size-3" />
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[220px]">
                  {r.boardUrl ? (
                    <a
                      href={r.boardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex max-w-full items-center gap-1 text-zinc-200 hover:text-foreground hover:underline underline-offset-4"
                    >
                      <span className="truncate">{r.boardName ?? 'Board'}</span>
                      <ArrowUpRight className="size-3 shrink-0 text-subtle" />
                    </a>
                  ) : (
                    <span className="text-subtle">{r.boardName ?? '—'}</span>
                  )}
                </TableCell>
                <TableCell className="tabular text-right">{formatNumber(r.totalCards)}</TableCell>
                <TableCell className="tabular text-right">{formatNumber(r.successfulCards)}</TableCell>
                <TableCell className={`tabular text-right ${r.failedCards > 0 ? 'text-red-300' : 'text-subtle'}`}>
                  {formatNumber(r.failedCards)}
                </TableCell>
                <TableCell className="text-right">
                  <StatusBadge status={r.status} />
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
}
