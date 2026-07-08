import { ChevronDown, Copy, MonitorSmartphone, Plug, Plus, Share2, Trash2, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type {
  RelayCreateDeviceResultDto,
  RelayAccessGrantDto,
  RelayDeviceDto,
  RelayPortalSummaryDto,
  RelaySessionShareDto,
  RelayThreadAccessDto,
  RelayWorkspaceAccessDto,
} from '@remote-codex/shared';
import {
  ApiError,
  createRelayGrant,
  createRelayDevice,
  deleteRelayDevice,
  enableRelayMode,
  fetchRelayPortal,
  revokeRelayGrant,
  revokeRelayShare,
  setSelectedRelayDeviceId,
  setSelectedRelayThreadId,
  updateRelayGrant,
  updateRelayShare,
} from '../lib/api';
import { threadHref, workspacesHref } from '../lib/relayRoutes';
import { RelayUserMenu } from '../components/RelayUserMenu';

const RELAY_PORTAL_REFRESH_INTERVAL_MS = 3000;

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : fallback;
}

export function mergeRelayPortalSummary(
  previous: RelayPortalSummaryDto | null,
  next: RelayPortalSummaryDto,
): RelayPortalSummaryDto {
  if (!previous) {
    return sanitizeRelayPortalSummary(next);
  }

  return {
    ...next,
    sharedWithMe: mergeShareMetadata(previous.sharedWithMe, next.sharedWithMe),
    sharedByMe: mergeShareMetadata(previous.sharedByMe, next.sharedByMe),
    sharedDevicesWithMe: mergeGrantMetadata(previous.sharedDevicesWithMe ?? [], next.sharedDevicesWithMe ?? []),
    sharedThreadsWithMe: mergeGrantMetadata(previous.sharedThreadsWithMe ?? [], next.sharedThreadsWithMe ?? []),
    grantsByMe: mergeGrantMetadata(previous.grantsByMe ?? [], next.grantsByMe ?? []),
  };
}

function sanitizeRelayPortalSummary(summary: RelayPortalSummaryDto): RelayPortalSummaryDto {
  return {
    ...summary,
    sharedWithMe: summary.sharedWithMe.map(sanitizeShareMetadata),
    sharedByMe: summary.sharedByMe.map(sanitizeShareMetadata),
    sharedDevicesWithMe: (summary.sharedDevicesWithMe ?? []).map(sanitizeGrantMetadata),
    sharedThreadsWithMe: (summary.sharedThreadsWithMe ?? []).map(sanitizeGrantMetadata),
    grantsByMe: (summary.grantsByMe ?? []).map(sanitizeGrantMetadata),
  };
}

function mergeShareMetadata(
  previousShares: RelaySessionShareDto[],
  nextShares: RelaySessionShareDto[],
) {
  const previousById = new Map(previousShares.map((share) => [share.id, share]));
  return nextShares.map((share) => {
    const previous = previousById.get(share.id);
    if (!previous) {
      return sanitizeShareMetadata(share);
    }
    const nextThreadTitle = stableShareThreadTitle(share);
    const previousThreadTitle = stableShareThreadTitle(previous);
    return {
      ...share,
      threadTitle: nextThreadTitle ?? previousThreadTitle,
      workspaceLabel: share.workspaceLabel ?? previous.workspaceLabel,
    };
  });
}

function sanitizeShareMetadata(share: RelaySessionShareDto): RelaySessionShareDto {
  return {
    ...share,
    threadTitle: stableShareThreadTitle(share),
  };
}

function mergeGrantMetadata(
  previousGrants: RelayAccessGrantDto[],
  nextGrants: RelayAccessGrantDto[],
) {
  const previousById = new Map(previousGrants.map((grant) => [grant.id, grant]));
  return nextGrants.map((grant) => {
    const previous = previousById.get(grant.id);
    if (!previous) {
      return sanitizeGrantMetadata(grant);
    }
    const nextThreadTitle = stableGrantThreadTitle(grant);
    const previousThreadTitle = stableGrantThreadTitle(previous);
    return {
      ...grant,
      threadTitle: nextThreadTitle ?? previousThreadTitle,
      workspaceLabel: grant.workspaceLabel ?? previous.workspaceLabel,
      deviceName: grant.deviceName?.trim() || previous.deviceName,
    };
  });
}

