import * as React from 'react';
import { AlertTriangle, CheckCircle2, Copy, XCircle } from 'lucide-react';
import { CSV_FIELD_LABELS } from '@shared/types';
import type { CsvParseResult, IssueSeverity } from '@shared/types';
import { formatNumber } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Stat } from '@/components/common';

const MAX_ROWS = 500;

export function ValidationStep({ result }: { result: CsvParseResult }) {
  const [filter, setFilter] = React.useState<'all' | IssueSeverity>('all');
  const issues = filter === 'all' ? result.issues : result.issues.filter((i) => i.severity === filter);
  const shown = issues.slice(0, MAX_ROWS);

  return (
    <div className="flex flex-col gap-6">
      {result.canImport ? (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertTitle>Ready to import</AlertTitle>
          <AlertDescription>
            {result.warningCount > 0
              ? `No blocking errors. ${result.warningCount} warning${result.warningCount === 1 ? '' : 's'} to review below.`
              : 'No errors or warnings were found.'}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="danger">
          <XCircle />
          <AlertTitle>Import blocked</AlertTitle>
          <AlertDescription>
            Fix the {result.errorCount} error{result.errorCount === 1 ? '' : 's'} below (in the CSV or by changing the
            column mapping) to continue.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-5">
          <Stat label="Cards" value={formatNumber(result.cards.length)} />
          <Stat label="Lists" value={formatNumber(result.lists.length)} />
          <Stat label="Errors" value={<span className={result.errorCount ? 'text-red-300' : ''}>{formatNumber(result.errorCount)}</span>} />
          <Stat label="Warnings" value={<span className={result.warningCount ? 'text-amber-300' : ''}>{formatNumber(result.warningCount)}</span>} />
          <Stat label="Duplicates" value={formatNumber(result.duplicateCount)} hint={result.duplicateCount ? 'Same list + card name' : undefined} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Issues</h2>
            <p className="mt-0.5 text-[13px] text-muted">Row numbers refer to data rows (header excluded).</p>
          </div>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList>
              <TabsTrigger value="all">All · {result.issues.length}</TabsTrigger>
              <TabsTrigger value="error">Errors · {result.errorCount}</TabsTrigger>
              <TabsTrigger value="warning">Warnings · {result.warningCount}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="mt-4">
          {shown.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing to show" description="No issues in this category." className="border-t border-border" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-24">Severity</TableHead>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead className="w-40">Field</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((i, idx) => (
                  <TableRow key={`${i.row}-${i.field}-${i.code}-${idx}`}>
                    <TableCell>
                      {i.severity === 'error' ? (
                        <Badge variant="danger">
                          <XCircle /> Error
                        </Badge>
                      ) : (
                        <Badge variant="warning">
                          {i.code === 'DUPLICATE_CARD' ? <Copy /> : <AlertTriangle />} Warning
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-muted">{i.row ?? '—'}</TableCell>
                    <TableCell className="text-muted">{i.field ? CSV_FIELD_LABELS[i.field] : 'File'}</TableCell>
                    <TableCell className="text-[13px]">{i.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {issues.length > MAX_ROWS && (
            <p className="border-t border-border px-5 py-3 text-[12px] text-subtle">
              Showing first {MAX_ROWS} of {formatNumber(issues.length)} issues.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
