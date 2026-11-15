import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportProgress, ImportSseEvent, StartImportRequest, TrelloLabel, TrelloList } from '../src/shared/types.js';

// ---------- fake in-memory Trello ----------

const fake = vi.hoisted(() => {
  type Card = { id: string; idList: string; name: string; desc: string; idLabels: string[] };
  const state = {
    boards: new Map<string, { id: string; name: string; closed: boolean }>(),
    lists: [] as { id: string; idBoard: string; name: string; closed: boolean; pos: number }[],
    labels: [] as { id: string; idBoard: string; name: string; color: string | null }[],
    cards: [] as Card[],
    calls: { createList: 0, createLabel: 0, createCard: 0 },
    failCardNames: new Set<string>(),
    unauthorizedOnCard: null as string | null,
    retryOnceCardNames: new Set<string>(),
    cardDelayMs: 0,
    seq: 0,
  };
  const nextId = () => (++state.seq).toString(16).padStart(24, '0');
  const reset = () => {
    state.boards.clear();
    state.lists = [];
    state.labels = [];
    state.cards = [];
    state.calls = { createList: 0, createLabel: 0, createCard: 0 };
    state.failCardNames.clear();
    state.unauthorizedOnCard = null;
    state.retryOnceCardNames.clear();
    state.cardDelayMs = 0;
  };
  return { state, nextId, reset };
});

vi.mock('../src/server/services/trello.service.js', async () => {
  const { TrelloApiError } = await import('../src/server/utils/errors.js');
  type Opts = { signal?: AbortSignal; onRetry?: (i: { attempt: number; delayMs: number; reason: string }) => void };
  const abortErr = () => {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    return e;
  };
  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortErr());
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(abortErr());
      });
    });
  const s = fake.state;
  const service = {
    getMe: async () => ({ id: 'me', username: 'me', fullName: 'Me', avatarUrl: null, url: '' }),
    getBoards: async () => [],
    getWorkspaces: async () => [],
    getBoard: async (id: string) => {
      const b = s.boards.get(id);
      if (!b) throw new TrelloApiError('Board not found', 404, false, 'TRELLO_NOT_FOUND');
      return { ...b, desc: '', url: `https://trello.com/b/${b.id}`, idOrganization: null };
    },
    createBoard: async (input: { name: string }) => {
      const id = fake.nextId();
      s.boards.set(id, { id, name: input.name, closed: false });
      return { id, name: input.name, desc: '', url: `https://trello.com/b/${id}`, idOrganization: null, closed: false };
    },
    getLists: async (boardId: string) => s.lists.filter((l) => l.idBoard === boardId),
    createList: async (boardId: string, name: string) => {
      s.calls.createList++;
      const l = { id: fake.nextId(), idBoard: boardId, name, closed: false, pos: s.lists.length };
      s.lists.push(l);
      return l;
    },
    getLabels: async (boardId: string) => s.labels.filter((l) => l.idBoard === boardId),
    createLabel: async (boardId: string, name: string, color: string | null) => {
      s.calls.createLabel++;
      const l = { id: fake.nextId(), idBoard: boardId, name, color };
      s.labels.push(l);
      return l;
    },
    createCard: async (input: { idList: string; name: string; desc?: string; idLabels?: string[] }, opts?: Opts) => {
      s.calls.createCard++;
      if (s.cardDelayMs) await wait(s.cardDelayMs, opts?.signal);
      if (s.retryOnceCardNames.has(input.name)) opts?.onRetry?.({ attempt: 1, delayMs: 0, reason: '429' });
      if (s.unauthorizedOnCard === input.name) throw new TrelloApiError('Trello rejected the credentials', 401, false, 'TRELLO_UNAUTHORIZED');
      if (s.failCardNames.has(input.name)) throw new TrelloApiError('invalid value for name', 400, false, 'TRELLO_BAD_REQUEST');
      const card = { id: fake.nextId(), idList: input.idList, name: input.name, desc: input.desc ?? '', idLabels: input.idLabels ?? [] };
      s.cards.push(card);
      const list = s.lists.find((l) => l.id === input.idList);
      return { ...card, idBoard: list?.idBoard ?? '', url: `https://trello.com/c/${card.id}`, shortUrl: `https://trello.com/c/${card.id}` };
    },
  };
  return { getTrelloService: () => service, createTrelloService: () => service };
});