function sanitizeGrantMetadata(grant: RelayAccessGrantDto): RelayAccessGrantDto {
  return {
    ...grant,
    threadTitle: stableGrantThreadTitle(grant),
  };
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
  const [expandedGrantId, setExpandedGrantId] = useState<string | null>(null);
  const [editingShare, setEditingShare] = useState<RelaySessionShareDto | null>(null);
  const [editingGrant, setEditingGrant] = useState<RelayAccessGrantDto | null>(null);
  const [sharingDevice, setSharingDevice] = useState<RelayDeviceDto | null>(null);
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
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
      setPortal((current) => mergeRelayPortalSummary(current, nextPortal));
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
      setAddDeviceOpen(false);
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

  function openSharedGrant(grant: RelayAccessGrantDto) {
    setSelectedRelayDeviceId(grant.deviceId);
    setSelectedRelayThreadId(grant.threadId);
    if (grant.threadId) {
      navigate(threadHref(grant.threadId, grant.deviceId));
      return;
    }
    navigate(workspacesHref(grant.deviceId));
  }

  async function createDeviceGrant(device: RelayDeviceDto, input: {
    targetIdentifier: string;
    label: string | null;
    threadAccess: RelayThreadAccessDto;
    workspaceAccess: RelayWorkspaceAccessDto;
    canCreateThreads: boolean;
  }) {
    setBusy(`grant:create:${device.id}`);
    setError(null);
    try {
      await createRelayGrant({
        ...input,
        deviceId: device.id,
        scope: 'device',
        workspaceScope: 'all',
        workspaceIds: [],
      });
      setSharingDevice(null);
      await load({ showLoading: false });
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to share device.'));
    } finally {
      setBusy(null);
    }
  }

  async function updateAccessGrant(grant: RelayAccessGrantDto, input: {
    label: string | null;
    threadAccess: RelayThreadAccessDto;
    workspaceAccess: RelayWorkspaceAccessDto;
    canCreateThreads: boolean;
    expiresAt: string | null;
  }) {
    setBusy(`grant:${grant.id}`);
    setError(null);
    try {
      await updateRelayGrant(grant.id, {
        ...input,
        workspaceId: grant.workspaceId,
        workspaceScope: grant.workspaceScope,
        workspaceIds: grant.workspaceIds,
      });
      setEditingGrant(null);
      await load({ showLoading: false });
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to update shared access.'));
    } finally {
      setBusy(null);
    }
  }

  async function revokeAccessGrant(grant: RelayAccessGrantDto) {
    if (!window.confirm(`Remove sharing access for "${grantTitleText(grant)}"?`)) {
      return;
    }
    setBusy(`grant:${grant.id}`);
    setError(null);
    try {
      await revokeRelayGrant(grant.id);
      setExpandedGrantId((current) => (current === grant.id ? null : current));
      await load({ showLoading: false });
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to remove shared access.'));
    } finally {
      setBusy(null);
    }
  }

  async function updateSharedSession(share: RelaySessionShareDto, input: {
    label: string | null;
    threadAccess: RelayThreadAccessDto;
    workspaceAccess: RelayWorkspaceAccessDto;
    expiresAt: string | null;
  }) {
    setBusy(`share:${share.id}`);
    setError(null);
    try {
      await updateRelayShare(share.id, {
        ...input,
        workspaceId: share.workspaceId,
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

  const sharedDevicesWithMe = portal?.sharedDevicesWithMe ?? [];
  const outgoingGrants = portal?.grantsByMe ?? [];
  const useGrantBackedOutgoing = outgoingGrants.length > 0 || (portal?.sharedByMe.length ?? 0) === 0;

  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 pb-6 text-[var(--app-fg)] sm:px-6">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="host-topbar sticky top-[env(safe-area-inset-top)] z-30 -mx-4 border-b px-2.5 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-4">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <RelayUserMenu />
            <Link
              className="host-info-pill inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-[11px] font-medium uppercase tracking-[0.14em] transition sm:px-3 sm:text-xs sm:tracking-[0.18em]"
              to="/"
            >
              Relay home
            </Link>
            <div className="min-w-0 flex-1 text-right">
              <p className="host-page-eyebrow truncate text-[11px] uppercase tracking-[0.24em]">
                Relay portal
              </p>
            </div>
          </div>
        </header>

        <section className="border-b border-[var(--theme-border)] pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
            Relay portal
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--theme-fg)]">
            Devices and shared sessions
          </h1>
        </section>

        {error ? <Notice tone="danger">{error}</Notice> : null}
        {createdDevice ? <DeviceTokenPanel result={createdDevice} /> : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(42rem,0.9fr)_minmax(0,1.1fr)]">
          <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--theme-fg)]">Devices</h2>
                <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                  Connect to an online device before opening workspaces.
                </p>
              </div>
              <button
                className="relay-button-secondary inline-flex h-9 shrink-0 items-center gap-2 px-3"
                onClick={() => setAddDeviceOpen(true)}
                type="button"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
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
                    onShare={() => setSharingDevice(device)}
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

          <div className="space-y-4">
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

            <GrantSection
              count={sharedDevicesWithMe.length}
              emptyText="No devices have been shared with this account yet."
              grants={sharedDevicesWithMe}
              loading={loading}
              loadingText="Loading shared devices..."
              title="Shared devices"
              subtitle="Devices another relay user has shared with this account."
              renderGrant={(grant) => (
                <GrantRow
                  key={grant.id}
                  grant={grant}
                  mode="incoming"
                  onOpen={() => openSharedGrant(grant)}
                />
              )}
            />

            {useGrantBackedOutgoing ? (
              <GrantSection
                count={outgoingGrants.length}
                emptyText="No access has been shared by this account yet."
                grants={outgoingGrants}
                loading={loading}
                loadingText="Loading shared access..."
                title="Shared by me"
                subtitle="Threads and devices this relay account has shared with other users."
                renderGrant={(grant) => (
                  <GrantRow
                    busy={busy === `grant:${grant.id}`}
                    expanded={expandedGrantId === grant.id}
                    key={grant.id}
                    grant={grant}
                    mode="outgoing"
                    onOpen={() => openSharedGrant(grant)}
                    onEdit={() => setEditingGrant(grant)}
                    onRevoke={() => void revokeAccessGrant(grant)}
                    onToggleAccess={() => {
                      setExpandedGrantId((current) => (current === grant.id ? null : grant.id));
                    }}
                  />
                )}
              />
            ) : (
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
            )}
          </div>
        </section>
      </div>
      {addDeviceOpen ? (
        <AddDeviceDialog
          busy={busy === 'create'}
          deviceName={deviceName}
          onChangeDeviceName={setDeviceName}
          onClose={() => setAddDeviceOpen(false)}
          onSubmit={addDevice}
        />
      ) : null}
      {editingShare ? (
        <SharePermissionsDialog
          busy={busy === `share:${editingShare.id}`}
          share={editingShare}
          onClose={() => setEditingShare(null)}
          onSave={(input) => void updateSharedSession(editingShare, input)}
        />
      ) : null}
      {editingGrant ? (
        <GrantPermissionsDialog
          busy={busy === `grant:${editingGrant.id}`}
          grant={editingGrant}
          onClose={() => setEditingGrant(null)}
          onSave={(input) => void updateAccessGrant(editingGrant, input)}
        />
      ) : null}
      {sharingDevice ? (
        <ShareDeviceDialog
          busy={busy === `grant:create:${sharingDevice.id}`}
          device={sharingDevice}
          onClose={() => setSharingDevice(null)}
          onShare={(input) => void createDeviceGrant(sharingDevice, input)}
        />
      ) : null}
    </main>
  );
}

