import type { SQLInputValue } from 'node:sqlite';
import { getDb, transaction } from './db.js';
import type {
  CardImportStatus,
  CardResult,
  DashboardStats,
  ImportDetail,
  ImportPhase,
  ImportProgress,
  ImportRecord,
  ImportStatus,
} from '../../shared/types.js';

/** Full DB row of the imports table (camelCased). */
export interface ImportRow {
  id: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  filename: string;
  boardId: string | null;
  boardName: string | null;
  boardUrl: string | null;
  status: ImportStatus;
  phase: ImportPhase;
  totalCards: number;
  successfulCards: number;
  failedCards: number;
  skippedCards: number;
  listsCreated: number;
  listsReused: number;
  labelsCreated: number;
  labelsReused: number;
  totalOperations: number;
  completedOperations: number;
  fatalError: string | null;
  retryOf: string | null;
  optionsJson: string;
  mappingJson: string;
}

/** Full DB row of the import_cards table. */
export interface CardRow {
  importId: string;
  row: number;
  listName: string;
  cardName: string;
  description: string;
  labels: string[];
  status: CardImportStatus;
  trelloCardId: string | null;
  trelloCardUrl: string | null;
  error: string | null;
  attempts: number;
}

const IMPORT_COLUMNS: Record<keyof ImportRow, string> = {
  id: 'id',
  createdAt: 'created_at',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  filename: 'filename',
  boardId: 'board_id',
  boardName: 'board_name',
  boardUrl: 'board_url',
  status: 'status',
  phase: 'phase',
  totalCards: 'total_cards',
  successfulCards: 'successful_cards',
  failedCards: 'failed_cards',
  skippedCards: 'skipped_cards',
  listsCreated: 'lists_created',
  listsReused: 'lists_reused',
  labelsCreated: 'labels_created',
  labelsReused: 'labels_reused',
  totalOperations: 'total_operations',
  completedOperations: 'completed_operations',
  fatalError: 'fatal_error',
  retryOf: 'retry_of',
  optionsJson: 'options_json',
  mappingJson: 'mapping_json',
};

type Raw = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => Number(v ?? 0) || 0;

function toImportRow(r: Raw): ImportRow {
  return {
    id: str(r.id),
    createdAt: str(r.created_at),
    startedAt: strOrNull(r.started_at),
    finishedAt: strOrNull(r.finished_at),
    filename: str(r.filename),
    boardId: strOrNull(r.board_id),
    boardName: strOrNull(r.board_name),
    boardUrl: strOrNull(r.board_url),
    status: str(r.status) as ImportStatus,
    phase: str(r.phase) as ImportPhase,
    totalCards: num(r.total_cards),
    successfulCards: num(r.successful_cards),
    failedCards: num(r.failed_cards),
    skippedCards: num(r.skipped_cards),
    listsCreated: num(r.lists_created),
    listsReused: num(r.lists_reused),
    labelsCreated: num(r.labels_created),
    labelsReused: num(r.labels_reused),
    totalOperations: num(r.total_operations),
    completedOperations: num(r.completed_operations),
    fatalError: strOrNull(r.fatal_error),
    retryOf: strOrNull(r.retry_of),
    optionsJson: str(r.options_json) || '{}',
    mappingJson: str(r.mapping_json) || '{}',
  };
}

