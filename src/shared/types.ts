/**
 * Shared API contract between the Express backend and the React frontend.
 * Everything here is type-only or pure data so it can be imported by both sides.
 * Server code imports this as `../../shared/types.js`; client code as `@shared/types`.
 */

// ---------- Generic API envelope ----------

/** Every JSON error response from the API has this shape (HTTP status >= 400). */
export interface ApiError {
  error: string;
  /** Optional machine-readable code, e.g. 'TRELLO_UNAUTHORIZED', 'VALIDATION_ERROR'. */
  code?: string;
  details?: unknown;
}

// ---------- Settings / connection ----------

export type ConnectionState = 'connected' | 'not_connected' | 'failed';

export interface TrelloMemberSummary {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  url: string;
}

/** GET /api/settings/status, POST /api/settings/test, PUT /api/settings/credentials */
export interface ConnectionStatus {
  state: ConnectionState;
  keyConfigured: boolean;
  tokenConfigured: boolean;
  /** Last 4 chars of the key only, e.g. "…a1b2". Never the full value. */
  keyHint: string | null;
  member: TrelloMemberSummary | null;
  /** Human readable error when state === 'failed'. */
  error: string | null;
  checkedAt: string; // ISO timestamp
}

/** PUT /api/settings/credentials body */
export interface CredentialsInput {
  apiKey: string;
  apiToken: string;
}

// ---------- Trello resources (sanitized, as returned by our API) ----------

export interface TrelloBoard {
  id: string;
  name: string;
  desc: string;
  url: string;
  idOrganization: string | null;
  closed: boolean;
}

export interface TrelloWorkspace {
  id: string;
  name: string;
  displayName: string;
}

export interface TrelloList {
  id: string;
  name: string;
  idBoard: string;
  closed: boolean;
  pos: number;
}

export type TrelloLabelColor =
  | 'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'blue' | 'sky' | 'lime' | 'pink' | 'black'
  | 'green_dark' | 'yellow_dark' | 'orange_dark' | 'red_dark' | 'purple_dark' | 'blue_dark' | 'sky_dark' | 'lime_dark' | 'pink_dark' | 'black_dark'
  | 'green_light' | 'yellow_light' | 'orange_light' | 'red_light' | 'purple_light' | 'blue_light' | 'sky_light' | 'lime_light' | 'pink_light' | 'black_light';

export interface TrelloLabel {
  id: string;
  idBoard: string;
  name: string;
  color: TrelloLabelColor | null;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idBoard: string;
  idLabels: string[];
  url: string;
  shortUrl: string;
}

// GET /api/trello/boards -> TrelloBoard[]
// GET /api/trello/workspaces -> TrelloWorkspace[]
// GET /api/trello/boards/:boardId/lists -> TrelloList[]
// GET /api/trello/boards/:boardId/labels -> TrelloLabel[]

// ---------- CSV ----------

/** Logical fields the importer understands. */
export type CsvField = 'listName' | 'cardName' | 'cardDescription' | 'labels';

export const CSV_FIELDS: readonly CsvField[] = ['listName', 'cardName', 'cardDescription', 'labels'] as const;

export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  listName: 'List Name',
  cardName: 'Card Name',
  cardDescription: 'Card Description',
  labels: 'Labels',
};

export const REQUIRED_CSV_FIELDS: readonly CsvField[] = ['listName', 'cardName'] as const;

/** Maps each logical field to a CSV header (exact header string) or null when unmapped. */
export type ColumnMapping = Record<CsvField, string | null>;

/** POST /api/csv/upload (multipart, field name "file") -> CsvUploadResult */
export interface CsvUploadResult {
  uploadId: string;
  filename: string;
  sizeBytes: number;
  headers: string[];
  rowCount: number;
  /** Auto-detected mapping from headers (case/space/punctuation-insensitive match + aliases). */
  suggestedMapping: ColumnMapping;
  /** First up to 5 raw rows keyed by header, for the mapping UI preview. */
  sampleRows: Record<string, string>[];
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  /** 1-based data row number (header row excluded). null for file-level issues. */
  row: number | null;
  field: CsvField | null;
  code:
    | 'MISSING_REQUIRED_COLUMN'
    | 'MISSING_VALUE'
    | 'DUPLICATE_CARD'
    | 'VALUE_TOO_LONG'
    | 'EMPTY_FILE'
    | 'PARSE_ERROR'
    | 'INVALID_LABEL';
  message: string;
}

export interface ParsedCard {
  /** 1-based data row number in the source CSV. */
  row: number;
  listName: string;
  cardName: string;
  /** Preserved verbatim (newlines, markdown, quotes). Empty string if absent. */
  description: string;
  /** Trimmed, de-duplicated label names, in CSV order. */
  labels: string[];
  /** True if an earlier row has the same listName+cardName (case-insensitive, trimmed). */
  isDuplicate: boolean;
}

