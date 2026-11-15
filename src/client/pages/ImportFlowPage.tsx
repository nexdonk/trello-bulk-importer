import * as React from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, FileWarning, Loader2, Play, RefreshCw } from 'lucide-react';
import { REQUIRED_CSV_FIELDS } from '@shared/types';
import type { ColumnMapping, CsvParseResult, CsvUploadResult, StartImportRequest } from '@shared/types';
import { api, errorMessage } from '@/lib/api';
import { formatBytes, formatNumber } from '@/lib/utils';
import { useAsync } from '@/hooks/useAsync';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { NotConnectedNotice } from '@/components/import/NotConnectedNotice';
import { Stepper, type StepDef } from '@/components/import/shared';
import { MappingStep } from '@/components/import/MappingStep';
import { ValidationStep } from '@/components/import/ValidationStep';
import { BoardStep, planLists, type BoardConfig } from '@/components/import/BoardStep';
import { PreviewStep } from '@/components/import/PreviewStep';

const STEPS: StepDef[] = [
  { id: 'mapping', label: 'Column mapping' },
  { id: 'validation', label: 'Validation' },
  { id: 'board', label: 'Board' },
  { id: 'preview', label: 'Preview' },
];

/**
 * Per-tab copy of the upload metadata (CSV headers/sample only, never credentials) so the
 * flow survives a reload without a round trip; falls back to GET /api/csv/:uploadId.
 */
const storageKey = (id: string) => `tbi.upload.${id}`;

function loadUpload(id: string): CsvUploadResult | null {
  try {
    const raw = sessionStorage.getItem(storageKey(id));
    return raw ? (JSON.parse(raw) as CsvUploadResult) : null;
  } catch {
    return null;
  }
}

function storeUpload(u: CsvUploadResult) {
  try {
    sessionStorage.setItem(storageKey(u.uploadId), JSON.stringify(u));
  } catch {
    /* storage unavailable or full — not fatal */
  }
}

