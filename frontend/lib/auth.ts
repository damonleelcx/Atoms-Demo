const AUTH_TOKEN_KEY = 'atoms-demo-auth-token';

function getAuthLoginUrl(): string {
  if (typeof window === 'undefined') return '/api/auth/login';
  const base = (window as unknown as { __API_BASE__?: string }).__API_BASE__;
  const b = base && !String(base).startsWith('$') ? String(base).replace(/\/$/, '') : '';
  return b ? `${b}/api/auth/login` : '/api/auth/login';
}

function getAuthSignupUrl(): string {
  if (typeof window === 'undefined') return '/api/auth/signup';
  const base = (window as unknown as { __API_BASE__?: string }).__API_BASE__;
  const b = base && !String(base).startsWith('$') ? String(base).replace(/\/$/, '') : '';
  return b ? `${b}/api/auth/signup` : '/api/auth/signup';
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(AUTH_TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function login(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = getAuthLoginUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok) {
    return { ok: false, error: data.error || 'Login failed' };
  }
  if (data.token) {
    setToken(data.token);
    return { ok: true };
  }
  return { ok: false, error: 'No token returned' };
}

export async function signup(
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = getAuthSignupUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok) {
    return { ok: false, error: data.error || 'Sign up failed' };
  }
  if (data.token) {
    setToken(data.token);
    return { ok: true };
  }
  return { ok: false, error: 'No token returned' };
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
