import { randomUUID } from 'node:crypto';
import type {
  BoardTarget,
  CardImportStatus,
  CardResult,
  ColumnMapping,
  ImportPhase,
  ImportProgress,
  ImportSseEvent,
  ImportStatus,
  ParsedCard,
  StartImportRequest,
  TrelloLabelColor,
} from '../../shared/types.js';
import { HttpError, TrelloApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getTrelloService, type CallOptions } from '../services/trello.service.js';
import { getUpload, readUpload } from '../services/upload-store.js';
import { buildParseResult, parseCsvBuffer } from './csv-parser.js';
import {
  countCards,
  createImport,
  getFailedCards,
  getImport,
  insertCards,
  listUnfinishedImports,
  progressFromRow,
  updateCard,
  updateImport,
  updatePendingCards,
  type NewCard,
} from '../database/import-repository.js';

export type ImportListener = (event: ImportSseEvent) => void;

interface ImportOptions {
  reuseExistingLists: boolean;
  createMissingLists: boolean;
  skipDuplicates: boolean;
}

type Source =
  | { kind: 'upload'; uploadId: string; filename: string; mapping: ColumnMapping; target: BoardTarget }
  | { kind: 'retry'; cards: ParsedCard[]; boardId: string };

interface RunState {
  id: string;
  progress: ImportProgress;
  controller: AbortController;
  listeners: Set<ImportListener>;
  cancelRequested: boolean;
  options: ImportOptions;
  source: Source;
}

/** Imports currently executing in this process (normally at most one). */
const running = new Map<string, RunState>();

const LABEL_COLORS: TrelloLabelColor[] = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black'];
const IN_FLIGHT_CANCEL_ERROR = 'Cancelled while request in flight; card may exist in Trello';
const RECOVERY_ERROR = 'Server stopped during import';

const norm = (s: string): string => s.trim().toLowerCase();

class FatalImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalImportError';
  }
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (err && typeof err === 'object' && 'name' in err && (err as { name: unknown }).name === 'AbortError') return true;
  return Boolean(signal?.aborted);
}

function isUnauthorized(err: unknown): err is TrelloApiError {
  return err instanceof TrelloApiError && err.code === 'TRELLO_UNAUTHORIZED';
}

function errorMessage(err: unknown): string {
  if (err instanceof TrelloApiError || err instanceof HttpError || err instanceof FatalImportError) return err.message;
  if (err instanceof Error) return err.message || 'Unexpected error';
  return 'Unexpected error';
}

function emptyProgress(id: string): ImportProgress {
  return {
    importId: id,
    status: 'pending',
    phase: 'queued',
    currentOperation: 'Queued',
    currentList: null,
    totalOperations: 0,
    completedOperations: 0,
    percent: 0,
    totalCards: 0,
    cardsImported: 0,
    cardsFailed: 0,
    cardsSkipped: 0,
    cardsRemaining: 0,
    listsCreated: 0,
    listsReused: 0,
    labelsCreated: 0,
    labelsReused: 0,
    boardId: null,
    boardName: null,
    boardUrl: null,
    fatalError: null,
    startedAt: null,
    finishedAt: null,
  };
}

function hasActiveImport(): boolean {
  return running.size > 0;
}

// ---------- events ----------

function emit(state: RunState, event: ImportSseEvent): void {
  for (const listener of [...state.listeners]) {
    try {
      listener(event);
    } catch (err) {
      logger.warn('Import listener threw:', err);
    }
  }
}

function recompute(p: ImportProgress): void {
  p.cardsRemaining = Math.max(0, p.totalCards - p.cardsImported - p.cardsFailed - p.cardsSkipped);
  p.percent = p.totalOperations > 0 ? Math.min(100, Math.round((p.completedOperations / p.totalOperations) * 100)) : 0;
  if (p.phase === 'done' && p.totalOperations === 0 && (p.status === 'completed' || p.status === 'completed_with_errors')) {
    p.percent = 100;
  }
}