export default function ImportFlowPage() {
  const { uploadId = '' } = useParams();
  const location = useLocation();
  const initial = React.useMemo<CsvUploadResult | null>(() => {
    const fromState = (location.state as { upload?: CsvUploadResult } | null)?.upload;
    if (fromState && fromState.uploadId === uploadId) {
      storeUpload(fromState);
      return fromState;
    }
    return loadUpload(uploadId);
  }, [location.state, uploadId]);
  // Fall back to the server (GET /api/csv/:uploadId) when this tab has no copy.
  const fetched = useAsync(() => api.getUpload(uploadId), [uploadId], !initial && !!uploadId);
  const upload = initial ?? fetched.data ?? null;

  if (!upload && !fetched.error && uploadId) {
    return (
      <>
        <PageHeader title="New import" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }
  if (!upload) {
    return (
      <>
        <PageHeader title="New import" />
        <Card>
          <EmptyState
            icon={FileWarning}
            title="Upload not found"
            description="This upload has expired or was removed. Upload the CSV file again to continue."
            action={
              <Button asChild size="sm">
                <Link to="/import">Upload CSV</Link>
              </Button>
            }
          />
        </Card>
      </>
    );
  }
  return <ImportFlow key={upload.uploadId} upload={upload} />;
}

function ImportFlow({ upload }: { upload: CsvUploadResult }) {
  const uploadId = upload.uploadId;
  const navigate = useNavigate();
  const { status } = useConnectionStatus();
  const connected = status?.state === 'connected';

  const [step, setStep] = React.useState(0);
  const [mapping, setMapping] = React.useState<ColumnMapping | null>(upload ? { ...upload.suggestedMapping } : null);
  const [parse, setParse] = React.useState<CsvParseResult | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const parseSeq = React.useRef(0);

  const [config, setConfig] = React.useState<BoardConfig>(() => ({
    mode: 'existing',
    boardId: null,
    newName: upload ? upload.filename.replace(/\.csv$/i, '') : '',
    newDesc: '',
    idOrganization: null,
    reuseExistingLists: true,
    createMissingLists: true,
    skipDuplicates: true,
  }));
  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);

  // Re-parse whenever the mapping changes (debounced).
  const runParse = React.useCallback(
    (m: ColumnMapping) => {
      const seq = ++parseSeq.current;
      setParsing(true);
      setParseError(null);
      api
        .parseCsv(uploadId, m)
        .then((r) => {
          if (seq === parseSeq.current) setParse(r);
        })
        .catch((err) => {
          if (seq === parseSeq.current) setParseError(errorMessage(err));
        })
        .finally(() => {
          if (seq === parseSeq.current) setParsing(false);
        });
    },
    [uploadId],
  );

  React.useEffect(() => {
    if (!mapping) return;
    const t = setTimeout(() => runParse(mapping), 200);
    return () => clearTimeout(t);
  }, [mapping, runParse]);

  const boards = useAsync(() => api.getBoards(), [connected], connected);
  const workspaces = useAsync(() => api.getWorkspaces(), [connected], connected);
  const boardId = config.mode === 'existing' ? config.boardId : null;
  const boardLists = useAsync(() => api.getBoardLists(boardId as string), [boardId], !!boardId && connected);

  if (!mapping) return null;

  const requiredMapped = REQUIRED_CSV_FIELDS.every((f) => !!mapping[f]);
  const parseFresh = !!parse && !parsing;
  const canImport = parseFresh && parse!.canImport && requiredMapped;
  const boardReady = config.mode === 'existing' ? !!config.boardId : config.newName.trim().length > 0;

  const stepValid = [
    requiredMapped && parseFresh && !parseError, // mapping -> validation
    canImport, // validation -> board
    boardReady && canImport, // board -> preview
    boardReady && canImport && connected, // preview -> start
  ];
  let maxReachable = 0;
  while (maxReachable < STEPS.length - 1 && stepValid[maxReachable]) maxReachable++;

  const plan = parse ? planLists(parse.lists, config, boardLists.data) : [];
  const selectedBoard = boards.data?.find((b) => b.id === config.boardId);
  const boardLabel = config.mode === 'new' ? config.newName.trim() || 'New board' : selectedBoard?.name ?? '—';

  const start = async () => {
    if (!parse) return;
    setStarting(true);
    setStartError(null);
    const body: StartImportRequest = {
      uploadId,
      mapping,
      target:
        config.mode === 'existing'
          ? { mode: 'existing', boardId: config.boardId as string }
          : {
              mode: 'new',
              name: config.newName.trim(),
              desc: config.newDesc.trim() || undefined,
              idOrganization: config.idOrganization,
            },
      reuseExistingLists: config.mode === 'existing' ? config.reuseExistingLists : true,
      createMissingLists: config.createMissingLists,
      skipDuplicates: config.skipDuplicates,
    };
    try {
      const res = await api.startImport(body);
      navigate(`/imports/${encodeURIComponent(res.importId)}`);
    } catch (err) {
      setStartError(errorMessage(err));
      setStarting(false);
    }
  };

  const next = () => setStep((s) => Math.min(maxReachable, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const effectiveStep = Math.min(step, maxReachable);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/import" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> New import
          </Link>
        }
        title={<span className="font-mono text-lg">{upload.filename}</span>}
        description={`${formatNumber(upload.rowCount)} rows · ${upload.headers.length} columns · ${formatBytes(upload.sizeBytes)}`}
        actions={
          parsing ? (
            <span className="inline-flex items-center gap-2 text-[12px] text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Validating…
            </span>
          ) : null
        }
      />

      {!connected && <NotConnectedNotice className="mb-6" />}

      <Stepper steps={STEPS} current={effectiveStep} maxReachable={maxReachable} onSelect={setStep} />

      <div className="mt-6">
        {parseError && (
          <ErrorState className="mb-6" title="Could not parse CSV" message={parseError} onRetry={() => runParse(mapping)} />
        )}

        {effectiveStep === 0 && <MappingStep upload={upload} mapping={mapping} onChange={setMapping} />}

        {effectiveStep >= 1 && !parse && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {effectiveStep === 1 && parse && <ValidationStep result={parse} />}

        {effectiveStep === 2 && parse && (
          <BoardStep
            config={config}
            onChange={setConfig}
            boards={boards.data}
            boardsLoading={boards.loading}
            boardsError={connected ? boards.error : 'Connect to Trello in Settings to load your boards.'}
            onReloadBoards={boards.reload}
            workspaces={workspaces.data}
            workspacesLoading={workspaces.loading}
            boardLists={boardLists.data}
            boardListsLoading={boardLists.loading}
            boardListsError={boardLists.error}
            csvLists={parse.lists}
            duplicateCount={parse.duplicateCount}
          />
        )}

        {effectiveStep === 3 && parse && (
          <PreviewStep result={parse} plan={plan} skipDuplicates={config.skipDuplicates} boardLabel={boardLabel} />
        )}
      </div>

      {startError && <ErrorState className="mt-6" title="Could not start import" message={startError} />}

      <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex items-center justify-between gap-3 border-t border-border bg-background/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <Button variant="ghost" onClick={back} disabled={effectiveStep === 0 || starting}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex items-center gap-3">
          {effectiveStep === 1 && parse && !parse.canImport && (
            <span className="hidden text-[12px] text-red-300 sm:inline">Resolve errors to continue</span>
          )}
          {effectiveStep === 0 && !requiredMapped && (
            <span className="hidden text-[12px] text-muted sm:inline">Map List Name and Card Name</span>
          )}
          {effectiveStep === 2 && !boardReady && (
            <span className="hidden text-[12px] text-muted sm:inline">
              {config.mode === 'existing' ? 'Select a board' : 'Enter a board name'}
            </span>
          )}
          {effectiveStep < STEPS.length - 1 ? (
            <Button onClick={next} disabled={!stepValid[effectiveStep]}>
              {parsing && effectiveStep === 0 ? <RefreshCw className="animate-spin" /> : null}
              Continue <ArrowRight />
            </Button>
          ) : (
            <Button onClick={start} disabled={!stepValid[3] || starting}>
              {starting ? <Loader2 className="animate-spin" /> : <Play />}
              Start import
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
