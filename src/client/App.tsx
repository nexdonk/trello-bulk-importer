import { Link, Route, Routes } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { ConnectionProvider } from '@/hooks/useConnectionStatus';
import { Layout } from '@/components/Layout';
import { EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import DashboardPage from '@/pages/DashboardPage';
import SettingsPage from '@/pages/SettingsPage';
import NewImportPage from '@/pages/NewImportPage';
import ImportFlowPage from '@/pages/ImportFlowPage';
import ImportDetailPage from '@/pages/ImportDetailPage';
import HistoryPage from '@/pages/HistoryPage';

function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="The page you are looking for does not exist."
      action={
        <Button asChild variant="secondary" size="sm">
          <Link to="/">Back to dashboard</Link>
        </Button>
      }
      className="py-24"
    />
  );
}

export default function App() {
  return (
    <ConnectionProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="import" element={<NewImportPage />} />
          <Route path="import/:uploadId" element={<ImportFlowPage />} />
          <Route path="imports/:id" element={<ImportDetailPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ConnectionProvider>
  );
}
