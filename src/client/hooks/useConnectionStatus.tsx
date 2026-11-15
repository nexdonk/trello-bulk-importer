import * as React from 'react';
import type { ConnectionStatus, CredentialsInput } from '@shared/types';
import { api, errorMessage } from '@/lib/api';

interface ConnectionContextValue {
  status: ConnectionStatus | null;
  loading: boolean;
  /** Error loading the status itself (e.g. server unreachable). */
  error: string | null;
  testing: boolean;
  refresh: () => Promise<ConnectionStatus | null>;
  test: () => Promise<ConnectionStatus>;
  save: (input: CredentialsInput) => Promise<ConnectionStatus>;
  remove: () => Promise<void>;
}

const ConnectionContext = React.createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const s = await api.getConnectionStatus();
      setStatus(s);
      setError(null);
      return s;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const test = React.useCallback(async () => {
    setTesting(true);
    try {
      const s = await api.testConnection();
      setStatus(s);
      setError(null);
      return s;
    } finally {
      setTesting(false);
    }
  }, []);

  const save = React.useCallback(async (input: CredentialsInput) => {
    setTesting(true);
    try {
      const s = await api.saveCredentials(input);
      setStatus(s);
      setError(null);
      return s;
    } finally {
      setTesting(false);
    }
  }, []);

  const remove = React.useCallback(async () => {
    await api.deleteCredentials();
    await refresh();
  }, [refresh]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = React.useMemo(
    () => ({ status, loading, error, testing, refresh, test, save, remove }),
    [status, loading, error, testing, refresh, test, save, remove],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnectionStatus(): ConnectionContextValue {
  const ctx = React.useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnectionStatus must be used inside <ConnectionProvider>');
  return ctx;
}