/** Recompute derived fields, persist the import row and emit a progress event. */
function publish(state: RunState): void {
  const p = state.progress;
  recompute(p);
  try {
    updateImport(state.id, {
      status: p.status,
      phase: p.phase,
      startedAt: p.startedAt,
      finishedAt: p.finishedAt,
      boardId: p.boardId,
      boardName: p.boardName,
      boardUrl: p.boardUrl,
      totalCards: p.totalCards,
      successfulCards: p.cardsImported,
      failedCards: p.cardsFailed,
      skippedCards: p.cardsSkipped,
      listsCreated: p.listsCreated,
      listsReused: p.listsReused,
      labelsCreated: p.labelsCreated,
      labelsReused: p.labelsReused,
      totalOperations: p.totalOperations,
      completedOperations: p.completedOperations,
      fatalError: p.fatalError,
    });
  } catch (err) {
    logger.error('Failed to persist import progress:', err);
  }
  emit(state, { type: 'progress', data: { ...p } });
}

function setPhase(state: RunState, phase: ImportPhase, op: string, currentList: string | null = null): void {
  state.progress.phase = phase;
  state.progress.currentOperation = op;
  state.progress.currentList = currentList;
  publish(state);
}

// ---------- card bookkeeping ----------

interface WorkCard extends ParsedCard {
  status: CardImportStatus;
  attempts: number;
}

function finishCard(
  state: RunState,
  card: WorkCard,
  status: 'success' | 'failed' | 'skipped' | 'cancelled',
  extra: { error?: string | null; trelloCardId?: string | null; trelloCardUrl?: string | null } = {},
): void {
  card.status = status;
  try {
    updateCard(state.id, card.row, {
      status,
      error: extra.error ?? null,
      trelloCardId: extra.trelloCardId ?? null,
      trelloCardUrl: extra.trelloCardUrl ?? null,
      attempts: card.attempts,
    });
  } catch (err) {
    logger.error('Failed to persist card result:', err);
  }
  if (status === 'success') state.progress.cardsImported++;
  else if (status === 'failed') state.progress.cardsFailed++;
  else if (status === 'skipped') state.progress.cardsSkipped++;
  if (status !== 'cancelled') {
    const result: CardResult = {
      row: card.row,
      listName: card.listName,
      cardName: card.cardName,
      status,
      trelloCardId: extra.trelloCardId ?? null,
      trelloCardUrl: extra.trelloCardUrl ?? null,
      error: extra.error ?? null,
      attempts: card.attempts,
    };
    emit(state, { type: 'card', data: result });
  }
}

/** Mark every still-pending card with the given status. */
function finishPending(state: RunState, cards: WorkCard[], status: 'failed' | 'cancelled', error: string | null): void {
  for (const c of cards) if (c.status === 'pending') finishCard(state, c, status, { error });
}

// ---------- the import run ----------

async function loadCards(state: RunState): Promise<{ cards: WorkCard[]; boardId: string | null }> {
  const src = state.source;
  if (src.kind === 'retry') {
    return { cards: src.cards.map((c) => ({ ...c, status: 'pending', attempts: 0 })), boardId: src.boardId };
  }
  const upload = getUpload(src.uploadId);
  const buf = upload ? readUpload(src.uploadId) : null;
  if (!upload || !buf) throw new FatalImportError('The uploaded CSV file is no longer available. Please upload it again.');
  const raw = parseCsvBuffer(buf);
  const parsed = buildParseResult(src.uploadId, upload.filename, raw, src.mapping);
  if (!parsed.canImport) {
    throw new FatalImportError(`The CSV has ${parsed.errorCount} validation error${parsed.errorCount === 1 ? '' : 's'}; fix them before importing.`);
  }
  const cards: WorkCard[] = [...parsed.cards]
    .sort((a, b) => a.row - b.row)
    .map((c) => ({ ...c, status: 'pending', attempts: 0 }));
  return { cards, boardId: null };
}

