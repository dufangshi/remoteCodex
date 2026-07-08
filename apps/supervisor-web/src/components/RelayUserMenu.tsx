import { LogOut, MonitorSmartphone, Settings, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { RelaySessionDto } from '@remote-codex/shared';
import {
  fetchRelaySession,
  relayLogout,
  relayModeActive,
} from '../lib/api';
import { RelayAccountSettingsPanel } from '../pages/RelayAccountPage';

function initials(username: string | null | undefined) {
  const normalized = username?.trim() ?? '';
  if (!normalized) {
    return '??';
  }
  return Array.from(normalized).slice(0, 2).join('').toUpperCase();
}

export function RelayUserMenu({
  className = '',
  menuAlign = 'left',
}: {
  className?: string;
  menuAlign?: 'left' | 'right';
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

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
    setAccountOpen(false);
  }, [location.pathname]);

  const user = session?.user ?? null;
  const label = useMemo(() => initials(user?.username), [user?.username]);
  const accountDialog =
    accountOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            aria-modal="true"
            className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-6 backdrop-blur-sm sm:py-10"
            role="dialog"
          >
            <section className="w-full max-w-3xl rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] shadow-[var(--theme-shadow)]">
              <header className="flex items-start justify-between gap-4 border-b border-[var(--theme-border)] px-5 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
                    Relay Account
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-[var(--theme-fg)]">
                    Account settings
                  </h2>
                </div>
                <button
                  aria-label="Close account settings"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-ring)]"
                  onClick={() => setAccountOpen(false)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="max-h-[min(78vh,48rem)] overflow-y-auto p-5">
                <RelayAccountSettingsPanel />
              </div>
            </section>
          </div>,
          document.body,
        )
      : null;

  if (!relayModeActive() || !user) {
    return null;
  }

  async function logout() {
    await relayLogout();
    setSession(null);
    navigate('/relay-portal');
  }

  return (
    <div className={`relative z-50 inline-flex shrink-0 ${className}`.trim()}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Relay account menu for ${user.username}`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] text-sm font-semibold text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-ring)]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {label}
      </button>
      {open ? (
        <div
          className={`absolute mt-2 w-64 overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-1 shadow-[var(--theme-shadow)] ${
            menuAlign === 'right' ? 'right-0' : 'left-0'
          }`}
          role="menu"
        >
          <div className="border-b border-[var(--theme-border)] px-3 py-2">
            <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
              {user.username}
            </p>
            <p className="truncate text-xs text-[var(--theme-fg-muted)]">{user.email}</p>
          </div>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)]"
            onClick={() => {
              setOpen(false);
              setAccountOpen(true);
            }}
            role="menuitem"
            type="button"
          >
            <Settings className="h-4 w-4" />
            Account settings
          </button>
          <Link
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)]"
            role="menuitem"
            to="/relay-devices"
          >
            <MonitorSmartphone className="h-4 w-4" />
            Device management
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
      {accountDialog}
    </div>
  );
}
