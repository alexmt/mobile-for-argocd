export interface AuthSettings {
  dexConfig?: {
    connectors?: { id: string; name: string; type: string }[];
  };
  oidcConfig?: {
    name: string;
    issuer: string;
  };
  userLoginsDisabled?: boolean;
}

export function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u.replace(/\/+$/, '');
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(normalizeUrl(url)).host;
  } catch {
    return url;
  }
}

export async function fetchAuthSettings(serverUrl: string): Promise<AuthSettings> {
  const res = await fetch(`${serverUrl}/api/v1/settings`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AuthSettings>;
}

export async function loginWithPassword(
  serverUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${serverUrl}/api/v1/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

export function ssoLoginUrl(serverUrl: string): string {
  return `${serverUrl}/auth/login`;
}
