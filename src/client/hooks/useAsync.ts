import * as React from 'react';
import { errorMessage } from '@/lib/api';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Runs `fn` on mount and whenever `deps` change. Pass `enabled=false` to skip.
 * Stale responses (from an older deps set) are ignored.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList, enabled = true): AsyncState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState<boolean>(enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const fnRef = React.useRef(fn);
  fnRef.current = fn;

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, nonce]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload, setData };
}
