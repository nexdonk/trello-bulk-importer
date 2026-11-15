// CSV routes (Agent B): upload, re-fetch upload info, and parse with a mapping.
import path from 'node:path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { HttpError, asyncHandler } from '../utils/errors.js';
import { buildParseResult, detectMapping, parseCsvBuffer, type RawCsv } from '../imports/csv-parser.js';
import { getUpload, readUpload, saveUpload, type StoredUpload } from '../services/upload-store.js';
import type { ColumnMapping, CsvParseResult, CsvUploadResult } from '../../shared/types.js';

const ALLOWED_EXT = new Set(['.csv', '.txt']);
const ALLOWED_MIME = new Set(['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv', 'text/x-csv']);

/** multer/busboy decodes filenames as latin1; recover UTF-8 names when that's what was sent. */
function fixFilenameEncoding(name: string): string {
  if (!/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const ok = ext ? ALLOWED_EXT.has(ext) : ALLOWED_MIME.has(mime);
    if (ok) cb(null, true);
    else cb(new HttpError(400, 'Only .csv files are supported. Please upload a CSV (comma-separated) file.', 'INVALID_FILE_TYPE'));
  },
});

function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const mb = Math.round((config.maxUploadBytes / (1024 * 1024)) * 10) / 10;
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File is too large. The maximum upload size is ${mb} MB.`, 'FILE_TOO_LARGE'));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new HttpError(400, 'Upload exactly one file in the "file" field.', 'INVALID_UPLOAD'));
      }
      return next(new HttpError(400, `Upload failed: ${err.message}`, 'INVALID_UPLOAD'));
    }
    next(err);
  });
}

function toUploadResult(stored: StoredUpload, raw: RawCsv): CsvUploadResult {
  return {
    uploadId: stored.uploadId,
    filename: stored.filename,
    sizeBytes: stored.sizeBytes,
    headers: raw.headers,
    rowCount: raw.rows.length,
    suggestedMapping: detectMapping(raw.headers),
    sampleRows: raw.rows.slice(0, 5),
  };
}

function loadUpload(uploadId: string): { stored: StoredUpload; raw: RawCsv } {
  const stored = getUpload(uploadId);
  const buf = stored ? readUpload(uploadId) : null;
  if (!stored || !buf) throw new HttpError(404, 'Upload not found. It may have expired — please upload the file again.', 'UPLOAD_NOT_FOUND');
  return { stored, raw: parseCsvBuffer(buf) };
}

const mappingValue = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v == null || v === '' ? null : v));

const parseBodySchema = z.object({
  mapping: z.object({
    listName: mappingValue,
    cardName: mappingValue,
    cardDescription: mappingValue,
    labels: mappingValue,
  }),
});

export const csvRouter = Router();

csvRouter.post(
  '/upload',
  handleUpload,
  asyncHandler(async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'No file uploaded. Attach a CSV file in the "file" field.', 'NO_FILE');
    if (file.size === 0 || file.buffer.length === 0) throw new HttpError(400, 'The uploaded file is empty.', 'EMPTY_FILE');
    // Parse first so malformed files are rejected before anything is stored.
    const raw = parseCsvBuffer(file.buffer);
    if (raw.headers.length === 0) throw new HttpError(400, 'The uploaded file contains no CSV data.', 'EMPTY_FILE');
    const stored = saveUpload(fixFilenameEncoding(file.originalname || 'upload.csv'), file.buffer);
    res.json(toUploadResult(stored, raw));
  }),
);

csvRouter.get(
  '/:uploadId',
  asyncHandler(async (req: Request, res: Response) => {
    const { stored, raw } = loadUpload(req.params.uploadId);
    res.json(toUploadResult(stored, raw));
  }),
);

csvRouter.post(
  '/:uploadId/parse',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = parseBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request: body must be { mapping: { listName, cardName, cardDescription, labels } } with string or null values.', 'VALIDATION_ERROR', parsed.error.flatten());
    }
    const { stored, raw } = loadUpload(req.params.uploadId);
    const mapping: ColumnMapping = parsed.data.mapping;
    const result: CsvParseResult = buildParseResult(stored.uploadId, stored.filename, raw, mapping);
    res.json(result);
  }),
);
