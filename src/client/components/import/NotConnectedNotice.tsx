import { Link } from 'react-router-dom';
import { PlugZap } from 'lucide-react';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Renders a warning when Trello isn't connected. Returns null when connected or still loading. */
export function NotConnectedNotice({ className }: { className?: string }) {
  const { status, loading } = useConnectionStatus();
  if (loading && !status) return null;
  if (status?.state === 'connected') return null;
  const failed = status?.state === 'failed';
  return (
    <Alert variant="warning" className={className}>
      <PlugZap />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <AlertTitle>{failed ? 'Trello connection failed' : 'Trello is not connected'}</AlertTitle>
          <AlertDescription>
            {failed
              ? status?.error ?? 'The saved credentials were rejected. Update them in Settings before importing.'
              : 'Add your Trello API key and token in Settings before starting an import.'}
          </AlertDescription>
        </div>
        <Button asChild size="sm" variant="secondary" className="shrink-0">
          <Link to="/settings">Go to Settings</Link>
        </Button>
      </div>
    </Alert>
  );
}
