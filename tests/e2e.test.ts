/**
 * End-to-end test: real Express app + real TrelloService (HTTP, retries, rate limiter) + real
 * CSV pipeline + real SQLite, against a local fake Trello HTTP server that mimics the REST API.
 * Imports the sample CSV fixture.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  CsvParseResult, CsvUploadResult, ImportDetail, ImportProgress, StartImportResponse, DashboardStats, ImportRecord,
} from '../src/shared/types.js';

const KEY = 'a'.repeat(32);
const TOKEN = 'b'.repeat(64);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbi-e2e-'));
process.env.TBI_DB_PATH = path.join(tmp, 'e2e.sqlite');
process.env.TRELLO_API_KEY = KEY;
process.env.TRELLO_API_TOKEN = TOKEN;

// ---------- fake Trello REST server ----------
type Obj = Record<string, unknown>;
const trello = {
  boards: [] as Obj[], lists: [] as Obj[], labels: [] as Obj[], cards: [] as Obj[],
  seq: 0, authFailures: 0, flaky503Remaining: 0, failCardName: null as string | null, requests: [] as string[],
};
const id = () => (++trello.seq).toString(16).padStart(24, '0');

const fakeServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url!, 'http://x');
    const p = url.pathname.replace(/^\/1/, '');
    trello.requests.push(`${req.method} ${p}${url.search}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const auth = req.headers.authorization || '';
    if (!auth.includes(`oauth_consumer_key="${KEY}"`) || !auth.includes(`oauth_token="${TOKEN}"`)) {
      trello.authFailures++;
      return send(401, 'invalid token');
    }
    const body: Obj = raw ? JSON.parse(raw) : {};
    if (req.method === 'POST' && trello.flaky503Remaining > 0) {
      trello.flaky503Remaining--;
      return send(503, 'temporarily unavailable');
    }
    let m: RegExpMatchArray | null;
    if (req.method === 'GET' && p === '/members/me') return send(200, { id: 'm1', username: 'tester', fullName: 'Test User', avatarUrl: null, url: 'https://trello.com/tester' });
    if (req.method === 'GET' && p === '/members/me/boards') return send(200, trello.boards);
    if (req.method === 'GET' && p === '/members/me/organizations') return send(200, [{ id: '5f0000000000000000000001', name: 'ws', displayName: 'Workspace' }]);
    if (req.method === 'POST' && p.replace(/\/$/, '') === '/boards') {
      const b = { id: id(), name: body.name, desc: body.desc ?? '', url: 'https://trello.com/b/x', idOrganization: body.idOrganization ?? null, closed: false };
      trello.boards.push(b);
      if (body.defaultLists !== false) for (const n of ['To Do', 'Doing', 'Done']) trello.lists.push({ id: id(), name: n, idBoard: b.id, closed: false, pos: trello.lists.length });
      return send(200, b);
    }
    if ((m = p.match(/^\/boards\/(\w+)$/)) && req.method === 'GET') {
      const b = trello.boards.find((x) => x.id === m![1]);
      return b ? send(200, b) : send(404, 'The requested resource was not found.');
    }
    if ((m = p.match(/^\/boards\/(\w+)\/lists$/))) return send(200, trello.lists.filter((l) => l.idBoard === m![1]));
    if ((m = p.match(/^\/boards\/(\w+)\/labels$/))) return send(200, trello.labels.filter((l) => l.idBoard === m![1]));
    if (req.method === 'POST' && p === '/lists') {
      const l = { id: id(), name: body.name, idBoard: body.idBoard, closed: false, pos: trello.lists.length };
      trello.lists.push(l);
      return send(200, l);
    }
    if (req.method === 'POST' && p === '/labels') {
      const l = { id: id(), name: body.name, idBoard: body.idBoard, color: body.color ?? null };
      trello.labels.push(l);
      return send(200, l);
    }
    if (req.method === 'POST' && p === '/cards') {
      if (body.name === trello.failCardName) return send(400, 'invalid value for name');
      const list = trello.lists.find((l) => l.id === body.idList);
      if (!list) return send(400, 'invalid value for idList');
      const c = {
        id: id(), name: body.name, desc: body.desc ?? '', idList: body.idList, idBoard: list.idBoard,
        idLabels: typeof body.idLabels === 'string' && body.idLabels ? (body.idLabels as string).split(',') : [],
        url: 'https://trello.com/c/x', shortUrl: 'https://trello.com/c/x',
      };
      trello.cards.push(c);
      return send(200, c);
    }
    send(404, 'not found');
  });
});

let base = '';
let appServer: http.Server;

vi.mock('../src/server/services/trello.service.js', async (orig) => {
  const mod = await orig<typeof import('../src/server/services/trello.service.js')>();
  return {
    ...mod,
    getTrelloService: () =>
      mod.createTrelloService({ apiKey: KEY, apiToken: TOKEN }, { baseURL: process.env.FAKE_TRELLO_URL!, baseDelayMs: 5, maxDelayMs: 20 }),
  };
});

beforeAll(async () => {
  await new Promise<void>((r) => fakeServer.listen(0, '127.0.0.1', r));
  process.env.FAKE_TRELLO_URL = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}/1`;
  const { initDatabase } = await import('../src/server/database/db.js');
  const { createApp } = await import('../src/server/app.js');
  initDatabase();
  appServer = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => appServer.once('listening', r));
  base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  appServer?.close();
  fakeServer.close();
  const { closeDatabase } = await import('../src/server/database/db.js');
  closeDatabase();
});

async function api<T>(method: string, p: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, data: (text && r.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) as T };
}

async function upload(file: string): Promise<CsvUploadResult> {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)], { type: 'text/csv' }), path.basename(file));
  const r = await fetch(base + '/api/csv/upload', { method: 'POST', body: fd });
  expect(r.status).toBe(200);
  return (await r.json()) as CsvUploadResult;
}

/** Consume SSE until `done`, returning every progress snapshot. */
async function followEvents(importId: string): Promise<{ progress: ImportProgress[]; cards: number; final: ImportProgress }> {
  const r = await fetch(`${base}/api/imports/${importId}/events`);
  expect(r.headers.get('content-type')).toContain('text/event-stream');
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const progress: ImportProgress[] = [];
  let cards = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (\w+)/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (!ev || !data) continue;
      if (ev === 'progress') progress.push(JSON.parse(data));
      if (ev === 'card') cards++;
      if (ev === 'done') return { progress, cards, final: JSON.parse(data) };
    }
  }
  throw new Error('stream ended without done event');
}

