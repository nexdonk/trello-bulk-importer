import { CSV_FIELD_LABELS, CSV_FIELDS, REQUIRED_CSV_FIELDS } from '@shared/types';
import type { ColumnMapping, CsvField, CsvUploadResult } from '@shared/types';
import { Wand2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionTitle } from './shared';

const NONE = '__none__';

const FIELD_HINTS: Record<CsvField, string> = {
  listName: 'Trello list each card goes into',
  cardName: 'Card title',
  cardDescription: 'Card body. Line breaks & Markdown preserved',
  labels: 'Comma-separated label names',
};

export function MappingStep({
  upload,
  mapping,
  onChange,
}: {
  upload: CsvUploadResult;
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const setField = (field: CsvField, header: string | null) => onChange({ ...mapping, [field]: header });
  const isSuggested = CSV_FIELDS.every((f) => mapping[f] === upload.suggestedMapping[f]);
  const mappedFields = CSV_FIELDS.filter((f) => mapping[f]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent>
          <SectionTitle
            title="Column mapping"
            description={
              <>
                {upload.headers.length} columns detected in{' '}
                <span className="font-mono text-zinc-300">{upload.filename}</span> · {upload.rowCount} data rows
              </>
            }
            right={
              !isSuggested && (
                <Button size="sm" variant="ghost" onClick={() => onChange({ ...upload.suggestedMapping })}>
                  <Wand2 /> Reset to detected
                </Button>
              )
            }
          />
          <div className="mb-5 flex flex-wrap gap-1.5">
            {upload.headers.map((h) => {
              const used = CSV_FIELDS.some((f) => mapping[f] === h);
              return (
                <Badge key={h} variant={used ? 'default' : 'outline'} className="font-mono font-normal">
                  {h || <em>(blank)</em>}
                </Badge>
              );
            })}
          </div>

          <div className="divide-y divide-border rounded-lg border border-border">
            {CSV_FIELDS.map((field) => {
              const required = REQUIRED_CSV_FIELDS.includes(field);
              const header = mapping[field];
              const samples = header
                ? upload.sampleRows
                    .map((r) => r[header] ?? '')
                    .filter((v) => v.trim() !== '')
                    .slice(0, 3)
                : [];
              return (
                <div key={field} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[200px_240px_1fr] md:items-center">
                  <div>
                    <div className="text-[13px] font-medium">
                      {CSV_FIELD_LABELS[field]}
                      {required && <span className="ml-0.5 text-red-300">*</span>}
                    </div>
                    <div className="text-[12px] text-subtle">{FIELD_HINTS[field]}</div>
                  </div>
                  <Select value={header ?? NONE} onValueChange={(v) => setField(field, v === NONE ? null : v)}>
                    <SelectTrigger className={required && !header ? 'border-red-500/40' : undefined}>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>
                        <span className="text-muted">{required ? 'Select a column…' : 'Not mapped'}</span>
                      </SelectItem>
                      <SelectSeparator />
                      {upload.headers
                        .filter((h) => h !== '')
                        .map((h) => (
                          <SelectItem key={h} value={h}>
                            <span className="font-mono text-[13px]">{h}</span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <div className="min-w-0 text-[12px]">
                    {!header ? (
                      <span className={required ? 'text-red-300' : 'text-subtle'}>
                        {required ? 'Required — choose a column' : 'Skipped'}
                      </span>
                    ) : samples.length === 0 ? (
                      <span className="text-subtle">No values in sample rows</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {samples.map((v, i) => (
                          <span
                            key={i}
                            className="max-w-[220px] truncate rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11.5px] text-zinc-300"
                            title={v}
                          >
                            {v.replace(/\s+/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {upload.sampleRows.length > 0 && mappedFields.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 pt-5">
            <SectionTitle title="Sample preview" description={`First ${upload.sampleRows.length} rows with the current mapping`} />
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12">Row</TableHead>
                {mappedFields.map((f) => (
                  <TableHead key={f}>{CSV_FIELD_LABELS[f]}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {upload.sampleRows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="tabular text-subtle">{i + 1}</TableCell>
                  {mappedFields.map((f) => (
                    <TableCell key={f} className="max-w-[280px]">
                      <div className="line-clamp-2 whitespace-pre-wrap break-words text-[13px]">
                        {r[mapping[f] as string] || <span className="text-subtle">—</span>}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