// ---------- fake upload store ----------

const uploads = vi.hoisted(() => new Map<string, { filename: string; buf: Buffer }>());
vi.mock('../src/server/services/upload-store.js', () => ({
  getUpload: (id: string) => {
    const u = uploads.get(id);
    return u ? { uploadId: id, filename: u.filename, sizeBytes: u.buf.length, path: '', createdAt: Date.now() } : null;
  },
  readUpload: (id: string) => uploads.get(id)?.buf ?? null,
  saveUpload: () => {
    throw new Error('not used');
  },
  cleanupStaleUploads: () => {},
}));

// ---------- imports under test (after mocks) ----------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbi-test-'));
process.env.TBI_DB_PATH = path.join(tmpDir, 'test.sqlite');

const db = await import('../src/server/database/db.js');
const repo = await import('../src/server/database/import-repository.js');
const engine = await import('../src/server/imports/import-engine.js');

const MAPPING = { listName: 'List Name', cardName: 'Card Name', cardDescription: 'Card Description', labels: 'Labels' };

function addUpload(csv: string): string {
  const id = randomUUID();
  uploads.set(id, { filename: 'test.csv', buf: Buffer.from(csv, 'utf8') });
  return id;
}

function addBoard(lists: string[] = [], labels: string[] = []): string {
  const id = fake.nextId();
  fake.state.boards.set(id, { id, name: 'Test board', closed: false });
  for (const name of lists) fake.state.lists.push({ id: fake.nextId(), idBoard: id, name, closed: false, pos: 0 } as TrelloList);
  for (const name of labels) fake.state.labels.push({ id: fake.nextId(), idBoard: id, name, color: 'green' } as TrelloLabel);
  return id;
}

function request(uploadId: string, boardId: string, over: Partial<StartImportRequest> = {}): StartImportRequest {
  return {
    uploadId,
    mapping: MAPPING,
    target: { mode: 'existing', boardId },
    reuseExistingLists: true,
    createMissingLists: true,
    skipDuplicates: true,
    ...over,
  };
}

/** Start and collect events until done. */
async function runToEnd(start: () => Promise<string>): Promise<{ id: string; events: ImportSseEvent[]; final: ImportProgress }> {
  const events: ImportSseEvent[] = [];
  const id = await start();
  engine.subscribe(id, (e) => events.push(e)); // run starts on setImmediate, so we catch all events
  await vi.waitFor(() => {
    const p = engine.getProgress(id);
    expect(p && p.phase === 'done').toBe(true);
  }, { timeout: 5000, interval: 5 });
  return { id, events, final: engine.getProgress(id)! };
}

const CSV_BASIC = [
  'List Name,Card Name,Card Description,Labels',
  'to do ,Card A,"Line 1\nLine 2",Bug',
  'Doing,Card B,,"Bug, UI"',
  'To Do,Card C,"He said ""hi""",ui',
  'Doing,Card D,,',
].join('\n');

beforeAll(() => {
  db.initDatabase();
});
afterAll(() => {
  db.closeDatabase();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* windows may hold WAL files briefly */
  }
});
beforeEach(() => {
  fake.reset();
});

