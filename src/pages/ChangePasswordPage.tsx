import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Card, CardBody } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { Field, Input } from '../ui/components/Form';
import { changePassword, type AuthUser } from '../application/auth';

/**
 * Shown right after signing in with a temporary password, before anything
 * else in the app is reachable. There's no skip — the accounts here hold
 * real client identifiers (UTRs, Companies House auth codes), so a
 * temporary password shouldn't stay in use longer than the first sign-in.
 */
export function ChangePasswordPage({ user, onDone }: { user: AuthUser; onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      onDone();
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
            <ShieldCheck className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-bold text-slate-900">Set a new password</h1>
          <p className="text-sm text-slate-500">
            Welcome, {user.name.split(' ')[0]}. You're signed in with a temporary password — set your own before continuing.
          </p>
        </div>
        <Card>
          <CardBody>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="Temporary password" htmlFor="cp-current">
                <Input id="cp-current" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus autoComplete="current-password" data-testid="change-password-current" />
              </Field>
              <Field label="New password" htmlFor="cp-new" hint="At least 8 characters.">
                <Input id="cp-new" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" data-testid="change-password-new" />
              </Field>
              <Field label="Confirm new password" htmlFor="cp-confirm">
                <Input id="cp-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" data-testid="change-password-confirm" />
              </Field>
              {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
              <Button type="submit" className="w-full justify-center" disabled={busy || !currentPassword || newPassword.length < 8 || !confirm} data-testid="change-password-submit">
                {busy ? 'Saving…' : 'Set password and continue'}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