async function runImport(state: RunState): Promise<void> {
  const p = state.progress;
  const signal = state.controller.signal;
  const opts = (onRetry?: CallOptions['onRetry']): CallOptions => ({ signal, onRetry });
  let cards: WorkCard[] = [];
  let boardReady = false;

  const checkCancelled = () => {
    if (state.cancelRequested || signal.aborted) {
      const e = new Error('Import cancelled');
      e.name = 'AbortError';
      throw e;
    }
  };

  try {
    p.status = 'running';
    p.startedAt = new Date().toISOString();

    // 1) credentials
    setPhase(state, 'validating_credentials', 'Validating Trello credentials');
    const trello = getTrelloService();
    try {
      await trello.getMe(opts());
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      throw new FatalImportError(`Trello credentials check failed: ${errorMessage(err)}`);
    }
    checkCancelled();

    // 2) cards
    const loaded = await loadCards(state);
    cards = loaded.cards;
    const toInsert: NewCard[] = cards.map((c) => ({
      row: c.row,
      listName: c.listName,
      cardName: c.cardName,
      description: c.description,
      labels: c.labels,
      status: 'pending',
    }));
    insertCards(state.id, toInsert);
    p.totalCards = cards.length;
    if (state.options.skipDuplicates) {
      for (const c of cards) if (c.isDuplicate) finishCard(state, c, 'skipped', { error: 'Duplicate of an earlier row (skipped)' });
    }
    publish(state);
    checkCancelled();

    // 3) board
    const src = state.source;
    let boardId: string;
    if (src.kind === 'retry' || src.target.mode === 'existing') {
      const id = src.kind === 'retry' ? src.boardId : (src.target as { mode: 'existing'; boardId: string }).boardId;
      setPhase(state, 'preparing_board', 'Loading target board');
      try {
        const board = await trello.getBoard(id, opts());
        if (board.closed) throw new FatalImportError(`Board "${board.name}" is closed (archived)`);
        boardId = board.id;
        p.boardId = board.id;
        p.boardName = board.name;
        p.boardUrl = board.url;
      } catch (err) {
        if (isAbortError(err, signal) || err instanceof FatalImportError) throw err;
        throw new FatalImportError(`Could not load target board: ${errorMessage(err)}`);
      }
    } else {
      const target = src.target as { mode: 'new'; name: string; desc?: string; idOrganization?: string | null };
      setPhase(state, 'preparing_board', `Creating board "${target.name}"`);
      try {
        const board = await trello.createBoard({ name: target.name, desc: target.desc, idOrganization: target.idOrganization ?? null }, opts());
        boardId = board.id;
        p.boardId = board.id;
        p.boardName = board.name;
        p.boardUrl = board.url;
      } catch (err) {
        if (isAbortError(err, signal)) throw err;
        throw new FatalImportError(`Could not create board: ${errorMessage(err)}`);
      }
    }
    boardReady = true;
    publish(state);
    checkCancelled();

    const active = cards.filter((c) => c.status === 'pending');

    // 4) lists
    setPhase(state, 'fetching_lists', 'Fetching lists on the board');
    let existingLists;
    try {
      existingLists = await trello.getLists(boardId, opts());
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      if (isUnauthorized(err)) throw new FatalImportError(err.message);
      throw new FatalImportError(`Could not fetch board lists: ${errorMessage(err)}`);
    }
    const existingByName = new Map<string, string>();
    for (const l of existingLists) {
      if (l.closed) continue;
      const k = norm(l.name);
      if (!existingByName.has(k)) existingByName.set(k, l.id);
    }

    // CSV lists in first-appearance order.
    const csvLists: { key: string; name: string }[] = [];
    const seenLists = new Set<string>();
    for (const c of active) {
      const k = norm(c.listName);
      if (!seenLists.has(k)) {
        seenLists.add(k);
        csvLists.push({ key: k, name: c.listName.trim() });
      }
    }

    const listIds = new Map<string, string>(); // key -> trello list id
    const listErrors = new Map<string, string>(); // key -> card error
    const listsToCreate: { key: string; name: string }[] = [];
    for (const l of csvLists) {
      const existing = existingByName.get(l.key);
      if (state.options.reuseExistingLists && existing) {
        listIds.set(l.key, existing);
        p.listsReused++;
      } else if (state.options.createMissingLists || (!state.options.reuseExistingLists && existing)) {
        listsToCreate.push(l);
      } else {
        listErrors.set(l.key, `List "${l.name}" does not exist on the board and list creation is disabled`);
      }
    }

    // Cards whose list can't exist fail right away (no Trello write involved).
    for (const c of active) {
      const e = listErrors.get(norm(c.listName));
      if (e) finishCard(state, c, 'failed', { error: e });
    }
    let attemptable = active.filter((c) => c.status === 'pending');

    // Labels needed by cards we'll attempt (computed now so totals are known early).
    const labelNames: { key: string; name: string }[] = [];
    const seenLabels = new Set<string>();
    for (const c of attemptable) {
      for (const lbl of c.labels) {
        const k = norm(lbl);
        if (!k || seenLabels.has(k)) continue;
        seenLabels.add(k);
        labelNames.push({ key: k, name: lbl.trim() });
      }
    }

    // Fetch existing labels now so the full operation count is known before the first write
    // (keeps percent monotonic).
    const labelIds = new Map<string, string>();
    let labelsToCreate: { key: string; name: string }[] = [];
    if (labelNames.length > 0) {
      p.currentOperation = 'Fetching labels on the board';
      publish(state);
      let existingLabels;
      try {
        existingLabels = await trello.getLabels(boardId, opts());
      } catch (err) {
        if (isAbortError(err, signal)) throw err;
        if (isUnauthorized(err)) throw new FatalImportError(err.message);
        throw new FatalImportError(`Could not fetch board labels: ${errorMessage(err)}`);
      }
      for (const lbl of existingLabels) {
        const k = norm(lbl.name ?? '');
        if (k && !labelIds.has(k)) labelIds.set(k, lbl.id);
      }
      labelsToCreate = labelNames.filter((l) => !labelIds.has(l.key));
      p.labelsReused = labelNames.length - labelsToCreate.length;
    }

    p.totalOperations = listsToCreate.length + labelsToCreate.length + attemptable.length;
    publish(state);
    checkCancelled();

    // 5) create lists sequentially in CSV order
    if (listsToCreate.length > 0) {
      setPhase(state, 'creating_lists', 'Creating lists');
      for (const l of listsToCreate) {
        checkCancelled();
        p.currentOperation = `Creating list "${l.name}"`;
        p.currentList = l.name;
        publish(state);
        try {
          const created = await trello.createList(boardId, l.name, opts());
          if (!created?.id) throw new Error('Trello did not return a list id');
          listIds.set(l.key, created.id);
          p.listsCreated++;
        } catch (err) {
          if (isAbortError(err, signal)) throw err;
          if (isUnauthorized(err)) throw new FatalImportError(err.message);
          const msg = `List creation failed: ${errorMessage(err)}`;
          listErrors.set(l.key, msg);
          logger.warn(`Import ${state.id}: could not create list "${l.name}":`, err);
        }
        p.completedOperations++;
        publish(state);
      }
      // Fail cards for lists that couldn't be created; they won't be attempted.
      for (const c of attemptable) {
        const e = listErrors.get(norm(c.listName));
        if (e) {
          finishCard(state, c, 'failed', { error: e });
          p.totalOperations--;
        }
      }
      attemptable = attemptable.filter((c) => c.status === 'pending');
      publish(state);
    }
    checkCancelled();

    // 6) labels
    if (labelsToCreate.length > 0) {
      setPhase(state, 'creating_labels', 'Creating labels');
      let colorIdx = 0;
      for (const l of labelsToCreate) {
        checkCancelled();
        p.currentOperation = `Creating label "${l.name}"`;
        p.currentList = null;
        publish(state);
        const color = LABEL_COLORS[colorIdx++ % LABEL_COLORS.length];
        try {
          const created = await trello.createLabel(boardId, l.name, color, opts());
          if (!created?.id) throw new Error('Trello did not return a label id');
          labelIds.set(l.key, created.id);
          p.labelsCreated++;
        } catch (err) {
          if (isAbortError(err, signal)) throw err;
          if (isUnauthorized(err)) throw new FatalImportError(err.message);
          // Cards still import, just without this label.
          logger.warn(`Import ${state.id}: could not create label "${l.name}"; cards will be imported without it:`, err);
        }
        p.completedOperations++;
        publish(state);
      }
    }
    checkCancelled();

    // 7) cards
    setPhase(state, 'creating_cards', 'Creating cards');
    for (const c of attemptable) {
      if (state.cancelRequested || signal.aborted) break;
      const idList = listIds.get(norm(c.listName));
      if (!idList) {
        // Should not happen; treat as a definitive failure without a write.
        finishCard(state, c, 'failed', { error: `List "${c.listName}" is not available on the board` });
        p.totalOperations--;
        publish(state);
        continue;
      }
      const idLabels = [...new Set(c.labels.map((l) => labelIds.get(norm(l))).filter((x): x is string => Boolean(x)))];
      p.currentOperation = `Creating card "${c.cardName}" in "${c.listName}"`;
      p.currentList = c.listName;
      publish(state);
      c.attempts = 1;
      try {
        const created = await trello.createCard(
          { idList, name: c.cardName, desc: c.description, idLabels },
          opts(() => {
            c.attempts++;
          }),
        );
        if (created && typeof created.id === 'string' && created.id) {
          finishCard(state, c, 'success', { trelloCardId: created.id, trelloCardUrl: created.shortUrl || created.url || null });
        } else {
          finishCard(state, c, 'failed', { error: 'Trello did not return a card id' });
        }
        p.completedOperations++;
      } catch (err) {
        if (isAbortError(err, signal)) {
          finishCard(state, c, 'failed', { error: IN_FLIGHT_CANCEL_ERROR });
          p.completedOperations++;
          publish(state);
          break;
        }
        if (isUnauthorized(err)) {
          finishCard(state, c, 'failed', { error: err.message });
          p.completedOperations++;
          finishPending(state, attemptable, 'failed', err.message);
          throw new FatalImportError(err.message);
        }
        finishCard(state, c, 'failed', { error: errorMessage(err) });
        p.completedOperations++;
      }
      publish(state);
    }

    if (state.cancelRequested || signal.aborted) {
      finalize(state, cards, 'cancelled', null);
      return;
    }

    // 8) finalize
    p.phase = 'finalizing';
    p.currentOperation = 'Finalizing';
    publish(state);
    finalize(state, cards, p.cardsFailed === 0 ? 'completed' : 'completed_with_errors', null);
  } catch (err) {
    if (isAbortError(err, signal) && !(err instanceof FatalImportError)) {
      finalize(state, cards, 'cancelled', null);
      return;
    }
    const msg = errorMessage(err);
    if (!(err instanceof FatalImportError) && !(err instanceof TrelloApiError) && !(err instanceof HttpError)) {
      logger.error(`Import ${state.id} crashed:`, err);
    } else {
      logger.warn(`Import ${state.id} failed: ${msg}`);
    }
    // Cards never attempted: retryable (failed) when the board exists, otherwise just cancelled.
    finishPending(state, cards, boardReady ? 'failed' : 'cancelled', boardReady ? `Import aborted: ${msg}` : null);
    finalize(state, cards, 'failed', msg);
  }
}

