import express, { type ErrorRequestHandler } from 'express';
import { HttpError, TrelloApiError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { settingsRouter } from './routes/settings.routes.js';
import { trelloRouter } from './routes/trello.routes.js';
import { csvRouter } from './routes/csv.routes.js';
import { importsRouter } from './routes/imports.routes.js';
import { statsRouter } from './routes/stats.routes.js';
import type { ApiError } from '../shared/types.js';

/** Build the Express app with all /api routes. Static/Vite serving is added in index.ts. */
export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  // Basic hardening for a localhost tool.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use('/api', express.json({ limit: '10mb' }));
  // Never cache API responses.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/settings', settingsRouter);
  app.use('/api/trello', trelloRouter);
  app.use('/api/csv', csvRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api/stats', statsRouter);

  app.use('/api', (_req, res) => {
    const body: ApiError = { error: 'Not found', code: 'NOT_FOUND' };
    res.status(404).json(body);
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    void _next;
    let status = 500;
    let body: ApiError = { error: 'Internal server error', code: 'INTERNAL_ERROR' };
    if (err instanceof HttpError) {
      status = err.status;
      body = { error: err.message, code: err.code, details: err.details };
    } else if (err instanceof TrelloApiError) {
      status = err.code === 'TRELLO_UNAUTHORIZED' ? 401 : err.code === 'TRELLO_NOT_CONFIGURED' ? 400 : err.status && err.status < 500 ? err.status : 502;
      body = { error: err.message, code: err.code };
    } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      status = 400;
      body = { error: 'Malformed JSON body', code: 'BAD_JSON' };
    } else {
      logger.error('Unhandled error:', err);
    }
    if (res.headersSent) return;
    res.status(status).json(body);
  };
  app.use(errorHandler);
  return app;
}
