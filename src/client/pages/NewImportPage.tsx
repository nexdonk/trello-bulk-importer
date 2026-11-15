import { FileSpreadsheet } from 'lucide-react';
import { CsvDropzone } from '@/components/CsvDropzone';
import { PageHeader } from '@/components/common';
import { NotConnectedNotice } from '@/components/import/NotConnectedNotice';
import { Card, CardContent } from '@/components/ui/card';

const EXAMPLE = `List Name,Card Name,Card Description,Labels
Backlog,Set up CI,"Run tests on every push",infra
Backlog,Write docs,"Install steps
Usage examples","docs, good first issue"
In Progress,Login page,,frontend`;

export default function NewImportPage() {
  return (
    <>
      <PageHeader title="New import" description="Upload a CSV file to map, validate and preview before importing." />
      <NotConnectedNotice className="mb-6" />
      <CsvDropzone />
      <Card className="mt-6">
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileSpreadsheet className="size-4 text-muted" /> Expected format
          </div>
          <p className="text-[13px] text-muted">
            One row per card. A header row is required; columns are matched automatically and can be remapped in the next
            step. Labels are comma-separated within a cell. Descriptions can contain line breaks and Markdown when quoted.
          </p>
          <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-border bg-background p-4 font-mono text-[12px] leading-relaxed text-zinc-300">
            {EXAMPLE}
          </pre>
        </CardContent>
      </Card>
    </>
  );
}