function finalize(state: RunState, cards: WorkCard[], status: ImportStatus, fatalError: string | null): void {
  const p = state.progress;
  try {
    finishPending(state, cards, 'cancelled', null);
    try {
      updatePendingCards(state.id, 'cancelled', null);
    } catch {
      /* ignore */
    }
    p.status = status;
    p.fatalError = fatalError;
    p.phase = 'done';
    p.finishedAt = new Date().toISOString();
    p.currentList = null;
    p.currentOperation =
      status === 'completed'
        ? 'Import completed'
        : status === 'completed_with_errors'
          ? `Import completed with ${p.cardsFailed} failed card${p.cardsFailed === 1 ? '' : 's'}`
          : status === 'cancelled'
            ? 'Import cancelled'
            : `Import failed: ${fatalError ?? 'unknown error'}`;
    publish(state);
    emit(state, { type: 'done', data: { ...p } });
  } finally {
    running.delete(state.id);
    state.listeners.clear();
  }
}

function launch(state: RunState): void {
  running.set(state.id, state);
  setImmediate(() => {
    runImport(state).catch((err) => {
      logger.error(`Import ${state.id} failed unexpectedly:`, err);
      try {
        finalize(state, [], 'failed', 'Unexpected internal error');
      } catch {
        running.delete(state.id);
      }
    });
  });
}