export interface ListSummary {
  name: string;
  cardCount: number;
}

/** POST /api/csv/:uploadId/parse  body: { mapping: ColumnMapping } -> CsvParseResult */
export interface CsvParseResult {
  uploadId: string;
  filename: string;
  mapping: ColumnMapping;
  cards: ParsedCard[];
  /** Lists in first-appearance order. */
  lists: ListSummary[];
  /** Distinct label names in first-appearance order. */
  labels: string[];
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  duplicateCount: number;
  /** True when there are no 'error' severity issues. */
  canImport: boolean;
}

// ---------- Imports ----------

export type BoardTarget =
  | { mode: 'existing'; boardId: string }
  | { mode: 'new'; name: string; desc?: string; idOrganization?: string | null };

/** POST /api/imports body */
export interface StartImportRequest {
  uploadId: string;
  mapping: ColumnMapping;
  target: BoardTarget;
  /** Reuse open lists on the board whose name matches (case-insensitive, trimmed). Default true. */
  reuseExistingLists: boolean;
  /** Create lists that don't exist. If false, cards whose list is missing fail. Default true. */
  createMissingLists: boolean;
  /** Skip rows flagged isDuplicate. Default true. */
  skipDuplicates: boolean;
}

/** POST /api/imports -> StartImportResponse ; POST /api/imports/:id/retry -> StartImportResponse */
export interface StartImportResponse {
  importId: string;
}

export type ImportStatus =
  | 'pending'
  | 'running'
  | 'completed'          // every card succeeded
  | 'completed_with_errors'
  | 'failed'             // fatal error before/while importing (e.g. auth, board missing)
  | 'cancelled';

export type ImportPhase =
  | 'queued'
  | 'validating_credentials'
  | 'preparing_board'
  | 'fetching_lists'
  | 'creating_lists'
  | 'creating_labels'
  | 'creating_cards'
  | 'finalizing'
  | 'done';

export type CardImportStatus = 'pending' | 'success' | 'failed' | 'skipped' | 'cancelled';

export interface CardResult {
  row: number;
  listName: string;
  cardName: string;
  status: CardImportStatus;
  trelloCardId: string | null;
  trelloCardUrl: string | null;
  error: string | null;
  attempts: number;
}

/** Live progress snapshot. Sent as SSE `progress` events and returned in ImportDetail. */
export interface ImportProgress {
  importId: string;
  status: ImportStatus;
  phase: ImportPhase;
  /** Human-readable current operation, e.g. 'Creating card "Berserk" in "Combat"'. */
  currentOperation: string;
  currentList: string | null;
  /** Total Trello write operations planned (lists + labels + cards to create). */
  totalOperations: number;
  /** Write operations Trello has confirmed or definitively failed. */
  completedOperations: number;
  /** 0-100, = completedOperations / totalOperations, based on real API completions only. */
  percent: number;
  totalCards: number;
  cardsImported: number;
  cardsFailed: number;
  cardsSkipped: number;
  cardsRemaining: number;
  listsCreated: number;
  listsReused: number;
  labelsCreated: number;
  labelsReused: number;
  boardId: string | null;
  boardName: string | null;
  boardUrl: string | null;
  fatalError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * GET /api/imports/:id/events  (text/event-stream)
 *   event: progress  data: ImportProgress     (sent immediately on connect, then on every change)
 *   event: card      data: CardResult         (each time a card reaches success/failed/skipped)
 *   event: done      data: ImportProgress     (final; server then closes the stream)
 */
export type ImportSseEvent =
  | { type: 'progress'; data: ImportProgress }
  | { type: 'card'; data: CardResult }
  | { type: 'done'; data: ImportProgress };

/** Row in import history. GET /api/imports -> ImportRecord[] (newest first) */
export interface ImportRecord {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  filename: string;
  boardId: string | null;
  boardName: string | null;
  boardUrl: string | null;
  totalCards: number;
  successfulCards: number;
  failedCards: number;
  skippedCards: number;
  listsCreated: number;
  labelsCreated: number;
  status: ImportStatus;
  /** If this import is a retry, the id of the original import. */
  retryOf: string | null;
}

/** GET /api/imports/:id -> ImportDetail */
export interface ImportDetail {
  record: ImportRecord;
  progress: ImportProgress;
  cards: CardResult[];
}

// POST /api/imports/:id/cancel -> { ok: true }
// GET  /api/imports/:id/errors.csv -> text/csv  (columns: Row,List Name,Card Name,Card Description,Labels,Error,Attempts)

/** GET /api/stats -> DashboardStats */
export interface DashboardStats {
  totalImports: number;
  totalCardsImported: number;
  totalCardsFailed: number;
  totalListsCreated: number;
  totalLabelsCreated: number;
  successfulImports: number;   // status completed
  partialImports: number;      // completed_with_errors
  failedImports: number;       // failed
  cancelledImports: number;
}