function AddDeviceDialog({
  busy,
  deviceName,
  onChangeDeviceName,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  deviceName: string;
  onChangeDeviceName: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--app-bg)_82%,transparent)] px-4 py-6">
      <form
        className="w-full max-w-md rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-2xl"
        onSubmit={onSubmit}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
              Relay device
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--theme-fg)]">Add device</h2>
            <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
              Create a token for one private supervisor.
            </p>
          </div>
          <button
            aria-label="Close add device dialog"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg-muted)] transition hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="mt-5 block text-sm text-[var(--theme-fg-soft)]">
          Device name
          <input
            autoFocus
            className="relay-input mt-2 w-full"
            onChange={(event) => onChangeDeviceName(event.target.value)}
            placeholder="MacBook Pro"
            value={deviceName}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button className="relay-button-secondary" disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="relay-button-primary inline-flex items-center gap-2"
            disabled={busy || !deviceName.trim()}
            type="submit"
          >
            <MonitorSmartphone className="h-4 w-4" />
            Create device token
          </button>
        </div>
      </form>
    </div>
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
        <div className="grid gap-3">
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

function GrantSection({
  count,
  emptyText,
  grants,
  loading,
  loadingText,
  renderGrant,
  subtitle,
  title,
}: {
  count: number;
  emptyText: string;
  grants: RelayAccessGrantDto[];
  loading: boolean;
  loadingText: string;
  renderGrant: (grant: RelayAccessGrantDto) => React.ReactNode;
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
      ) : grants.length ? (
        <div className="grid gap-3">
          {grants.map((grant) => renderGrant(grant))}
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
  const shareLabel = share.label?.trim() || null;
  const workspaceLabel = share.workspaceLabel?.trim() || 'Workspace unavailable';
  const lastAccessLabel = share.lastAccessedAt
    ? `${share.lastAccessedByUsername ?? 'unknown'} at ${formatRelayTimestamp(share.lastAccessedAt)}`
    : 'Not accessed yet';

  return (
    <article className="relative rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
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
            {shareLabel ? (
              <p className="truncate">
                Label: <span className="text-[var(--theme-fg-soft)]">{shareLabel}</span>
              </p>
            ) : null}
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

function GrantRow({
  busy = false,
  expanded = false,
  grant,
  mode,
  onEdit,
  onOpen,
  onRevoke,
  onToggleAccess,
}: {
  busy?: boolean;
  expanded?: boolean;
  grant: RelayAccessGrantDto;
  mode: 'incoming' | 'outgoing';
  onEdit?: () => void;
  onOpen?: () => void;
  onRevoke?: () => void;
  onToggleAccess?: () => void;
}) {
  const title = grantTitleText(grant);
  const scopeLabel = grantScopeLabel(grant);
  const workspaceLabel = grant.workspaceLabel?.trim() || (grant.scope === 'device' ? 'All workspaces' : 'Workspace unavailable');
  const threadLabel = grant.scope === 'thread'
    ? (stableGrantThreadTitle(grant) ?? 'Thread unavailable')
    : grant.scope === 'workspace'
      ? 'Workspace access'
      : 'Whole device';
  const label = grant.label?.trim() || null;
  const lastAccessLabel = grant.lastAccessedAt
    ? `${grant.lastAccessedByUsername ?? 'unknown'} at ${formatRelayTimestamp(grant.lastAccessedAt)}`
    : 'Not accessed yet';

  return (
    <article className="relative rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-[var(--theme-fg)]">{title}</p>
            <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-[var(--theme-fg-muted)]">
              {scopeLabel}
            </span>
          </div>
          <div className="mt-1 space-y-0.5 text-xs text-[var(--theme-fg-muted)]">
            <p className="truncate">
              Workspace: <span className="text-[var(--theme-fg-soft)]">{workspaceLabel}</span>
            </p>
            <p className="truncate">
              {grant.scope === 'thread' ? 'Thread' : 'Access'}: <span className="text-[var(--theme-fg-soft)]">{threadLabel}</span>
            </p>
            {label ? (
              <p className="truncate">
                Label: <span className="text-[var(--theme-fg-soft)]">{label}</span>
              </p>
            ) : null}
            <p className="truncate">
              {mode === 'incoming' ? `From ${grant.ownerUsername}` : `To ${grant.targetUsername}`}
            </p>
            <p className="truncate">Device: {grant.deviceName}</p>
          </div>
          {mode === 'outgoing' ? (
            <p className="mt-1 text-xs text-[var(--theme-fg-soft)]">
              Last access: {lastAccessLabel}
            </p>
          ) : null}
          <p className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--theme-fg-muted)]">
            <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5">
              {grant.threadAccess === 'read' ? 'View only' : 'Collaborator'}
            </span>
            <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5">
              {workspaceAccessLabel(grant.workspaceAccess)}
            </span>
            {grant.canCreateThreads ? (
              <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5">
                Can create threads
              </span>
            ) : null}
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
          {grant.accessEvents.length ? (
            <ul className="space-y-2 text-xs text-[var(--theme-fg-muted)]">
              {grant.accessEvents.map((event) => (
                <li className="flex items-center justify-between gap-3" key={event.id}>
                  <span className="font-medium text-[var(--theme-fg)]">{event.username}</span>
                  <span>{formatRelayTimestamp(event.accessedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--theme-fg-muted)]">
              This shared access has not been used yet.
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
    expiresAt: string | null;
  }) => void;
  share: RelaySessionShareDto;
}) {
  const [label, setLabel] = useState(share.label ?? '');
  const [threadAccess, setThreadAccess] = useState<RelayThreadAccessDto>(share.threadAccess);
  const [workspaceAccess, setWorkspaceAccess] = useState<RelayWorkspaceAccessDto>(share.workspaceAccess);
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocalValue(share.expiresAt));
  const workspaceAccessLocked = !share.workspaceId;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      label: label.trim() || null,
      threadAccess,
      workspaceAccess: workspaceAccessLocked ? 'none' : workspaceAccess,
      expiresAt: fromDatetimeLocalValue(expiresAt),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--app-bg)_82%,transparent)] px-4 py-6">
      <form
        className="max-h-[min(42rem,calc(100vh-3rem))] w-full max-w-lg overflow-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-2xl"
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
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            Expiration
            <input
              aria-label="Expiration"
              className="relay-input mt-2 w-full"
              onChange={(event) => setExpiresAt(event.target.value)}
              type="datetime-local"
              value={expiresAt}
            />
            <span className="mt-1 block text-xs text-[var(--theme-fg-muted)]">
              Leave empty for no expiration.
            </span>
          </label>
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

function ShareDeviceDialog({
  busy,
  device,
  onClose,
  onShare,
}: {
  busy: boolean;
  device: RelayDeviceDto;
  onClose: () => void;
  onShare: (input: {
    targetIdentifier: string;
    label: string | null;
    threadAccess: RelayThreadAccessDto;
    workspaceAccess: RelayWorkspaceAccessDto;
    canCreateThreads: boolean;
  }) => void;
}) {
  const [targetIdentifier, setTargetIdentifier] = useState('');
  const [label, setLabel] = useState('');
  const [threadAccess, setThreadAccess] = useState<RelayThreadAccessDto>('read');
  const [workspaceAccess, setWorkspaceAccess] = useState<RelayWorkspaceAccessDto>('read');
  const [canCreateThreads, setCanCreateThreads] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onShare({
      targetIdentifier: targetIdentifier.trim(),
      label: label.trim() || null,
      threadAccess,
      workspaceAccess,
      canCreateThreads,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--app-bg)_82%,transparent)] px-4 py-6">
      <form
        className="max-h-[min(42rem,calc(100vh-3rem))] w-full max-w-lg overflow-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-2xl"
        onSubmit={submit}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
              Relay device
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--theme-fg)]">Share {device.name}</h2>
            <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
              Give another relay account access to this device and its workspaces.
            </p>
          </div>
          <button
            aria-label="Close share device dialog"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg-muted)] transition hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            Relay account
            <input
              autoFocus
              className="relay-input mt-2 w-full"
              onChange={(event) => setTargetIdentifier(event.target.value)}
              placeholder="username or email"
              value={targetIdentifier}
            />
          </label>
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            Label
            <input
              className="relay-input mt-2 w-full"
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional note shown in Shared by me"
              value={label}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
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
                onChange={(event) => setWorkspaceAccess(event.target.value as RelayWorkspaceAccessDto)}
                value={workspaceAccess}
              >
                <option value="none">No workspace</option>
                <option value="read">Workspace read</option>
                <option value="write">Workspace write</option>
              </select>
            </label>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-sm text-[var(--theme-fg-soft)]">
            Can create new threads
            <input
              checked={canCreateThreads}
              className="h-4 w-4 accent-[var(--theme-accent)]"
              onChange={(event) => setCanCreateThreads(event.target.checked)}
              type="checkbox"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="relay-button-secondary" disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="relay-button-primary inline-flex items-center gap-2"
            disabled={busy || !targetIdentifier.trim()}
            type="submit"
          >
            <Share2 className="h-4 w-4" />
            Share device
          </button>
        </div>
      </form>
    </div>
  );
}