function parseLabels(json: unknown): string[] {
  try {
    const v = JSON.parse(str(json) || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function toCardRow(r: Raw): CardRow {
  return {
    importId: str(r.import_id),
    row: num(r.row),
    listName: str(r.list_name),
    cardName: str(r.card_name),
    description: str(r.description),
    labels: parseLabels(r.labels_json),
    status: str(r.status) as CardImportStatus,
    trelloCardId: strOrNull(r.trello_card_id),
    trelloCardUrl: strOrNull(r.trello_card_url),
    error: strOrNull(r.error),
    attempts: num(r.attempts),
  };
}

export function toCardResult(c: CardRow): CardResult {
  return {
    row: c.row,
    listName: c.listName,
    cardName: c.cardName,
    status: c.status,
    trelloCardId: c.trelloCardId,
    trelloCardUrl: c.trelloCardUrl,
    error: c.error,
    attempts: c.attempts,
  };
}

export function toImportRecord(r: ImportRow): ImportRecord {
  return {
    id: r.id,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    filename: r.filename,
    boardId: r.boardId,
    boardName: r.boardName,
    boardUrl: r.boardUrl,
    totalCards: r.totalCards,
    successfulCards: r.successfulCards,
    failedCards: r.failedCards,
    skippedCards: r.skippedCards,
    listsCreated: r.listsCreated,
    labelsCreated: r.labelsCreated,
    status: r.status,
    retryOf: r.retryOf,
  };
}

function describeStatus(r: ImportRow): string {
  switch (r.status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Importing…';
    case 'completed':
      return 'Import completed';
    case 'completed_with_errors':
      return `Import completed with ${r.failedCards} failed card${r.failedCards === 1 ? '' : 's'}`;
    case 'failed':
      return r.fatalError ? `Import failed: ${r.fatalError}` : 'Import failed';
    case 'cancelled':
      return 'Import cancelled';
    default:
      return '';
  }
}

/** Reconstruct an ImportProgress snapshot from a persisted row (for imports not running in memory). */
export function progressFromRow(r: ImportRow): ImportProgress {
  const finished = r.status !== 'pending' && r.status !== 'running';
  let percent = r.totalOperations > 0 ? Math.round((r.completedOperations / r.totalOperations) * 100) : 0;
  if (finished && r.totalOperations === 0 && (r.status === 'completed' || r.status === 'completed_with_errors')) percent = 100;
  percent = Math.max(0, Math.min(100, percent));
  return {
    importId: r.id,
    status: r.status,
    phase: r.phase,
    currentOperation: describeStatus(r),
    currentList: null,
    totalOperations: r.totalOperations,
    completedOperations: r.completedOperations,
    percent,
    totalCards: r.totalCards,
    cardsImported: r.successfulCards,
    cardsFailed: r.failedCards,
    cardsSkipped: r.skippedCards,
    cardsRemaining: Math.max(0, r.totalCards - r.successfulCards - r.failedCards - r.skippedCards),
    listsCreated: r.listsCreated,
    listsReused: r.listsReused,
    labelsCreated: r.labelsCreated,
    labelsReused: r.labelsReused,
    boardId: r.boardId,
    boardName: r.boardName,
    boardUrl: r.boardUrl,
    fatalError: r.fatalError,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}

// ---------- imports ----------

export type NewImport = Pick<ImportRow, 'id' | 'filename'> &
  Partial<Omit<ImportRow, 'id' | 'filename'>>;

export function createImport(input: NewImport): ImportRow {
  const row: ImportRow = {
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    boardId: null,
    boardName: null,
    boardUrl: null,
    status: 'pending',
    phase: 'queued',
    totalCards: 0,
    successfulCards: 0,
    failedCards: 0,
    skippedCards: 0,
    listsCreated: 0,
    listsReused: 0,
    labelsCreated: 0,
    labelsReused: 0,
    totalOperations: 0,
    completedOperations: 0,
    fatalError: null,
    retryOf: null,
    optionsJson: '{}',
    mappingJson: '{}',
    ...input,
  };
  const keys = Object.keys(IMPORT_COLUMNS) as (keyof ImportRow)[];
  const cols = keys.map((k) => IMPORT_COLUMNS[k]);
  getDb()
    .prepare(`INSERT INTO imports (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => row[k] as SQLInputValue));
  return row;
}

export function updateImport(id: string, patch: Partial<Omit<ImportRow, 'id'>>): void {
  const keys = (Object.keys(patch) as (keyof ImportRow)[]).filter((k) => k !== 'id' && k in IMPORT_COLUMNS && patch[k as keyof typeof patch] !== undefined);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${IMPORT_COLUMNS[k]} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE imports SET ${sets} WHERE id = ?`)
    .run(...keys.map((k) => (patch as Record<string, unknown>)[k] as SQLInputValue), id);
}

export function getImport(id: string): ImportRow | null {
  const r = getDb().prepare('SELECT * FROM imports WHERE id = ?').get(id) as Raw | undefined;
  return r ? toImportRow(r) : null;
}

export function listImports(limit = 100): ImportRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM imports ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(Math.max(1, Math.min(1000, Math.floor(limit)))) as Raw[];
  return rows.map((r) => toImportRecord(toImportRow(r)));
}

/** Rows that were left running/pending (e.g. server crash). */
export function listUnfinishedImports(): ImportRow[] {
  const rows = getDb().prepare("SELECT * FROM imports WHERE status IN ('pending', 'running')").all() as Raw[];
  return rows.map(toImportRow);
}

// ---------- cards ----------

export interface NewCard {
  row: number;
  listName: string;
  cardName: string;
  description: string;
  labels: string[];
  status: CardImportStatus;
  error?: string | null;
}

export function insertCards(importId: string, cards: NewCard[]): void {
  if (cards.length === 0) return;
  transaction(() => {
    const stmt = getDb().prepare(
      `INSERT INTO import_cards (import_id, row, list_name, card_name, description, labels_json, status, error, attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    );
    for (const c of cards) {
      stmt.run(importId, c.row, c.listName, c.cardName, c.description, JSON.stringify(c.labels), c.status, c.error ?? null);
    }
  });
}

export interface CardPatch {
  status?: CardImportStatus;
  trelloCardId?: string | null;
  trelloCardUrl?: string | null;
  error?: string | null;
  attempts?: number;
}

const CARD_COLUMNS: Record<keyof CardPatch, string> = {
  status: 'status',
  trelloCardId: 'trello_card_id',
  trelloCardUrl: 'trello_card_url',
  error: 'error',
  attempts: 'attempts',
};

export function updateCard(importId: string, row: number, patch: CardPatch): void {
  const keys = (Object.keys(patch) as (keyof CardPatch)[]).filter((k) => k in CARD_COLUMNS && patch[k] !== undefined);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${CARD_COLUMNS[k]} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE import_cards SET ${sets} WHERE import_id = ? AND row = ?`)
    .run(...keys.map((k) => patch[k] as SQLInputValue), importId, row);
}

/** Set every card still in `pending` to the given status/error. Returns number changed. */
export function updatePendingCards(importId: string, status: CardImportStatus, error: string | null): number {
  const res = getDb()
    .prepare("UPDATE import_cards SET status = ?, error = ? WHERE import_id = ? AND status = 'pending'")
    .run(status, error, importId);
  return Number(res.changes);
}

export function getCards(importId: string): CardRow[] {
  const rows = getDb().prepare('SELECT * FROM import_cards WHERE import_id = ? ORDER BY row').all(importId) as Raw[];
  return rows.map(toCardRow);
}

export function getFailedCards(importId: string): CardRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM import_cards WHERE import_id = ? AND status = 'failed' ORDER BY row")
    .all(importId) as Raw[];
  return rows.map(toCardRow);
}

/** Recount card statuses for an import from import_cards. */
export function countCards(importId: string): Record<CardImportStatus, number> {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS n FROM import_cards WHERE import_id = ? GROUP BY status')
    .all(importId) as Raw[];
  const out: Record<CardImportStatus, number> = { pending: 0, success: 0, failed: 0, skipped: 0, cancelled: 0 };
  for (const r of rows) out[str(r.status) as CardImportStatus] = num(r.n);
  return out;
}

export function getImportDetail(id: string): ImportDetail | null {
  const row = getImport(id);
  if (!row) return null;
  return {
    record: toImportRecord(row),
    progress: progressFromRow(row),
    cards: getCards(id).map(toCardResult),
  };
}

// ---------- stats ----------

export function getStats(): DashboardStats {
  const r = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total_imports,
         COALESCE(SUM(successful_cards), 0) AS cards_imported,
         COALESCE(SUM(failed_cards), 0) AS cards_failed,
         COALESCE(SUM(lists_created), 0) AS lists_created,
         COALESCE(SUM(labels_created), 0) AS labels_created,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS successful,
         COALESCE(SUM(CASE WHEN status = 'completed_with_errors' THEN 1 ELSE 0 END), 0) AS partial,
         COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
         COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled
       FROM imports`,
    )
    .get() as Raw;
  return {
    totalImports: num(r.total_imports),
    totalCardsImported: num(r.cards_imported),
    totalCardsFailed: num(r.cards_failed),
    totalListsCreated: num(r.lists_created),
    totalLabelsCreated: num(r.labels_created),
    successfulImports: num(r.successful),
    partialImports: num(r.partial),
    failedImports: num(r.failed),
    cancelledImports: num(r.cancelled),
  };
}
