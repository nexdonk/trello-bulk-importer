import { Link } from 'react-router-dom';
import { History, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { ImportsTable } from '@/components/ImportsTable';

export default function HistoryPage() {
  const imports = useAsync(() => api.listImports(), []);
  const records = imports.data ?? [];

  return (
    <>
      <PageHeader
        title="History"
        description="Every import run on this machine, newest first."
        actions={
          <Button size="sm" variant="secondary" onClick={imports.reload} disabled={imports.loading}>
            <RefreshCw className={imports.loading ? 'animate-spin' : undefined} /> Refresh
          </Button>
        }
      />
      {imports.error ? (
        <ErrorState title="Could not load history" message={imports.error} onRetry={imports.reload} />
      ) : (
        <Card className="overflow-hidden">
          {!imports.loading && records.length === 0 ? (
            <EmptyState
              icon={History}
              title="No imports yet"
              description="Imports you run will show up here."
              action={
                <Button asChild size="sm">
                  <Link to="/import">New import</Link>
                </Button>
              }
            />
          ) : (
            <ImportsTable records={records} loading={imports.loading} skeletonRows={8} />
          )}
        </Card>
      )}
    </>
  );
}
