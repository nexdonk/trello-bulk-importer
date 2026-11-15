// CSV validation (Agent B).
import {
  REQUIRED_CSV_FIELDS,
  CSV_FIELDS,
  CSV_FIELD_LABELS,
  type ColumnMapping,
  type CsvParseResult,
  type ListSummary,
  type ParsedCard,
  type ValidationIssue,
} from '../../shared/types.js';
import type { RawCsv } from './csv-parser.js';

/** Trello limits. */
export const MAX_CARD_NAME = 16384;
export const MAX_DESCRIPTION = 16384;
export const MAX_LIST_NAME = 16384;
export const MAX_LABEL_NAME = 100;

export type ValidationOutput = Omit<CsvParseResult, 'uploadId' | 'filename' | 'mapping'>;

/** Split a labels cell on comma or semicolon; trim, drop empties, de-duplicate case-insensitively. */
export function splitLabels(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/**
 * Validate raw CSV rows against a column mapping.
 *
 * IMPORTANT: `cards` contains ONLY rows without errors. Rows with errors are reported in
 * `issues` (with their 1-based row number) and are never handed to the import engine.
 * Duplicate rows (warning) ARE included in `cards` with isDuplicate=true; the engine
 * decides whether to skip them (StartImportRequest.skipDuplicates).
 * List/label names are canonicalized to their first-seen spelling (case-insensitive, trimmed)
 * so that grouping is consistent. `lists[].cardCount` counts every card in `cards`, duplicates included.
 */
export function validate(raw: RawCsv, mapping: ColumnMapping): ValidationOutput {
  const issues: ValidationIssue[] = [];
  const cards: ParsedCard[] = [];
  const headerSet = new Set(raw.headers);

  if (raw.rows.length === 0) {
    issues.push({ severity: 'error', row: null, field: null, code: 'EMPTY_FILE', message: 'The CSV file has no data rows.' });
  }

  let mappingOk = true;
  for (const field of CSV_FIELDS) {
    const header = mapping[field];
    const label = CSV_FIELD_LABELS[field];
    if (header == null || header === '') {
      if (REQUIRED_CSV_FIELDS.includes(field)) {
        mappingOk = false;
        issues.push({ severity: 'error', row: null, field, code: 'MISSING_REQUIRED_COLUMN', message: `"${label}" must be mapped to a CSV column.` });
      }
    } else if (!headerSet.has(header)) {
      mappingOk = false;
      issues.push({ severity: 'error', row: null, field, code: 'MISSING_REQUIRED_COLUMN', message: `"${label}" is mapped to column "${header}", which does not exist in the file.` });
    }
  }

  const listCanonical = new Map<string, string>(); // lower -> first-seen spelling
  const listCounts = new Map<string, number>();
  const labelCanonical = new Map<string, string>();
  const seenCards = new Set<string>();
  let duplicateCount = 0;

  if (mappingOk) {
    const get = (row: Record<string, string>, header: string | null): string => (header ? row[header] ?? '' : '');

    raw.rows.forEach((rowData, i) => {
      const row = i + 1;
      const rowIssues: ValidationIssue[] = [];
      const listName = get(rowData, mapping.listName).trim();
      const cardName = get(rowData, mapping.cardName).trim();
      const description = get(rowData, mapping.cardDescription); // verbatim
      const labels = splitLabels(get(rowData, mapping.labels));

      if (!listName) rowIssues.push({ severity: 'error', row, field: 'listName', code: 'MISSING_VALUE', message: `Row ${row}: list name is empty.` });
      else if (listName.length > MAX_LIST_NAME) rowIssues.push({ severity: 'error', row, field: 'listName', code: 'VALUE_TOO_LONG', message: `Row ${row}: list name is longer than ${MAX_LIST_NAME} characters.` });
      if (!cardName) rowIssues.push({ severity: 'error', row, field: 'cardName', code: 'MISSING_VALUE', message: `Row ${row}: card name is empty.` });
      else if (cardName.length > MAX_CARD_NAME) rowIssues.push({ severity: 'error', row, field: 'cardName', code: 'VALUE_TOO_LONG', message: `Row ${row}: card name is longer than ${MAX_CARD_NAME} characters.` });
      if (description.length > MAX_DESCRIPTION) rowIssues.push({ severity: 'error', row, field: 'cardDescription', code: 'VALUE_TOO_LONG', message: `Row ${row}: description is longer than ${MAX_DESCRIPTION} characters (${description.length}).` });
      for (const l of labels) {
        if (l.length > MAX_LABEL_NAME) rowIssues.push({ severity: 'error', row, field: 'labels', code: 'INVALID_LABEL', message: `Row ${row}: label "${l.slice(0, 40)}…" is longer than ${MAX_LABEL_NAME} characters.` });
      }

      if (rowIssues.length) {
        issues.push(...rowIssues);
        return;
      }

      const listKey = listName.toLowerCase();
      if (!listCanonical.has(listKey)) listCanonical.set(listKey, listName);
      const canonicalList = listCanonical.get(listKey)!;
      const canonicalLabels = labels.map((l) => {
        const k = l.toLowerCase();
        if (!labelCanonical.has(k)) labelCanonical.set(k, l);
        return labelCanonical.get(k)!;
      });

      const cardKey = `${listKey}\u0000${cardName.toLowerCase()}`;
      const isDuplicate = seenCards.has(cardKey);
      seenCards.add(cardKey);
      if (isDuplicate) {
        duplicateCount++;
        issues.push({ severity: 'warning', row, field: 'cardName', code: 'DUPLICATE_CARD', message: `Row ${row}: "${cardName}" appears earlier in list "${canonicalList}".` });
      }

      listCounts.set(listKey, (listCounts.get(listKey) ?? 0) + 1);
      cards.push({ row, listName: canonicalList, cardName, description, labels: canonicalLabels, isDuplicate });
    });
  }

  const lists: ListSummary[] = [...listCanonical.entries()].map(([k, name]) => ({ name, cardCount: listCounts.get(k) ?? 0 }));
  const errorCount = issues.filter((x) => x.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  return {
    cards,
    lists,
    labels: [...labelCanonical.values()],
    issues,
    errorCount,
    warningCount,
    duplicateCount,
    canImport: errorCount === 0 && cards.some((c) => !c.isDuplicate),
  };
}
