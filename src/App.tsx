import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './ui/layout/AppShell';
import { useAppStore } from './application/store';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { DashboardPage } from './pages/DashboardPage';
import { AttentionPage } from './pages/AttentionPage';
import { ClientsPage } from './pages/ClientsPage';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { NewClientPage } from './pages/NewClientPage';
import { ImportClientsPage } from './pages/ImportClientsPage';
import { JobsPage } from './pages/JobsPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { ChasingPage } from './pages/ChasingPage';
import { InboxPage } from './pages/InboxPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { CapacityPage } from './pages/CapacityPage';
import { ReadinessPage } from './pages/ReadinessPage';
import { BriefingPage } from './pages/BriefingPage';
import { ActivityPage } from './pages/ActivityPage';
import { AskPage } from './pages/AskPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const init = useAppStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) return <SplashSkeleton />;

  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="dashboard" element={<Navigate to="/" replace />} />
          <Route path="attention" element={<AttentionPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/new" element={<NewClientPage />} />
          <Route path="clients/import" element={<ImportClientsPage />} />
          <Route path="clients/:clientId" element={<ClientDetailPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:jobId" element={<JobDetailPage />} />
          <Route path="chasing" element={<ChasingPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route path="capacity" element={<CapacityPage />} />
          <Route path="readiness" element={<ReadinessPage />} />
          <Route path="briefing" element={<BriefingPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="ask" element={<AskPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

function SplashSkeleton() {
  return (
    <div className="min-h-screen bg-canvas lg:pl-64">
      <div className="hidden lg:block fixed inset-y-0 left-0 w-64 bg-surface border-r border-slate-200" />
      <div className="h-14 bg-surface border-b border-slate-200" />
      <div className="p-6 space-y-4 max-w-[1400px]">
        <div className="skeleton h-7 w-56" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
        <div className="skeleton h-64" />
      </div>
    </div>
  );
}
