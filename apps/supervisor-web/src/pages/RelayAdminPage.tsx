import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Clock3,
  Database,
  KeyRound,
  LogOut,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Play,
  Square,
  Plus,
  Camera,
  ShieldCheck,
  Settings,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';

import type {
  RelayAdminDeviceDto,
  RelayAdminSummaryDto,
  RelayHostedSandboxCapabilityDto,
  RelayHostedSandboxDto,
  RelayHostedSandboxReconciliationDto,
  RelayRegistrationSettingsDto,
  RelaySessionDto,
  RelaySessionShareDto,
  RelayUserDto,
} from '@remote-codex/shared';
import { LoginPage } from './LoginPage';
import {
  ApiError,
  approveRelayRegistration,
  createHostedSandbox,
  deleteHostedSandbox,
  deleteHostedOrphanCredential,
  deleteHostedOrphanInstance,
  deleteRelayAdminUser,
  enableRelayMode,
  fetchRelayAdmin,
  fetchRelayAdminSession,
  fetchHostedSandboxCapability,
  fetchHostedCodexFiles,
  fetchHostedSandboxes,
  fetchHostedSandboxReconciliation,
  rejectRelayRegistration,
  relayAdminLogout,
  relayAdminLogin,
  resetRelayAdminUserPassword,
  runHostedSandboxAction,
  runHostedSandboxReconciliation,
  setRelayUserEnabled,
  snapshotHostedSandbox,
  updateHostedSandboxMembers,
  updateHostedCodexFiles,
  updateRelayRegistrationSettings,
} from '../lib/api';

type AdminTab =
  | 'overview'
  | 'users'
  | 'devices'
  | 'hosted'
  | 'shares'
  | 'settings';
type SortDirection = 'asc' | 'desc';
type UserSortKey =
  | 'username'
  | 'enabled'
  | 'lastSeenAt'
  | 'conversationCount'
  | 'deviceCount'
  | 'createdAt';