const SAMPLE = path.join(__dirname, 'fixtures', 'sample-import.csv');

describe('end-to-end import of the sample CSV', () => {
  it('reports connection status without leaking credentials', async () => {
    const { status, data } = await api<Record<string, unknown>>('GET', '/api/settings/status?refresh=1');
    expect(status).toBe(200);
    expect(data.state).toBe('connected');
    expect(JSON.stringify(data)).not.toContain(KEY);
    expect(JSON.stringify(data)).not.toContain(TOKEN);
  });

  let importId = '';
  let upl: CsvUploadResult;

  it('uploads, parses, imports into a new board with live progress', async () => {
    upl = await upload(SAMPLE);
    expect(upl.rowCount).toBe(74);
    expect(upl.suggestedMapping).toEqual({ listName: 'List Name', cardName: 'Card Name', cardDescription: 'Card Description', labels: 'Labels' });

    const parsed = (await api<CsvParseResult>('POST', `/api/csv/${upl.uploadId}/parse`, { mapping: upl.suggestedMapping })).data;
    expect(parsed.canImport).toBe(true);
    expect(parsed.cards).toHaveLength(74);
    expect(parsed.lists.map((l) => l.name)).toHaveLength(9);

    trello.flaky503Remaining = 2; // first two writes hit transient 503s and must be retried
    const start = await api<StartImportResponse>('POST', '/api/imports', {
      uploadId: upl.uploadId, mapping: upl.suggestedMapping,
      target: { mode: 'new', name: 'Overtime V2', desc: 'Imported', idOrganization: '5f0000000000000000000001' },
      reuseExistingLists: true, createMissingLists: true, skipDuplicates: true,
    });
    expect(start.status).toBe(202);
    importId = start.data.importId;

    const { progress, cards, final } = await followEvents(importId);
    expect(final.status).toBe('completed');
    expect(final.cardsImported).toBe(74);
    expect(final.cardsFailed).toBe(0);
    expect(final.listsCreated).toBe(9);
    expect(final.labelsCreated).toBe(parsed.labels.length);
    expect(final.percent).toBe(100);
    expect(final.completedOperations).toBe(final.totalOperations);
    expect(final.totalOperations).toBe(9 + parsed.labels.length + 74);
    expect(cards).toBe(74);
    // progress is monotonic
    for (let i = 1; i < progress.length; i++) expect(progress[i].completedOperations).toBeGreaterThanOrEqual(progress[i - 1].completedOperations);

    // Trello state matches the CSV exactly
    const board = trello.boards.find((b) => b.name === 'Overtime V2')!;
    const lists = trello.lists.filter((l) => l.idBoard === board.id);
    expect(lists.map((l) => l.name)).toEqual(parsed.lists.map((l) => l.name)); // no default lists, CSV order
    for (const l of parsed.lists) {
      const tl = lists.find((x) => x.name === l.name)!;
      expect(trello.cards.filter((c) => c.idList === tl.id)).toHaveLength(l.cardCount);
    }
    for (const pc of parsed.cards) {
      const tc = trello.cards.find((c) => c.name === pc.cardName && lists.find((l) => l.id === c.idList)?.name === pc.listName)!;
      expect(tc, pc.cardName).toBeTruthy();
      expect(tc.desc).toBe(pc.description);
      const labelNames = (tc.idLabels as string[]).map((lid) => trello.labels.find((x) => x.id === lid)!.name);
      expect(labelNames).toEqual(pc.labels);
    }
    expect(trello.authFailures).toBe(0);
    // credentials never in URLs
    expect(trello.requests.join('\n')).not.toMatch(/key=|token=/);
  }, 60_000);

  it('records history and stats', async () => {
    const hist = (await api<ImportRecord[]>('GET', '/api/imports')).data;
    expect(hist[0]).toMatchObject({ id: importId, filename: 'sample-import.csv', totalCards: 74, successfulCards: 74, failedCards: 0, status: 'completed' });
    const stats = (await api<DashboardStats>('GET', '/api/stats')).data;
    expect(stats.totalCardsImported).toBe(74);
    expect(stats.totalListsCreated).toBe(9);
  });

  it('re-import into the same board reuses lists and labels, failed card can be retried', async () => {
    const boardId = trello.boards[0].id as string;
    const before = { lists: trello.lists.length, labels: trello.labels.length };
    trello.failCardName = 'Guardian';
    const start = await api<StartImportResponse>('POST', '/api/imports', {
      uploadId: upl.uploadId, mapping: upl.suggestedMapping, target: { mode: 'existing', boardId },
      reuseExistingLists: true, createMissingLists: true, skipDuplicates: true,
    });
    const { final } = await followEvents(start.data.importId);
    expect(final.status).toBe('completed_with_errors');
    expect(final.cardsImported).toBe(73);
    expect(final.cardsFailed).toBe(1);
    expect(final.listsCreated).toBe(0);
    expect(final.listsReused).toBe(9);
    expect(final.labelsCreated).toBe(0);
    expect(trello.lists.length).toBe(before.lists);
    expect(trello.labels.length).toBe(before.labels);

    const detail = (await api<ImportDetail>('GET', `/api/imports/${start.data.importId}`)).data;
    const failed = detail.cards.filter((c) => c.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].attempts).toBe(1); // 400 is not retried
    expect(failed[0].error).toMatch(/invalid value for name/i);

    const csv = await api<string>('GET', `/api/imports/${start.data.importId}/errors.csv`);
    expect(csv.status).toBe(200);
    expect(csv.data).toContain('Guardian');

    trello.failCardName = null;
    const retry = await api<StartImportResponse>('POST', `/api/imports/${start.data.importId}/retry`);
    expect(retry.status).toBe(202);
    const r2 = await followEvents(retry.data.importId);
    expect(r2.final.status).toBe('completed');
    expect(r2.final.cardsImported).toBe(1);
    expect(r2.final.totalCards).toBe(1);
  }, 60_000);

  it('rejects path traversal / bad ids', async () => {
    expect((await api('GET', '/api/imports/..%2F..%2Fetc')).status).toBe(400);
    expect((await api('POST', '/api/csv/not-a-uuid/parse', { mapping: upl.suggestedMapping })).status).toBeGreaterThanOrEqual(400);
    expect((await api('GET', '/api/trello/boards/../../x')).status).toBeGreaterThanOrEqual(400);
  });
});
