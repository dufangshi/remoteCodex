import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type {
  RelayCreateDeviceResultDto,
  RelayPortalSummaryDto,
  RelaySessionDto,
} from '../../../../packages/shared/src/index';
import {
  ApiError,
  createRelayDevice,
  createRelayShare,
  deleteRelayDevice,
  enableRelayMode,
  fetchRelayPortal,
  fetchRelaySession,
  relayLogin,
  relayLogout,
  relayRegister,
  revokeRelayShare,
  setSelectedRelayDeviceId,
  setSelectedRelayThreadId,
} from '../lib/api';
import {
  threadHref,
  workspacesHref,
} from '../lib/relayRoutes';
import { RelayUserMenu } from '../components/RelayUserMenu';

type AuthMode = 'login' | 'register';

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : fallback;
}

export function RelayPortalPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [portal, setPortal] = useState<RelayPortalSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdDevice, setCreatedDevice] = useState<RelayCreateDeviceResultDto | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      enableRelayMode();
      const nextSession = await fetchRelaySession();
      setSession(nextSession);
      if (nextSession.authenticated) {
        setPortal(await fetchRelayPortal());
      } else {
        setPortal(null);
      }
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to load relay portal.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleAuthenticated() {
    setCreatedDevice(null);
    await load();
  }

  async function handleCreateDevice(name: string) {
    const result = await createRelayDevice({ name });
    setCreatedDevice(result);
    await load();
  }

  async function handleDeleteDevice(deviceId: string) {
    await deleteRelayDevice(deviceId);
    await load();
  }

  async function handleShare(input: {
    targetUsername: string;
    deviceId: string;
    threadId: string;
    label?: string;
  }) {
    await createRelayShare(input);
    await load();
  }

  async function handleRevokeShare(shareId: string) {
    await revokeRelayShare(shareId);
    await load();
  }

  async function handleLogout() {
    await relayLogout();
    setSession(await fetchRelaySession());
    setPortal(null);
    setCreatedDevice(null);
  }

  function openOwnDevice(deviceId: string) {
    setSelectedRelayDeviceId(deviceId);
    setSelectedRelayThreadId(null);
    navigate(workspacesHref(deviceId));
  }

  function openSharedSession(deviceId: string, threadId: string) {
    setSelectedRelayDeviceId(deviceId);
    setSelectedRelayThreadId(threadId);
    navigate(threadHref(threadId, deviceId));
  }

  if (loading) {
    return <RelayFrame>Checking relay session...</RelayFrame>;
  }

  if (!session?.authenticated) {
    return (
      <RelayFrame>
        <RelayAuthPanel
          registrationEnabled={session?.registrationEnabled ?? true}
          initialError={error}
          onAuthenticated={handleAuthenticated}
        />
      </RelayFrame>
    );
  }

  return (
    <RelayFrame>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-[var(--theme-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
              Relay Portal
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
              {session.user?.username}
            </h1>
            <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
              Manage devices and shared Remote Codex sessions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {session.user?.role === 'admin' ? (
              <Link className="relay-button-secondary" to="/relay-admin">
                Admin
              </Link>
            ) : null}
            <button className="relay-button-secondary" onClick={() => void load()} type="button">
              Refresh
            </button>
            <button className="relay-button-secondary" onClick={() => void handleLogout()} type="button">
              Sign out
            </button>
          </div>
        </header>

        {error ? <RelayNotice tone="danger">{error}</RelayNotice> : null}
        {createdDevice ? (
          <RelayNotice tone="accent">
            Device token for {createdDevice.device.name}. Store it on the device as
            REMOTE_CODEX_RELAY_AGENT_TOKEN. It will not be shown again.
            <code className="mt-2 block break-all rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 font-mono text-xs">
              {createdDevice.token}
            </code>
            <code className="mt-2 block break-all rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 font-mono text-xs">
              {relaySupervisorCommand(createdDevice.token)}
            </code>
          </RelayNotice>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
          <Panel title="Devices" description="Owned devices and sessions shared with you.">
            <DeviceCreateForm onCreate={handleCreateDevice} />
            <div className="mt-4 divide-y divide-[var(--theme-border)] rounded-lg border border-[var(--theme-border)]">
              {portal?.devices.length ? (
                portal.devices.map((device) => (
                  <div key={device.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${device.connected ? 'bg-emerald-500' : 'bg-[var(--theme-fg-muted)]'}`}
                        />
                        <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
                          {device.name}
                        </p>
                      </div>
                      <p className="mt-1 font-mono text-xs text-[var(--theme-fg-muted)]">
                        {device.tokenPreview}
                      </p>
                      <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                        {device.connected
                          ? `Online. Last heartbeat: ${formatRelayTimestamp(device.lastHeartbeatAt ?? device.connectedAt)}`
                          : `Offline. Last online: ${formatRelayTimestamp(device.lastHeartbeatAt ?? device.connectedAt)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="relay-button-primary"
                        disabled={!device.connected}
                        onClick={() => openOwnDevice(device.id)}
                        type="button"
                      >
                        Connect
                      </button>
                      <button
                        className="relay-button-secondary"
                        onClick={() => void handleDeleteDevice(device.id)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-3 text-sm text-[var(--theme-fg-muted)]">No devices yet.</p>
              )}
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--theme-fg)]">Shared</h3>
                <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-[11px] text-[var(--theme-fg-muted)]">
                  {portal?.sharedWithMe.length ?? 0}
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {portal?.sharedWithMe.length ? (
                  portal.sharedWithMe.map((share) => (
                    <article key={share.id} className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
                            {share.label || share.threadId}
                          </p>
                          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                            {share.ownerUsername} / {share.deviceName}
                          </p>
                        </div>
                        <button
                          className="relay-button-primary"
                          onClick={() => openSharedSession(share.deviceId, share.threadId)}
                          type="button"
                        >
                          Continue
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 text-sm text-[var(--theme-fg-muted)]">
                    No shared sessions.
                  </p>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Invite" description="Share a single thread with another relay user.">
            <ShareForm
              devices={portal?.devices ?? []}
              onShare={handleShare}
            />
          </Panel>
        </section>

        <section>
          <Panel title="Shared By Me" description="Active invitations you created.">
            <div className="space-y-3">
              {portal?.sharedByMe.length ? (
                portal.sharedByMe.map((share) => (
                  <article key={share.id} className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
                    <p className="text-sm font-medium text-[var(--theme-fg)]">
                      {share.label || share.threadId}
                    </p>
                    <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                      Shared with {share.targetUsername} on {share.deviceName}
                    </p>
                    <button
                      className="relay-button-secondary mt-3"
                      onClick={() => void handleRevokeShare(share.id)}
                      type="button"
                    >
                      Revoke
                    </button>
                  </article>
                ))
              ) : (
                <p className="text-sm text-[var(--theme-fg-muted)]">No active shares.</p>
              )}
            </div>
          </Panel>
        </section>
      </div>
    </RelayFrame>
  );
}

function RelayAuthPanel({
  registrationEnabled,
  initialError,
  onAuthenticated,
}: {
  registrationEnabled: boolean;
  initialError: string | null;
  onAuthenticated: () => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'login') {
        await relayLogin({ identifier, password });
      } else {
        await relayRegister({ email, username, password, registrationPassword });
      }
      await onAuthenticated();
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to authenticate with relay.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-sm rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-xl shadow-black/10">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
        Relay Access
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </h1>
      <form className="mt-5 space-y-4" onSubmit={submit}>
        {mode === 'login' ? (
          <RelayInput
            autoComplete="username"
            label="Email or username"
            onChange={setIdentifier}
            value={identifier}
          />
        ) : (
          <>
            <RelayInput autoComplete="email" label="Email" onChange={setEmail} value={email} />
            <RelayInput autoComplete="username" label="Username" onChange={setUsername} value={username} />
            <RelayInput
              autoComplete="one-time-code"
              label="Registration password"
              onChange={setRegistrationPassword}
              type="password"
              value={registrationPassword}
            />
          </>
        )}
        <RelayInput
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          label="Password"
          onChange={setPassword}
          type="password"
          value={password}
        />
        {error ? <RelayNotice tone="danger">{error}</RelayNotice> : null}
        <button className="relay-button-primary h-11 w-full" disabled={submitting} type="submit">
          {submitting ? 'Working...' : mode === 'login' ? 'Sign in' : 'Register'}
        </button>
      </form>
      <button
        className="mt-4 text-sm text-[var(--theme-accent-strong)] disabled:text-[var(--theme-fg-muted)]"
        disabled={mode === 'login' ? !registrationEnabled : false}
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        type="button"
      >
        {mode === 'login'
          ? registrationEnabled
            ? 'Create relay account'
            : 'Registration is disabled'
          : 'Use an existing account'}
      </button>
    </section>
  );
}

function DeviceCreateForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate(name);
      setName('');
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to create device.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
      <input
        className="relay-input min-w-0 flex-1"
        onChange={(event) => setName(event.target.value)}
        placeholder="Device name"
        value={name}
      />
      <button className="relay-button-primary" disabled={busy || !name.trim()} type="submit">
        Create
      </button>
      {error ? <p className="text-sm text-[var(--status-danger-fg)]">{error}</p> : null}
    </form>
  );
}

function ShareForm({
  devices,
  onShare,
}: {
  devices: RelayPortalSummaryDto['devices'];
  onShare: (input: {
    targetUsername: string;
    deviceId: string;
    threadId: string;
    label?: string;
  }) => Promise<void>;
}) {
  const firstDeviceId = useMemo(() => devices[0]?.id ?? '', [devices]);
  const [deviceId, setDeviceId] = useState(firstDeviceId);
  const [targetUsername, setTargetUsername] = useState('');
  const [threadId, setThreadId] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId && firstDeviceId) {
      setDeviceId(firstDeviceId);
    }
  }, [deviceId, firstDeviceId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await onShare({
        targetUsername,
        deviceId,
        threadId,
        ...(label.trim() ? { label } : {}),
      });
      setTargetUsername('');
      setThreadId('');
      setLabel('');
      setMessage('Invitation created.');
    } catch (caught) {
      setMessage(errorMessage(caught, 'Unable to create invitation.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <label className="block text-sm text-[var(--theme-fg-soft)]">
        Device
        <select
          className="relay-input mt-2 w-full"
          onChange={(event) => setDeviceId(event.target.value)}
          value={deviceId}
        >
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
      </label>
      <RelayInput label="Username" onChange={setTargetUsername} value={targetUsername} />
      <RelayInput label="Thread ID" onChange={setThreadId} value={threadId} />
      <RelayInput label="Label" onChange={setLabel} value={label} />
      {message ? <p className="text-sm text-[var(--theme-fg-muted)]">{message}</p> : null}
      <button
        className="relay-button-primary"
        disabled={busy || !deviceId || !targetUsername.trim() || !threadId.trim()}
        type="submit"
      >
        Invite
      </button>
    </form>
  );
}

function RelayFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-6 text-[var(--app-fg)] sm:px-6">
      <RelayUserMenu />
      <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center">
        {children}
      </div>
    </main>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-[var(--theme-fg)]">{title}</h2>
        <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">{description}</p>
      </div>
      {children}
    </section>
  );
}

function RelayInput({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block text-sm text-[var(--theme-fg-soft)]">
      {label}
      <input
        autoComplete={autoComplete}
        className="relay-input mt-2 w-full"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function RelayNotice({
  tone,
  children,
}: {
  tone: 'accent' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        tone === 'danger'
          ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
          : 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-fg)]'
      }`}
    >
      {children}
    </div>
  );
}

function relaySupervisorCommand(token: string) {
  const relayUrl = relayWebsocketBaseUrl();
  return `REMOTE_CODEX_RELAY_SERVER_URL=${relayUrl} REMOTE_CODEX_RELAY_AGENT_TOKEN=${token} remote-codex relay-supervisor`;
}

function relayWebsocketBaseUrl() {
  if (typeof window === 'undefined') {
    return 'wss://relay.example.com';
  }

  return window.location.origin
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://');
}

function formatRelayTimestamp(value: string | null | undefined) {
  return value ?? 'never';
}
