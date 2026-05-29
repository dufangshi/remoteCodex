const DEFAULT_CONTROL_PLANE_BASE_URL =
  import.meta.env.VITE_CONTROL_PLANE_BASE_URL || 'http://127.0.0.1:8790';

export const CONTROL_PLANE_AUTH_STORAGE_KEY = 'remote-codex-control-plane-auth';

export interface StoredControlPlaneAuth {
  baseUrl: string;
  token: string;
  email?: string;
  displayName?: string | null;
  expiresAt?: string;
}

interface LegacyStoredControlPlaneAuth {
  baseUrl?: string;
  subject?: string;
  email?: string;
  displayName?: string;
  token?: string;
  expiresAt?: string;
}

function normalizeStoredAuth(parsed: LegacyStoredControlPlaneAuth): StoredControlPlaneAuth | null {
  const baseUrl = parsed.baseUrl || DEFAULT_CONTROL_PLANE_BASE_URL;
  if (parsed.token) {
    const auth: StoredControlPlaneAuth = {
      baseUrl,
      token: parsed.token,
    };
    if (parsed.email !== undefined) {
      auth.email = parsed.email;
    }
    if (parsed.displayName !== undefined) {
      auth.displayName = parsed.displayName;
    }
    if (parsed.expiresAt !== undefined) {
      auth.expiresAt = parsed.expiresAt;
    }
    return auth;
  }
  if (parsed.subject) {
    const auth: StoredControlPlaneAuth = {
      baseUrl,
      token: `dev:${parsed.subject}`,
    };
    if (parsed.email !== undefined) {
      auth.email = parsed.email;
    }
    if (parsed.displayName !== undefined) {
      auth.displayName = parsed.displayName;
    }
    return auth;
  }
  return null;
}

export function readStoredControlPlaneAuth(): StoredControlPlaneAuth | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(CONTROL_PLANE_AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = normalizeStoredAuth(JSON.parse(raw) as LegacyStoredControlPlaneAuth);
    if (!parsed?.baseUrl || !parsed.token) {
      return null;
    }
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredControlPlaneAuth(auth: StoredControlPlaneAuth) {
  window.localStorage.setItem(CONTROL_PLANE_AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearStoredControlPlaneAuth() {
  window.localStorage.removeItem(CONTROL_PLANE_AUTH_STORAGE_KEY);
}

export function hasStoredControlPlaneAuth() {
  return Boolean(readStoredControlPlaneAuth());
}
