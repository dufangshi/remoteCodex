import { ChevronDown, Copy, MonitorSmartphone, Plug, Plus, Trash2 } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type {
  RelayCreateDeviceResultDto,
  RelayDeviceDto,
  RelayPortalSummaryDto,
  RelaySessionShareDto,
  RelayThreadAccessDto,
  RelayWorkspaceAccessDto,
} from '@remote-codex/shared';
import {
  ApiError,
  createRelayDevice,
  deleteRelayDevice,
  enableRelayMode,
  fetchRelayPortal,
  revokeRelayShare,
  setSelectedRelayDeviceId,
  setSelectedRelayThreadId,
  updateRelayShare,
} from '../lib/api';
import { threadHref, workspacesHref } from '../lib/relayRoutes';

const RELAY_PORTAL_REFRESH_INTERVAL_MS = 3000;

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : fallback;
}

export function RelayDevicesPage() {
  const navigate = useNavigate();
  const [portal, setPortal] = useState<RelayPortalSummaryDto | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [createdDevice, setCreatedDevice] = useState<RelayCreateDeviceResultDto | null>(null);
  const [copiedDeviceId, setCopiedDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null);
  const [editingShare, setEditingShare] = useState<RelaySessionShareDto | null>(null);
  const hasLoadedPortalRef = useRef(false);

  const load = useCallback(async (options?: {
    showLoading?: boolean;
    clearError?: boolean;
  }) => {
    const showLoading = options?.showLoading ?? true;
    const clearError = options?.clearError ?? true;

    if (showLoading) {
      setLoading(true);
    }
    if (clearError) {
      setError(null);
    }
    try {
      enableRelayMode();
      const nextPortal = await fetchRelayPortal();
      hasLoadedPortalRef.current = true;
      setPortal(nextPortal);
    } catch (caught) {
      if (showLoading || !hasLoadedPortalRef.current) {
        setError(errorMessage(caught, 'Unable to load devices.'));
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => {
      void load({ showLoading: false, clearError: false });
    }, RELAY_PORTAL_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [load]);

  async function addDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('create');
    setError(null);
    try {
      const result = await createRelayDevice({ name: deviceName });
      setCreatedDevice(result);
      setDeviceName('');
      await load({ showLoading: false });
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to create device.'));
    } finally {
      setBusy(null);
    }
  }

  async function removeDevice(device: RelayDeviceDto) {
    if (!window.confirm(`Delete relay device "${device.name}"?`)) {
      return;
    }
    setBusy(device.id);
    setError(null);
    try {
      await deleteRelayDevice(device.id);
      if (createdDevice?.device.id === device.id) {
        setCreatedDevice(null);
      }
      await load({ showLoading: false });
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to delete device.'));
    } finally {
      setBusy(null);
    }
  }

  function connectDevice(device: RelayDeviceDto) {
    setSelectedRelayDeviceId(device.id);
    setSelectedRelayThreadId(null);
    navigate(workspacesHref(device.id));
  }

  function openSharedSession(share: RelaySessionShareDto) {
    setSelectedRelayDeviceId(share.deviceId);
    setSelectedRelayThreadId(share.threadId);
    navigate(threadHref(share.threadId, share.deviceId));
  }

  async function updateSharedSession(share: RelaySessionShareDto, input: {
    label: string | null;
    threadAccess: RelayThreadAccessDto;
    workspaceAccess: RelayWorkspaceAccessDto;
  }) {
    setBusy(`share:${share.id}`);
    setError(null);
    try {
      await updateRelayShare(share.id, {
        ...input,
        workspaceId: share.workspaceId,
        expiresAt: share.expiresAt,
      });
      setEditingShare(null);
      await load({ showLoading: false });
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to update shared thread.'));
    } finally {
      setBusy(null);
    }
  }

  async function revokeSharedSession(share: RelaySessionShareDto) {
    if (!window.confirm(`Remove sharing access for "${shareTitleText(share)}"?`)) {
      return;
    }
    setBusy(`share:${share.id}`);
    setError(null);
    try {
      await revokeRelayShare(share.id);
      setExpandedShareId((current) => (current === share.id ? null : current));
      await load({ showLoading: false });
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to remove shared thread access.'));
    } finally {
      setBusy(null);
    }
  }

  async function copySupervisorSetup(device: RelayDeviceDto) {
    const token = device.token;
    if (!token) {
      setError('This device token is not available. Create a new device token for devices created before token storage was enabled.');
      return;
    }

    try {
      await navigator.clipboard?.writeText(relaySupervisorCommand(token));
      setCopiedDeviceId(device.id);
      window.setTimeout(() => {
        setCopiedDeviceId((current) => (current === device.id ? null : current));
      }, 1600);
    } catch {
      // Clipboard access can be unavailable in non-secure contexts.
    }
  }

  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-6 text-[var(--app-fg)] sm:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-5 pr-12 sm:pr-0">
        <header className="border-b border-[var(--theme-border)] pb-5">
          <div>
            <Link className="text-sm text-[var(--theme-accent-strong)]" to="/">
              Relay home
            </Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
              Relay portal
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
              Devices and shared sessions
            </h1>
          </div>
        </header>

        {error ? <Notice tone="danger">{error}</Notice> : null}
        {createdDevice ? <DeviceTokenPanel result={createdDevice} /> : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
          <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
            <div className="mb-4 flex items-start gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg)]">
                <Plus className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-fg)]">Add device</h2>
                <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                  Create a token for one private supervisor.
                </p>
              </div>
            </div>
            <form className="space-y-3" onSubmit={addDevice}>
              <label className="block text-sm text-[var(--theme-fg-soft)]">
                Device name
                <input
                  className="relay-input mt-2 w-full"
                  onChange={(event) => setDeviceName(event.target.value)}
                  placeholder="MacBook Pro"
                  value={deviceName}
                />
              </label>
              <button
                className="relay-button-primary inline-flex h-10 w-full items-center justify-center gap-2"
                disabled={busy === 'create' || !deviceName.trim()}
                type="submit"
              >
                <MonitorSmartphone className="h-4 w-4" />
                Create device token
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-fg)]">Devices</h2>
                <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                  Connect to an online device before opening workspaces.
                </p>
              </div>
              <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-xs text-[var(--theme-fg-muted)]">
                {portal?.devices.length ?? 0}
              </span>
            </div>
            {loading ? (
              <p className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 text-sm text-[var(--theme-fg-muted)]">
                Loading devices...
              </p>
            ) : portal?.devices.length ? (
              <div className="space-y-3">
                {portal.devices.map((device) => (
                  <DeviceRow
                    busy={busy === device.id}
                    copiedSetup={copiedDeviceId === device.id}
                    device={device}
                    key={device.id}
                    onConnect={() => connectDevice(device)}
                    onCopySetup={() => void copySupervisorSetup(device)}
                    onDelete={() => void removeDevice(device)}
                    setupTokenAvailable={Boolean(device.token)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--theme-border)] bg-[var(--theme-surface)] p-5 text-sm text-[var(--theme-fg-muted)]">
                No devices yet. Create a token, then start `remote-codex relay-supervisor` on your private machine.
              </div>
            )}
          </section>
        </section>

        <ShareSection
          count={portal?.sharedWithMe.length ?? 0}
          emptyText="No sessions have been shared with this account yet."
          loading={loading}
          loadingText="Loading shared sessions..."
          shares={portal?.sharedWithMe ?? []}
          title="Shared with me"
          subtitle="Sessions another relay user has shared with this account."
          renderShare={(share) => (
            <SharedSessionRow
              key={share.id}
              mode="incoming"
              share={share}
              onOpen={() => openSharedSession(share)}
            />
          )}
        />

        <ShareSection
          count={portal?.sharedByMe.length ?? 0}
          emptyText="No sessions have been shared by this account yet."
          loading={loading}
          loadingText="Loading shared sessions..."
          shares={portal?.sharedByMe ?? []}
          title="Shared by me"
          subtitle="Threads this relay account has shared with other users."
          renderShare={(share) => (
            <SharedSessionRow
              busy={busy === `share:${share.id}`}
              expanded={expandedShareId === share.id}
              key={share.id}
              mode="outgoing"
              share={share}
              onOpen={() => openSharedSession(share)}
              onEdit={() => setEditingShare(share)}
              onRevoke={() => void revokeSharedSession(share)}
              onToggleAccess={() => {
                setExpandedShareId((current) => (current === share.id ? null : share.id));
              }}
            />
          )}
        />
      </div>
      {editingShare ? (
        <SharePermissionsDialog
          busy={busy === `share:${editingShare.id}`}
          share={editingShare}
          onClose={() => setEditingShare(null)}
          onSave={(input) => void updateSharedSession(editingShare, input)}
        />
      ) : null}
    </main>
  );
}