function GrantPermissionsDialog({
  busy,
  grant,
  onClose,
  onSave,
}: {
  busy: boolean;
  grant: RelayAccessGrantDto;
  onClose: () => void;
  onSave: (input: {
    label: string | null;
    threadAccess: RelayThreadAccessDto;
    workspaceAccess: RelayWorkspaceAccessDto;
    canCreateThreads: boolean;
    expiresAt: string | null;
  }) => void;
}) {
  const [label, setLabel] = useState(grant.label ?? '');
  const [threadAccess, setThreadAccess] = useState<RelayThreadAccessDto>(grant.threadAccess);
  const [workspaceAccess, setWorkspaceAccess] = useState<RelayWorkspaceAccessDto>(grant.workspaceAccess);
  const [canCreateThreads, setCanCreateThreads] = useState(grant.canCreateThreads);
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocalValue(grant.expiresAt));
  const canCreateThreadsAvailable = grant.scope !== 'thread';
  const workspaceAccessLocked = grant.scope === 'thread' && !grant.workspaceId;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      label: label.trim() || null,
      threadAccess,
      workspaceAccess: workspaceAccessLocked ? 'none' : workspaceAccess,
      canCreateThreads: canCreateThreadsAvailable ? canCreateThreads : false,
      expiresAt: fromDatetimeLocalValue(expiresAt),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--app-bg)_82%,transparent)] px-4 py-6">
      <form
        className="max-h-[min(42rem,calc(100vh-3rem))] w-full max-w-lg overflow-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-2xl"
        onSubmit={submit}
      >
        <div>
          <h2 className="text-base font-semibold text-[var(--theme-fg)]">Shared access permissions</h2>
          <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
            {grant.targetUsername} can access {grantTitleText(grant)}.
          </p>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            Label
            <input
              className="relay-input mt-2 w-full"
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional shared access label"
              value={label}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
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
          {canCreateThreadsAvailable ? (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-sm text-[var(--theme-fg-soft)]">
              Can create new threads
              <input
                checked={canCreateThreads}
                className="h-4 w-4 accent-[var(--theme-accent)]"
                onChange={(event) => setCanCreateThreads(event.target.checked)}
                type="checkbox"
              />
            </label>
          ) : null}
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            Expiration
            <input
              aria-label="Expiration"
              className="relay-input mt-2 w-full"
              onChange={(event) => setExpiresAt(event.target.value)}
              type="datetime-local"
              value={expiresAt}
            />
            <span className="mt-1 block text-xs text-[var(--theme-fg-muted)]">
              Leave empty for no expiration.
            </span>
          </label>
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
  onShare,
  setupTokenAvailable,
}: {
  device: RelayDeviceDto;
  busy: boolean;
  copiedSetup: boolean;
  onConnect: () => void;
  onCopySetup: () => void;
  onDelete: () => void;
  onShare: () => void;
  setupTokenAvailable: boolean;
}) {
  return (
    <article className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap">
          <button
            className="relay-button-secondary inline-flex h-10 items-center gap-2 whitespace-nowrap"
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
            className="relay-button-primary inline-flex h-10 items-center gap-2 whitespace-nowrap"
            disabled={!device.connected}
            onClick={onConnect}
            type="button"
          >
            <Plug className="h-4 w-4" />
            Connect
          </button>
          <button
            className="relay-button-secondary inline-flex h-10 items-center gap-2 whitespace-nowrap"
            onClick={onShare}
            type="button"
          >
            <Share2 className="h-4 w-4" />
            Share
          </button>
          <button
            aria-label={`Delete ${device.name}`}
            className="relay-button-secondary inline-flex h-10 w-10 items-center justify-center px-0"
            disabled={busy}
            onClick={onDelete}
            title={`Delete ${device.name}`}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
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

function toDatetimeLocalValue(value: string | null | undefined) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

function fromDatetimeLocalValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function shareTitleText(share: RelaySessionShareDto) {
  return stableShareThreadTitle(share) ?? 'Thread unavailable';
}

function stableShareThreadTitle(share: RelaySessionShareDto) {
  const threadTitle = share.threadTitle?.trim();
  if (!threadTitle) {
    return null;
  }
  const label = share.label?.trim();
  return label && threadTitle === label ? null : threadTitle;
}

function grantTitleText(grant: RelayAccessGrantDto) {
  if (grant.scope === 'device') {
    return grant.deviceName?.trim() || 'Shared device';
  }
  if (grant.scope === 'workspace') {
    return grant.workspaceLabel?.trim() || grant.deviceName?.trim() || 'Shared workspace';
  }
  return stableGrantThreadTitle(grant) ?? 'Thread unavailable';
}

function stableGrantThreadTitle(grant: RelayAccessGrantDto) {
  if (grant.scope !== 'thread') {
    return grant.threadTitle?.trim() || null;
  }
  const threadTitle = grant.threadTitle?.trim();
  if (!threadTitle) {
    return null;
  }
  const label = grant.label?.trim();
  return label && threadTitle === label ? null : threadTitle;
}

function grantScopeLabel(grant: RelayAccessGrantDto) {
  switch (grant.scope) {
    case 'device':
      return 'Device';
    case 'workspace':
      return 'Workspace';
    case 'thread':
    default:
      return 'Thread';
  }
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
