import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock3, Database, RefreshCw, Settings, Share2, Users } from 'lucide-react';

import type {
  RelayAdminDeviceDto,
  RelayAdminSummaryDto,
  RelayRegistrationSettingsDto,
  RelaySessionShareDto,
  RelayUserDto,
} from '@remote-codex/shared';
import { RelayUserMenu } from '../components/RelayUserMenu';
import { LoginPage } from './LoginPage';
import {
  ApiError,
  approveRelayRegistration,
  enableRelayMode,
  fetchRelayAdmin,
  rejectRelayRegistration,
  relayAdminLogin,
  setRelayUserEnabled,
  updateRelayRegistrationSettings,
} from '../lib/api';

type AdminTab = 'overview' | 'users' | 'devices' | 'shares' | 'settings';

function errorMessage(caught: unknown) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : 'Unable to update relay admin state.';
}

export function RelayAdminPage() {
  const [summary, setSummary] = useState<RelayAdminSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [days, setDays] = useState(7);
  const [settingsDraft, setSettingsDraft] = useState<RelayRegistrationSettingsDto | null>(null);

  async function load(nextDays = days, options: { showLoading?: boolean } = {}) {
    if (options.showLoading !== false) {
      setLoading(true);
    }
    setError(null);
    try {
      enableRelayMode();
      const result = await fetchRelayAdmin(nextDays);
      setSummary(result);
      setSettingsDraft(result.settings);
      setDays(result.conversationWindowDays);
      setLoginRequired(false);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.statusCode === 401 || caught.statusCode === 403)
      ) {
        setSummary(null);
        setLoginRequired(true);
        setError(null);
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const totals = useMemo(() => {
    const users = summary?.users ?? [];
    const devices = summary?.devices ?? [];
    return {
      users: users.length,
      enabledUsers: users.filter((user) => user.enabled).length,
      devices: devices.length,
      onlineDevices: devices.filter((device) => device.connected).length,
      conversations: users.reduce((sum, user) => sum + user.conversationCount, 0),
      shares: summary?.shares.filter((share) => !share.revokedAt).length ?? 0,
    };
  }, [summary]);

  async function updateUser(userId: string, enabled: boolean) {
    setBusyKey(userId);
    setError(null);
    try {
      const updated = await setRelayUserEnabled(userId, enabled);
      setSummary((current) => replaceAdminUser(current, updated));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyKey(null);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settingsDraft) {
      return;
    }
    setBusyKey('settings');
    setError(null);
    try {
      const result = await updateRelayRegistrationSettings(settingsDraft);
      setSummary((current) =>
        current
          ? {
              ...current,
              registrationEnabled: result.registrationEnabled,
              settings: result.settings,
            }
          : current,
      );
      setSettingsDraft(result.settings);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyKey(null);
    }
  }

  async function reviewRegistration(requestId: string, action: 'approve' | 'reject') {
    setBusyKey(`${action}:${requestId}`);
    setError(null);
    try {
      if (action === 'approve') {
        await approveRelayRegistration(requestId);
      } else {
        await rejectRelayRegistration(requestId);
      }
      await load(days, { showLoading: false });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAdminLogin(input: { username: string; password: string }) {
    await relayAdminLogin(input);
    await load(days);
  }

  if (loginRequired) {
    return (
      <LoginPage
        description="Use the relay admin credentials for this server. This does not replace your normal relay account."
        eyebrow="Relay Admin"
        onLogin={handleAdminLogin}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-6 text-[var(--app-fg)] sm:px-6">
      <RelayUserMenu />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-[var(--theme-border)] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
              Relay Admin
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
              Operations panel
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--theme-fg-muted)]">
              Accounts, devices, usage, registration policy, and shared thread access.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--theme-fg-muted)]">
              Usage window
              <select
                className="relay-input h-10 w-24"
                onChange={(event) => void load(Number(event.target.value))}
                value={days}
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
            <Link className="relay-button-secondary" to="/relay-portal">
              Portal
            </Link>
            <button className="relay-button-secondary inline-flex items-center gap-2" onClick={() => void load(days)} type="button">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </header>

        {error ? (
          <section className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger-fg)]">
            {error}
          </section>
        ) : null}

        {loading ? (
          <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 text-sm text-[var(--theme-fg-muted)]">
            Loading relay admin...
          </section>
        ) : summary ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={<Users className="h-5 w-5" />} label="Users" value={totals.users} detail={`${totals.enabledUsers} enabled`} />
              <MetricCard icon={<Database className="h-5 w-5" />} label="Devices" value={totals.devices} detail={`${totals.onlineDevices} online`} />
              <MetricCard icon={<Clock3 className="h-5 w-5" />} label={`Conversations, ${summary.conversationWindowDays}d`} value={totals.conversations} detail="Relay prompt/start events" />
              <MetricCard icon={<Share2 className="h-5 w-5" />} label="Active shares" value={totals.shares} detail={`${summary.pendingRegistrations.length} pending registrations`} />
            </section>

            <nav className="flex gap-2 overflow-x-auto border-b border-[var(--theme-border)] pb-2">
              {(['overview', 'users', 'devices', 'shares', 'settings'] as AdminTab[]).map((item) => (
                <button
                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                    tab === item
                      ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-fg)]'
                      : 'text-[var(--theme-fg-muted)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]'
                  }`}
                  key={item}
                  onClick={() => setTab(item)}
                  type="button"
                >
                  {tabLabel(item)}
                </button>
              ))}
            </nav>

            {tab === 'overview' ? <Overview summary={summary} /> : null}
            {tab === 'users' ? (
              <UsersTable busyKey={busyKey} onUpdateUser={updateUser} users={summary.users} />
            ) : null}
            {tab === 'devices' ? <DevicesPanel devices={summary.devices} /> : null}
            {tab === 'shares' ? <SharesTable shares={summary.shares} /> : null}
            {tab === 'settings' && settingsDraft ? (
              <SettingsPanel
                busy={busyKey === 'settings'}
                draft={settingsDraft}
                onChange={setSettingsDraft}
                onReviewRegistration={reviewRegistration}
                onSave={saveSettings}
                pending={summary.pendingRegistrations}
                reviewBusyKey={busyKey}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2 text-[var(--theme-accent-strong)]">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--theme-fg-muted)]">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold text-[var(--theme-fg)]">{value.toLocaleString()}</p>
          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">{detail}</p>
        </div>
      </div>
    </article>
  );
}

function Overview({ summary }: { summary: RelayAdminSummaryDto }) {
  const recentUsers = [...summary.users].sort(compareNullableDate('lastSeenAt')).slice(0, 6);
  const activeDevices = summary.devices.filter((device) => device.connected);
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
      <Panel title="Recent users" detail="Last authenticated relay activity.">
        <div className="divide-y divide-[var(--theme-border)]">
          {recentUsers.map((user) => (
            <div className="flex items-center justify-between gap-3 py-3" key={user.id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--theme-fg)]">{user.username}</p>
                <p className="truncate text-xs text-[var(--theme-fg-muted)]">{user.email}</p>
              </div>
              <div className="text-right text-xs text-[var(--theme-fg-muted)]">
                <p>{formatTimestamp(user.lastSeenAt)}</p>
                <p>{user.conversationCount} conversations</p>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Online devices" detail="Devices with an active supervisor tunnel.">
        {activeDevices.length ? (
          <div className="space-y-3">
            {activeDevices.map((device) => (
              <DeviceSummary device={device} key={device.id} />
            ))}
          </div>
        ) : (
          <EmptyState>No supervisors are connected.</EmptyState>
        )}
      </Panel>
    </section>
  );
}

function UsersTable({
  busyKey,
  onUpdateUser,
  users,
}: {
  busyKey: string | null;
  onUpdateUser: (userId: string, enabled: boolean) => void;
  users: RelayAdminSummaryDto['users'];
}) {
  return (
    <Panel title="Users" detail="Registered relay accounts and usage in the selected window.">
      <ResponsiveTable minWidth="58rem">
        <thead>
          <tr>
            <Th>User</Th>
            <Th>Status</Th>
            <Th>Last used</Th>
            <Th>Conversations</Th>
            <Th>Devices</Th>
            <Th>Role</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <Td strong>{user.username}<div className="text-xs font-normal text-[var(--theme-fg-muted)]">{user.email}</div></Td>
              <Td>{user.enabled ? 'Enabled' : 'Disabled'}</Td>
              <Td>{formatTimestamp(user.lastSeenAt)}</Td>
              <Td>{user.conversationCount.toLocaleString()}</Td>
              <Td>{user.deviceCount}</Td>
              <Td>{user.role}</Td>
              <Td>
                <button
                  className="relay-button-secondary"
                  disabled={busyKey === user.id || user.role === 'admin'}
                  onClick={() => onUpdateUser(user.id, !user.enabled)}
                  type="button"
                >
                  {user.enabled ? 'Disable' : 'Enable'}
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </ResponsiveTable>
    </Panel>
  );
}

function DevicesPanel({ devices }: { devices: RelayAdminDeviceDto[] }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      {devices.map((device) => (
        <Panel
          detail={`${device.ownerUsername} · ${device.ipAddress ?? 'IP unavailable'}`}
          key={device.id}
          title={device.name}
          aside={<StatusPill active={device.connected}>{device.connected ? 'Online' : 'Offline'}</StatusPill>}
        >
          <DeviceSummary device={device} />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ResourceList
              empty="No workspace list available."
              items={device.workspaces.map((workspace) => ({
                id: workspace.id,
                primary: workspace.label,
                secondary: workspace.absPath ?? workspace.id,
              }))}
              title="Workspaces"
            />
            <ResourceList
              empty="No thread list available."
              items={device.threads.map((thread) => ({
                id: thread.id,
                primary: thread.title,
                secondary: `${thread.workspaceLabel ?? 'Workspace unavailable'} · ${thread.status ?? 'unknown'}`,
              }))}
              title="Threads"
            />
          </div>
        </Panel>
      ))}
    </section>
  );
}

function SharesTable({ shares }: { shares: RelaySessionShareDto[] }) {
  return (
    <Panel title="Share relationships" detail="Thread grants between relay users. Revoked grants remain visible for audit.">
      <ResponsiveTable minWidth="62rem">
        <thead>
          <tr>
            <Th>Owner</Th>
            <Th>Target</Th>
            <Th>Thread</Th>
            <Th>Device</Th>
            <Th>Permissions</Th>
            <Th>Last access</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {shares.map((share) => (
            <tr key={share.id}>
              <Td strong>{share.ownerUsername}</Td>
              <Td>{share.targetUsername}</Td>
              <Td>
                <span className="font-medium text-[var(--theme-fg)]">{share.threadTitle ?? share.label ?? 'Thread unavailable'}</span>
                <div className="text-xs text-[var(--theme-fg-muted)]">{share.workspaceLabel ?? 'Workspace unavailable'}</div>
              </Td>
              <Td>{share.deviceName}</Td>
              <Td>{share.threadAccess} / {workspaceAccessLabel(share.workspaceAccess)}</Td>
              <Td>{formatTimestamp(share.lastAccessedAt)}</Td>
              <Td>{share.revokedAt ? 'Revoked' : share.expiresAt && share.expiresAt <= new Date().toISOString() ? 'Expired' : 'Active'}</Td>
            </tr>
          ))}
        </tbody>
      </ResponsiveTable>
    </Panel>
  );
}

function SettingsPanel({
  busy,
  draft,
  onChange,
  onReviewRegistration,
  onSave,
  pending,
  reviewBusyKey,
}: {
  busy: boolean;
  draft: RelayRegistrationSettingsDto;
  onChange: (settings: RelayRegistrationSettingsDto) => void;
  onReviewRegistration: (requestId: string, action: 'approve' | 'reject') => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  pending: RelayAdminSummaryDto['pendingRegistrations'];
  reviewBusyKey: string | null;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Panel title="Registration settings" detail="Stored in the relay database. Environment password seeds this once if empty.">
        <form className="space-y-4" onSubmit={onSave}>
          <Checkbox
            checked={draft.enabled}
            label="Open registration"
            onChange={(enabled) => onChange({ ...draft, enabled })}
          />
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            Registration password
            <input
              className="relay-input mt-2 w-full"
              onChange={(event) => onChange({ ...draft, registrationPassword: event.target.value })}
              placeholder="Leave empty for no invite password"
              value={draft.registrationPassword ?? ''}
            />
          </label>
          <Checkbox
            checked={draft.approvalRequired}
            label="Require admin approval"
            onChange={(approvalRequired) => onChange({ ...draft, approvalRequired })}
          />
          <button className="relay-button-primary inline-flex items-center gap-2" disabled={busy} type="submit">
            <Settings className="h-4 w-4" />
            Save settings
          </button>
        </form>
      </Panel>

      <Panel title="Pending registrations" detail="Approve creates the user. Reject keeps an audit trail.">
        {pending.length ? (
          <div className="divide-y divide-[var(--theme-border)]">
            {pending.map((request) => (
              <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between" key={request.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--theme-fg)]">{request.username}</p>
                  <p className="truncate text-xs text-[var(--theme-fg-muted)]">{request.email} · {formatTimestamp(request.createdAt)}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="relay-button-primary inline-flex items-center gap-2"
                    disabled={reviewBusyKey === `approve:${request.id}`}
                    onClick={() => onReviewRegistration(request.id, 'approve')}
                    type="button"
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    className="relay-button-secondary"
                    disabled={reviewBusyKey === `reject:${request.id}`}
                    onClick={() => onReviewRegistration(request.id, 'reject')}
                    type="button"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No pending applications.</EmptyState>
        )}
      </Panel>
    </section>
  );
}

function DeviceSummary({ device }: { device: RelayAdminDeviceDto }) {
  return (
    <div className="grid gap-2 text-xs text-[var(--theme-fg-muted)] sm:grid-cols-2">
      <p>Owner: <span className="text-[var(--theme-fg-soft)]">{device.ownerEmail}</span></p>
      <p>IP: <span className="text-[var(--theme-fg-soft)]">{device.ipAddress ?? 'unavailable'}</span></p>
      <p>Connected: <span className="text-[var(--theme-fg-soft)]">{formatTimestamp(device.connectedAt)}</span></p>
      <p>Heartbeat: <span className="text-[var(--theme-fg-soft)]">{formatTimestamp(device.lastHeartbeatAt)}</span></p>
    </div>
  );
}

function ResourceList({
  empty,
  items,
  title,
}: {
  empty: string;
  items: Array<{ id: string; primary: string; secondary: string }>;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
      <h3 className="text-sm font-semibold text-[var(--theme-fg)]">{title}</h3>
      {items.length ? (
        <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
          {items.map((item) => (
            <li className="min-w-0" key={item.id}>
              <p className="truncate text-sm text-[var(--theme-fg)]">{item.primary}</p>
              <p className="truncate text-xs text-[var(--theme-fg-muted)]">{item.secondary}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[var(--theme-fg-muted)]">{empty}</p>
      )}
    </div>
  );
}

function Panel({
  aside,
  children,
  detail,
  title,
}: {
  aside?: React.ReactNode;
  children: React.ReactNode;
  detail: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--theme-fg)]">{title}</h2>
          <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">{detail}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ResponsiveTable({ children, minWidth }: { children: React.ReactNode; minWidth: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-[var(--theme-border)] py-2 pr-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-fg-muted)]">
      {children}
    </th>
  );
}

function Td({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <td className={`border-b border-[var(--theme-border)] py-3 pr-3 ${strong ? 'font-medium text-[var(--theme-fg)]' : 'text-[var(--theme-fg-muted)]'}`}>
      {children}
    </td>
  );
}

function Checkbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-[var(--theme-fg-soft)]">
      <input
        checked={checked}
        className="h-4 w-4 accent-[var(--theme-accent)]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function StatusPill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${
      active
        ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
        : 'border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg-muted)]'
    }`}>
      {children}
    </span>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 text-sm text-[var(--theme-fg-muted)]">
      {children}
    </p>
  );
}

function replaceAdminUser(summary: RelayAdminSummaryDto | null, updated: RelayUserDto) {
  if (!summary) {
    return summary;
  }
  return {
    ...summary,
    users: summary.users.map((user) =>
      user.id === updated.id
        ? {
            ...user,
            ...updated,
          }
        : user,
    ),
  };
}

function tabLabel(tab: AdminTab) {
  switch (tab) {
    case 'overview':
      return 'Overview';
    case 'users':
      return 'Users';
    case 'devices':
      return 'Devices';
    case 'shares':
      return 'Shares';
    case 'settings':
      return 'Settings';
  }
}

function workspaceAccessLabel(access: RelaySessionShareDto['workspaceAccess']) {
  switch (access) {
    case 'write':
      return 'workspace write';
    case 'read':
      return 'workspace read';
    case 'none':
    default:
      return 'no workspace';
  }
}

function compareNullableDate(field: 'lastSeenAt') {
  return (left: { [key in typeof field]: string | null }, right: { [key in typeof field]: string | null }) =>
    Date.parse(right[field] ?? '') - Date.parse(left[field] ?? '');
}

function formatTimestamp(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : 'never';
}
