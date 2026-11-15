import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, Loader2, UploadCloud } from 'lucide-react';
import type { CsvUploadResult } from '@shared/types';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ErrorState } from '@/components/common';

// Mirrors the server default (MAX_UPLOAD_MB=5); the server enforces the real limit.
const MAX_BYTES = 5 * 1024 * 1024;

/** Upload a CSV and navigate to /import/:uploadId, passing the upload result as router state. */
export function CsvDropzone({ className, compact }: { className?: string; compact?: boolean }) {
  const navigate = useNavigate();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const dragDepth = React.useRef(0);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const looksCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel';
    if (!looksCsv) {
      setError('Please choose a .csv file.');
      return;
    }
    if (file.size === 0) {
      setError('That file is empty.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('File is larger than 5 MB.');
      return;
    }
    setUploading({ name: file.name, pct: 0 });
    try {
      const result: CsvUploadResult = await api.uploadCsv(file, (pct) => setUploading({ name: file.name, pct }));
      navigate(`/import/${encodeURIComponent(result.uploadId)}`, { state: { upload: result } });
    } catch (err) {
      setError(errorMessage(err));
      setUploading(null);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload CSV file"
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!uploading) void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          'group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface text-center transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'px-6 py-8' : 'px-6 py-14',
          dragging && 'border-white/40 bg-white/[0.04]',
          uploading && 'cursor-default',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        {uploading ? (
          <div className="flex w-full max-w-xs flex-col items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted" />
            <div className="text-sm text-foreground">
              Uploading <span className="font-mono text-[13px]">{uploading.name}</span>
            </div>
            <Progress value={uploading.pct} className="h-1" />
          </div>
        ) : (
          <>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2 transition-colors group-hover:border-border-strong">
              {dragging ? <FileUp className="size-4 text-foreground" /> : <UploadCloud className="size-4 text-muted" />}
            </div>
            <p className="text-sm font-medium text-foreground">
              {dragging ? 'Drop to upload' : 'Drop a CSV file here'}
            </p>
            <p className="mt-1 text-[13px] text-muted">
              Columns for list name, card name, description and labels. Up to 5 MB.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              Choose file
            </Button>
          </>
        )}
      </div>
      {error && <ErrorState title="Upload failed" message={error} className="mt-3" />}
    </div>
  );
}