// ---------- public API ----------

/** Validate and start an import. Resolves with the import id immediately; work continues in the background. */
export async function startImport(req: StartImportRequest): Promise<string> {
  if (hasActiveImport()) throw new HttpError(409, 'Another import is running', 'IMPORT_RUNNING');
  const upload = getUpload(req.uploadId);
  if (!upload) throw new HttpError(404, 'Upload not found. Please upload the CSV again.', 'UPLOAD_NOT_FOUND');
  const options: ImportOptions = {
    reuseExistingLists: req.reuseExistingLists !== false,
    createMissingLists: req.createMissingLists !== false,
    skipDuplicates: req.skipDuplicates !== false,
  };
  const id = randomUUID();
  createImport({
    id,
    filename: upload.filename,
    status: 'pending',
    phase: 'queued',
    boardId: req.target.mode === 'existing' ? req.target.boardId : null,
    boardName: req.target.mode === 'new' ? req.target.name : null,
    optionsJson: JSON.stringify({ ...options, target: req.target, uploadId: req.uploadId }),
    mappingJson: JSON.stringify(req.mapping),
  });
  const progress = emptyProgress(id);
  progress.boardId = req.target.mode === 'existing' ? req.target.boardId : null;
  progress.boardName = req.target.mode === 'new' ? req.target.name : null;
  launch({
    id,
    progress,
    controller: new AbortController(),
    listeners: new Set(),
    cancelRequested: false,
    options,
    source: { kind: 'upload', uploadId: req.uploadId, filename: upload.filename, mapping: req.mapping, target: req.target },
  });
  return id;
}

