// Upload storage (Agent B). Signatures are the agreed contract; do not change them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from '../config.js';
import { logger } from '../utils/logger.js';

export interface StoredUpload { uploadId: string; filename: string; sizeBytes: number; path: string; createdAt: number }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STALE_MS = 24 * 60 * 60 * 1000;

interface Sidecar { filename: string; sizeBytes: number; createdAt: number }

export function sanitizeFilename(name: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 200);
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'upload.csv';
  return cleaned;
}

const csvPath = (id: string) => path.join(UPLOADS_DIR, `${id}.csv`);
const metaPath = (id: string) => path.join(UPLOADS_DIR, `${id}.json`);

/** Save an uploaded CSV buffer under uploads/<uuid>.csv; returns metadata. filename is sanitized original name. */
export function saveUpload(originalName: string, buf: Buffer): StoredUpload {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const uploadId = crypto.randomUUID();
  const meta: Sidecar = { filename: sanitizeFilename(originalName), sizeBytes: buf.length, createdAt: Date.now() };
  fs.writeFileSync(csvPath(uploadId), buf);
  fs.writeFileSync(metaPath(uploadId), JSON.stringify(meta), 'utf8');
  return { uploadId, ...meta, path: csvPath(uploadId) };
}

/** Look up an upload by id (validate id is a UUID; prevents path traversal). Returns null if missing. */
export function getUpload(uploadId: string): StoredUpload | null {
  if (typeof uploadId !== 'string' || !UUID_RE.test(uploadId)) return null;
  const file = csvPath(uploadId);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  let meta: Partial<Sidecar> = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaPath(uploadId), 'utf8')) as Partial<Sidecar>;
  } catch {
    /* sidecar missing/corrupt: fall back to defaults */
  }
  return {
    uploadId,
    filename: typeof meta.filename === 'string' ? sanitizeFilename(meta.filename) : 'upload.csv',
    sizeBytes: stat.size,
    path: file,
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : stat.mtimeMs,
  };
}

/** Read the stored bytes. */
export function readUpload(uploadId: string): Buffer | null {
  const u = getUpload(uploadId);
  if (!u) return null;
  try {
    return fs.readFileSync(u.path);
  } catch {
    return null;
  }
}

/** Delete uploads older than 24h. Called on startup. Never throws. */
export function cleanupStaleUploads(): void {
  try {
    const now = Date.now();
    let removed = 0;
    for (const entry of fs.readdirSync(UPLOADS_DIR)) {
      const m = /^(.+)\.(csv|json)$/.exec(entry);
      if (!m || !UUID_RE.test(m[1])) continue;
      const full = path.join(UPLOADS_DIR, entry);
      try {
        if (now - fs.statSync(full).mtimeMs > STALE_MS) {
          fs.unlinkSync(full);
          removed++;
        }
      } catch {
        /* ignore individual failures */
      }
    }
    if (removed) logger.info(`Removed ${removed} stale upload file(s).`);
  } catch (err) {
    logger.warn('Upload cleanup failed:', err);
  }
}
