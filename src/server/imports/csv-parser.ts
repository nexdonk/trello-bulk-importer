// CSV pipeline (Agent B). Signatures are the agreed contract with the import engine; do not change them.
import { parse } from 'csv-parse/sync';
import { CSV_FIELDS, type ColumnMapping, type CsvField, type CsvParseResult } from '../../shared/types.js';
import { HttpError } from '../utils/errors.js';
import { validate } from './validator.js';

export interface RawCsv { headers: string[]; rows: Record<string, string>[] }

/** Decode bytes to a string: UTF-16 LE/BE when a UTF-16 BOM is present, otherwise UTF-8. BOM is stripped. */
function decodeBuffer(buf: Buffer): string {
  let text: string;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = new TextDecoder('utf-16le').decode(buf.subarray(2));
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    text = new TextDecoder('utf-16be').decode(buf.subarray(2));
  } else {
    text = new TextDecoder('utf-8').decode(buf);
  }
  // Fallback BOM strip (TextDecoder already strips it by default, but be defensive).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** Normalize line endings inside a cell and drop a trailing \r. Does NOT trim otherwise. */
function normalizeCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s.replace(/\r\n/g, '\n').replace(/\r$/, '');
}

/** Make headers unique and non-blank: blank -> "Column N", duplicates -> "Name (2)", "Name (3)"... */
function normalizeHeaders(rawHeaders: string[]): string[] {
  const used = new Set<string>();
  return rawHeaders.map((h, i) => {
    let base = normalizeCell(h).replace(/\n/g, ' ').trim();
    if (!base) base = `Column ${i + 1}`;
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${n++})`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Parse CSV bytes (UTF-8, with or without BOM; CRLF/LF; quoted commas/quotes/multiline). Throws HttpError(400,'...','PARSE_ERROR') on malformed CSV. */
export function parseCsvBuffer(buf: Buffer): RawCsv {
  const text = decodeBuffer(buf);
  if (text.includes('\u0000')) {
    throw new HttpError(400, 'CSV parse error: the file appears to be binary, not a text CSV file.', 'PARSE_ERROR');
  }
  if (!text.trim()) return { headers: [], rows: [] };

  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      columns: false,
      relax_column_count: true,
      relax_quotes: false,
      skip_empty_lines: true,
    }) as string[][];
  } catch (err) {
    const e = err as { message?: string; lines?: number };
    const line = typeof e.lines === 'number' ? e.lines : '?';
    const detail = e.message || 'Invalid CSV';
    throw new HttpError(400, `CSV parse error on line ${line}: ${detail}`, 'PARSE_ERROR');
  }

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = normalizeHeaders(records[0]);
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r].map(normalizeCell);
    if (cells.every((c) => c.trim() === '')) continue; // skip rows where every cell is blank
    const row: Record<string, string> = {};
    // Pad short rows with '' and ignore cells beyond the header count.
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

const normalizeHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Aliases per field, in priority order. The first entry is the canonical normalized name. */
const FIELD_ALIASES: Record<CsvField, string[]> = {
  listName: ['listname', 'list', 'column', 'category', 'group', 'stage', 'status', 'lane'],
  cardName: ['cardname', 'card', 'name', 'title', 'cardtitle', 'task', 'summary'],
  cardDescription: ['carddescription', 'description', 'desc', 'details', 'body', 'notes', 'content'],
  labels: ['labels', 'label', 'tags', 'tag'],
};

/** Auto-detect mapping from headers. */
export function detectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = { listName: null, cardName: null, cardDescription: null, labels: null };
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const take = (field: CsvField, alias: string): boolean => {
    const idx = normalized.findIndex((n, i) => n === alias && !used.has(i));
    if (idx === -1) return false;
    used.add(idx);
    mapping[field] = headers[idx];
    return true;
  };
  // Pass 1: exact canonical names.
  for (const field of CSV_FIELDS) take(field, FIELD_ALIASES[field][0]);
  // Pass 2: aliases in priority order.
  for (const field of CSV_FIELDS) {
    if (mapping[field]) continue;
    for (const alias of FIELD_ALIASES[field].slice(1)) if (take(field, alias)) break;
  }
  return mapping;
}

/** Apply mapping + validation (see validator.ts) and build the full parse result. */
export function buildParseResult(uploadId: string, filename: string, raw: RawCsv, mapping: ColumnMapping): CsvParseResult {
  const v = validate(raw, mapping);
  return { uploadId, filename, mapping, ...v };
}
