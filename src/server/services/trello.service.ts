import axios, { type AxiosInstance, type AxiosResponse, type Method } from 'axios';
import type {
  TrelloBoard, TrelloCard, TrelloLabel, TrelloLabelColor, TrelloList, TrelloMemberSummary, TrelloWorkspace,
} from '../../shared/types.js';
import { getCredentials } from '../config.js';
import { TrelloApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface CreateBoardInput { name: string; desc?: string; idOrganization?: string | null }
export interface CreateCardInput { idList: string; name: string; desc?: string; idLabels?: string[] }

/** Optional per-call options. `signal` aborts waiting/retrying (throws an AbortError-like Error with name 'AbortError'). */
export interface CallOptions { signal?: AbortSignal; onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void }

export interface TrelloService {
  getMe(opts?: CallOptions): Promise<TrelloMemberSummary>;
  getBoards(opts?: CallOptions): Promise<TrelloBoard[]>;
  getWorkspaces(opts?: CallOptions): Promise<TrelloWorkspace[]>;
  getBoard(boardId: string, opts?: CallOptions): Promise<TrelloBoard>;
  createBoard(input: CreateBoardInput, opts?: CallOptions): Promise<TrelloBoard>;
  getLists(boardId: string, opts?: CallOptions): Promise<TrelloList[]>;
  createList(boardId: string, name: string, opts?: CallOptions): Promise<TrelloList>;
  getLabels(boardId: string, opts?: CallOptions): Promise<TrelloLabel[]>;
  createLabel(boardId: string, name: string, color: TrelloLabelColor | null, opts?: CallOptions): Promise<TrelloLabel>;
  createCard(input: CreateCardInput, opts?: CallOptions): Promise<TrelloCard>;
}

/** Internal tuning knobs (mainly for tests). All optional. */
export interface TrelloServiceOptions {
  baseURL?: string;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Use a dedicated limiter (instead of the shared process-wide one). */
  limiter?: RateLimiter | RateLimiterOptions;
}

const DEFAULTS = {
  baseURL: 'https://api.trello.com/1',
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 5,
  timeoutMs: 30_000,
};

const NETWORK_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ERR_NETWORK', 'ERR_SOCKET_CONNECTION_TIMEOUT',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT',
]);

// ---------- Abort helpers ----------

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------- Rate limiter (sliding window + max concurrency) ----------

export interface RateLimiterOptions { maxPerWindow?: number; windowMs?: number; maxConcurrent?: number }

interface Waiter { resolve: (release: () => void) => void; reject: (err: Error) => void; signal?: AbortSignal; onAbort?: () => void }

export class RateLimiter {
  readonly maxPerWindow: number;
  readonly windowMs: number;
  readonly maxConcurrent: number;
  private stamps: number[] = [];
  private active = 0;
  private queue: Waiter[] = [];
  private pausedUntil = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: RateLimiterOptions = {}) {
    this.maxPerWindow = opts.maxPerWindow ?? 90;
    this.windowMs = opts.windowMs ?? 10_000;
    this.maxConcurrent = opts.maxConcurrent ?? 5;
  }

  /** Wait for a slot. Resolves with a release function that must be called when the request finishes. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const idx = this.queue.indexOf(waiter);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(abortError());
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
      this.pump();
    });
  }

  /** Globally block new requests for `ms` (used after a 429). */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
    this.pump();
  }

  /** Number of request starts within the current window (for tests/diagnostics). */
  get inWindow(): number {
    this.prune(Date.now());
    return this.stamps.length;
  }

  private prune(now: number): void {
    while (this.stamps.length && this.stamps[0] <= now - this.windowMs) this.stamps.shift();
  }

  private schedule(at: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(1, at - Date.now()));
    this.timer.unref?.();
  }

  private pump(): void {
    while (this.queue.length && this.active < this.maxConcurrent) {
      const now = Date.now();
      if (this.pausedUntil > now) return this.schedule(this.pausedUntil);
      this.prune(now);
      if (this.stamps.length >= this.maxPerWindow) return this.schedule(this.stamps[0] + this.windowMs);
      const waiter = this.queue.shift()!;
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      this.stamps.push(now);
      this.active++;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.pump();
      });
    }
  }
}