type DeviceSortKey =
  | 'name'
  | 'ownerUsername'
  | 'connected'
  | 'lastActivity'
  | 'createdAt'
  | 'workspaceCount'
  | 'threadCount';

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
  const [settingsDraft, setSettingsDraft] =
    useState<RelayRegistrationSettingsDto | null>(null);
  const [hostedCapability, setHostedCapability] =
    useState<RelayHostedSandboxCapabilityDto | null>(null);
  const [hostedSandboxes, setHostedSandboxes] = useState<
    RelayHostedSandboxDto[]
  >([]);
  const [hostedReconciliation, setHostedReconciliation] =
    useState<RelayHostedSandboxReconciliationDto | null>(null);
  const [hostedLoading, setHostedLoading] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [hostedBusyKey, setHostedBusyKey] = useState<string | null>(null);

  async function load(
    nextDays = days,
    options: { showLoading?: boolean } = {},
  ) {
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

  async function loadHosted() {
    setHostedLoading(true);
    setHostedError(null);
    const [capability, sandboxes, reconciliation] = await Promise.allSettled([
      fetchHostedSandboxCapability(),
      fetchHostedSandboxes(),
      fetchHostedSandboxReconciliation(),
    ]);
    if (capability.status === 'fulfilled') {
      setHostedCapability(capability.value);
    } else {
      setHostedCapability(null);
      setHostedError(errorMessage(capability.reason));
    }
    if (sandboxes.status === 'fulfilled') {
      setHostedSandboxes(sandboxes.value.sandboxes);
    } else {
      setHostedError((current) => current ?? errorMessage(sandboxes.reason));
    }
    if (reconciliation.status === 'fulfilled') {
      setHostedReconciliation(reconciliation.value);
    } else {
      setHostedReconciliation(null);
      setHostedError(
        (current) => current ?? errorMessage(reconciliation.reason),
      );
    }
    setHostedLoading(false);
  }

  useEffect(() => {
    if (tab === 'hosted') {
      void loadHosted();
    }
  }, [tab]);

  async function hostedAction(
    busyKeyValue: string,
    action: () => Promise<unknown>,
  ) {
    setHostedBusyKey(busyKeyValue);
    setHostedError(null);
    try {
      await action();
      await loadHosted();
      window.setTimeout(() => void loadHosted(), 750);
    } catch (caught) {
      setHostedError(errorMessage(caught));
    } finally {
      setHostedBusyKey(null);
    }
  }

  const totals = useMemo(() => {
    const users = summary?.users ?? [];
    const devices = summary?.devices ?? [];
    return {
      users: users.length,
      enabledUsers: users.filter((user) => user.enabled).length,
      devices: devices.length,
      onlineDevices: devices.filter((device) => device.connected).length,
      conversations: users.reduce(
        (sum, user) => sum + user.conversationCount,
        0,
      ),
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

  async function deleteUser(userId: string) {
    setBusyKey(`delete:${userId}`);
    setError(null);
    try {
      await deleteRelayAdminUser(userId);
      await load(days, { showLoading: false });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyKey(null);
    }
  }

  async function resetUserPassword(userId: string, password: string) {
    setBusyKey(`reset:${userId}`);
    setError(null);
    try {
      const updated = await resetRelayAdminUserPassword(userId, password);
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

  async function reviewRegistration(
    requestId: string,
    action: 'approve' | 'reject',
  ) {
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

  async function handleAdminLogin(input: {
    username: string;
    password: string;
  }) {
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
      <RelayAdminUserMenu
        onLogout={() => {
          setSummary(null);
          setLoginRequired(true);
        }}
      />
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
              Accounts, devices, usage, registration policy, and shared thread
              access.
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
            <Link className="relay-button-secondary" to="/">
              Relay home
            </Link>
            <button
              className="relay-button-secondary inline-flex items-center gap-2"
              onClick={() => void load(days)}
              type="button"
            >
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
              <MetricCard
                icon={<Users className="h-5 w-5" />}
                label="Users"
                value={totals.users}
                detail={`${totals.enabledUsers} enabled`}
              />
              <MetricCard
                icon={<Database className="h-5 w-5" />}
                label="Devices"
                value={totals.devices}
                detail={`${totals.onlineDevices} online`}
              />
              <MetricCard
                icon={<Clock3 className="h-5 w-5" />}
                label={`Conversations, ${summary.conversationWindowDays}d`}
                value={totals.conversations}
                detail="Relay prompt/start events"
              />
              <MetricCard
                icon={<Share2 className="h-5 w-5" />}
                label="Active shares"
                value={totals.shares}
                detail={`${summary.pendingRegistrations.length} pending registrations`}
              />
            </section>

            <nav className="flex gap-2 overflow-x-auto border-b border-[var(--theme-border)] pb-2">
              {(
                [
                  'overview',
                  'users',
                  'devices',
                  'hosted',
                  'shares',
                  'settings',
                ] as AdminTab[]
              ).map((item) => (
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
              <UsersTable
                busyKey={busyKey}
                onDeleteUser={deleteUser}
                onResetPassword={resetUserPassword}
                onUpdateUser={updateUser}
                users={summary.users}
              />
            ) : null}
            {tab === 'devices' ? (
              <DevicesPanel devices={summary.devices} users={summary.users} />
            ) : null}
            {tab === 'hosted' ? (
              <HostedSandboxesPanel
                busyKey={hostedBusyKey}
                capability={hostedCapability}
                error={hostedError}
                loading={hostedLoading}
                onAction={hostedAction}
                onRefresh={loadHosted}
                sandboxes={hostedSandboxes}
                reconciliation={hostedReconciliation}
                users={summary.users}
              />
            ) : null}
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

function HostedSandboxesPanel({
  busyKey,
  capability,
  error,
  loading,
  onAction,
  onRefresh,
  reconciliation,
  sandboxes,
  users,
}: {
  busyKey: string | null;
  capability: RelayHostedSandboxCapabilityDto | null;
  error: string | null;
  loading: boolean;
  onAction: (key: string, action: () => Promise<unknown>) => Promise<void>;
  onRefresh: () => Promise<void>;
  reconciliation: RelayHostedSandboxReconciliationDto | null;
  sandboxes: RelayHostedSandboxDto[];
  users: RelayAdminSummaryDto['users'];
}) {
  const eligibleUsers = users.filter(
    (user) => user.role === 'user' && user.enabled,
  );
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [deviceName, setDeviceName] = useState('Hosted Codex');
  const [resourcePreset, setResourcePreset] = useState<'standard' | 'large'>(
    'standard',
  );
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [modelProvider, setModelProvider] = useState('OpenAI');
  const [model, setModel] = useState('gpt-5.6-sol');
  const [reviewModel, setReviewModel] = useState('gpt-5.6-sol');
  const [baseUrl, setBaseUrl] = useState('https://sub.lnz-study.com');
  const [reasoningEffort, setReasoningEffort] = useState<
    'low' | 'medium' | 'high' | 'xhigh'
  >('low');
  const canCreate =
    capability?.available === true && assignedUserIds.length > 0;

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) return;
    const resources =
      resourcePreset === 'large'
        ? { cpuCount: 2, memoryMiB: 2048, diskGiB: 12 }
        : { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 };
    await onAction('hosted:create', () =>
      createHostedSandbox({
        assignedUserIds,
        deviceName,
        imageVersion: 'ubuntu-24.04-v4',
        resources,
        openaiApiKey,
        codexConfig: {
          modelProvider,
          model,
          reviewModel,
          reasoningEffort,
          baseUrl,
          wireApi: 'responses',
          requiresOpenaiAuth: true,
          disableResponseStorage: true,
          networkAccess: 'enabled',
          goals: true,
        },
      }),
    );
    setOpenaiApiKey('');
  }

  const capabilityTone = capability?.available
    ? 'success'
    : capability?.configured
      ? 'warning'
      : 'neutral';

  return (
    <section className="space-y-4" aria-label="Hosted supervisor VMs">
      <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)]">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-lg bg-[var(--theme-surface)] p-2 text-[var(--theme-fg-soft)]">
              <Server className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-[var(--theme-fg)]">
                  Hosted supervisor VMs
                </h2>
                <HostedStatusPill tone={capabilityTone}>
                  {capability?.available
                    ? 'Available'
                    : capability?.configured
                      ? 'Unavailable'
                      : 'Disabled'}
                </HostedStatusPill>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-[var(--theme-fg-muted)]">
                {capability?.reason ??
                  'Incus VMs run one isolated relay supervisor per assigned user.'}
              </p>
              {capability?.capacity && capability.limits ? (
                <p className="mt-1 text-xs text-[var(--theme-fg-soft)]">
                  {capability.capacity.runningInstances}/
                  {capability.limits.maxRunningInstances} running ·{' '}
                  {capability.capacity.totalInstances}/
                  {capability.limits.maxInstances} total
                </p>
              ) : null}
              {capability?.metrics ? (
                <p className="mt-1 text-xs text-[var(--theme-fg-soft)]">
                  {capability.metrics.cpuCount} CPU · load{' '}
                  {capability.metrics.load1.toFixed(2)} ·{' '}
                  {Math.round(capability.metrics.memoryAvailableMiB / 1024)} GiB
                  RAM free · {capability.metrics.diskAvailableGiB.toFixed(1)}{' '}
                  GiB disk free
                </p>
              ) : null}
              {capability?.alerts?.map((alert) => (
                <p
                  className="mt-1 text-xs text-amber-700 dark:text-amber-300"
                  key={alert.code}
                  role="alert"
                >
                  {alert.message}
                </p>
              ))}
            </div>
          </div>
          <button
            className="relay-button-secondary inline-flex min-h-11 items-center justify-center gap-2"
            disabled={loading}
            onClick={() => void onRefresh()}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Check host
          </button>
        </div>

        {error ? (
          <div
            className="border-t border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-fg)]"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <HostedReconciliationPanel
          busyKey={busyKey}
          onAction={onAction}
          reconciliation={reconciliation}
        />

        <details
          className="border-t border-[var(--theme-border)]"
          open={sandboxes.length === 0}
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--theme-fg)] hover:bg-[var(--theme-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent-ring)]">
            <Plus className="h-4 w-4" />
            Create hosted VM
          </summary>
          <form
            className="grid gap-4 border-t border-[var(--theme-border)] p-4 lg:grid-cols-2"
            onSubmit={submitCreate}
          >
            <fieldset className="text-sm text-[var(--theme-fg-soft)]">
              <legend>Assigned users</legend>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)]">
                {eligibleUsers.length ? (
                  eligibleUsers.map((user) => (
                    <label
                      className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-[var(--theme-border)] px-3 last:border-b-0 hover:bg-[var(--theme-hover)]"
                      key={user.id}
                    >
                      <input
                        aria-label={`Assign ${user.username} (${user.email})`}
                        checked={assignedUserIds.includes(user.id)}
                        disabled={!capability?.available}
                        onChange={(event) =>
                          setAssignedUserIds((current) =>
                            event.target.checked
                              ? [...current, user.id]
                              : current.filter((id) => id !== user.id),
                          )
                        }
                        type="checkbox"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-[var(--theme-fg)]">
                          {user.username}
                        </span>
                        <span className="block truncate text-xs text-[var(--theme-fg-muted)]">
                          {user.email}
                        </span>
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="px-3 py-3 text-xs text-[var(--theme-fg-muted)]">
                    Create and enable a user account before assigning a VM.
                  </p>
                )}
              </div>
              <span className="mt-1 block text-xs text-[var(--theme-fg-muted)]">
                {assignedUserIds.length} selected · all receive full VM access
              </span>
            </fieldset>
            <label className="text-sm text-[var(--theme-fg-soft)]">
              Device name
              <input
                className="relay-input mt-2 w-full"
                maxLength={120}
                onChange={(event) => setDeviceName(event.target.value)}
                required
                value={deviceName}
              />
            </label>
            <label className="text-sm text-[var(--theme-fg-soft)]">
              Resources
              <select
                className="relay-input mt-2 w-full"
                onChange={(event) =>
                  setResourcePreset(event.target.value as 'standard' | 'large')
                }
                value={resourcePreset}
              >
                <option value="standard">
                  Standard, 1 CPU · 1.5 GiB · 10 GiB
                </option>
                <option value="large">Large, 2 CPU · 2 GiB · 12 GiB</option>
              </select>
            </label>
            <label className="text-sm text-[var(--theme-fg-soft)]">
              OpenAI Platform API key
              <input
                autoComplete="off"
                className="relay-input mt-2 w-full font-mono"
                minLength={20}
                onChange={(event) => setOpenaiApiKey(event.target.value)}
                placeholder="Stored encrypted on the Incus host"
                required
                type="password"
                value={openaiApiKey}
              />
            </label>
            <details className="rounded-md border border-[var(--theme-border)] lg:col-span-2">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-[var(--theme-fg)]">
                Codex provider configuration
              </summary>
              <div className="grid gap-4 border-t border-[var(--theme-border)] p-3 md:grid-cols-2">
                <label className="text-sm text-[var(--theme-fg-soft)]">
                  Provider name
                  <input
                    className="relay-input mt-2 w-full"
                    onChange={(event) => setModelProvider(event.target.value)}
                    pattern="[A-Za-z][A-Za-z0-9_-]{0,31}"
                    required
                    value={modelProvider}
                  />
                </label>
                <label className="text-sm text-[var(--theme-fg-soft)]">
                  Responses API base URL
                  <input
                    className="relay-input mt-2 w-full"
                    onChange={(event) => setBaseUrl(event.target.value)}
                    required
                    type="url"
                    value={baseUrl}
                  />
                </label>
                <label className="text-sm text-[var(--theme-fg-soft)]">
                  Model
                  <input
                    className="relay-input mt-2 w-full"
                    onChange={(event) => setModel(event.target.value)}
                    required
                    value={model}
                  />
                </label>
                <label className="text-sm text-[var(--theme-fg-soft)]">
                  Review model
                  <input
                    className="relay-input mt-2 w-full"
                    onChange={(event) => setReviewModel(event.target.value)}
                    required
                    value={reviewModel}
                  />
                </label>
                <label className="text-sm text-[var(--theme-fg-soft)]">
                  Reasoning effort
                  <select
                    className="relay-input mt-2 w-full"
                    onChange={(event) =>
                      setReasoningEffort(
                        event.target.value as
                          | 'low'
                          | 'medium'
                          | 'high'
                          | 'xhigh',
                      )
                    }
                    value={reasoningEffort}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="xhigh">Extra high</option>
                  </select>
                </label>
              </div>
            </details>
            <div className="flex flex-col gap-2 lg:col-span-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-[var(--theme-fg-muted)]">
                <ShieldCheck className="h-4 w-4" />
                The relay stores only an opaque credential reference.
              </p>
              <button
                className="relay-button-primary inline-flex min-h-11 items-center justify-center gap-2"
                disabled={
                  !canCreate || !openaiApiKey || busyKey === 'hosted:create'
                }
                type="submit"
              >
                <Plus className="h-4 w-4" />
                {busyKey === 'hosted:create' ? 'Creating…' : 'Create hosted VM'}
              </button>
            </div>
          </form>
        </details>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--theme-border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--theme-fg)]">
              Managed VMs
            </h3>
            <p className="text-xs text-[var(--theme-fg-muted)]">
              Turn-aware idle stop is 10 minutes after the last terminal
              activity.
            </p>
          </div>
          <span className="text-sm tabular-nums text-[var(--theme-fg-muted)]">
            {sandboxes.length}
          </span>
        </div>
        {loading && sandboxes.length === 0 ? (
          <div className="space-y-3 p-4" aria-label="Loading hosted VMs">
            <div className="h-14 animate-pulse rounded-md bg-[var(--theme-muted)]" />
            <div className="h-14 animate-pulse rounded-md bg-[var(--theme-muted)]" />
          </div>
        ) : sandboxes.length ? (
          <div className="divide-y divide-[var(--theme-border)]">
            {sandboxes.map((sandbox) => (
              <HostedSandboxRow
                busyKey={busyKey}
                key={sandbox.id}
                onAction={onAction}
                sandbox={sandbox}
                users={eligibleUsers}
              />
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-[var(--theme-fg-muted)]">
            No hosted VMs yet. Open “Create hosted VM” to assign the first one.
          </div>
        )}
      </div>
    </section>
  );
}

function HostedReconciliationPanel({
  busyKey,
  onAction,
  reconciliation,
}: {
  busyKey: string | null;
  onAction: (key: string, action: () => Promise<unknown>) => Promise<void>;
  reconciliation: RelayHostedSandboxReconciliationDto | null;
}) {
  const issueCount = reconciliation
    ? reconciliation.missingInstanceSandboxIds.length +
      reconciliation.missingCredentialSandboxIds.length +
      reconciliation.orphanInstances.length +
      reconciliation.orphanCredentials.length
    : 0;
  const tone =
    reconciliation?.status === 'healthy'
      ? 'success'
      : reconciliation?.status === 'issues' ||
          reconciliation?.status === 'unavailable'
        ? 'warning'
        : 'neutral';
  const label =
    reconciliation?.status === 'healthy'
      ? 'Inventory healthy'
      : reconciliation?.status === 'issues'
        ? `${issueCount} inventory issue${issueCount === 1 ? '' : 's'}`
        : reconciliation?.status === 'unavailable'
          ? 'Inventory unavailable'
          : 'Inventory not checked';

  return (
    <div className="border-t border-[var(--theme-border)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--theme-fg)]">
              Relay ↔ Incus inventory
            </span>
            <HostedStatusPill tone={tone}>{label}</HostedStatusPill>
          </div>
          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
            Audit only; resources are deleted only after an explicit admin
            action and a fresh orphan check.
          </p>
        </div>
        <button
          className="relay-button-secondary inline-flex min-h-10 items-center justify-center gap-2"
          disabled={busyKey === 'hosted:reconcile'}
          onClick={() =>
            void onAction('hosted:reconcile', runHostedSandboxReconciliation)
          }
          type="button"
        >
          <RefreshCw
            className={`h-4 w-4 ${busyKey === 'hosted:reconcile' ? 'animate-spin' : ''}`}
          />
          Run inventory audit
        </button>
      </div>

      {reconciliation?.missingInstanceSandboxIds.map((id) => (
        <p
          className="mt-2 text-xs text-amber-700 dark:text-amber-300"
          key={`missing-instance-${id}`}
        >
          Missing Incus instance for relay sandbox {id}
        </p>
      ))}
      {reconciliation?.missingCredentialSandboxIds.map((id) => (
        <p
          className="mt-2 text-xs text-amber-700 dark:text-amber-300"
          key={`missing-credential-${id}`}
        >
          Missing credential for relay sandbox {id}
        </p>
      ))}
      {reconciliation?.orphanInstances.map((instance) => (
        <div
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--theme-surface)] px-3 py-2"
          key={instance.id}
        >
          <span className="text-xs text-[var(--theme-fg-soft)]">
            Orphan VM {instance.id} · {instance.status} ·{' '}
            {instance.snapshots.length} snapshots
          </span>
          <button
            className="relay-button-danger min-h-9"
            disabled={busyKey === `hosted:orphan-instance:${instance.id}`}
            onClick={() =>
              void onAction(`hosted:orphan-instance:${instance.id}`, () =>
                deleteHostedOrphanInstance(instance.id),
              )
            }
            type="button"
          >
            Delete orphan VM
          </button>
        </div>
      ))}
      {reconciliation?.orphanCredentials.map((credential) => (
        <div
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--theme-surface)] px-3 py-2"
          key={credential.credentialRef}
        >
          <span className="text-xs text-[var(--theme-fg-soft)]">
            Orphan credential {credential.credentialRef}
          </span>
          <button
            className="relay-button-danger min-h-9"
            disabled={
              busyKey === `hosted:orphan-credential:${credential.credentialRef}`
            }
            onClick={() =>
              void onAction(
                `hosted:orphan-credential:${credential.credentialRef}`,
                () => deleteHostedOrphanCredential(credential.credentialRef),
              )
            }
            type="button"
          >
            Delete orphan credential
          </button>
        </div>
      ))}
    </div>
  );
}

function HostedSandboxRow({
  busyKey,
  onAction,
  sandbox,
  users,
}: {
  busyKey: string | null;
  onAction: (key: string, action: () => Promise<unknown>) => Promise<void>;
  sandbox: RelayHostedSandboxDto;
  users: RelayAdminSummaryDto['users'];
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const busy = busyKey?.endsWith(sandbox.id) ?? false;
  const tone = hostedStatusTone(sandbox.status);
  const memberIds = sandbox.assignedUsers.map((user) => user.userId);
  const normalizedInviteQuery = inviteQuery.trim().toLowerCase();
  const inviteCandidates = users
    .filter((user) => !memberIds.includes(user.id))
    .filter((user) => {
      if (!normalizedInviteQuery) return false;
      return [user.id, user.username, user.email].some((value) =>
        value.toLowerCase().includes(normalizedInviteQuery),
      );
    })
    .slice(0, 6);
  return (
    <article className="px-4 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-[var(--theme-fg)]">
              {sandbox.deviceName}
            </h4>
            <HostedStatusPill tone={tone}>
              {hostedStatusLabel(sandbox.status)}
            </HostedStatusPill>
            {sandbox.activeTurnCount > 0 ? (
              <HostedStatusPill tone="warning">
                {sandbox.activeTurnCount} active turn
                {sandbox.activeTurnCount === 1 ? '' : 's'}
              </HostedStatusPill>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[var(--theme-fg-soft)]">
            {sandbox.assignedUsers.map((user) => user.username).join(', ')}
            <span className="mx-2 text-[var(--theme-fg-muted)]">·</span>
            {sandbox.resources.cpuCount} CPU ·{' '}
            {formatMemory(sandbox.resources.memoryMiB)} ·{' '}
            {sandbox.resources.diskGiB} GiB
          </p>
          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
            Updated {formatTimestamp(sandbox.updatedAt)}
            {sandbox.idleDeadlineAt
              ? ` · idle stop ${formatTimestamp(sandbox.idleDeadlineAt)}`
              : ''}
          </p>
          {sandbox.lastErrorMessage ? (
            <p
              className="mt-2 text-sm text-[var(--status-danger-fg)]"
              role="status"
            >
              {sandbox.lastErrorMessage}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {sandbox.status === 'stopped' || sandbox.status === 'error' ? (
            <button
              className="relay-button-secondary inline-flex min-h-11 items-center gap-2"
              disabled={busy}
              onClick={() =>
                void onAction(`start:${sandbox.id}`, () =>
                  runHostedSandboxAction(
                    sandbox.id,
                    sandbox.status === 'error' ? 'retry' : 'start',
                  ),
                )
              }
              type="button"
            >
              {sandbox.status === 'error' ? (
                <RotateCcw className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {sandbox.status === 'error' ? 'Retry' : 'Start'}
            </button>
          ) : (
            <button
              className="relay-button-secondary inline-flex min-h-11 items-center gap-2"
              disabled={
                busy ||
                sandbox.activeTurnCount > 0 ||
                sandbox.status !== 'online'
              }
              onClick={() =>
                void onAction(`stop:${sandbox.id}`, () =>
                  runHostedSandboxAction(sandbox.id, 'stop'),
                )
              }
              title={
                sandbox.activeTurnCount > 0
                  ? 'An active turn prevents stopping.'
                  : undefined
              }
              type="button"
            >
              <Square className="h-4 w-4" />
              Stop
            </button>
          )}
          <button
            className="relay-button-secondary inline-flex min-h-11 items-center gap-2"
            disabled={
              busy || sandbox.status !== 'online' || sandbox.activeTurnCount > 0
            }
            onClick={() =>
              void onAction(`snapshot:${sandbox.id}`, () =>
                snapshotHostedSandbox(sandbox.id, `manual-${Date.now()}`),
              )
            }
            type="button"
          >
            <Camera className="h-4 w-4" />
            Snapshot
          </button>
          {confirmDelete ? (
            <span className="inline-flex items-center gap-2 rounded-md bg-[var(--status-danger-bg)] p-1">
              <button
                className="min-h-9 rounded-md px-3 text-sm font-medium text-[var(--status-danger-fg)] hover:bg-[var(--theme-hover)]"
                disabled={busy}
                onClick={() =>
                  void onAction(`delete:${sandbox.id}`, () =>
                    deleteHostedSandbox(sandbox.id),
                  )
                }
                type="button"
              >
                Confirm delete
              </button>
              <button
                className="min-h-9 rounded-md px-2 text-sm text-[var(--theme-fg-muted)] hover:bg-[var(--theme-hover)]"
                onClick={() => setConfirmDelete(false)}
                type="button"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              className="relay-button-secondary min-h-11 text-[var(--status-danger-fg)]"
              disabled={busy || sandbox.activeTurnCount > 0}
              onClick={() => setConfirmDelete(true)}
              type="button"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)]">
          Access · {sandbox.assignedUsers.length} user
          {sandbox.assignedUsers.length === 1 ? '' : 's'}
        </summary>
        <div className="mt-3 max-w-2xl overflow-hidden rounded-md border border-[var(--theme-border)]">
          <div className="flex min-h-11 items-center justify-between gap-3 bg-[var(--theme-surface)] px-3">
            <div>
              <p className="text-xs font-semibold text-[var(--theme-fg)]">
                Authorized users
              </p>
              <p className="text-[11px] text-[var(--theme-fg-muted)]">
                Full workspace, thread, and VM control
              </p>
            </div>
            <button
              aria-expanded={inviteOpen}
              aria-label="Add authorized user"
              className="relay-button-secondary inline-flex h-9 w-9 items-center justify-center p-0"
              disabled={busy}
              onClick={() => {
                setInviteOpen((current) => !current);
                setInviteQuery('');
              }}
              type="button"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {inviteOpen ? (
            <div className="border-t border-[var(--theme-border)] p-3">
              <label
                className="text-xs font-medium text-[var(--theme-fg-soft)]"
                htmlFor={`invite-user-${sandbox.id}`}
              >
                Find an account
              </label>
              <input
                autoFocus
                className="relay-input mt-2 min-h-11 w-full"
                id={`invite-user-${sandbox.id}`}
                onChange={(event) => setInviteQuery(event.target.value)}
                placeholder="Account ID, username, or email"
                value={inviteQuery}
              />
              {normalizedInviteQuery ? (
                <div className="mt-2 overflow-hidden rounded-md border border-[var(--theme-border)]">
                  {inviteCandidates.length ? (
                    inviteCandidates.map((user) => (
                      <button
                        className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-[var(--theme-border)] px-3 text-left last:border-b-0 hover:bg-[var(--theme-hover)]"
                        disabled={busy}
                        key={user.id}
                        onClick={() =>
                          void onAction(`members:${sandbox.id}`, async () => {
                            await updateHostedSandboxMembers(sandbox.id, [
                              ...memberIds,
                              user.id,
                            ]);
                            setInviteOpen(false);
                            setInviteQuery('');
                          })
                        }
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[var(--theme-fg)]">
                            {user.username}
                          </span>
                          <span className="block truncate text-xs text-[var(--theme-fg-muted)]">
                            {user.email} · {user.id}
                          </span>
                        </span>
                        <span className="text-xs font-medium text-[var(--theme-accent-strong)]">
                          Add
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-3 text-xs text-[var(--theme-fg-muted)]">
                      No unassigned account matches that search.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <ul className="divide-y divide-[var(--theme-border)] border-t border-[var(--theme-border)]">
            {sandbox.assignedUsers.map((user) => (
              <li
                className="flex min-h-12 items-center justify-between gap-3 px-3"
                key={user.userId}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--theme-fg)]">
                    {user.username}
                  </span>
                  <span className="block truncate text-xs text-[var(--theme-fg-muted)]">
                    {user.email}
                  </span>
                </span>
                <button
                  aria-label={`Remove ${user.username} access`}
                  className="min-h-9 rounded-md px-3 text-xs font-medium text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)]"
                  disabled={busy || memberIds.length === 1}
                  onClick={() =>
                    void onAction(`members:${sandbox.id}`, () =>
                      updateHostedSandboxMembers(
                        sandbox.id,
                        memberIds.filter((id) => id !== user.userId),
                      ),
                    )
                  }
                  title={
                    memberIds.length === 1
                      ? 'A hosted VM must keep at least one authorized user.'
                      : undefined
                  }
                  type="button"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details>
      <HostedBackendFilesEditor
        busy={busy}
        onAction={onAction}
        sandbox={sandbox}
      />
    </article>
  );
}

function HostedBackendFilesEditor({
  busy,
  onAction,
  sandbox,
}: {
  busy: boolean;
  onAction: (key: string, action: () => Promise<unknown>) => Promise<void>;
  sandbox: RelayHostedSandboxDto;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configToml, setConfigToml] = useState('');
  const [authJson, setAuthJson] = useState('');

  async function loadFiles() {
    setLoading(true);
    setError(null);
    try {
      const files = await fetchHostedCodexFiles(sandbox.id);
      setConfigToml(files.configToml);
      setAuthJson(files.authJson);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <details
      className="mt-3"
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (
          nextOpen &&
          !configToml &&
          !loading &&
          sandbox.status === 'online'
        ) {
          void loadFiles();
        }
      }}
    >
      <summary className="cursor-pointer text-xs font-medium text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)]">
        Backend credentials
      </summary>
      {open ? (
        <div className="mt-3 max-w-3xl overflow-hidden rounded-md border border-[var(--theme-border)]">
          <div className="grid gap-3 bg-[var(--theme-surface)] p-3 sm:grid-cols-[12rem_1fr] sm:items-end">
            <label className="text-xs font-medium text-[var(--theme-fg-soft)]">
              Backend
              <select
                className="relay-input mt-2 min-h-11 w-full"
                onChange={() => undefined}
                value="codex"
              >
                <option value="codex">Codex</option>
                <option disabled>Claude Code (coming soon)</option>
                <option disabled>OpenCode (coming soon)</option>
              </select>
            </label>
            <p className="text-xs leading-5 text-[var(--theme-fg-muted)]">
              Files are read from and written directly to this VM. The VM must
              be online.
            </p>
          </div>
          {sandbox.status !== 'online' ? (
            <p className="border-t border-[var(--theme-border)] px-3 py-3 text-sm text-[var(--status-warning-fg)]">
              Start the VM before editing backend files.
            </p>
          ) : loading ? (
            <p className="border-t border-[var(--theme-border)] px-3 py-4 text-sm text-[var(--theme-fg-muted)]">
              Loading Codex files from the VM…
            </p>
          ) : (
            <div className="space-y-4 border-t border-[var(--theme-border)] p-3">
              {error ? (
                <p className="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger-fg)]">
                  {error}
                </p>
              ) : null}
              <BackendFileField
                filename="~/.codex/config.toml"
                language="TOML"
                onChange={setConfigToml}
                value={configToml}
              />
              <BackendFileField
                filename="~/.codex/auth.json"
                language="JSON"
                onChange={setAuthJson}
                value={authJson}
              />
              <div className="flex justify-end gap-2">
                <button
                  className="relay-button-secondary min-h-11"
                  disabled={busy || loading}
                  onClick={() => void loadFiles()}
                  type="button"
                >
                  Reload
                </button>
                <button
                  className="relay-button-primary min-h-11"
                  disabled={busy || !configToml.trim() || !authJson.trim()}
                  onClick={() =>
                    void onAction(`backend:${sandbox.id}`, () =>
                      updateHostedCodexFiles(sandbox.id, {
                        configToml,
                        authJson,
                      }),
                    )
                  }
                  type="button"
                >
                  Save to VM
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </details>
  );
}

function BackendFileField({
  filename,
  language,
  onChange,
  value,
}: {
  filename: string;
  language: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div>
      <div className="flex min-h-9 items-center justify-between gap-3">
        <label
          className="text-xs font-semibold text-[var(--theme-fg)]"
          htmlFor={filename}
        >
          {filename}
        </label>
        <label className="relay-button-secondary inline-flex min-h-9 cursor-pointer items-center px-3 text-xs">
          Upload {language}
          <input
            accept={
              language === 'JSON'
                ? '.json,application/json'
                : '.toml,text/plain'
            }
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void file.text().then(onChange);
              event.target.value = '';
            }}
            type="file"
          />
        </label>
      </div>
      <textarea
        className="relay-input mt-2 min-h-40 w-full resize-y font-mono text-xs leading-5"
        id={filename}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={value}
      />
    </div>
  );
}

function HostedStatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const classes = {
    success:
      'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
    warning:
      'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
    danger:
      'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
    neutral:
      'border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg-muted)]',
  }[tone];
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {children}
    </span>
  );
}

function hostedStatusTone(status: RelayHostedSandboxDto['status']) {
  if (status === 'online') return 'success' as const;
  if (status === 'error') return 'danger' as const;
  if (
    ['creating', 'starting', 'provisioning', 'stopping', 'deleting'].includes(
      status,
    )
  ) {
    return 'warning' as const;
  }
  return 'neutral' as const;
}

function hostedStatusLabel(status: RelayHostedSandboxDto['status']) {
  return status.replace('_', ' ').replace(/^./, (value) => value.toUpperCase());
}

function formatMemory(memoryMiB: number) {
  return memoryMiB % 1024 === 0
    ? `${memoryMiB / 1024} GiB`
    : `${(memoryMiB / 1024).toFixed(1)} GiB`;
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
          <p className="mt-1 text-2xl font-semibold text-[var(--theme-fg)]">
            {value.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">{detail}</p>
        </div>
      </div>
    </article>
  );
}

function RelayAdminUserMenu({ onLogout }: { onLogout: () => void }) {
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRelayAdminSession()
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
  }, []);

  const user = session?.user ?? null;
  if (!user) {
    return null;
  }

  async function logout() {
    await relayAdminLogout();
    setSession(null);
    setOpen(false);
    onLogout();
  }

  return (
    <div className="fixed right-3 top-[calc(env(safe-area-inset-top)+0.55rem)] z-50">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Relay admin menu for ${user.username}`}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] text-sm font-semibold text-[var(--theme-fg)] shadow-lg transition hover:bg-[var(--theme-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-ring)]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {initials(user.username)}
      </button>
      {open ? (
        <div
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-1 shadow-[var(--theme-shadow)]"
          role="menu"
        >
          <div className="border-b border-[var(--theme-border)] px-3 py-2">
            <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
              {user.username}
            </p>
            <p className="truncate text-xs text-[var(--theme-fg-muted)]">
              {user.email}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--theme-fg-muted)]">
              Admin session
            </p>
          </div>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--status-danger-fg)] transition hover:bg-[var(--status-danger-bg)]"
            onClick={() => void logout()}
            role="menuitem"
            type="button"
          >
            <LogOut className="h-4 w-4" />
            Logout admin
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Overview({ summary }: { summary: RelayAdminSummaryDto }) {
  const recentUsers = [...summary.users]
    .sort(compareNullableDate('lastSeenAt'))
    .slice(0, 6);
  const activeDevices = summary.devices.filter((device) => device.connected);
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
      <Panel title="Recent users" detail="Last authenticated relay activity.">
        <div className="divide-y divide-[var(--theme-border)]">
          {recentUsers.map((user) => (
            <div
              className="flex items-center justify-between gap-3 py-3"
              key={user.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
                  {user.username}
                </p>
                <p className="truncate text-xs text-[var(--theme-fg-muted)]">
                  {user.email}
                </p>
              </div>
              <div className="text-right text-xs text-[var(--theme-fg-muted)]">
                <p>{formatTimestamp(user.lastSeenAt)}</p>
                <p>{user.conversationCount} conversations</p>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        title="Online devices"
        detail="Devices with an active supervisor tunnel."
      >
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
  onDeleteUser,
  onResetPassword,
  onUpdateUser,
  users,
}: {
  busyKey: string | null;
  onDeleteUser: (userId: string) => Promise<void>;
  onResetPassword: (userId: string, password: string) => Promise<void>;
  onUpdateUser: (userId: string, enabled: boolean) => void;
  users: RelayAdminSummaryDto['users'];
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{
    key: UserSortKey;
    direction: SortDirection;
  }>({
    key: 'lastSeenAt',
    direction: 'desc',
  });
  const [resetTarget, setResetTarget] = useState<
    RelayAdminSummaryDto['users'][number] | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<
    RelayAdminSummaryDto['users'][number] | null
  >(null);
  const filteredUsers = useMemo(() => {
    const normalized = normalizeSearch(query);
    return users
      .filter((user) => {
        if (!normalized) {
          return true;
        }
        return normalizeSearch(`${user.username} ${user.email}`).includes(
          normalized,
        );
      })
      .sort((left, right) => compareUsers(left, right, sort));
  }, [query, sort, users]);

  function updateSort(key: UserSortKey) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  }

  return (
    <>
      <Panel
        title="Users"
        detail="Registered relay accounts. Admin accounts are excluded from workspace and device operations."
      >
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--theme-fg-muted)]" />
            <input
              className="relay-input w-full pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search username or email"
              value={query}
            />
          </label>
          <p className="text-sm text-[var(--theme-fg-muted)]">
            {filteredUsers.length.toLocaleString()} of{' '}
            {users.length.toLocaleString()} users
          </p>
        </div>
        <ResponsiveTable minWidth="68rem">
          <thead>
            <tr>
              <SortableTh
                active={sort.key === 'username'}
                direction={sort.direction}
                onClick={() => updateSort('username')}
              >
                User
              </SortableTh>
              <SortableTh
                active={sort.key === 'enabled'}
                direction={sort.direction}
                onClick={() => updateSort('enabled')}
              >
                Status
              </SortableTh>
              <SortableTh
                active={sort.key === 'lastSeenAt'}
                direction={sort.direction}
                onClick={() => updateSort('lastSeenAt')}
              >
                Last used
              </SortableTh>
              <SortableTh
                active={sort.key === 'conversationCount'}
                direction={sort.direction}
                onClick={() => updateSort('conversationCount')}
              >
                Conversations
              </SortableTh>
              <SortableTh
                active={sort.key === 'deviceCount'}
                direction={sort.direction}
                onClick={() => updateSort('deviceCount')}
              >
                Devices
              </SortableTh>
              <Th>Role</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={user.id}>
                <Td strong>
                  {user.username}
                  <div className="text-xs font-normal text-[var(--theme-fg-muted)]">
                    {user.email}
                  </div>
                </Td>
                <Td>
                  <StatusPill active={user.enabled}>
                    {user.enabled ? 'Enabled' : 'Disabled'}
                  </StatusPill>
                </Td>
                <Td>{formatTimestamp(user.lastSeenAt)}</Td>
                <Td>{user.conversationCount.toLocaleString()}</Td>
                <Td>{user.deviceCount.toLocaleString()}</Td>
                <Td>{user.role}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="relay-button-secondary"
                      disabled={busyKey === user.id || user.role === 'admin'}
                      onClick={() => onUpdateUser(user.id, !user.enabled)}
                      type="button"
                    >
                      {user.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="relay-button-secondary inline-flex items-center gap-2"
                      disabled={
                        busyKey === `reset:${user.id}` || user.role === 'admin'
                      }
                      onClick={() => setResetTarget(user)}
                      type="button"
                    >
                      <KeyRound className="h-4 w-4" />
                      Reset
                    </button>
                    <button
                      className="relay-button-secondary inline-flex items-center gap-2 text-[var(--status-danger-fg)]"
                      disabled={
                        busyKey === `delete:${user.id}` || user.role === 'admin'
                      }
                      onClick={() => setDeleteTarget(user)}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
        {!filteredUsers.length ? (
          <EmptyState>No users match the current search.</EmptyState>
        ) : null}
      </Panel>
      {resetTarget ? (
        <PasswordResetDialog
          busy={busyKey === `reset:${resetTarget.id}`}
          onClose={() => setResetTarget(null)}
          onSubmit={async (password) => {
            await onResetPassword(resetTarget.id, password);
            setResetTarget(null);
          }}
          user={resetTarget}
        />
      ) : null}
      {deleteTarget ? (
        <DangerConfirmDialog
          busy={busyKey === `delete:${deleteTarget.id}`}
          confirmLabel="Delete user"
          description={`Delete ${deleteTarget.username}, their devices, shares, and access history. This cannot be undone.`}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await onDeleteUser(deleteTarget.id);
            setDeleteTarget(null);
          }}
          title="Delete relay user"
        />
      ) : null}
    </>
  );
}

function DevicesPanel({
  devices,
  users,
}: {
  devices: RelayAdminDeviceDto[];
  users: RelayAdminSummaryDto['users'];
}) {
  const [ownerId, setOwnerId] = useState('all');
  const [status, setStatus] = useState<'all' | 'online' | 'offline'>('all');
  const [activity, setActivity] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [sortKey, setSortKey] = useState<DeviceSortKey>('lastActivity');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const ownerUsers = useMemo(
    () =>
      users.filter((user) =>
        devices.some((device) => device.ownerUserId === user.id),
      ),
    [devices, users],
  );
  const filteredDevices = useMemo(
    () =>
      devices
        .filter((device) => ownerId === 'all' || device.ownerUserId === ownerId)
        .filter(
          (device) =>
            status === 'all' ||
            (status === 'online' ? device.connected : !device.connected),
        )
        .filter(
          (device) =>
            activity === 'all' ||
            isAfterActivityWindow(deviceLastActivity(device), activity),
        )
        .sort((left, right) => compareDevices(left, right, sortKey, direction)),
    [activity, devices, direction, ownerId, sortKey, status],
  );

  return (
    <Panel
      title="Devices"
      detail="Supervisor devices grouped by owner, connection state, activity, and loaded workspace metadata."
    >
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="block text-sm text-[var(--theme-fg-soft)]">
          Owner
          <select
            className="relay-input mt-2 w-full"
            onChange={(event) => setOwnerId(event.target.value)}
            value={ownerId}
          >
            <option value="all">All users</option>
            {ownerUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.username}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-[var(--theme-fg-soft)]">
          Status
          <select
            className="relay-input mt-2 w-full"
            onChange={(event) => setStatus(event.target.value as typeof status)}
            value={status}
          >
            <option value="all">All devices</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
        </label>
        <label className="block text-sm text-[var(--theme-fg-soft)]">
          Last activity
          <select
            className="relay-input mt-2 w-full"
            onChange={(event) =>
              setActivity(event.target.value as typeof activity)
            }
            value={activity}
          >
            <option value="all">Any time</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </label>
        <label className="block text-sm text-[var(--theme-fg-soft)]">
          Sort by
          <select
            className="relay-input mt-2 w-full"
            onChange={(event) =>
              setSortKey(event.target.value as DeviceSortKey)
            }
            value={sortKey}
          >
            <option value="lastActivity">Last activity</option>
            <option value="name">Device name</option>
            <option value="ownerUsername">Owner</option>
            <option value="connected">Connection</option>
            <option value="createdAt">Created</option>
            <option value="workspaceCount">Workspaces</option>
            <option value="threadCount">Threads</option>
          </select>
        </label>
        <label className="block text-sm text-[var(--theme-fg-soft)]">
          Direction
          <select
            className="relay-input mt-2 w-full"
            onChange={(event) =>
              setDirection(event.target.value as SortDirection)
            }
            value={direction}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
      </div>
      <ResponsiveTable minWidth="74rem">
        <thead>
          <tr>
            <Th>Device</Th>
            <Th>Owner</Th>
            <Th>Status</Th>
            <Th>Last activity</Th>
            <Th>Inventory</Th>
            <Th>Network</Th>
          </tr>
        </thead>
        <tbody>
          {filteredDevices.map((device) => (
            <tr key={device.id}>
              <Td strong>
                {device.name}
                <div className="text-xs font-normal text-[var(--theme-fg-muted)]">
                  {device.tokenPreview}
                </div>
              </Td>
              <Td>
                <span className="font-medium text-[var(--theme-fg-soft)]">
                  {device.ownerUsername}
                </span>
                <div className="text-xs text-[var(--theme-fg-muted)]">
                  {device.ownerEmail}
                </div>
              </Td>
              <Td>
                <StatusPill active={device.connected}>
                  {device.connected ? 'Online' : 'Offline'}
                </StatusPill>
              </Td>
              <Td>
                {formatTimestamp(deviceLastActivity(device))}
                <div className="text-xs text-[var(--theme-fg-muted)]">
                  created {formatTimestamp(device.createdAt)}
                </div>
              </Td>
              <Td>
                <span>
                  {device.workspaces.length.toLocaleString()} workspaces
                </span>
                <span className="mx-2 text-[var(--theme-fg-muted)]">·</span>
                <span>{device.threads.length.toLocaleString()} threads</span>
                <div className="mt-1 truncate text-xs text-[var(--theme-fg-muted)]">
                  {device.workspaces[0]?.label ?? 'No workspace metadata'}
                </div>
                <div className="truncate text-xs text-[var(--theme-fg-muted)]">
                  {device.threads[0]?.title ?? 'No thread metadata'}
                </div>
              </Td>
              <Td>
                {device.ipAddress ?? 'IP unavailable'}
                <div className="text-xs text-[var(--theme-fg-muted)]">
                  heartbeat {formatTimestamp(device.lastHeartbeatAt)}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </ResponsiveTable>
      {!filteredDevices.length ? (
        <EmptyState>No devices match the selected filters.</EmptyState>
      ) : null}
    </Panel>
  );
}

function SharesTable({ shares }: { shares: RelaySessionShareDto[] }) {
  return (
    <Panel
      title="Share relationships"
      detail="Thread grants between relay users. Revoked grants remain visible for audit."
    >
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
                <span className="font-medium text-[var(--theme-fg)]">
                  {share.threadTitle ?? share.label ?? 'Thread unavailable'}
                </span>
                <div className="text-xs text-[var(--theme-fg-muted)]">
                  {share.workspaceLabel ?? 'Workspace unavailable'}
                </div>
              </Td>
              <Td>{share.deviceName}</Td>
              <Td>
                {share.threadAccess} /{' '}
                {workspaceAccessLabel(share.workspaceAccess)}
              </Td>
              <Td>{formatTimestamp(share.lastAccessedAt)}</Td>
              <Td>
                {share.revokedAt
                  ? 'Revoked'
                  : share.expiresAt &&
                      share.expiresAt <= new Date().toISOString()
                    ? 'Expired'
                    : 'Active'}
              </Td>
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
  onReviewRegistration: (
    requestId: string,
    action: 'approve' | 'reject',
  ) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  pending: RelayAdminSummaryDto['pendingRegistrations'];
  reviewBusyKey: string | null;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Panel
        title="Registration settings"
        detail="Stored in the relay database. Environment password seeds this once if empty."
      >
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
              onChange={(event) =>
                onChange({ ...draft, registrationPassword: event.target.value })
              }
              placeholder="Leave empty for no invite password"
              value={draft.registrationPassword ?? ''}
            />
          </label>
          <Checkbox
            checked={draft.approvalRequired}
            label="Require admin approval"
            onChange={(approvalRequired) =>
              onChange({ ...draft, approvalRequired })
            }
          />
          <button
            className="relay-button-primary inline-flex items-center gap-2"
            disabled={busy}
            type="submit"
          >
            <Settings className="h-4 w-4" />
            Save settings
          </button>
        </form>
      </Panel>

      <Panel
        title="Pending registrations"
        detail="Approve creates the user. Reject keeps an audit trail."
      >
        {pending.length ? (
          <div className="divide-y divide-[var(--theme-border)]">
            {pending.map((request) => (
              <div
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                key={request.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
                    {request.username}
                  </p>
                  <p className="truncate text-xs text-[var(--theme-fg-muted)]">
                    {request.email} · {formatTimestamp(request.createdAt)}
                  </p>
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
      <p>
        Owner:{' '}
        <span className="text-[var(--theme-fg-soft)]">{device.ownerEmail}</span>
      </p>
      <p>
        IP:{' '}
        <span className="text-[var(--theme-fg-soft)]">
          {device.ipAddress ?? 'unavailable'}
        </span>
      </p>
      <p>
        Connected:{' '}
        <span className="text-[var(--theme-fg-soft)]">
          {formatTimestamp(device.connectedAt)}
        </span>
      </p>
      <p>
        Heartbeat:{' '}
        <span className="text-[var(--theme-fg-soft)]">
          {formatTimestamp(device.lastHeartbeatAt)}
        </span>
      </p>
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
          <h2 className="text-base font-semibold text-[var(--theme-fg)]">
            {title}
          </h2>
          <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">{detail}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ResponsiveTable({
  children,
  minWidth,
}: {
  children: React.ReactNode;
  minWidth: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-left text-sm"
        style={{ minWidth }}
      >
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

function SortableTh({
  active,
  children,
  direction,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  direction: SortDirection;
  onClick: () => void;
}) {
  const Icon = !active
    ? ArrowUpDown
    : direction === 'asc'
      ? ArrowUp
      : ArrowDown;
  return (
    <th className="border-b border-[var(--theme-border)] py-2 pr-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-fg-muted)]">
      <button
        className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)] ${
          active ? 'text-[var(--theme-fg)]' : ''
        }`}
        onClick={onClick}
        type="button"
      >
        {children}
        <Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}

function Td({
  children,
  strong = false,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-b border-[var(--theme-border)] py-3 pr-3 ${strong ? 'font-medium text-[var(--theme-fg)]' : 'text-[var(--theme-fg-muted)]'}`}
    >
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

function StatusPill({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs ${
        active
          ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
          : 'border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg-muted)]'
      }`}
    >
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

function PasswordResetDialog({
  busy,
  onClose,
  onSubmit,
  user,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
  user: RelayAdminSummaryDto['users'][number];
}) {
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }
    await onSubmit(password);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--app-bg)_82%,transparent)] px-4 py-8">
      <section className="w-full max-w-md rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-2xl shadow-[color-mix(in_oklch,var(--app-fg)_18%,transparent)]">
        <h2 className="text-lg font-semibold text-[var(--theme-fg)]">
          Reset password
        </h2>
        <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
          Set a new relay password for {user.username}.
        </p>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <label className="block text-sm text-[var(--theme-fg-soft)]">
            New password
            <input
              autoFocus
              className="relay-input mt-2 w-full"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          {localError ? (
            <p className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger-fg)]">
              {localError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              className="relay-button-secondary"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="relay-button-primary inline-flex items-center gap-2"
              disabled={busy}
              type="submit"
            >
              <KeyRound className="h-4 w-4" />
              Save password
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DangerConfirmDialog({
  busy,
  confirmLabel,
  description,
  onClose,
  onConfirm,
  title,
}: {
  busy: boolean;
  confirmLabel: string;
  description: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--app-bg)_82%,transparent)] px-4 py-8">
      <section className="w-full max-w-md rounded-lg border border-[var(--status-danger-border)] bg-[var(--theme-panel)] p-5 shadow-2xl shadow-[color-mix(in_oklch,var(--app-fg)_18%,transparent)]">
        <h2 className="text-lg font-semibold text-[var(--theme-fg)]">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--theme-fg-muted)]">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="relay-button-secondary"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--action-danger-bg)] px-4 text-sm font-semibold text-[var(--action-danger-fg)] transition hover:bg-[var(--action-danger-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function compareUsers(
  left: RelayAdminSummaryDto['users'][number],
  right: RelayAdminSummaryDto['users'][number],
  sort: { key: UserSortKey; direction: SortDirection },
) {
  const direction = sort.direction === 'asc' ? 1 : -1;
  let value = 0;
  if (sort.key === 'username') {
    value = left.username.localeCompare(right.username);
  } else if (sort.key === 'enabled') {
    value = Number(left.enabled) - Number(right.enabled);
  } else if (sort.key === 'lastSeenAt') {
    value = compareDateValues(left.lastSeenAt, right.lastSeenAt);
  } else if (sort.key === 'conversationCount') {
    value = left.conversationCount - right.conversationCount;
  } else if (sort.key === 'deviceCount') {
    value = left.deviceCount - right.deviceCount;
  } else {
    value = compareDateValues(left.createdAt, right.createdAt);
  }
  return value * direction || left.username.localeCompare(right.username);
}

function compareDevices(
  left: RelayAdminDeviceDto,
  right: RelayAdminDeviceDto,
  key: DeviceSortKey,
  direction: SortDirection,
) {
  const multiplier = direction === 'asc' ? 1 : -1;
  let value = 0;
  if (key === 'name') {
    value = left.name.localeCompare(right.name);
  } else if (key === 'ownerUsername') {
    value = left.ownerUsername.localeCompare(right.ownerUsername);
  } else if (key === 'connected') {
    value = Number(left.connected) - Number(right.connected);
  } else if (key === 'lastActivity') {
    value = compareDateValues(
      deviceLastActivity(left),
      deviceLastActivity(right),
    );
  } else if (key === 'createdAt') {
    value = compareDateValues(left.createdAt, right.createdAt);
  } else if (key === 'workspaceCount') {
    value = left.workspaces.length - right.workspaces.length;
  } else {
    value = left.threads.length - right.threads.length;
  }
  return value * multiplier || left.name.localeCompare(right.name);
}

function compareDateValues(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftTime = Date.parse(left ?? '');
  const rightTime = Date.parse(right ?? '');
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : -Infinity;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : -Infinity;
  return normalizedLeft - normalizedRight;
}

function deviceLastActivity(device: RelayAdminDeviceDto) {
  return device.lastHeartbeatAt ?? device.connectedAt ?? device.createdAt;
}

function isAfterActivityWindow(
  value: string | null | undefined,
  window: '24h' | '7d' | '30d',
) {
  const timestamp = Date.parse(value ?? '');
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const hours = window === '24h' ? 24 : window === '7d' ? 24 * 7 : 24 * 30;
  return timestamp >= Date.now() - hours * 60 * 60 * 1000;
}

function replaceAdminUser(
  summary: RelayAdminSummaryDto | null,
  updated: RelayUserDto,
) {
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
    case 'hosted':
      return 'Hosted VMs';
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
  return (
    left: { [key in typeof field]: string | null },
    right: { [key in typeof field]: string | null },
  ) => Date.parse(right[field] ?? '') - Date.parse(left[field] ?? '');
}

function formatTimestamp(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : 'never';
}

function initials(username: string | null | undefined) {
  const normalized = username?.trim() ?? '';
  if (!normalized) {
    return '??';
  }
  return Array.from(normalized).slice(0, 2).join('').toUpperCase();
}
