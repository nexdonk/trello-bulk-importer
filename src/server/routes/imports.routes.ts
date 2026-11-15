import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getFailedCards, getImportDetail, listImports } from '../database/import-repository.js';
import { cancelImport, getProgress, isImportRunning, startImport, startRetry, subscribe, type ImportListener } from '../imports/import-engine.js';
import type { ImportDetail, ImportRecord, StartImportRequest, StartImportResponse } from '../../shared/types.js';

export const importsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(req: Request): string {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) throw new HttpError(400, 'Invalid import id', 'VALIDATION_ERROR');
  return id;
}

const headerName = z.string().max(1024).nullable();

const startSchema = z.object({
  uploadId: z.string().regex(UUID_RE, 'Invalid upload id'),
  mapping: z.object({
    listName: headerName,
    cardName: headerName,
    cardDescription: headerName.optional().default(null),
    labels: headerName.optional().default(null),
  }),
  target: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('existing'),
      boardId: z.string().regex(/^[a-zA-Z0-9]{8,32}$/, 'Invalid board id'),
    }),
    z.object({
      mode: z.literal('new'),
      name: z.string().trim().min(1, 'Board name is required').max(16384, 'Board name is too long'),
      desc: z.string().max(16384).optional(),
      idOrganization: z.string().regex(/^[a-zA-Z0-9]{8,32}$/, 'Invalid workspace id').nullable().optional(),
    }),
  ]),
  reuseExistingLists: z.boolean().optional().default(true),
  createMissingLists: z.boolean().optional().default(true),
  skipDuplicates: z.boolean().optional().default(true),
});

// GET /api/imports -> ImportRecord[]
importsRouter.get('/', (_req, res) => {
  const body: ImportRecord[] = listImports(100);
  res.json(body);
});

// POST /api/imports -> 202 StartImportResponse
importsRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new HttpError(400, first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request', 'VALIDATION_ERROR', parsed.error.issues);
    }
    const importId = await startImport(parsed.data as StartImportRequest);
    const body: StartImportResponse = { importId };
    res.status(202).json(body);
  }),
);

// GET /api/imports/:id -> ImportDetail
importsRouter.get('/:id', (req, res) => {
  const id = requireId(req);
  const detail = getImportDetail(id);
  if (!detail) throw new HttpError(404, 'Import not found', 'NOT_FOUND');
  const live = getProgress(id);
  const body: ImportDetail = live ? { ...detail, progress: live } : detail;
  res.json(body);
});

// GET /api/imports/:id/events -> text/event-stream
importsRouter.get('/:id/events', (req, res) => {
  const id = requireId(req);
  const initial = getProgress(id);
  if (!initial) throw new HttpError(404, 'Import not found', 'NOT_FOUND');

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  const send = (event: string, data: unknown) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      logger.warn('SSE write failed:', err);
    }
  };

  send('progress', initial);
  if (!isImportRunning(id)) {
    send('done', initial);
    closed = true;
    res.end();
    return;
  }

  let unsubscribe: () => void = () => {};
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, 15_000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };

  const listener: ImportListener = (event) => {
    send(event.type, event.data);
    if (event.type === 'done') {
      cleanup();
      res.end();
    }
  };
  unsubscribe = subscribe(id, listener);

  // The import may have finished between getProgress and subscribe.
  if (!isImportRunning(id)) {
    const final = getProgress(id);
    if (final) send('done', final);
    cleanup();
    res.end();
    return;
  }

  req.on('close', cleanup);
});

// POST /api/imports/:id/cancel -> { ok: true }
importsRouter.post('/:id/cancel', (req, res) => {
  const id = requireId(req);
  const progress = getProgress(id);
  if (!progress) throw new HttpError(404, 'Import not found', 'NOT_FOUND');
  if (!cancelImport(id)) throw new HttpError(409, 'Import is not running', 'NOT_RUNNING');
  res.json({ ok: true });
});

// POST /api/imports/:id/retry -> 202 StartImportResponse
importsRouter.post(
  '/:id/retry',
  asyncHandler(async (req: Request, res: Response) => {
    const id = requireId(req);
    const importId = await startRetry(id);
    const body: StartImportResponse = { importId };
    res.status(202).json(body);
  }),
);

// ---------- errors.csv ----------

/** Neutralize spreadsheet formula injection, then CSV-escape. */
export function csvCell(value: string | number): string {
  let s = typeof value === 'number' ? String(value) : value ?? '';
  if (typeof value === 'string' && /^(?:[=+@\t\r]|-(?!\s))/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// GET /api/imports/:id/errors.csv
importsRouter.get('/:id/errors.csv', (req, res) => {
  const id = requireId(req);
  if (!getProgress(id)) throw new HttpError(404, 'Import not found', 'NOT_FOUND');
  const failed = getFailedCards(id);
  const lines = [['Row', 'List Name', 'Card Name', 'Card Description', 'Labels', 'Error', 'Attempts'].map(csvCell).join(',')];
  for (const c of failed) {
    lines.push(
      [c.row, c.listName, c.cardName, c.description, c.labels.join(', '), c.error ?? '', c.attempts].map(csvCell).join(','),
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="import-${id}-errors.csv"`);
  res.send('﻿' + lines.join('\r\n') + '\r\n');
});
