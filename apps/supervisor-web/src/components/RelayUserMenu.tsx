import { LogOut, Settings } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { RelaySessionDto } from '@remote-codex/shared';
import {
  fetchRelaySession,
  relayLogout,
  relayModeActive,
} from '../lib/api';

function initials(username: string | null | undefined) {
  const normalized = username?.trim() ?? '';
  if (!normalized) {
    return '??';
  }
  return Array.from(normalized).slice(0, 2).join('').toUpperCase();
}

export function RelayUserMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!relayModeActive()) {
      return;
    }
    let cancelled = false;
    fetchRelaySession()
      .then((nextSession) => {
        if (!cancelled) {
          setSession(nextSession.authenticated ? nextSession : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const user = session?.user ?? null;
  const label = useMemo(() => initials(user?.username), [user?.username]);

  if (!relayModeActive() || !user) {
    return null;
  }

  async function logout() {
    await relayLogout();
    setSession(null);
    navigate('/relay-portal');
  }

  return (
    <div className="fixed right-3 top-[calc(env(safe-area-inset-top)+0.55rem)] z-50">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Relay account menu for ${user.username}`}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] text-sm font-semibold text-[var(--theme-fg)] shadow-lg transition hover:bg-[var(--theme-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-ring)]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {label}
      </button>
      {open ? (
        <div
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-1 shadow-xl"
          role="menu"
        >
          <div className="border-b border-[var(--theme-border)] px-3 py-2">
            <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
              {user.username}
            </p>
            <p className="truncate text-xs text-[var(--theme-fg-muted)]">{user.email}</p>
          </div>
          <Link
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)]"
            role="menuitem"
            to="/relay-account"
          >
            <Settings className="h-4 w-4" />
            Account settings
          </Link>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--status-danger-fg)] transition hover:bg-[var(--status-danger-bg)]"
            onClick={() => void logout()}
            role="menuitem"
            type="button"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}
