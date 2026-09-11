import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './ui/layout/AppShell';
import { useAppStore, configureRepository } from './application/store';
import { HttpRepository } from './application/persistence/httpRepository';
import { fetchCurrentUser, type AuthUser } from './application/auth';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
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

type AuthPhase = 'checking' | 'local' | 'unauthenticated' | 'must_change_password' | 'authenticated';

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const init = useAppStore((s) => s.init);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('checking');
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    void fetchCurrentUser().then((result) => {
      if (result.status === 'not_configured') {
        setAuthPhase('local');
      } else if (result.status === 'unauthenticated') {
        setAuthPhase('unauthenticated');
      } else if (result.user.mustChangePassword) {
        setPendingUser(result.user);
        setAuthPhase('must_change_password');
      } else {
        useAppStore.setState({ authMode: 'server', authUser: result.user, currentUserId: result.user.id });
        setAuthPhase('authenticated');
      }
    });
  }, []);

  useEffect(() => {
    if (authPhase === 'local' || authPhase === 'authenticated') {
      if (authPhase === 'authenticated') configureRepository(new HttpRepository());
      void init();
    }
  }, [authPhase, init]);

  if (authPhase === 'checking') return <SplashSkeleton />;

  if (authPhase === 'unauthenticated') {
    return (
      <LoginPage
        onSuccess={(user) => {
          if (user.mustChangePassword) {
            setPendingUser(user);
            setAuthPhase('must_change_password');
          } else {
            useAppStore.setState({ authMode: 'server', authUser: user, currentUserId: user.id });
            setAuthPhase('authenticated');
          }
        }}
      />
    );
  }

  if (authPhase === 'must_change_password' && pendingUser) {
    return (
      <ChangePasswordPage
        user={pendingUser}
        onDone={() => {
          const user = { ...pendingUser, mustChangePassword: false };
          useAppStore.setState({ authMode: 'server', authUser: user, currentUserId: user.id });
          setAuthPhase('authenticated');
        }}
      />
    );
  }

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