/** Start a new import that retries the failed cards of a previous import on the same board. */
export async function startRetry(importId: string): Promise<string> {
  const original = getImport(importId);
  if (!original) throw new HttpError(404, 'Import not found', 'NOT_FOUND');
  if (running.has(importId) || original.status === 'running' || original.status === 'pending') {
    throw new HttpError(409, 'Import is still running', 'IMPORT_RUNNING');
  }
  if (hasActiveImport()) throw new HttpError(409, 'Another import is running', 'IMPORT_RUNNING');
  const failed = getFailedCards(importId);
  if (failed.length === 0) throw new HttpError(400, 'This import has no failed cards to retry', 'NO_FAILED_CARDS');
  if (!original.boardId) throw new HttpError(400, 'The original import has no target board to retry on', 'NO_BOARD');

  let prevOptions: Partial<ImportOptions> = {};
  try {
    prevOptions = JSON.parse(original.optionsJson) as Partial<ImportOptions>;
  } catch {
    /* ignore */
  }
  const options: ImportOptions = {
    reuseExistingLists: true,
    createMissingLists: prevOptions.createMissingLists !== false,
    skipDuplicates: false,
  };
  const id = randomUUID();
  createImport({
    id,
    filename: original.filename,
    status: 'pending',
    phase: 'queued',
    boardId: original.boardId,
    boardName: original.boardName,
    boardUrl: original.boardUrl,
    retryOf: original.id,
    optionsJson: JSON.stringify({ ...options, retryOf: original.id }),
    mappingJson: original.mappingJson,
  });
  const progress = emptyProgress(id);
  progress.boardId = original.boardId;
  progress.boardName = original.boardName;
  progress.boardUrl = original.boardUrl;
  const cards: ParsedCard[] = failed.map((c) => ({
    row: c.row,
    listName: c.listName,
    cardName: c.cardName,
    description: c.description,
    labels: c.labels,
    isDuplicate: false,
  }));
  launch({
    id,
    progress,
    controller: new AbortController(),
    listeners: new Set(),
    cancelRequested: false,
    options,
    source: { kind: 'retry', cards, boardId: original.boardId },
  });
  return id;
}

/** Request cancellation. Returns false if the import isn't running in this process. */
export function cancelImport(id: string): boolean {
  const state = running.get(id);
  if (!state) return false;
  if (!state.cancelRequested) {
    state.cancelRequested = true;
    state.progress.currentOperation = 'Cancelling…';
    try {
      publish(state);
    } catch {
      /* ignore */
    }
    state.controller.abort();
  }
  return true;
}

/** True when the import is currently executing in this process. */
export function isImportRunning(id: string): boolean {
  return running.has(id);
}

/** Subscribe to progress/card/done events of a running import. Returns an unsubscribe fn (no-op if not running). */
export function subscribe(id: string, listener: ImportListener): () => void {
  const state = running.get(id);
  if (!state) return () => {};
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

/** Current progress: live for running imports, reconstructed from the DB otherwise. */
export function getProgress(id: string): ImportProgress | null {
  const state = running.get(id);
  if (state) {
    recompute(state.progress);
    return { ...state.progress };
  }
  const row = getImport(id);
  return row ? progressFromRow(row) : null;
}

/** Mark imports left running/pending by a previous process as failed. Call once at startup. */
export function recoverInterruptedImports(): void {
  try {
    const rows = listUnfinishedImports().filter((r) => !running.has(r.id));
    for (const r of rows) {
      updatePendingCards(r.id, 'cancelled', null);
      const counts = countCards(r.id);
      updateImport(r.id, {
        status: 'failed',
        phase: 'done',
        fatalError: RECOVERY_ERROR,
        finishedAt: new Date().toISOString(),
        successfulCards: counts.success,
        failedCards: counts.failed,
        skippedCards: counts.skipped,
      });
    }
    if (rows.length > 0) logger.warn(`Marked ${rows.length} interrupted import(s) as failed`);
  } catch (err) {
    logger.error('Failed to recover interrupted imports:', err);
  }
}
