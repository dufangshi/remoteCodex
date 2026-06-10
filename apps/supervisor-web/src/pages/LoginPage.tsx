import { FormEvent, useState } from 'react';

import { ApiError } from '../lib/api';

export function LoginPage({
  onLogin,
}: {
  onLogin: (input: { username: string; password: string }) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onLogin({
        username,
        password,
      });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.payload.message);
      } else {
        setError('Unable to sign in.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 py-8 text-[var(--app-fg)]">
      <section className="w-full max-w-sm rounded-[1.35rem] border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-2xl shadow-[color-mix(in_oklch,var(--app-fg)_14%,transparent)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-muted)]">
            Supervisor Access
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-[var(--theme-fg)]">
            Sign in
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--theme-muted)]">
            Use the admin credentials configured on this Remote Codex server.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[var(--theme-fg-soft)]">
              Username
            </span>
            <input
              autoComplete="username"
              autoFocus
              className="mt-2 h-11 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none transition focus:border-[var(--theme-accent-solid)] focus:ring-2 focus:ring-[var(--theme-accent-border)]"
              disabled={submitting}
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              value={username}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[var(--theme-fg-soft)]">
              Password
            </span>
            <input
              autoComplete="current-password"
              className="mt-2 h-11 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none transition focus:border-[var(--theme-accent-solid)] focus:ring-2 focus:ring-[var(--theme-accent-border)]"
              disabled={submitting}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>

          {error && (
            <p className="rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger-fg)]">
              {error}
            </p>
          )}

          <button
            className="h-11 w-full rounded-xl bg-[var(--theme-accent-solid)] px-4 text-sm font-semibold text-[var(--theme-accent-solid-fg)] transition hover:bg-[var(--theme-accent-solid-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting || !username.trim() || !password}
            type="submit"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
