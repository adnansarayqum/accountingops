import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './ui/layout/AppShell';
import { useAppStore, configureRepository } from './application/store';
import { HttpRepository } from './application/persistence/httpRepository';
import { fetchCurrentUser, type AuthUser } from './application/auth';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { UnavailablePage } from './pages/UnavailablePage';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const AttentionPage = lazy(() => import('./pages/AttentionPage').then((module) => ({ default: module.AttentionPage })));
const ClientsPage = lazy(() => import('./pages/ClientsPage').then((module) => ({ default: module.ClientsPage })));
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage').then((module) => ({ default: module.ClientDetailPage })));
const NewClientPage = lazy(() => import('./pages/NewClientPage').then((module) => ({ default: module.NewClientPage })));
const ImportClientsPage = lazy(() => import('./pages/ImportClientsPage').then((module) => ({ default: module.ImportClientsPage })));
const JobsPage = lazy(() => import('./pages/JobsPage').then((module) => ({ default: module.JobsPage })));
const JobDetailPage = lazy(() => import('./pages/JobDetailPage').then((module) => ({ default: module.JobDetailPage })));
const ChasingPage = lazy(() => import('./pages/ChasingPage').then((module) => ({ default: module.ChasingPage })));
const InboxPage = lazy(() => import('./pages/InboxPage').then((module) => ({ default: module.InboxPage })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })));
const CapacityPage = lazy(() => import('./pages/CapacityPage').then((module) => ({ default: module.CapacityPage })));
const ReadinessPage = lazy(() => import('./pages/ReadinessPage').then((module) => ({ default: module.ReadinessPage })));
const BriefingPage = lazy(() => import('./pages/BriefingPage').then((module) => ({ default: module.BriefingPage })));
const ActivityPage = lazy(() => import('./pages/ActivityPage').then((module) => ({ default: module.ActivityPage })));
const AskPage = lazy(() => import('./pages/AskPage').then((module) => ({ default: module.AskPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })));
const PortalPage = lazy(() => import('./pages/PortalPage').then((module) => ({ default: module.PortalPage })));

type AuthPhase = 'checking' | 'local' | 'unauthenticated' | 'must_change_password' | 'authenticated' | 'unavailable';

/**
 * The public client portal is routed before any of the app's auth gating:
 * it has no session, loads no practice data, and must work for a person
 * who has never signed in. Everything else goes through the gated app.
 */
export default function App() {
  return (
    <Suspense fallback={<SplashSkeleton />}>
      <Routes>
        <Route path="/portal/:token" element={<PortalPage />} />
        <Route path="*" element={<AuthenticatedApp />} />
      </Routes>
    </Suspense>
  );
}

function AuthenticatedApp() {
  const ready = useAppStore((s) => s.ready);
  const init = useAppStore((s) => s.init);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('checking');
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
  const [retrying, setRetrying] = useState(false);

  const checkSession = useCallback(async () => {
    const result = await fetchCurrentUser();
    if (result.status === 'not_configured') {
      setAuthPhase('local');
    } else if (result.status === 'unavailable') {
      setAuthPhase('unavailable');
    } else if (result.status === 'unauthenticated') {
      setAuthPhase('unauthenticated');
    } else if (result.user.mustChangePassword) {
      setPendingUser(result.user);
      setAuthPhase('must_change_password');
    } else {
      useAppStore.setState({ authMode: 'server', authUser: result.user, currentUserId: result.user.id });
      setAuthPhase('authenticated');
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (authPhase === 'local' || authPhase === 'authenticated') {
      if (authPhase === 'authenticated') configureRepository(new HttpRepository());
      void init();
    }
  }, [authPhase, init]);

  if (authPhase === 'checking') return <SplashSkeleton />;

  if (authPhase === 'unavailable') {
    return (
      <UnavailablePage
        busy={retrying}
        onRetry={() => {
          setRetrying(true);
          void checkSession().finally(() => setRetrying(false));
        }}
      />
    );
  }

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
