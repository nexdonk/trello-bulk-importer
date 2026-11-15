import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/** Project root (directory containing package.json). Works from src/ (tsx) and dist/ (built). */
function findRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const ROOT_DIR = findRoot();
export const ENV_PATH = path.join(ROOT_DIR, '.env');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
export const DB_PATH = path.join(DATA_DIR, 'imports.sqlite');
export const CLIENT_ROOT = path.join(ROOT_DIR, 'src', 'client');
export const CLIENT_DIST = path.join(ROOT_DIR, 'dist', 'client');

dotenv.config({ path: ENV_PATH, quiet: true } as dotenv.DotenvConfigOptions);

for (const dir of [DATA_DIR, UPLOADS_DIR]) fs.mkdirSync(dir, { recursive: true });

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3000,
  isProduction: process.env.NODE_ENV === 'production',
  maxUploadBytes: Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 5) * 1024 * 1024,
};

// ---------- Credentials (server-side only; never send to client, never log) ----------

let credentials = {
  apiKey: (process.env.TRELLO_API_KEY || '').trim(),
  apiToken: (process.env.TRELLO_API_TOKEN || '').trim(),
};

export function getCredentials(): { apiKey: string; apiToken: string } {
  return { ...credentials };
}

export function hasCredentials(): boolean {
  return Boolean(credentials.apiKey && credentials.apiToken);
}

/**
 * Persist credentials to .env (preserving other lines) and update the in-memory copy.
 * Pass empty strings to clear.
 */
export function saveCredentials(apiKey: string, apiToken: string): void {
  const updates: Record<string, string> = { TRELLO_API_KEY: apiKey.trim(), TRELLO_API_TOKEN: apiToken.trim() };
  let lines: string[] = [];
  if (fs.existsSync(ENV_PATH)) lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  const seen = new Set<string>();
  lines = lines.map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m && m[1] in updates) {
      seen.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) lines.push(`${k}=${v}`);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  credentials = { apiKey: updates.TRELLO_API_KEY, apiToken: updates.TRELLO_API_TOKEN };
  process.env.TRELLO_API_KEY = credentials.apiKey;
  process.env.TRELLO_API_TOKEN = credentials.apiToken;
}
