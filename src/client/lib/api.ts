import axios, { AxiosError } from 'axios';
import type {
  ApiError,
  ColumnMapping,
  ConnectionStatus,
  CredentialsInput,
  CsvParseResult,
  CsvUploadResult,
  DashboardStats,
  ImportDetail,
  ImportRecord,
  StartImportRequest,
  StartImportResponse,
  TrelloBoard,
  TrelloLabel,
  TrelloList,
  TrelloWorkspace,
} from '@shared/types';

/** Error thrown by every API function. `message` is safe to show in the UI. */
export class ApiRequestError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly details: unknown;

  constructor(message: string, status: number | null, code: string | null, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const http = axios.create({
  baseURL: '/api',
  headers: { Accept: 'application/json' },
});

function isApiError(v: unknown): v is ApiError {
  return typeof v === 'object' && v !== null && typeof (v as { error?: unknown }).error === 'string';
}

function toError(err: unknown): ApiRequestError {
  if (err instanceof ApiRequestError) return err;
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<unknown>;
    const status = ax.response?.status ?? null;
    const data = ax.response?.data;
    if (isApiError(data)) {
      return new ApiRequestError(data.error, status, data.code ?? null, data.details);
    }
    if (!ax.response) {
      return new ApiRequestError('Could not reach the local server. Is it running?', null, 'NETWORK_ERROR');
    }
    return new ApiRequestError(`Request failed (HTTP ${status})`, status, null);
  }
  if (err instanceof Error) return new ApiRequestError(err.message, null, null);
  return new ApiRequestError('Unexpected error', null, null);
}

async function req<T>(p: Promise<{ data: T }>): Promise<T> {
  try {
    const res = await p;
    return res.data;
  } catch (err) {
    throw toError(err);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

export const api = {
  // ---- Settings ----
  getConnectionStatus: () => req<ConnectionStatus>(http.get('/settings/status')),
  testConnection: () => req<ConnectionStatus>(http.post('/settings/test')),
  saveCredentials: (body: CredentialsInput) => req<ConnectionStatus>(http.put('/settings/credentials', body)),
  deleteCredentials: () => req<unknown>(http.delete('/settings/credentials')),

  // ---- Trello ----
  getBoards: () => req<TrelloBoard[]>(http.get('/trello/boards')),
  getWorkspaces: () => req<TrelloWorkspace[]>(http.get('/trello/workspaces')),
  getBoardLists: (boardId: string) =>
    req<TrelloList[]>(http.get(`/trello/boards/${encodeURIComponent(boardId)}/lists`)),
  getBoardLabels: (boardId: string) =>
    req<TrelloLabel[]>(http.get(`/trello/boards/${encodeURIComponent(boardId)}/labels`)),

  // ---- CSV ----
  uploadCsv: (file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return req<CsvUploadResult>(
      http.post('/csv/upload', form, {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      }),
    );
  },
  getUpload: (uploadId: string) => req<CsvUploadResult>(http.get(`/csv/${encodeURIComponent(uploadId)}`)),
  parseCsv: (uploadId: string, mapping: ColumnMapping) =>
    req<CsvParseResult>(http.post(`/csv/${encodeURIComponent(uploadId)}/parse`, { mapping })),

  // ---- Imports ----
  startImport: (body: StartImportRequest) => req<StartImportResponse>(http.post('/imports', body)),
  listImports: () => req<ImportRecord[]>(http.get('/imports')),
  getImport: (id: string) => req<ImportDetail>(http.get(`/imports/${encodeURIComponent(id)}`)),
  cancelImport: (id: string) => req<{ ok: true }>(http.post(`/imports/${encodeURIComponent(id)}/cancel`)),
  retryImport: (id: string) => req<StartImportResponse>(http.post(`/imports/${encodeURIComponent(id)}/retry`)),
  errorsCsvUrl: (id: string) => `/api/imports/${encodeURIComponent(id)}/errors.csv`,
  eventsUrl: (id: string) => `/api/imports/${encodeURIComponent(id)}/events`,

  // ---- Stats ----
  getStats: () => req<DashboardStats>(http.get('/stats')),
};
