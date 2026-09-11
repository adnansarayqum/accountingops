export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
}

export type AuthCheckResult = { status: 'ok'; user: AuthUser } | { status: 'unauthenticated' } | { status: 'not_configured' };

/**
 * Checks sign-in status against the server. `not_configured` means no
 * database is wired up yet (DATABASE_URL unset) — the caller should fall
 * back to the original browser-only mode rather than showing a login
 * screen with nothing behind it.
 *
 * /health is checked first (always 200, whether or not a database is
 * configured) so the common no-database case never has to make a request
 * that fails — hitting /api/auth/me directly would 503, which the browser
 * logs as a failed request regardless of how the response is handled here.
 */
export async function fetchCurrentUser(): Promise<AuthCheckResult> {
  try {
    const health = await fetch('/health');
    if (health.ok) {
      const body = (await health.json().catch(() => null)) as { database?: boolean } | null;
      if (body?.database === false) return { status: 'not_configured' };
    }
  } catch {
    return { status: 'not_configured' };
  }

  let res: Response;
  try {
    res = await fetch('/api/auth/me', { credentials: 'include' });
  } catch {
    return { status: 'not_configured' };
  }
  if (res.status === 503) return { status: 'not_configured' };
  if (res.status === 401) return { status: 'unauthenticated' };
  if (!res.ok) return { status: 'not_configured' };
  const body = (await res.json()) as { user: AuthUser };
  return { status: 'ok', user: body.user };
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error === 'invalid_credentials' ? 'Incorrect username or password.' : "Couldn't sign in. Try again.");
  }
  const body = (await res.json()) as { user: AuthUser };
  return body.user;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    const message = body.error === 'invalid_current_password' ? 'Current password is incorrect.' : body.error === 'weak_password' ? 'New password must be at least 8 characters.' : "Couldn't update your password. Try again.";
    throw new Error(message);
  }
}
