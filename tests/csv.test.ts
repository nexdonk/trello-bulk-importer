import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildParseResult, detectMapping, parseCsvBuffer } from '../src/server/imports/csv-parser.js';
import { splitLabels } from '../src/server/imports/validator.js';
import { HttpError } from '../src/server/utils/errors.js';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
const parseFile = (name: string) => {
  const raw = parseCsvBuffer(fixture(name));
  return { raw, result: buildParseResult('id', name, raw, detectMapping(raw.headers)) };
};

describe('sample import fixture', () => {
  const { raw, result } = parseFile('sample-import.csv');

  it('starts with a BOM on disk, but headers are clean', () => {
    const buf = fixture('sample-import.csv');
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(raw.headers[0]).toBe('List Name');
  });

  it('parses 74 cards / 9 lists with correct counts', () => {
    expect(result.cards).toHaveLength(74);
    expect(result.lists.map((l) => [l.name, l.cardCount])).toEqual([
      ['Original Skill Ideas', 12],
      ['V2 Combat', 10],
      ['V2 Driving', 8],
      ['V2 Criminal', 9],
      ['V2 Jobs & Trade', 8],
      ['V2 Social', 7],
      ['V2 Utility', 8],
      ['V2 Rank Rewards', 7],
      ['V2 Planning Notes', 5],
    ]);
    expect(result.issues).toEqual([]);
    expect(result.canImport).toBe(true);
  });

  it('preserves quotes, commas, markdown bullets, unicode and emoji', () => {
    const byName = (n: string) => result.cards.find((c) => c.cardName === n)!;
    expect(byName('Berserk').description).toBe('On kill: +15% movement speed and +20% fire rate.');
    expect(byName('Silver Tongue').description).toBe('Shop prices reduced by 10%, "haggle" option unlocked at dealers.');
    expect(byName('Medic').description).toBe('Revive downed teammates 2x faster.\n\n- Works on strangers too\n- Costs no bandages');
    expect(byName('Localization').description).toContain('é, ñ, ü');
    expect(byName('Miner').description).toContain('💎');
    expect(byName('Rank 40: Prestige Outfit').description).toContain('—');
    expect(byName('Berserk V2').labels).toEqual(['V2 Combat', 'Priority']);
  });
});

describe('edge cases', () => {
  const { result } = parseFile('edge-cases.csv');

  it('detects alternate headers', () => {
    expect(result.mapping).toEqual({ listName: 'Column', cardName: 'Title', cardDescription: 'Details', labels: 'Tags' });
  });

  it('flags duplicates (case-insensitive) as warnings and canonicalizes list names', () => {
    const dup = result.cards.find((c) => c.isDuplicate)!;
    expect(dup.cardName).toBe('write docs');
    expect(dup.listName).toBe('Todo');
    expect(result.duplicateCount).toBe(1);
    expect(result.issues.filter((i) => i.code === 'DUPLICATE_CARD')).toHaveLength(1);
  });

  it('reports missing values as errors and excludes those rows', () => {
    const missing = result.issues.filter((i) => i.code === 'MISSING_VALUE');
    expect(missing.map((i) => i.field).sort()).toEqual(['cardName', 'listName']);
    expect(result.cards.some((c) => c.cardName === 'Orphan card')).toBe(false);
    expect(result.canImport).toBe(false);
  });

  it('skips blank rows, pads short rows, preserves multiline, splits labels', () => {
    expect(result.cards).toHaveLength(4);
    expect(result.cards.find((c) => c.cardName === 'Short row')!.description).toBe('');
    expect(result.cards[0].description).toBe('Line one\nLine two');
    expect(result.cards[0].labels).toEqual(['docs', 'writing']);
    expect(result.lists).toEqual([{ name: 'Todo', cardCount: 2 }, { name: 'Doing', cardCount: 2 }]);
  });
});

describe('parser / mapping units', () => {
  it('detectMapping prefers canonical names and uses each header once', () => {
    expect(detectMapping(['Name', 'Card Name', 'Status', 'Notes', 'tag'])).toEqual({
      listName: 'Status', cardName: 'Card Name', cardDescription: 'Notes', labels: 'tag',
    });
    expect(detectMapping(['foo', 'bar'])).toEqual({ listName: null, cardName: null, cardDescription: null, labels: null });
  });

  it('names blank and duplicate headers', () => {
    const raw = parseCsvBuffer(Buffer.from('Name,,Name\na,b,c\n'));
    expect(raw.headers).toEqual(['Name', 'Column 2', 'Name (2)']);
    expect(raw.rows[0]).toEqual({ Name: 'a', 'Column 2': 'b', 'Name (2)': 'c' });
  });

  it('decodes UTF-16 LE with BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('List,Card\nA,Café\n', 'utf16le')]);
    expect(parseCsvBuffer(buf).rows[0]).toEqual({ List: 'A', Card: 'Café' });
  });

  it('throws PARSE_ERROR HttpError on malformed CSV', () => {
    try {
      parseCsvBuffer(Buffer.from('a,b\n"unterminated,1\n'));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
      expect((e as HttpError).code).toBe('PARSE_ERROR');
      expect((e as HttpError).message).toMatch(/^CSV parse error on line/);
    }
  });

  it('reports a missing required column mapping', () => {
    const raw = parseCsvBuffer(Buffer.from('List,Card\nA,B\n'));
    const r = buildParseResult('id', 'f.csv', raw, { listName: 'List', cardName: null, cardDescription: null, labels: 'Nope' });
    const codes = r.issues.map((i) => [i.code, i.field]);
    expect(codes).toContainEqual(['MISSING_REQUIRED_COLUMN', 'cardName']);
    expect(codes).toContainEqual(['MISSING_REQUIRED_COLUMN', 'labels']);
    expect(r.cards).toEqual([]);
    expect(r.canImport).toBe(false);
  });

  it('reports EMPTY_FILE for header-only files', () => {
    const raw = parseCsvBuffer(Buffer.from('List Name,Card Name\r\n'));
    const r = buildParseResult('id', 'f.csv', raw, detectMapping(raw.headers));
    expect(r.issues.map((i) => i.code)).toContain('EMPTY_FILE');
  });

  it('flags too-long values and long labels', () => {
    const long = 'x'.repeat(16385);
    const raw = parseCsvBuffer(Buffer.from(`List,Card,Desc,Labels\nA,B,${long},${'y'.repeat(101)}\n`));
    const r = buildParseResult('id', 'f.csv', raw, detectMapping(raw.headers));
    expect(r.issues.map((i) => i.code).sort()).toEqual(['INVALID_LABEL', 'VALUE_TOO_LONG']);
  });

  it('splitLabels splits on comma/semicolon and de-dupes case-insensitively', () => {
    expect(splitLabels(' a, B;b ;; c ,A')).toEqual(['a', 'B', 'c']);
  });
});
