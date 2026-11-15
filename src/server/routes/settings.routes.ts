import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import type { ConnectionStatus, TrelloMemberSummary } from '../../shared/types.js';
import { getCredentials, hasCredentials, saveCredentials } from '../config.js';
import { createTrelloService, getTrelloService } from '../services/trello.service.js';
import { asyncHandler, HttpError, TrelloApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const settingsRouter = express.Router();

const CACHE_TTL_MS = 30_000;

let cache: { fingerprint: string; at: number; status: ConnectionStatus } | null = null;
let inFlight: { fingerprint: string; promise: Promise<ConnectionStatus> } | null = null;

function fingerprint(): string {
  const { apiKey, apiToken } = getCredentials();
  return crypto.createHash('sha256').update(`${apiKey}\u0000${apiToken}`).digest('hex');
}

function keyHint(apiKey: string): string | null {
  return apiKey ? `…${apiKey.slice(-4)}` : null;
}

function buildStatus(state: ConnectionStatus['state'], member: TrelloMemberSummary | null, error: string | null): ConnectionStatus {
  const { apiKey, apiToken } = getCredentials();
  return {
    state,
    keyConfigured: Boolean(apiKey),
    tokenConfigured: Boolean(apiToken),
    keyHint: keyHint(apiKey),
    member,
    error,
    checkedAt: new Date().toISOString(),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof TrelloApiError) return err.message;
  return 'Unexpected error while contacting Trello';
}

function invalidateCache(): void {
  cache = null;
  inFlight = null;
}

async function checkStatus(fresh: boolean): Promise<ConnectionStatus> {
  if (!hasCredentials()) return buildStatus('not_connected', null, null);
  const fp = fingerprint();
  if (!fresh && cache && cache.fingerprint === fp && Date.now() - cache.at < CACHE_TTL_MS) return cache.status;
  if (inFlight && inFlight.fingerprint === fp) return inFlight.promise;

  const promise = (async () => {
    let status: ConnectionStatus;
    try {
      const member = await getTrelloService().getMe({});
      status = buildStatus('connected', member, null);
    } catch (err) {
      if (!(err instanceof TrelloApiError)) logger.error('Connection check failed:', err);
      status = buildStatus('failed', null, errorMessage(err));
    }
    // Only cache if credentials didn't change meanwhile.
    if (fingerprint() === fp) cache = { fingerprint: fp, at: Date.now(), status };
    return status;
  })();
  inFlight = { fingerprint: fp, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

settingsRouter.get(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await checkStatus(refresh));
  }),
);

settingsRouter.post(
  '/test',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await checkStatus(true));
  }),
);

const credentialsSchema = z.object({
  apiKey: z
    .string({ required_error: 'API key is required' })
    .trim()
    .min(1, 'API key is required')
    .regex(/^[A-Za-z0-9]{16,128}$/, 'API key looks invalid (expected 16-128 letters/digits, usually 32 hex characters)'),
  apiToken: z
    .string({ required_error: 'API token is required' })
    .trim()
    .min(1, 'API token is required')
    .regex(/^[A-Za-z0-9_-]{16,512}$/, 'API token looks invalid (expected 16-512 letters, digits, "_" or "-")'),
});

settingsRouter.put(
  '/credentials',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = credentialsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      throw new HttpError(400, issues[0]?.message ?? 'Invalid credentials', 'VALIDATION_ERROR', issues);
    }
    const { apiKey, apiToken } = parsed.data;

    let member: TrelloMemberSummary;
    try {
      member = await createTrelloService({ apiKey, apiToken }, { maxAttempts: 2 }).getMe();
    } catch (err) {
      if (err instanceof TrelloApiError) {
        if (['TRELLO_UNAUTHORIZED', 'TRELLO_BAD_REQUEST', 'TRELLO_NOT_FOUND'].includes(err.code)) {
          throw new HttpError(400, 'Trello rejected the API key or token. Double-check both values. The token is not the Power-Up \"Secret\": generate it with the Token link on your API key page (tokens usually start with ATTA).', 'INVALID_CREDENTIALS');
        }
        throw new HttpError(502, `Could not verify credentials with Trello: ${err.message}`, err.code);
      }
      logger.error('Credential validation failed:', err);
      throw new HttpError(502, 'Could not verify credentials with Trello', 'TRELLO_ERROR');
    }

    saveCredentials(apiKey, apiToken);
    invalidateCache();
    const status = buildStatus('connected', member, null);
    cache = { fingerprint: fingerprint(), at: Date.now(), status };
    logger.info(`Trello credentials saved for @${member.username}`);
    res.json(status);
  }),
);

settingsRouter.delete(
  '/credentials',
  asyncHandler(async (_req: Request, res: Response) => {
    saveCredentials('', '');
    invalidateCache();
    logger.info('Trello credentials cleared');
    res.json(buildStatus('not_connected', null, null));
  }),
);
