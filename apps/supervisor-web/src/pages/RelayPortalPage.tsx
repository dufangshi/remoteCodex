import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

import type {
  RelayCreateDeviceResultDto,
  RelayPortalSummaryDto,
  RelaySessionDto,
  RelaySessionShareDto,
  RelayThreadAccessDto,
  RelayWorkspaceAccessDto,
} from '../../../../packages/shared/src/index';
import {
  ApiError,
  createRelayDevice,
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
  updateRelayShare,
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
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null);
  const [editingShare, setEditingShare] = useState<RelaySessionShareDto | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      enableRelayMode();
      const nextSession = await fetchRelaySession();
      setSession(nextSession);
      if (nextSession.authenticated) {
        if (nextSession.user?.role === 'admin') {
          navigate('/relay-admin', { replace: true });
          return;
        }
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

  async function handleDeleteDevice(device: { id: string; name: string }) {
    if (!window.confirm(`Delete relay device "${device.name}"?`)) {
      return;
    }
    await deleteRelayDevice(device.id);
    await load();
  }

  async function handleRevokeShare(shareId: string) {
    await revokeRelayShare(shareId);
    await load();
  }

  async function handleUpdateShare(share: RelaySessionShareDto, input: {
    label: string | null;
    threadAccess: RelayThreadAccessDto;
    workspaceAccess: RelayWorkspaceAccessDto;
  }) {
    await updateRelayShare(share.id, input);
    setEditingShare(null);
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

        <section className="grid gap-4">
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
                        onClick={() => void handleDeleteDevice(device)}
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
                            {shareTitleText(share)}
                          </p>
                          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                            {share.workspaceLabel ?? 'Workspace unavailable'} / {share.ownerUsername} / {share.deviceName}
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
        </section>

        <section>
          <Panel title="Shared By Me" description="Active invitations you created.">
            <div className="space-y-3">
              {portal?.sharedByMe.length ? (
                portal.sharedByMe.map((share) => (
                  <SharedByMeRow
                    expanded={expandedShareId === share.id}
                    key={share.id}
                    onEdit={() => setEditingShare(share)}
                    onOpen={() => openSharedSession(share.deviceId, share.threadId)}
                    onRevoke={() => void handleRevokeShare(share.id)}
                    onToggleAccess={() => setExpandedShareId((current) => (current === share.id ? null : share.id))}
                    share={share}
                  />
                ))
              ) : (
                <p className="text-sm text-[var(--theme-fg-muted)]">No active shares.</p>
              )}
            </div>
          </Panel>
        </section>
        {editingShare ? (
          <SharePermissionsDialog
            onClose={() => setEditingShare(null)}
            onSave={(input) => void handleUpdateShare(editingShare, input)}
            share={editingShare}
          />
        ) : null}
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
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'login') {
        await relayLogin({ identifier, password });
      } else {
        const result = await relayRegister({ email, username, password, registrationPassword });
        if (result.pendingApproval) {
          setNotice('Registration request sent. An admin must approve it before you can sign in.');
          setMode('login');
          return;
        }
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
        {notice ? <RelayNotice tone="accent">{notice}</RelayNotice> : null}
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

function SharedByMeRow({
  expanded,
  onEdit,
  onOpen,
  onRevoke,
  onToggleAccess,
  share,
}: {
  expanded: boolean;
  onEdit: () => void;
  onOpen: () => void;
  onRevoke: () => void;
  onToggleAccess: () => void;
  share: RelaySessionShareDto;
}) {
  const lastAccessLabel = share.lastAccessedAt
    ? `${share.lastAccessedByUsername ?? 'unknown'} at ${formatRelayTimestamp(share.lastAccessedAt)}`
    : 'Not accessed yet';

  return (
    <article className="relative rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
            {shareTitleText(share)}
          </p>
          <div className="mt-1 space-y-0.5 text-xs text-[var(--theme-fg-muted)]">
            <p className="truncate">
              Workspace: <span className="text-[var(--theme-fg-soft)]">{share.workspaceLabel ?? 'Workspace unavailable'}</span>
            </p>
            <p className="truncate">
              Thread: <span className="text-[var(--theme-fg-soft)]">{shareTitleText(share)}</span>
            </p>
            <p className="truncate">To {share.targetUsername} on {share.deviceName}</p>
            <p className="truncate">Last access: {lastAccessLabel}</p>
          </div>
          <p className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--theme-fg-muted)]">
            <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5">
              {share.threadAccess === 'read' ? 'View only' : 'Collaborator'}
            </span>
            <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5">
              {workspaceAccessLabel(share.workspaceAccess)}
            </span>
            <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5">
              {share.revokedAt ? 'Revoked' : 'Active'}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="relay-button-primary" onClick={onOpen} type="button">
            Open
          </button>
          <button className="relay-button-secondary" onClick={onEdit} type="button">
            Permissions
          </button>
          <button className="relay-button-secondary inline-flex items-center gap-2" onClick={onToggleAccess} type="button">
            Access
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <button className="relay-button-secondary text-[var(--status-danger-fg)]" onClick={onRevoke} type="button">
            Revoke
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="absolute right-3 top-[calc(100%-0.5rem)] z-20 w-[min(24rem,calc(100vw-3rem))] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3 shadow-xl">
          {share.accessEvents.length ? (
            <ul className="space-y-2 text-xs text-[var(--theme-fg-muted)]">
              {share.accessEvents.map((event) => (
                <li className="flex items-center justify-between gap-3" key={event.id}>
                  <span className="font-medium text-[var(--theme-fg)]">{event.username}</span>
                  <span>{formatRelayTimestamp(event.accessedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--theme-fg-muted)]">
              This shared thread has not been accessed yet.
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function SharePermissionsDialog({
  onClose,
  onSave,
  share,
}: {
  onClose: () => void;
  onSave: (input: {
    label: string | null;
    threadAccess: RelayThreadAccessDto;
    workspaceAccess: RelayWorkspaceAccessDto;
  }) => void;
  share: RelaySessionShareDto;
}) {
  const [label, setLabel] = useState(share.label ?? '');
  const [threadAccess, setThreadAccess] = useState<RelayThreadAccessDto>(share.threadAccess);
  const [workspaceAccess, setWorkspaceAccess] = useState<RelayWorkspaceAccessDto>(share.workspaceAccess);
  const workspaceAccessLocked = !share.workspaceId;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      label: label.trim() || null,
      threadAccess,
      workspaceAccess: workspaceAccessLocked ? 'none' : workspaceAccess,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--app-bg)_82%,transparent)] px-4 py-6">
      <form
        className="w-full max-w-lg rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-2xl"
        onSubmit={submit}
      >
        <h2 className="text-base font-semibold text-[var(--theme-fg)]">Shared thread permissions</h2>
        <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
          {share.targetUsername} can access {shareTitleText(share)}.
        </p>
        <div className="mt-5 space-y-4">
          <RelayInput label="Label" onChange={setLabel} value={label} />
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            Thread access
            <select
              className="relay-input mt-2 w-full"
              onChange={(event) => setThreadAccess(event.target.value as RelayThreadAccessDto)}
              value={threadAccess}
            >
              <option value="read">View only</option>
              <option value="control">Collaborator</option>
            </select>
          </label>
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            Workspace access
            <select
              className="relay-input mt-2 w-full"
              disabled={workspaceAccessLocked}
              onChange={(event) => setWorkspaceAccess(event.target.value as RelayWorkspaceAccessDto)}
              value={workspaceAccessLocked ? 'none' : workspaceAccess}
            >
              <option value="none">No workspace</option>
              <option value="read">Workspace read</option>
              <option value="write">Workspace write</option>
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="relay-button-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="relay-button-primary" type="submit">
            Save permissions
          </button>
        </div>
      </form>
    </div>
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

function shareTitleText(share: RelaySessionShareDto) {
  return share.threadTitle?.trim() || share.label?.trim() || 'Thread unavailable';
}

function workspaceAccessLabel(access: RelayWorkspaceAccessDto) {
  switch (access) {
    case 'write':
      return 'Workspace write';
    case 'read':
      return 'Workspace read';
    case 'none':
    default:
      return 'No workspace';
  }
}