/** Shared per-process limiter: Trello allows 100 req/10s per token, 300 per key — stay under. */
const sharedLimiter = new RateLimiter({ maxPerWindow: 90, windowMs: 10_000, maxConcurrent: 5 });

// ---------- Error mapping ----------

function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[REDACTED]');
  return out
    .replace(/((?:key|token)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(oauth_(?:consumer_key|token)=")[^"]*"/gi, '$1[REDACTED]"');
}

function extractTrelloMessage(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return data.trim().slice(0, 500);
  if (typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of ['message', 'error']) if (typeof d[k] === 'string' && d[k]) return (d[k] as string).slice(0, 500);
    try {
      return JSON.stringify(data).slice(0, 500);
    } catch {
      return '';
    }
  }
  return String(data).slice(0, 500);
}

function parseRetryAfter(value: unknown): number | null {
  if (value == null) return null;
  const str = String(Array.isArray(value) ? value[0] : value).trim();
  if (!str) return null;
  const secs = Number(str);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(str);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

interface Classified { error: TrelloApiError; retryAfterMs: number | null; reason: string }

function classify(err: unknown, secrets: string[]): Classified {
  if (axios.isAxiosError(err)) {
    const res = err.response;
    if (res) {
      const status = res.status;
      const trelloMsg = scrub(extractTrelloMessage(res.data), secrets);
      const retryAfterMs = parseRetryAfter(res.headers?.['retry-after']);
      if (status === 401 || status === 403) {
        return {
          error: new TrelloApiError(
            `Trello rejected the API key or token${trelloMsg ? ` (${trelloMsg})` : ''}. Check your credentials in Settings.`,
            status, false, 'TRELLO_UNAUTHORIZED'),
          retryAfterMs, reason: `HTTP ${status}`,
        };
      }
      if (status === 404) {
        return {
          error: new TrelloApiError(`Trello resource not found${trelloMsg ? `: ${trelloMsg}` : ''}`, status, false, 'TRELLO_NOT_FOUND'),
          retryAfterMs, reason: 'HTTP 404',
        };
      }
      if (status === 429) {
        return {
          error: new TrelloApiError('Trello rate limit exceeded; please try again shortly', status, true, 'TRELLO_RATE_LIMITED'),
          retryAfterMs, reason: 'HTTP 429 rate limited',
        };
      }
      if (status >= 500) {
        return {
          error: new TrelloApiError(`Trello server error (HTTP ${status})${trelloMsg ? `: ${trelloMsg}` : ''}`, status, true, 'TRELLO_SERVER_ERROR'),
          retryAfterMs, reason: `HTTP ${status}`,
        };
      }
      if (status === 400 || status === 422) {
        return {
          error: new TrelloApiError(`Trello rejected the request${trelloMsg ? `: ${trelloMsg}` : ''}`, status, false, 'TRELLO_BAD_REQUEST'),
          retryAfterMs, reason: `HTTP ${status}`,
        };
      }
      return {
        error: new TrelloApiError(`Trello request failed (HTTP ${status})${trelloMsg ? `: ${trelloMsg}` : ''}`, status, false, 'TRELLO_ERROR'),
        retryAfterMs, reason: `HTTP ${status}`,
      };
    }
    const code = err.code ?? (err.cause as { code?: string } | undefined)?.code ?? 'UNKNOWN';
    if (NETWORK_CODES.has(code) || err.request) {
      const what = code === 'ECONNABORTED' || code === 'ETIMEDOUT' ? 'timed out' : `failed (${code})`;
      return {
        error: new TrelloApiError(`Could not reach Trello: network request ${what}`, null, true, 'TRELLO_NETWORK_ERROR'),
        retryAfterMs: null, reason: `network ${code}`,
      };
    }
    return {
      error: new TrelloApiError('Trello request failed before it was sent', null, false, 'TRELLO_ERROR'),
      retryAfterMs: null, reason: code,
    };
  }
  const code = (err as { code?: string } | null)?.code;
  if (code && NETWORK_CODES.has(code)) {
    return {
      error: new TrelloApiError(`Could not reach Trello: network request failed (${code})`, null, true, 'TRELLO_NETWORK_ERROR'),
      retryAfterMs: null, reason: `network ${code}`,
    };
  }
  return { error: new TrelloApiError('Unexpected error calling Trello', null, false, 'TRELLO_ERROR'), retryAfterMs: null, reason: 'unknown' };
}

// ---------- Mapping ----------

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function mapMember(r: Raw): TrelloMemberSummary {
  let avatarUrl = strOrNull(r.avatarUrl);
  if (avatarUrl && !/\.(png|jpe?g|gif|webp)$/i.test(avatarUrl)) avatarUrl = `${avatarUrl.replace(/\/+$/, '')}/170.png`;
  return { id: str(r.id), username: str(r.username), fullName: str(r.fullName), avatarUrl, url: str(r.url) };
}

function mapBoard(r: Raw): TrelloBoard {
  return {
    id: str(r.id), name: str(r.name), desc: str(r.desc), url: str(r.url),
    idOrganization: strOrNull(r.idOrganization), closed: Boolean(r.closed),
  };
}

function mapWorkspace(r: Raw): TrelloWorkspace {
  return { id: str(r.id), name: str(r.name), displayName: str(r.displayName) || str(r.name) };
}

function mapList(r: Raw): TrelloList {
  return { id: str(r.id), name: str(r.name), idBoard: str(r.idBoard), closed: Boolean(r.closed), pos: Number(r.pos) || 0 };
}

function mapLabel(r: Raw): TrelloLabel {
  return { id: str(r.id), idBoard: str(r.idBoard), name: str(r.name), color: (strOrNull(r.color) as TrelloLabelColor | null) };
}

function mapCard(r: Raw): TrelloCard {
  return {
    id: str(r.id), name: str(r.name), desc: str(r.desc), idList: str(r.idList), idBoard: str(r.idBoard),
    idLabels: Array.isArray(r.idLabels) ? r.idLabels.map(str) : [], url: str(r.url), shortUrl: str(r.shortUrl),
  };
}

function asArray(data: unknown): Raw[] {
  return Array.isArray(data) ? (data as Raw[]) : [];
}

// ---------- Service ----------

const BOARD_FIELDS = 'id,name,desc,url,idOrganization,closed';

function notConfigured(): TrelloApiError {
  return new TrelloApiError('Trello API key and token are not configured. Add them in Settings.', null, false, 'TRELLO_NOT_CONFIGURED');
}

/** For tests / credential validation with explicit (unsaved) credentials. */
/**
 * Optional TRELLO_API_BASE_URL override for testing against a local mock Trello server.
 * Only loopback http(s) URLs are honored so credentials can never be redirected to another host.
 */
function baseUrlOverride(): string | undefined {
  const raw = process.env.TRELLO_API_BASE_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (/^https?:$/.test(u.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return raw.replace(/\/+$/, '');
  } catch {
    /* ignore */
  }
  return undefined;
}

export function createTrelloService(creds: { apiKey: string; apiToken: string }, options: TrelloServiceOptions = {}): TrelloService {
  if (options.baseURL === undefined) options = { ...options, baseURL: baseUrlOverride() };
  const apiKey = (creds.apiKey || '').trim();
  const apiToken = (creds.apiToken || '').trim();
  const cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) } as typeof DEFAULTS & TrelloServiceOptions;
  const limiter = options.limiter instanceof RateLimiter ? options.limiter : options.limiter ? new RateLimiter(options.limiter) : sharedLimiter;
  const secrets = [apiKey, apiToken];

  const http: AxiosInstance = axios.create({
    baseURL: cfg.baseURL,
    timeout: cfg.timeoutMs,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `OAuth oauth_consumer_key="${apiKey}", oauth_token="${apiToken}"`,
    },
    // Never follow redirects with credentials attached to some other host.
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  async function request<T>(method: Method, path: string, params: Record<string, unknown> | undefined, data: unknown, opts: CallOptions = {}): Promise<T> {
    if (!apiKey || !apiToken) throw notConfigured();
    const { signal, onRetry } = opts;
    const maxAttempts = Math.max(1, cfg.maxAttempts);
    for (let attempt = 1; ; attempt++) {
      throwIfAborted(signal);
      const release = await limiter.acquire(signal);
      let res: AxiosResponse<T> | null = null;
      let failure: unknown = null;
      try {
        res = await http.request<T>({ method, url: path, params, data, signal });
      } catch (err) {
        failure = err;
      } finally {
        release();
      }
      if (res) return res.data;

      if (signal?.aborted || axios.isCancel(failure) || (axios.isAxiosError(failure) && failure.code === 'ERR_CANCELED')) {
        throw abortError();
      }
      const { error, retryAfterMs, reason } = classify(failure, secrets);
      if (!error.retryable || attempt >= maxAttempts) throw error;

      const backoff = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** (attempt - 1));
      const jittered = backoff / 2 + Math.random() * (backoff / 2);
      const delayMs = Math.round(Math.min(cfg.maxDelayMs, retryAfterMs != null ? Math.max(retryAfterMs, jittered) : jittered));
      if (error.status === 429) limiter.pause(delayMs);
      logger.warn(`Trello ${method.toUpperCase()} ${path} failed (${reason}); retry ${attempt}/${maxAttempts - 1} in ${delayMs}ms`);
      try {
        onRetry?.({ attempt, delayMs, reason });
      } catch {
        /* callback errors must not break retries */
      }
      await sleep(delayMs, signal);
    }
  }

  const enc = encodeURIComponent;

  return {
    async getMe(opts) {
      return mapMember(await request<Raw>('GET', '/members/me', { fields: 'id,username,fullName,avatarUrl,url' }, undefined, opts));
    },
    async getBoards(opts) {
      return asArray(await request('GET', '/members/me/boards', { filter: 'open', fields: BOARD_FIELDS }, undefined, opts)).map(mapBoard);
    },
    async getWorkspaces(opts) {
      return asArray(await request('GET', '/members/me/organizations', { fields: 'id,name,displayName' }, undefined, opts)).map(mapWorkspace);
    },
    async getBoard(boardId, opts) {
      return mapBoard(await request<Raw>('GET', `/boards/${enc(boardId)}`, { fields: BOARD_FIELDS }, undefined, opts));
    },
    async createBoard(input, opts) {
      const body: Record<string, unknown> = { name: input.name, desc: input.desc ?? '', defaultLists: false, defaultLabels: false };
      if (input.idOrganization) body.idOrganization = input.idOrganization;
      return mapBoard(await request<Raw>('POST', '/boards/', undefined, body, opts));
    },
    async getLists(boardId, opts) {
      return asArray(await request('GET', `/boards/${enc(boardId)}/lists`, { filter: 'open', fields: 'id,name,idBoard,closed,pos' }, undefined, opts)).map(mapList);
    },
    async createList(boardId, name, opts) {
      return mapList(await request<Raw>('POST', '/lists', undefined, { name, idBoard: boardId, pos: 'bottom' }, opts));
    },
    async getLabels(boardId, opts) {
      return asArray(await request('GET', `/boards/${enc(boardId)}/labels`, { fields: 'id,idBoard,name,color', limit: 1000 }, undefined, opts)).map(mapLabel);
    },
    async createLabel(boardId, name, color, opts) {
      return mapLabel(await request<Raw>('POST', '/labels', undefined, { name, color: color ?? null, idBoard: boardId }, opts));
    },
    async createCard(input, opts) {
      const body: Record<string, unknown> = { idList: input.idList, name: input.name, desc: input.desc ?? '', pos: 'bottom' };
      if (input.idLabels && input.idLabels.length) body.idLabels = input.idLabels.join(',');
      return mapCard(await request<Raw>('POST', '/cards', undefined, body, opts));
    },
  };
}

/** Returns a service bound to the CURRENT credentials from config.getCredentials(). Throws TrelloApiError('TRELLO_NOT_CONFIGURED') on use if missing. */
export function getTrelloService(): TrelloService {
  const current = (): TrelloService => {
    const creds = getCredentials();
    if (!creds.apiKey || !creds.apiToken) throw notConfigured();
    return createTrelloService(creds);
  };
  return {
    getMe: async (opts) => current().getMe(opts),
    getBoards: async (opts) => current().getBoards(opts),
    getWorkspaces: async (opts) => current().getWorkspaces(opts),
    getBoard: async (id, opts) => current().getBoard(id, opts),
    createBoard: async (input, opts) => current().createBoard(input, opts),
    getLists: async (id, opts) => current().getLists(id, opts),
    createList: async (id, name, opts) => current().createList(id, name, opts),
    getLabels: async (id, opts) => current().getLabels(id, opts),
    createLabel: async (id, name, color, opts) => current().createLabel(id, name, color, opts),
    createCard: async (input, opts) => current().createCard(input, opts),
  };
}
