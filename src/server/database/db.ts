import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { DB_PATH } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * SQLite access via Node's built-in `node:sqlite`.
 * The module is loaded lazily (after a narrow emitWarning filter is installed) so the
 * one-off "SQLite is an experimental feature" warning doesn't clutter the console.
 * Never store Trello keys/tokens in this database.
 */

let warningFilterInstalled = false;
function installSqliteWarningFilter(): void {
  if (warningFilterInstalled) return;
  warningFilterInstalled = true;
  const original = process.emitWarning.bind(process) as (...args: unknown[]) => void;
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    const message = typeof warning === 'string' ? warning : warning instanceof Error ? warning.message : '';
    const first = rest[0];
    const name =
      warning instanceof Error
        ? warning.name
        : typeof first === 'string'
          ? first
          : first && typeof first === 'object' && 'type' in first
            ? String((first as { type?: unknown }).type)
            : '';
    if (name === 'ExperimentalWarning' && message.includes('SQLite')) return;
    original(warning, ...rest);
  }) as typeof process.emitWarning;
}

type SqliteModule = typeof import('node:sqlite');
let sqliteModule: SqliteModule | null = null;
function loadSqlite(): SqliteModule {
  if (!sqliteModule) {
    installSqliteWarningFilter();
    const require = createRequire(import.meta.url);
    sqliteModule = require('node:sqlite') as SqliteModule;
  }
  return sqliteModule;
}

let db: DatabaseSyncType | null = null;

/** Ordered migrations; index + 1 = resulting user_version. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    filename TEXT NOT NULL,
    board_id TEXT,
    board_name TEXT,
    board_url TEXT,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    total_cards INTEGER NOT NULL DEFAULT 0,
    successful_cards INTEGER NOT NULL DEFAULT 0,
    failed_cards INTEGER NOT NULL DEFAULT 0,
    skipped_cards INTEGER NOT NULL DEFAULT 0,
    lists_created INTEGER NOT NULL DEFAULT 0,
    lists_reused INTEGER NOT NULL DEFAULT 0,
    labels_created INTEGER NOT NULL DEFAULT 0,
    labels_reused INTEGER NOT NULL DEFAULT 0,
    total_operations INTEGER NOT NULL DEFAULT 0,
    completed_operations INTEGER NOT NULL DEFAULT 0,
    fatal_error TEXT,
    retry_of TEXT,
    options_json TEXT NOT NULL DEFAULT '{}',
    mapping_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_imports_created_at ON imports(created_at);
  CREATE TABLE IF NOT EXISTS import_cards (
    import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    row INTEGER NOT NULL,
    list_name TEXT NOT NULL,
    card_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    labels_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    trello_card_id TEXT,
    trello_card_url TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (import_id, row)
  );
  CREATE INDEX IF NOT EXISTS idx_import_cards_status ON import_cards(import_id, status);
  `,
];

function migrate(database: DatabaseSyncType): void {
  const row = database.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = Number(row?.user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    database.exec('BEGIN');
    try {
      database.exec(MIGRATIONS[v]);
      database.exec(`PRAGMA user_version = ${v + 1}`);
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Open (or create) the database and run migrations. Safe to call more than once. */
export function initDatabase(): DatabaseSyncType {
  if (db) return db;
  const { DatabaseSync } = loadSqlite();
  const dbPath = process.env.TBI_DB_PATH || DB_PATH;
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  try {
    database.exec('PRAGMA journal_mode = WAL');
  } catch (err) {
    logger.warn('Could not enable WAL mode:', err);
  }
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  migrate(database);
  db = database;
  return db;
}

/** Get the open database (initializes lazily). */
export function getDb(): DatabaseSyncType {
  return db ?? initDatabase();
}

/** Close the database (used by tests). */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Run fn inside a transaction. */
export function transaction<T>(fn: () => T): T {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}
