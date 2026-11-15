import * as React from 'react';
import type { CardResult, ImportProgress, ImportRecord, ImportStatus } from '@shared/types';
import { api, errorMessage } from '@/lib/api';

export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface LogEntry {
  key: string;
  at: number;
  card: CardResult;
}

const MAX_LOG = 200;
const TERMINAL: ImportStatus[] = ['completed', 'completed_with_errors', 'failed', 'cancelled'];

export function isTerminalStatus(s: ImportStatus | undefined | null): boolean {
  return !!s && TERMINAL.includes(s);
}

interface State {
  record: ImportRecord | null;
  progress: ImportProgress | null;
  /** Latest known result per row. */
  cards: Map<number, CardResult>;
  /** Live log, newest first. */
  log: LogEntry[];
}

export interface UseImportProgress {
  record: ImportRecord | null;
  progress: ImportProgress | null;
  cards: CardResult[];
  log: LogEntry[];
  stream: StreamState;
  loading: boolean;
  error: string | null;
  isDone: boolean;
  reload: () => void;
}

export function useImportProgress(importId: string | undefined): UseImportProgress {
  const [state, setState] = React.useState<State>({ record: null, progress: null, cards: new Map(), log: [] });
  const [stream, setStream] = React.useState<StreamState>('connecting');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!importId) return;
    let disposed = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let finished = false;
    let logSeq = 0;

    setState({ record: null, progress: null, cards: new Map(), log: [] });
    setLoading(true);
    setError(null);
    setStream('connecting');

    const fetchDetail = async (): Promise<boolean> => {
      try {
        const d = await api.getImport(importId);
        if (disposed) return false;
        setState((prev) => {
          const cards = new Map(prev.cards);
          for (const c of d.cards) cards.set(c.row, c);
          return { ...prev, record: d.record, progress: d.progress, cards };
        });
        setError(null);
        return isTerminalStatus(d.progress.status);
      } catch (err) {
        if (!disposed) setError(errorMessage(err));
        return false;
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    const closeStream = () => {
      if (es) {
        es.close();
        es = null;
      }
    };

    const finish = async () => {
      if (finished) return;
      finished = true;
      closeStream();
      setStream('closed');
      await fetchDetail();
    };

    const scheduleReconnect = () => {
      if (disposed || finished) return;
      setStream('reconnecting');
      const delay = Math.min(10_000, 1000 * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(async () => {
        // Fallback snapshot while the stream is down.
        const done = await fetchDetail();
        if (disposed) return;
        if (done) {
          finished = true;
          setStream('closed');
          return;
        }
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed || finished) return;
      closeStream();
      const source = new EventSource(api.eventsUrl(importId));
      es = source;

      source.onopen = () => {
        attempt = 0;
        setStream('live');
      };

      source.addEventListener('progress', (ev) => {
        try {
          const p = JSON.parse((ev as MessageEvent<string>).data) as ImportProgress;
          setState((prev) => ({ ...prev, progress: p }));
          setLoading(false);
          if (isTerminalStatus(p.status)) {
            // Some servers may only send a terminal progress; treat as done.
            void finish();
          }
        } catch {
          /* ignore malformed event */
        }
      });

      source.addEventListener('card', (ev) => {
        try {
          const c = JSON.parse((ev as MessageEvent<string>).data) as CardResult;
          setState((prev) => {
            const cards = new Map(prev.cards);
            cards.set(c.row, c);
            const entry: LogEntry = { key: `${c.row}-${c.attempts}-${logSeq++}`, at: Date.now(), card: c };
            const log = [entry, ...prev.log].slice(0, MAX_LOG);
            return { ...prev, cards, log };
          });
        } catch {
          /* ignore */
        }
      });

      source.addEventListener('done', (ev) => {
        try {
          const p = JSON.parse((ev as MessageEvent<string>).data) as ImportProgress;
          setState((prev) => ({ ...prev, progress: p }));
        } catch {
          /* ignore */
        }
        void finish();
      });

      source.onerror = () => {
        if (finished || disposed) return;
        closeStream();
        scheduleReconnect();
      };
    };

    (async () => {
      const done = await fetchDetail();
      if (disposed) return;
      if (done) {
        finished = true;
        setStream('closed');
      } else {
        connect();
      }
    })();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      closeStream();
    };
  }, [importId, nonce]);

  const cards = React.useMemo(
    () => Array.from(state.cards.values()).sort((a, b) => a.row - b.row),
    [state.cards],
  );

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  return {
    record: state.record,
    progress: state.progress,
    cards,
    log: state.log,
    stream,
    loading,
    error,
    isDone: isTerminalStatus(state.progress?.status),
    reload,
  };
}