function ShareSection({
  count,
  emptyText,
  loading,
  loadingText,
  renderShare,
  shares,
  subtitle,
  title,
}: {
  count: number;
  emptyText: string;
  loading: boolean;
  loadingText: string;
  renderShare: (share: RelaySessionShareDto) => React.ReactNode;
  shares: RelaySessionShareDto[];
  subtitle: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--theme-fg)]">{title}</h2>
          <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">{subtitle}</p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-xs text-[var(--theme-fg-muted)]">
          {count}
        </span>
      </div>
      {loading ? (
        <p className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 text-sm text-[var(--theme-fg-muted)]">
          {loadingText}
        </p>
      ) : shares.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {shares.map((share) => renderShare(share))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--theme-border)] bg-[var(--theme-surface)] p-5 text-sm text-[var(--theme-fg-muted)]">
          {emptyText}
        </div>
      )}
    </section>
  );
}

function SharedSessionRow({
  busy = false,
  expanded = false,
  mode,
  onEdit,
  onRevoke,
  onToggleAccess,
  share,
  onOpen,
}: {
  busy?: boolean;
  expanded?: boolean;
  mode: 'incoming' | 'outgoing';
  onEdit?: () => void;
  onRevoke?: () => void;
  onToggleAccess?: () => void;
  share: RelaySessionShareDto;
  onOpen?: () => void;
}) {
  const shareTitle = shareTitleText(share);
  const threadLabel = shareTitle;
  const workspaceLabel = share.workspaceLabel?.trim() || 'Workspace unavailable';
  const lastAccessLabel = share.lastAccessedAt
    ? `${share.lastAccessedByUsername ?? 'unknown'} at ${formatRelayTimestamp(share.lastAccessedAt)}`
    : 'Not accessed yet';

  return (
    <article className="relative rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
            {shareTitle}
          </p>
          <div className="mt-1 space-y-0.5 text-xs text-[var(--theme-fg-muted)]">
            <p className="truncate">
              Workspace: <span className="text-[var(--theme-fg-soft)]">{workspaceLabel}</span>
            </p>
            <p className="truncate">
              Thread: <span className="text-[var(--theme-fg-soft)]">{threadLabel}</span>
            </p>
            <p className="truncate">
              {mode === 'incoming' ? `From ${share.ownerUsername}` : `To ${share.targetUsername}`}
            </p>
            <p className="truncate">Device: {share.deviceName}</p>
          </div>
          {mode === 'outgoing' ? (
            <p className="mt-1 text-xs text-[var(--theme-fg-soft)]">
              Last access: {lastAccessLabel}
            </p>
          ) : null}
          <p className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--theme-fg-muted)]">
            <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5">
              {share.threadAccess === 'read' ? 'View only' : 'Collaborator'}
            </span>
            <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5">
              {workspaceAccessLabel(share.workspaceAccess)}
            </span>
          </p>
        </div>
        {mode === 'incoming' ? (
          <button
            className="relay-button-primary inline-flex items-center gap-2"
            onClick={onOpen}
            type="button"
          >
            Open
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              className="relay-button-primary inline-flex items-center gap-2"
              onClick={onOpen}
              type="button"
            >
              Open
            </button>
            <button
              className="relay-button-secondary inline-flex items-center gap-2"
              disabled={busy}
              onClick={onEdit}
              type="button"
            >
              Permissions
            </button>
            <button
              className="relay-button-secondary inline-flex items-center gap-2"
              onClick={onToggleAccess}
              type="button"
            >
              Access
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
            <button
              className="relay-button-secondary inline-flex items-center gap-2 text-[var(--status-danger-fg)]"
              disabled={busy}
              onClick={onRevoke}
              type="button"
            >
              Revoke
            </button>
          </div>
        )}
      </div>
      {mode === 'outgoing' && expanded ? (
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
  busy,
  onClose,
  onSave,
  share,
}: {
  busy: boolean;
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
        <div>
          <h2 className="text-base font-semibold text-[var(--theme-fg)]">Shared thread permissions</h2>
          <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
            {share.targetUsername} can access {shareTitleText(share)}.
          </p>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            Label
            <input
              className="relay-input mt-2 w-full"
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional shared thread label"
              value={label}
            />
          </label>
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
          {workspaceAccessLocked ? (
            <p className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-xs text-[var(--theme-fg-muted)]">
              This share was created without a workspace scope, so only thread access can be changed.
            </p>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="relay-button-secondary" disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="relay-button-primary" disabled={busy} type="submit">
            Save permissions
          </button>
        </div>
      </form>
    </div>
  );
}

function DeviceRow({
  device,
  busy,
  copiedSetup,
  onConnect,
  onCopySetup,
  onDelete,
  setupTokenAvailable,
}: {
  device: RelayDeviceDto;
  busy: boolean;
  copiedSetup: boolean;
  onConnect: () => void;
  onCopySetup: () => void;
  onDelete: () => void;
  setupTokenAvailable: boolean;
}) {
  return (
    <article className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                device.connected ? 'bg-[var(--status-success-fg)]' : 'bg-[var(--theme-fg-muted)]'
              }`}
            />
            <p className="truncate text-sm font-medium text-[var(--theme-fg)]">{device.name}</p>
          </div>
          <p className="mt-1 font-mono text-xs text-[var(--theme-fg-muted)]">
            {device.tokenPreview}
          </p>
          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
            {device.connected
              ? `Online since ${formatRelayTimestamp(device.connectedAt)}`
              : `Offline. Last heartbeat: ${formatRelayTimestamp(device.lastHeartbeatAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="relay-button-secondary inline-flex items-center gap-2"
            onClick={onCopySetup}
            title={
              setupTokenAvailable
                ? 'Copy relay supervisor setup command'
                : 'Device token is not available. Create a new device token for devices created before token storage was enabled.'
            }
            disabled={!setupTokenAvailable}
            type="button"
          >
            <Copy className="h-4 w-4" />
            {copiedSetup ? 'Copied' : 'Copy setup'}
          </button>
          <button
            className="relay-button-primary inline-flex items-center gap-2"
            disabled={!device.connected}
            onClick={onConnect}
            type="button"
          >
            <Plug className="h-4 w-4" />
            Connect
          </button>
          <button
            className="relay-button-secondary inline-flex items-center gap-2"
            disabled={busy}
            onClick={onDelete}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>
      {!setupTokenAvailable ? (
        <p className="mt-3 rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-xs text-[var(--theme-fg-muted)]">
          Token not available for this device. Create a new device token to copy a ready-to-run setup command.
        </p>
      ) : null}
    </article>
  );
}

function DeviceTokenPanel({ result }: { result: RelayCreateDeviceResultDto }) {
  const command = relaySupervisorCommand(result.token);
  return (
    <section className="rounded-lg border border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] p-4">
      <h2 className="text-base font-semibold text-[var(--theme-fg)]">
        Token created for {result.device.name}
      </h2>
      <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
        Store this token now. It will not be shown again.
      </p>
      <CodeBlock label="Device token" value={result.token} />
      <CodeBlock label="Supervisor command" value={command} />
    </section>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      // Clipboard access can be unavailable in non-secure contexts.
    }
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--theme-fg-muted)]">
          {label}
        </p>
        <button
          className="relay-button-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
          onClick={() => void copy()}
          type="button"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
      </div>
      <code className="block break-all rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 font-mono text-xs text-[var(--theme-fg)]">
        {value}
      </code>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: 'danger';
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger-fg)]">
      {children}
    </div>
  );
}

function relaySupervisorCommand(token: string) {
  const relayUrl = relayWebsocketBaseUrl();
  return [
    `REMOTE_CODEX_RELAY_SERVER_URL=${shellQuote(relayUrl)} \\`,
    `REMOTE_CODEX_RELAY_AGENT_TOKEN=${shellQuote(token)} \\`,
    'REMOTE_CODEX_RELAY_SUPERVISOR_PORT=45679 \\',
    'remote-codex relay-supervisor',
  ].join('\n');
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:@%+=,~-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
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
  return value ? new Date(value).toLocaleString() : 'never';
}

function shareTitleText(share: RelaySessionShareDto) {
  return share.threadTitle?.trim() || share.label?.trim() || 'Thread unavailable';
}

function workspaceAccessLabel(access: RelaySessionShareDto['workspaceAccess']) {
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
