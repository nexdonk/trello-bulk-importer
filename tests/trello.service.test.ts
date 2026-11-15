import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTrelloService, RateLimiter, type TrelloServiceOptions } from '../src/server/services/trello.service.js';
import { TrelloApiError } from '../src/server/utils/errors.js';
import { logger } from '../src/server/utils/logger.js';

const KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const TOKEN = 'ATTAtoken_secret-value_0123456789abcdef';

type Handler = (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void;
let handler: Handler = (_req, _body, res) => res.end('{}');
const seen: { method: string; url: string; auth: string | undefined; body: string }[] = [];
let server: http.Server;
let baseURL = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/1`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  seen.length = 0;
  vi.restoreAllMocks();
});

function svc(extra: TrelloServiceOptions = {}) {
  return createTrelloService(
    { apiKey: KEY, apiToken: TOKEN },
    { baseURL, baseDelayMs: 5, maxDelayMs: 50, timeoutMs: 2000, limiter: { maxPerWindow: 1000, windowMs: 1000, maxConcurrent: 5 }, ...extra },
  );
}

function json(res: http.ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

describe('trello.service', () => {
  it('sends OAuth header (no secrets in URL) and maps member', async () => {
    handler = (_req, _b, res) =>
      json(res, 200, { id: 'm1', username: 'bob', fullName: 'Bob', avatarUrl: 'https://trello-members.s3.amazonaws.com/m1/abc', url: 'https://trello.com/bob', extra: 'x' });
    const me = await svc().getMe();
    expect(me).toEqual({ id: 'm1', username: 'bob', fullName: 'Bob', avatarUrl: 'https://trello-members.s3.amazonaws.com/m1/abc/170.png', url: 'https://trello.com/bob' });
    expect(seen[0].auth).toBe(`OAuth oauth_consumer_key="${KEY}", oauth_token="${TOKEN}"`);
    expect(seen[0].url).not.toContain(KEY);
    expect(seen[0].url).not.toContain(TOKEN);
    expect(seen[0].url).toContain('/1/members/me?fields=');
  });

  it('sends card writes as JSON body preserving multiline descriptions', async () => {
    handler = (_req, body, res) => json(res, 200, { id: 'c1', ...JSON.parse(body), idLabels: ['l1', 'l2'], idBoard: 'b1', url: 'u', shortUrl: 's' });
    const desc = 'Line 1\n\n**bold** "quoted", & = ?\nLine 3';
    const card = await svc().createCard({ idList: 'list1', name: 'Card', desc, idLabels: ['l1', 'l2'] });
    const sent = JSON.parse(seen[0].body);
    expect(sent).toEqual({ idList: 'list1', name: 'Card', desc, pos: 'bottom', idLabels: 'l1,l2' });
    expect(card.desc).toBe(desc);
    expect(card.idLabels).toEqual(['l1', 'l2']);
  });

  it('retries 5xx with backoff and calls onRetry', async () => {
    let n = 0;
    handler = (_req, _b, res) => (++n < 3 ? json(res, 503, { message: 'busy' }) : json(res, 200, []));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const onRetry = vi.fn();
    const boards = await svc().getBoards({ onRetry });
    expect(boards).toEqual([]);
    expect(n).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1, reason: 'HTTP 503' });
    expect(warn.mock.calls.join(' ')).not.toContain('fields=');
  });

  it('honors Retry-After on 429 and pauses the limiter', async () => {
    let n = 0;
    handler = (_req, _b, res) => (++n === 1 ? json(res, 429, { message: 'rate' }, { 'Retry-After': '0.1' }) : json(res, 200, []));
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const limiter = new RateLimiter({ maxPerWindow: 1000, windowMs: 1000, maxConcurrent: 5 });
    const pause = vi.spyOn(limiter, 'pause');
    const delays: number[] = [];
    const start = Date.now();
    await svc({ limiter, maxDelayMs: 1000 }).getLists('board1234', { onRetry: (i) => delays.push(i.delayMs) });
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(pause).toHaveBeenCalledWith(delays[0]);
    expect(Date.now() - start).toBeGreaterThanOrEqual(90);
  });

  it('gives up after maxAttempts with retryable error', async () => {
    let n = 0;
    handler = (_req, _b, res) => {
      n++;
      json(res, 500, 'boom');
    };
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const err = await svc({ maxAttempts: 3 }).getBoards().catch((e) => e);
    expect(err).toBeInstanceOf(TrelloApiError);
    expect(err).toMatchObject({ code: 'TRELLO_SERVER_ERROR', retryable: true, status: 500 });
    expect(n).toBe(3);
  });

  it('does not retry 401 and returns friendly, redacted error', async () => {
    let n = 0;
    handler = (_req, _b, res) => {
      n++;
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end(`invalid token ${TOKEN} key=${KEY}`);
    };
    const err = await svc().getMe().catch((e) => e);
    expect(n).toBe(1);
    expect(err).toBeInstanceOf(TrelloApiError);
    expect(err).toMatchObject({ code: 'TRELLO_UNAUTHORIZED', retryable: false, status: 401 });
    expect(err.message).toMatch(/rejected the API key or token/);
    const dump = JSON.stringify(err) + err.message + String(err.stack);
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain(TOKEN);
    expect('config' in err).toBe(false);
  });

  it('maps 404 and 400 without retry', async () => {
    handler = (req, _b, res) => (req.url!.startsWith('/1/boards/') ? json(res, 404, 'The requested resource was not found.') : json(res, 400, { message: 'invalid value for idList' }));
    await expect(svc().getBoard('abcdefgh')).rejects.toMatchObject({ code: 'TRELLO_NOT_FOUND', retryable: false });
    const err = await svc().createCard({ idList: 'x', name: 'y' }).catch((e) => e);
    expect(err).toMatchObject({ code: 'TRELLO_BAD_REQUEST', retryable: false });
    expect(err.message).toContain('invalid value for idList');
    expect(seen).toHaveLength(2);
  });

  it('retries network errors (connection reset)', async () => {
    let n = 0;
    handler = (req, _b, res) => {
      if (++n === 1) return req.socket.destroy();
      json(res, 200, []);
    };
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const onRetry = vi.fn();
    await expect(svc().getWorkspaces({ onRetry })).resolves.toEqual([]);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0].reason).toMatch(/network/);
  });

  it('aborts in-flight requests and backoff waits with AbortError', async () => {
    handler = (_req, _b, res) => setTimeout(() => json(res, 200, []), 500);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const err = await svc().getBoards({ signal: ac.signal }).catch((e) => e);
    expect(err.name).toBe('AbortError');

    handler = (_req, _b, res) => json(res, 503, 'x');
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const ac2 = new AbortController();
    const err2 = await svc({ baseDelayMs: 10_000, maxDelayMs: 10_000 })
      .getBoards({ signal: ac2.signal, onRetry: () => setTimeout(() => ac2.abort(), 10) })
      .catch((e) => e);
    expect(err2.name).toBe('AbortError');
  });

  it('throws TRELLO_NOT_CONFIGURED when credentials are missing', async () => {
    await expect(createTrelloService({ apiKey: '', apiToken: '' }, { baseURL }).getMe()).rejects.toMatchObject({ code: 'TRELLO_NOT_CONFIGURED' });
    expect(seen).toHaveLength(0);
  });
});

describe('RateLimiter', () => {
  it('caps concurrency', async () => {
    const limiter = new RateLimiter({ maxPerWindow: 1000, windowMs: 1000, maxConcurrent: 2 });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const release = await limiter.acquire();
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        release();
      }),
    );
    expect(peak).toBe(2);
  });

  it('enforces the sliding window', async () => {
    const limiter = new RateLimiter({ maxPerWindow: 3, windowMs: 100, maxConcurrent: 10 });
    const start = Date.now();
    const times: number[] = [];
    await Promise.all(
      Array.from({ length: 7 }, async () => {
        const release = await limiter.acquire();
        times.push(Date.now() - start);
        release();
      }),
    );
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(50);
    expect(times[3]).toBeGreaterThanOrEqual(95);
    expect(times[6]).toBeGreaterThanOrEqual(195);
  });

  it('pause() blocks new acquisitions; abort removes waiter', async () => {
    const limiter = new RateLimiter({ maxPerWindow: 100, windowMs: 1000, maxConcurrent: 1 });
    limiter.pause(60);
    const start = Date.now();
    (await limiter.acquire())();
    expect(Date.now() - start).toBeGreaterThanOrEqual(55);

    const hold = await limiter.acquire();
    const ac = new AbortController();
    const p = limiter.acquire(ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    hold();
    (await limiter.acquire())();
  });
});
