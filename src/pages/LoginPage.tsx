import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Card, CardBody } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { Field, Input } from '../ui/components/Form';
import { login, type AuthUser } from '../application/auth';

export function LoginPage({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(username.trim(), password);
      onSuccess(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-white mb-3">
            <Lock className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-bold text-slate-900">Farhan & Raihan</h1>
          <p className="text-sm text-slate-500">Sign in to the operations hub</p>
        </div>
        <Card>
          <CardBody>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="Username" htmlFor="login-username">
                <Input id="login-username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" data-testid="login-username" />
              </Field>
              <Field label="Password" htmlFor="login-password">
                <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="login-password" />
              </Field>
              {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
              <Button type="submit" className="w-full justify-center" disabled={busy || !username.trim() || !password} data-testid="login-submit">
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
