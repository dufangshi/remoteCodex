import { Copy, MonitorSmartphone, Plug, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type {
  RelayCreateDeviceResultDto,
  RelayDeviceDto,
  RelayPortalSummaryDto,
} from '@remote-codex/shared';
import {
  ApiError,
  createRelayDevice,
  deleteRelayDevice,
  enableRelayMode,
  fetchRelayPortal,
  setSelectedRelayDeviceId,
  setSelectedRelayThreadId,
} from '../lib/api';
import { workspacesHref } from '../lib/relayRoutes';

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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      enableRelayMode();
      setPortal(await fetchRelayPortal());
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to load devices.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('create');
    setError(null);
    try {
      const result = await createRelayDevice({ name: deviceName });
      setCreatedDevice(result);
      setDeviceName('');
      await load();
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
      await load();
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
        <header className="flex flex-col gap-3 border-b border-[var(--theme-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link className="text-sm text-[var(--theme-accent-strong)]" to="/workspaces">
              Back to workspaces
            </Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
              Relay Devices
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
              Device management
            </h1>
          </div>
          <button
            className="relay-button-secondary inline-flex items-center gap-2"
            onClick={() => void load()}
            type="button"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
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
      </div>
    </main>
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