describe('import engine', () => {
  it('reuses matching lists (case-insensitive, trimmed) and creates missing ones in CSV order', async () => {
    const boardId = addBoard(['To Do']);
    const { id, final } = await runToEnd(() => engine.startImport(request(addUpload(CSV_BASIC), boardId)));
    expect(final.status).toBe('completed');
    expect(final.listsReused).toBe(1);
    expect(final.listsCreated).toBe(1);
    expect(fake.state.calls.createList).toBe(1);
    const toDo = fake.state.lists.find((l) => l.name === 'To Do')!;
    const doing = fake.state.lists.find((l) => l.name === 'Doing')!;
    expect(fake.state.cards.filter((c) => c.idList === toDo.id).map((c) => c.name)).toEqual(['Card A', 'Card C']);
    expect(fake.state.cards.filter((c) => c.idList === doing.id).map((c) => c.name)).toEqual(['Card B', 'Card D']);
    expect(fake.state.cards[0].desc).toBe('Line 1\nLine 2');
    const detail = repo.getImportDetail(id)!;
    expect(detail.record.successfulCards).toBe(4);
    expect(detail.cards.every((c) => c.status === 'success' && c.trelloCardId)).toBe(true);
  });

  it('creates new lists for every CSV list when reuseExistingLists is false (never twice)', async () => {
    const boardId = addBoard(['To Do']);
    const { final } = await runToEnd(() =>
      engine.startImport(request(addUpload(CSV_BASIC), boardId, { reuseExistingLists: false })),
    );
    expect(final.status).toBe('completed');
    expect(final.listsCreated).toBe(2);
    expect(final.listsReused).toBe(0);
    expect(fake.state.calls.createList).toBe(2);
    expect(fake.state.lists.filter((l) => l.idBoard === boardId).map((l) => l.name)).toEqual(['To Do', 'to do', 'Doing']);
  });

  it('fails cards for missing lists when list creation is disabled', async () => {
    const boardId = addBoard(['To Do']);
    const { id, final } = await runToEnd(() =>
      engine.startImport(request(addUpload(CSV_BASIC), boardId, { createMissingLists: false })),
    );
    expect(final.status).toBe('completed_with_errors');
    expect(final.cardsImported).toBe(2);
    expect(final.cardsFailed).toBe(2);
    expect(final.percent).toBe(100);
    const failed = repo.getFailedCards(id);
    expect(failed.map((c) => c.cardName)).toEqual(['Card B', 'Card D']);
    expect(failed[0].error).toBe('List "Doing" does not exist on the board and list creation is disabled');
  });

  it('creates each missing label once and reuses existing labels case-insensitively', async () => {
    const boardId = addBoard(['To Do', 'Doing'], ['UI']);
    const { final } = await runToEnd(() => engine.startImport(request(addUpload(CSV_BASIC), boardId)));
    expect(final.status).toBe('completed');
    expect(fake.state.calls.createLabel).toBe(1);
    expect(final.labelsCreated).toBe(1);
    expect(final.labelsReused).toBe(1);
    const bug = fake.state.labels.find((l) => l.name === 'Bug')!;
    const ui = fake.state.labels.find((l) => l.name === 'UI')!;
    expect(bug.color).toBe('green');
    const cardB = fake.state.cards.find((c) => c.name === 'Card B')!;
    expect(cardB.idLabels.sort()).toEqual([bug.id, ui.id].sort());
  });

  it('skips duplicate rows when skipDuplicates is on', async () => {
    const boardId = addBoard(['To Do']);
    const csv = 'List Name,Card Name\nTo Do,Same\nTo Do,same \nTo Do,Other\n';
    const { id, final } = await runToEnd(() =>
      engine.startImport(request(addUpload(csv), boardId, { mapping: { ...MAPPING, cardDescription: null, labels: null } })),
    );
    expect(final.status).toBe('completed');
    expect(final.cardsSkipped).toBe(1);
    expect(final.cardsImported).toBe(2);
    expect(final.totalCards).toBe(3);
    expect(repo.getImportDetail(id)!.cards.find((c) => c.row === 2)!.status).toBe('skipped');
  });

  it('a failing card does not stop the import; progress only advances on real ops and ends at 100', async () => {
    const boardId = addBoard([]);
    fake.state.failCardNames.add('Card B');
    fake.state.retryOnceCardNames.add('Card C');
    const { id, events, final } = await runToEnd(() => engine.startImport(request(addUpload(CSV_BASIC), boardId)));
    expect(final.status).toBe('completed_with_errors');
    expect(final.cardsImported).toBe(3);
    expect(final.cardsFailed).toBe(1);
    // 2 lists + 2 labels + 4 cards
    expect(final.totalOperations).toBe(8);
    expect(final.completedOperations).toBe(8);
    expect(final.percent).toBe(100);

    const progress = events.filter((e) => e.type === 'progress').map((e) => e.data as ImportProgress);
    let last = 0;
    for (const p of progress) {
      expect(p.percent).toBeGreaterThanOrEqual(last);
      last = p.percent;
      if (p.completedOperations === 0) expect(p.percent).toBe(0);
      if (p.percent === 100) expect(p.completedOperations).toBe(p.totalOperations);
    }
    // percent 100 is never reported before the last card op resolved
    const firstHundred = progress.findIndex((p) => p.percent === 100);
    expect(progress[firstHundred].cardsImported + progress[firstHundred].cardsFailed).toBe(4);
    expect(events.filter((e) => e.type === 'card')).toHaveLength(4);
    expect(events[events.length - 1].type).toBe('done');

    const cards = repo.getImportDetail(id)!.cards;
    expect(cards.find((c) => c.cardName === 'Card B')).toMatchObject({ status: 'failed', error: 'invalid value for name', trelloCardId: null });
    expect(cards.find((c) => c.cardName === 'Card C')!.attempts).toBe(2);
  });

  it('retries only the failed cards on the same board, reusing lists', async () => {
    const boardId = addBoard([]);
    fake.state.failCardNames.add('Card B');
    fake.state.failCardNames.add('Card D');
    const first = await runToEnd(() => engine.startImport(request(addUpload(CSV_BASIC), boardId)));
    expect(first.final.cardsFailed).toBe(2);
    const listsBefore = fake.state.calls.createList;

    fake.state.failCardNames.clear();
    const retry = await runToEnd(() => engine.startRetry(first.id));
    expect(retry.id).not.toBe(first.id);
    expect(retry.final.status).toBe('completed');
    expect(retry.final.cardsImported).toBe(2);
    expect(retry.final.boardId).toBe(boardId);
    expect(fake.state.calls.createList).toBe(listsBefore);
    const detail = repo.getImportDetail(retry.id)!;
    expect(detail.record.retryOf).toBe(first.id);
    expect(detail.cards.map((c) => c.cardName)).toEqual(['Card B', 'Card D']);
    expect(fake.state.cards.filter((c) => c.name === 'Card B')).toHaveLength(1);

    await expect(engine.startRetry(retry.id)).rejects.toMatchObject({ status: 400 });
  });

  it('aborts the remaining cards when Trello returns unauthorized mid-import', async () => {
    const boardId = addBoard(['To Do', 'Doing']);
    fake.state.unauthorizedOnCard = 'Card B';
    const { id, final } = await runToEnd(() => engine.startImport(request(addUpload(CSV_BASIC), boardId)));
    expect(final.status).toBe('failed');
    expect(final.fatalError).toBe('Trello rejected the credentials');
    expect(final.cardsImported).toBe(1);
    expect(final.cardsFailed).toBe(3);
    expect(fake.state.calls.createCard).toBe(2);
    const cards = repo.getImportDetail(id)!.cards;
    expect(cards.map((c) => c.status)).toEqual(['success', 'failed', 'failed', 'failed']);
  });

  it('cancels: in-flight card is failed (may exist), remaining are cancelled', async () => {
    const boardId = addBoard(['To Do', 'Doing']);
    fake.state.cardDelayMs = 40;
    const events: ImportSseEvent[] = [];
    const id = await engine.startImport(request(addUpload(CSV_BASIC), boardId));
    engine.subscribe(id, (e) => {
      events.push(e);
      // Cancel while the 2nd card's request is in flight.
      if (e.type === 'card' && e.data.status === 'success') setTimeout(() => engine.cancelImport(id), 10);
    });
    await vi.waitFor(() => expect(engine.getProgress(id)!.phase).toBe('done'), { timeout: 5000, interval: 5 });
    const final = engine.getProgress(id)!;
    expect(final.status).toBe('cancelled');
    expect(final.cardsImported).toBe(1);
    const cards = repo.getImportDetail(id)!.cards;
    expect(cards.map((c) => c.status)).toEqual(['success', 'failed', 'cancelled', 'cancelled']);
    expect(cards[1].error).toBe('Cancelled while request in flight; card may exist in Trello');
    expect(engine.cancelImport(id)).toBe(false);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('cancel between cards leaves remaining cards cancelled', async () => {
    const boardId = addBoard(['To Do', 'Doing']);
    const id = await engine.startImport(request(addUpload(CSV_BASIC), boardId));
    engine.subscribe(id, (e) => {
      if (e.type === 'card' && e.data.status === 'success') engine.cancelImport(id);
    });
    await vi.waitFor(() => expect(engine.getProgress(id)!.phase).toBe('done'), { timeout: 5000, interval: 5 });
    expect(engine.getProgress(id)!.status).toBe('cancelled');
    expect(repo.getImportDetail(id)!.cards.map((c) => c.status)).toEqual(['success', 'cancelled', 'cancelled', 'cancelled']);
  });

  it('rejects a second concurrent import with 409', async () => {
    const boardId = addBoard(['To Do', 'Doing']);
    fake.state.cardDelayMs = 20;
    const id = await engine.startImport(request(addUpload(CSV_BASIC), boardId));
    await expect(engine.startImport(request(addUpload(CSV_BASIC), boardId))).rejects.toMatchObject({ status: 409 });
    engine.cancelImport(id);
    await vi.waitFor(() => expect(engine.getProgress(id)!.phase).toBe('done'), { timeout: 5000, interval: 5 });
  });

  it('fails fatally when the board does not exist', async () => {
    const { final } = await runToEnd(() => engine.startImport(request(addUpload(CSV_BASIC), 'abcdefgh12345678')));
    expect(final.status).toBe('failed');
    expect(final.fatalError).toContain('Board not found');
    expect(final.percent).toBe(0);
  });

  it('creates a new board when target mode is new', async () => {
    const { final } = await runToEnd(() =>
      engine.startImport(request(addUpload(CSV_BASIC), 'x', { target: { mode: 'new', name: 'Fresh' } })),
    );
    expect(final.status).toBe('completed');
    expect(final.boardName).toBe('Fresh');
    expect(final.boardUrl).toContain(final.boardId!);
  });

  it('recovers interrupted imports and computes stats', async () => {
    const id = randomUUID();
    repo.createImport({ id, filename: 'x.csv', status: 'running', phase: 'creating_cards' });
    repo.insertCards(id, [
      { row: 1, listName: 'L', cardName: 'A', description: '', labels: [], status: 'success' },
      { row: 2, listName: 'L', cardName: 'B', description: '', labels: [], status: 'pending' },
    ]);
    engine.recoverInterruptedImports();
    const p = engine.getProgress(id)!;
    expect(p.status).toBe('failed');
    expect(p.fatalError).toBe('Server stopped during import');
    expect(repo.getImportDetail(id)!.cards[1].status).toBe('cancelled');

    const stats = repo.getStats();
    expect(stats.totalImports).toBe(repo.listImports().length);
    expect(stats.failedImports).toBeGreaterThanOrEqual(3);
    expect(stats.totalCardsImported).toBeGreaterThan(0);
    expect(repo.listImports()[0].id).toBe(id);
  });
});

describe('errors.csv cell escaping', () => {
  it('escapes quotes/commas/newlines and neutralizes formulas', async () => {
    const { csvCell } = await import('../src/server/routes/imports.routes.js');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd,x')).toBe('"\'@cmd,x"');
    expect(csvCell(-5)).toBe('-5');
  });
});
