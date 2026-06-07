import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AgentBackendIdDto } from '../../../../packages/shared/src/index';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  closeControlPlaneSession,
  createControlPlaneProject,
  createControlPlaneRouteToken,
  createControlPlaneSession,
  createControlPlaneWorkspace,
  deleteControlPlaneProject,
  fetchControlPlaneMe,
  fetchControlPlaneAdminSandboxDetail,
  fetchControlPlaneHarnessModuleRuns,
  fetchControlPlaneHarnessModuleTools,
  fetchControlPlaneHarnessStatus,
  fetchControlPlaneHarnessUsageEvents,
  fetchControlPlaneHarnessUsageSummary,
  fetchControlPlaneProjects,
  fetchControlPlaneUsageEvents,
  fetchControlPlaneSandboxHealth,
  fetchControlPlaneSessions,
  fetchControlPlaneWorkspaces,
  restartControlPlaneSandbox,
  resumeControlPlaneSession,
  startControlPlaneSandbox,
  stopControlPlaneSandbox,
  updateControlPlaneProject,
  updateControlPlaneSession,
  updateControlPlaneWorkspace,
  updateControlPlaneMe,
  ApiError,
  type ControlPlaneAuth,
  type ControlPlaneHarnessModule,
  type ControlPlaneHarnessPayload,
  type ControlPlaneHarnessStatus,
  type ControlPlaneHarnessUsageEvent,
  type ControlPlaneHarnessUsageSummary,
  type ControlPlaneBillingSummary,
  type ControlPlaneSandboxDetail,
  type ControlPlaneProject,
  type ControlPlaneRouteToken,
  type ControlPlaneSandbox,
  type ControlPlaneSession,
  type ControlPlaneUsageEvent,
  type ControlPlaneUsageSummary,
  type ControlPlaneUser,
  type ControlPlaneWorkspace,
} from '../lib/api';
import {
  clearStoredControlPlaneAuth,
  readStoredControlPlaneAuth,
  writeStoredControlPlaneAuth,
} from './controlPlaneAuthStorage';
import { ControlPlaneInspector } from './control-plane/ControlPlaneInspector';
import { ControlPlaneShell } from './control-plane/ControlPlaneShell';
import { ControlPlaneSidebar } from './control-plane/ControlPlaneSidebar';
import { ControlPlaneTopBar } from './control-plane/ControlPlaneTopBar';

const ROUTE_TOKEN_REFRESH_SKEW_MS = 60_000;
const ROUTE_TOKEN_MIN_REFRESH_MS = 5_000;
const SANDBOX_HEALTH_POLL_MS = 3_000;
const HARNESS_MODULE_LABELS: Record<ControlPlaneHarnessModule, string> = {
  estructural: 'Estructural',
  quntur: 'Quntur',
  farmaco: 'Farmaco',
};
type CreatePanelKind = 'project' | 'workspace' | 'session';
type InspectorTab = 'summary' | 'metadata' | 'route' | 'logs';
type EditableEntity =
  | { type: 'project'; id: string }
  | { type: 'workspace'; id: string }
  | { type: 'session'; id: string };

function formatRelativeTime(value: string | null | undefined) {
  if (!value) {
    return 'no activity yet';
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  const deltaMs = Date.now() - timestamp;
  const absMs = Math.abs(deltaMs);
  const suffix = deltaMs >= 0 ? 'ago' : 'from now';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absMs < minute) {
    return 'just now';
  }
  if (absMs < hour) {
    const minutes = Math.round(absMs / minute);
    return `${minutes}m ${suffix}`;
  }
  if (absMs < day) {
    const hours = Math.round(absMs / hour);
    return `${hours}h ${suffix}`;
  }
  const days = Math.round(absMs / day);
  return `${days}d ${suffix}`;
}

function slugFromName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function statusTone(state: string) {
  switch (state) {
    case 'running':
      return 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]';
    case 'failed':
    case 'degraded':
    case 'unknown':
      return 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]';
    case 'stopped':
      return 'border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]';
    default:
      return 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]';
  }
}

function statusLabel(state: string | null | undefined) {
  if (!state) {
    return 'Unknown';
  }
  return state
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function workspaceSourceLabel(sourceType: string | null | undefined) {
  switch (sourceType) {
    case 'empty':
      return 'Local workspace';
    case 'git':
      return 'Git workspace';
    default:
      return statusLabel(sourceType);
  }
}

function workspaceTreeLabel(workspace: ControlPlaneWorkspace) {
  return workspaceSourceLabel(workspace.sourceType);
}

function sessionRuntimeLabel(session: ControlPlaneSession) {
  return session.workerSessionId ? 'Runtime ready' : 'Not started';
}

function entityKey(entity: EditableEntity | null) {
  return entity ? `${entity.type}:${entity.id}` : '';
}

function providerLabel(provider: string) {
  switch (provider) {
    case 'codex':
      return 'Codex';
    case 'claude':
      return 'Claude';
    case 'opencode':
      return 'OpenCode';
    default:
      return statusLabel(provider);
  }
}

function TreeChevron({ open }: { open?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <path
        d={open ? 'M4.5 6.25 8 9.75l3.5-3.5' : 'M6.25 4.5 9.75 8l-3.5 3.5'}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ProjectTreeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <path
        d="M2.75 5.25h10.5v7H2.75zM2.75 4a1 1 0 0 1 1-1h3l1.25 1.25h4.25a1 1 0 0 1 1 1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function WorkspaceTreeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <path
        d="M3 3.75h10v8.5H3zM5.25 6h5.5M5.25 8h5.5M5.25 10h3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function SessionTreeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <path
        d="M4 3.25h5.25L12 6v6.75H4zM9.25 3.25V6H12M6 8.25h4M6 10.25h3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <path
        d="m3.2 10.9-.45 2.35 2.35-.45 6.95-6.95-1.9-1.9zm7.8-7.8.95-.95a1.35 1.35 0 0 1 1.9 1.9l-.95.95"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <path
        d="M3 4.25h10M6.25 4.25V3h3.5v1.25M4.5 4.25l.55 8.25h5.9l.55-8.25M6.75 6.75v3.5M9.25 6.75v3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function connectionLabel(state: 'idle' | 'connecting' | 'ready' | 'reconnecting') {
  switch (state) {
    case 'connecting':
      return 'Connecting';
    case 'ready':
      return 'Ready';
    case 'reconnecting':
      return 'Reconnecting';
    default:
      return 'Idle';
  }
}

function sandboxStageLabel(sandbox: ControlPlaneSandbox | null) {
  if (!sandbox) {
    return 'Loading runtime';
  }
  if (sandbox.state === 'starting') {
    const progress = sandbox.startupProgress ?? 0;
    if (progress < 25) {
      return 'Request received';
    }
    if (progress < 50) {
      return 'Scheduling sandbox';
    }
    if (progress < 90) {
      return 'Preparing runtime';
    }
    return 'Opening sandbox route';
  }
  if (sandbox.state === 'stopping') {
    return 'Stopping sandbox';
  }
  if (sandbox.state === 'running') {
    return 'Ready';
  }
  if (sandbox.state === 'degraded') {
    return 'Checking readiness';
  }
  if (sandbox.state === 'failed') {
    return 'Startup failed';
  }
  if (sandbox.state === 'stopped') {
    return 'Stopped';
  }
  return statusLabel(sandbox.state);
}

function sandboxHealthLabel(sandbox: ControlPlaneSandbox | null) {
  if (!sandbox) {
    return 'Loading sandbox registry';
  }
  switch (sandbox.state) {
    case 'running':
      return 'Healthy';
    case 'starting':
      return 'Waiting for runtime readiness';
    case 'stopping':
      return 'Shutdown in progress';
    case 'degraded':
      return 'Needs attention';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Offline';
    default:
      return 'Unknown';
  }
}

type SandboxLifecycleAction = 'start' | 'stop' | 'restart' | 'health' | 'inspect';

interface SandboxActionPresentation {
  label: string;
  disabled: boolean;
  title: string | undefined;
}

function sandboxActionPresentation(
  canUseControlPlane: boolean,
  sandbox: ControlPlaneSandbox | null,
): Record<SandboxLifecycleAction, SandboxActionPresentation> {
  const signedOutTitle = 'Sign in before managing the sandbox.';
  if (!canUseControlPlane) {
    return {
      start: { label: 'Start', disabled: true, title: signedOutTitle },
      stop: { label: 'Stop', disabled: true, title: signedOutTitle },
      restart: { label: 'Restart', disabled: true, title: signedOutTitle },
      health: { label: 'Health', disabled: true, title: signedOutTitle },
      inspect: { label: 'Inspect', disabled: true, title: signedOutTitle },
    };
  }

  if (!sandbox) {
    const loadingTitle = 'Wait for the sandbox registry to load.';
    return {
      start: { label: 'Start', disabled: true, title: loadingTitle },
      stop: { label: 'Stop', disabled: true, title: loadingTitle },
      restart: { label: 'Restart', disabled: true, title: loadingTitle },
      health: { label: 'Health', disabled: true, title: loadingTitle },
      inspect: { label: 'Inspect', disabled: true, title: loadingTitle },
    };
  }

  const state = sandbox.state;
  const canStop = state === 'running' || state === 'degraded' || state === 'starting';
  const canRestart = state === 'running' || state === 'degraded';
  const startDisabled =
    state === 'running' ||
    state === 'starting' ||
    state === 'stopping' ||
    state === 'restarting' ||
    state === 'degraded';
  const startLabel =
    state === 'starting'
      ? 'Starting...'
      : state === 'stopping'
        ? 'Stopping...'
        : state === 'restarting'
          ? 'Restarting...'
          : state === 'running'
            ? 'Running'
            : state === 'failed'
              ? 'Retry start'
              : 'Start';

  return {
    start: {
      label: startLabel,
      disabled: startDisabled,
      title:
        state === 'starting'
          ? 'Sandbox startup is already in progress.'
          : state === 'running'
            ? 'Sandbox is already running.'
            : state === 'stopping'
              ? 'Wait for sandbox shutdown to finish before starting again.'
              : state === 'restarting'
                ? 'Sandbox restart is already in progress.'
                : state === 'degraded'
                  ? 'Use Restart to recover a degraded sandbox.'
                  : undefined,
    },
    stop: {
      label: 'Stop',
      disabled: !canStop,
      title: canStop ? undefined : 'Stop is available only while the sandbox is running or starting.',
    },
    restart: {
      label: state === 'restarting' ? 'Restarting...' : 'Restart',
      disabled: !canRestart,
      title:
        state === 'failed'
          ? 'Use Retry start after a failed startup.'
          : canRestart
            ? undefined
            : 'Restart is available only when the sandbox is running or degraded.',
    },
    health: {
      label: 'Health',
      disabled: false,
      title: undefined,
    },
    inspect: {
      label: 'Inspect',
      disabled: false,
      title: undefined,
    },
  };
}

function sandboxBanner(sandbox: ControlPlaneSandbox | null) {
  if (!sandbox) {
    return null;
  }
  if (sandbox.state === 'running' && sandbox.idleTimeoutAt) {
    const timeoutMs = Date.parse(sandbox.idleTimeoutAt);
    if (Number.isFinite(timeoutMs) && timeoutMs > Date.now()) {
      return {
        tone: 'warning',
        text: `Sandbox will stop after idle timeout at ${sandbox.idleTimeoutAt}.`,
      };
    }
  }
  if (sandbox.state === 'degraded') {
    return {
      tone: 'warning',
      text: sandbox.statusReason ?? 'Sandbox is reachable but not fully ready.',
    };
  }
  if (sandbox.state === 'failed') {
    return {
      tone: 'danger',
      text: sandbox.lastFailureMessage ?? sandbox.statusReason ?? 'Sandbox startup failed.',
    };
  }
  if (sandbox.state === 'unknown') {
    return {
      tone: 'warning',
      text: sandbox.statusReason ?? 'Sandbox state is unknown.',
    };
  }
  if (!['running', 'starting', 'stopping'].includes(sandbox.state)) {
    return {
      tone: 'neutral',
      text: 'Sandbox is offline.',
    };
  }
  return null;
}

function harnessState(status: ControlPlaneHarnessStatus | null, error: string | null) {
  if (error) {
    return 'unavailable';
  }
  if (!status) {
    return 'idle';
  }
  if (!status.enabled || !status.chemistryToolsEnabled) {
    return 'not configured';
  }
  if (!status.keyPresent) {
    return 'missing key';
  }
  return status.health ? 'ready' : 'degraded';
}

function harnessTone(state: string) {
  switch (state) {
    case 'ready':
      return statusTone('running');
    case 'unavailable':
    case 'missing key':
      return statusTone('failed');
    case 'not configured':
    case 'idle':
      return statusTone('stopped');
    default:
      return statusTone('starting');
  }
}

function payloadPreview(value: ControlPlaneHarnessPayload | null) {
  if (!value) {
    return '';
  }
  if (typeof value.text === 'string') {
    return value.text.trim();
  }
  if (value.payload === undefined) {
    return '';
  }
  return JSON.stringify(value.payload, null, 2);
}

function payloadItems(value: ControlPlaneHarnessPayload | null) {
  const payload = value?.payload;
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    for (const key of ['tools', 'runs', 'items', 'artifacts']) {
      const candidate = (payload as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }
  return [];
}

function payloadItemLabel(item: unknown, fallback: string) {
  if (!item || typeof item !== 'object') {
    return String(item ?? fallback);
  }
  const record = item as Record<string, unknown>;
  for (const key of ['name', 'tool', 'run_id', 'id', 'title', 'path']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return fallback;
}

function payloadItemMeta(item: unknown) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const record = item as Record<string, unknown>;
  return ['status', 'type', 'module', 'execution_mode']
    .map((key) => {
      const value = record[key];
      return typeof value === 'string' && value.trim() ? value : null;
    })
    .filter(Boolean)
    .join(' / ');
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-[var(--theme-fg-muted)]">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-10 rounded-[0.7rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none transition focus:border-[var(--theme-accent-border)] focus:ring-2 focus:ring-[var(--theme-accent-soft)]"
      />
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  type = 'button',
  title,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string | undefined;
  ariaLabel?: string | undefined;
}) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="h-10 rounded-[0.75rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 text-sm font-medium text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] disabled:cursor-not-allowed disabled:text-[var(--theme-fg-muted)]"
    >
      {children}
    </button>
  );
}

function MetadataDisclosure({
  title = 'Metadata',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="control-metadata-disclosure">
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function CopyField({ label, value }: { label: string; value: string | null | undefined }) {
  const printable = value && value.trim() ? value : 'not assigned';
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span>{printable}</span>
        {value ? (
          <button
            type="button"
            className="control-copy-button"
            onClick={() => {
              void navigator.clipboard?.writeText(value);
            }}
          >
            Copy
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function SessionStatusBadge({ status }: { status: string }) {
  return <span className={`control-status-pill compact ${statusTone(status)}`}>{statusLabel(status)}</span>;
}

function TreeEntityActions({
  label,
  onEdit,
  onDelete,
}: {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="control-tree-actions">
      <button
        type="button"
        className="control-tree-action-button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        aria-label={`Rename ${label}`}
        title={`Rename ${label}`}
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        className="control-tree-action-button danger"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${label}`}
        title={`Delete ${label}`}
      >
        <TrashIcon />
      </button>
    </span>
  );
}

function TreeRenameForm({
  label,
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="control-tree-edit-form" onSubmit={onSubmit}>
      <label>
        <span>{label}</span>
        <input
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          autoFocus
        />
      </label>
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

export function ControlPlanePage() {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<ControlPlaneAuth | null>(() => {
    const stored = readStoredControlPlaneAuth();
    return stored ? { baseUrl: stored.baseUrl, token: stored.token } : null;
  });
  const [user, setUser] = useState<ControlPlaneUser | null>(null);
  const [sandbox, setSandbox] = useState<ControlPlaneSandbox | null>(null);
  const [adminSandboxDetail, setAdminSandboxDetail] = useState<ControlPlaneSandboxDetail | null>(null);
  const [usage, setUsage] = useState<ControlPlaneUsageSummary | null>(null);
  const [billing, setBilling] = useState<ControlPlaneBillingSummary | null>(null);
  const [usageEvents, setUsageEvents] = useState<ControlPlaneUsageEvent[]>([]);
  const [harnessUsage, setHarnessUsage] = useState<ControlPlaneHarnessUsageSummary | null>(null);
  const [harnessUsageEvents, setHarnessUsageEvents] = useState<ControlPlaneHarnessUsageEvent[]>([]);
  const [projects, setProjects] = useState<ControlPlaneProject[]>([]);
  const [workspaces, setWorkspaces] = useState<ControlPlaneWorkspace[]>([]);
  const [sessions, setSessions] = useState<ControlPlaneSession[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
  const [routeToken, setRouteToken] = useState<ControlPlaneRouteToken | null>(null);
  const [workerSocketUrl, setWorkerSocketUrl] = useState<string | null>(null);
  const [harnessStatus, setHarnessStatus] = useState<ControlPlaneHarnessStatus | null>(null);
  const [selectedHarnessModule, setSelectedHarnessModule] = useState<ControlPlaneHarnessModule>('farmaco');
  const [harnessTools, setHarnessTools] = useState<ControlPlaneHarnessPayload | null>(null);
  const [harnessRuns, setHarnessRuns] = useState<ControlPlaneHarnessPayload | null>(null);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Computational chemistry');
  const [workspaceName, setWorkspaceName] = useState('Molecule study');
  const [sessionTitle, setSessionTitle] = useState('Plan calculation');
  const [sessionProvider, setSessionProvider] = useState<AgentBackendIdDto>('codex');
  const [editingEntity, setEditingEntity] = useState<EditableEntity | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<EditableEntity | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [createPanelOpen, setCreatePanelOpen] = useState<CreatePanelKind | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('summary');
  const [profileName, setProfileName] = useState(() => readStoredControlPlaneAuth()?.displayName ?? '');
  const [gatewayUnavailable, setGatewayUnavailable] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState<string | null>(null);
  const [disabledAccount, setDisabledAccount] = useState<string | null>(null);
  const [expiredSession, setExpiredSession] = useState<string | null>(null);
  const [sandboxOffline, setSandboxOffline] = useState<string | null>(null);
  const [adminUsersForbidden, setAdminUsersForbidden] = useState<string | null>(null);
  const [metadataLoading, setMetadataLoading] = useState<{
    projects: boolean;
    workspaces: boolean;
    sessions: boolean;
    usageEvents: boolean;
    harness: boolean;
  }>({
    projects: false,
    workspaces: false,
    sessions: false,
    usageEvents: false,
    harness: false,
  });
  const [workerConnectionState, setWorkerConnectionState] = useState<'idle' | 'connecting' | 'ready' | 'reconnecting'>('idle');
  const routeTokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workerSocketRef = useRef<WebSocket | null>(null);

  const canUseControlPlane = Boolean(auth && user);
  const sandboxReady = sandbox?.state === 'running';
  const sandboxActions = sandboxActionPresentation(canUseControlPlane, sandbox);
  const sandboxProvisioning =
    sandbox?.state === 'starting' ||
    sandbox?.state === 'stopping' ||
    sandbox?.state === 'restarting' ||
    sandbox?.state === 'degraded' ||
    (typeof sandbox?.startupProgress === 'number' &&
      sandbox.startupProgress > 0 &&
      sandbox.startupProgress < 100);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const canCreateWorkspace = canUseControlPlane && Boolean(selectedProject);
  const canCreateSession = canUseControlPlane && Boolean(selectedWorkspace) && sandboxReady;
  const sandboxNotice = sandboxBanner(sandbox);
  const workspaceCreateBlocker = !selectedProject
    ? 'Select a project before creating a workspace.'
    : undefined;
  const sessionCreateBlocker = !selectedWorkspace
    ? 'Select a workspace before creating a session.'
    : !sandboxReady
      ? 'Start the sandbox before creating a session.'
      : undefined;
  const sessionConnectBlocker = !selectedSession
    ? 'Select a session before connecting.'
    : !sandboxReady
      ? 'Start the sandbox before connecting a session.'
      : undefined;
  const createTarget: CreatePanelKind = selectedWorkspace ? 'session' : selectedProject ? 'workspace' : 'project';
  const createTargetLabel =
    createTarget === 'project' ? 'Project' : createTarget === 'workspace' ? 'Workspace' : 'Session';
  const createPanelTitle =
    createPanelOpen === 'project'
      ? 'Create project'
      : createPanelOpen === 'workspace'
        ? `Create workspace in ${selectedProject?.name ?? 'project'}`
        : createPanelOpen === 'session'
          ? `Create session in ${selectedWorkspace?.name ?? 'workspace'}`
          : '';
  const createPanelBlocker =
    createPanelOpen === 'workspace'
      ? workspaceCreateBlocker
      : createPanelOpen === 'session'
        ? sessionCreateBlocker
        : undefined;
  const selectedPath = [
    selectedProject?.name,
    selectedWorkspace?.name,
    selectedSession?.title,
  ].filter(Boolean).join(' / ');
  const harnessStatusText = harnessState(harnessStatus, harnessError);
  const harnessModules = harnessStatus?.modules.length ? harnessStatus.modules : (['farmaco', 'quntur', 'estructural'] as ControlPlaneHarnessModule[]);
  const harnessToolItems = payloadItems(harnessTools);
  const harnessRunItems = payloadItems(harnessRuns);
  const harnessToolsPreview = payloadPreview(harnessTools);
  const harnessRunsPreview = payloadPreview(harnessRuns);
  const accountInitial = (user?.displayName ?? user?.email ?? 'U').trim().charAt(0).toUpperCase() || 'U';
  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const totalCostUsd = billing?.totalCostUsd ?? Number(usage?.costUsd ?? 0) + Number(harnessUsage?.costUsd ?? 0);
  const activeSessions = sessions.filter((session) => session.status === 'active').length;
  const sessionsNeedingStart = sessions.filter((session) => !session.workerSessionId).length;
  const failedSessions = sessions.filter((session) => session.status === 'failed' || session.status === 'closed').length;
  const sessionFilters = [
    { label: 'All', value: sessions.length },
    { label: 'Active', value: activeSessions },
    { label: 'Needs runtime', value: sessionsNeedingStart },
    { label: 'Closed', value: failedSessions },
  ];
  const controlPlaneBaseUrl = auth?.baseUrl ?? readStoredControlPlaneAuth()?.baseUrl ?? 'not connected';
  const selectedSessionActivity = selectedSession?.lastActivityAt ?? selectedSession?.updatedAt ?? null;
  const sandboxActivity = sandbox?.lastSeenAt ?? sandbox?.updatedAt ?? null;
  const sandboxProgressLabel = sandboxStageLabel(sandbox);
  const sandboxHealthSummary = sandboxHealthLabel(sandbox);
  const toolbarTitle = selectedWorkspace?.name ?? selectedProject?.name ?? 'Control Plane';
  const toolbarSubtitle = selectedPath || 'Choose a project and workspace to manage sessions';

  async function run<T>(label: string, action: () => Promise<T>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    setGatewayUnavailable(null);
    setQuotaExceeded(null);
    setDisabledAccount(null);
    setExpiredSession(null);
    setSandboxOffline(null);
    setAdminUsersForbidden(null);
    try {
      return await action();
    } catch (caught) {
      if (caught instanceof ApiError && caught.payload.code === 'gateway_unavailable') {
        setGatewayUnavailable(caught.message);
      }
      if (caught instanceof ApiError && caught.payload.code === 'quota_exceeded') {
        const details = caught.payload.details ?? {};
        const limit = typeof details.limit === 'number' ? details.limit : null;
        const used = typeof details.used === 'number' ? details.used : null;
        const quotaProfile =
          typeof details.quotaProfile === 'string' ? details.quotaProfile : user?.quotaProfile ?? 'current';
        setQuotaExceeded(
          limit !== null && used !== null
            ? `${quotaProfile} quota exhausted (${used}/${limit}).`
            : 'Quota exceeded.',
        );
      }
      if (caught instanceof ApiError && caught.payload.code === 'account_inactive') {
        setDisabledAccount(caught.message);
      }
      if (
        caught instanceof ApiError &&
        (caught.statusCode === 401 || caught.payload.code === 'unauthorized')
      ) {
        setExpiredSession(caught.message);
        clearStoredControlPlaneAuth();
      }
      if (caught instanceof ApiError && caught.payload.code === 'forbidden') {
        setAdminUsersForbidden(caught.message);
      }
      setError(caught instanceof Error ? caught.message : `${label} failed.`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function refresh(nextAuth = auth) {
    if (!nextAuth) {
      return;
    }

    setMetadataLoading((current) => ({ ...current, projects: true, usageEvents: true }));
    try {
      const me = await fetchControlPlaneMe(nextAuth);
      const [projectResult, usageEventResult, harnessUsageResult, harnessUsageEventResult] = await Promise.all([
        fetchControlPlaneProjects(nextAuth),
        fetchControlPlaneUsageEvents(nextAuth, 10),
        fetchControlPlaneHarnessUsageSummary(nextAuth),
        fetchControlPlaneHarnessUsageEvents(nextAuth, 10),
      ]);
      setUser(me.user);
      setSandbox(me.sandbox);
      setUsage(me.usage);
      setBilling(me.billing ?? null);
      setUsageEvents(usageEventResult.events);
      setHarnessUsage(harnessUsageResult.usage);
      setHarnessUsageEvents(harnessUsageEventResult.events);
      setProjects(projectResult.projects);
      setProfileName(me.user.displayName ?? '');
      setSelectedProjectId((current) =>
        projectResult.projects.some((project) => project.id === current) ? current : '',
      );
    } finally {
      setMetadataLoading((current) => ({ ...current, projects: false, usageEvents: false }));
    }
  }

  async function refreshHarness(nextAuth = auth, module = selectedHarnessModule) {
    if (!nextAuth || !sandboxReady) {
      setHarnessStatus(null);
      setHarnessTools(null);
      setHarnessRuns(null);
      setHarnessError(null);
      return;
    }
    setMetadataLoading((current) => ({ ...current, harness: true }));
    setHarnessError(null);
    try {
      const status = await fetchControlPlaneHarnessStatus(nextAuth);
      setHarnessStatus(status);
      const nextModule = status.modules.includes(module)
        ? module
        : status.modules[0] ?? module;
      setSelectedHarnessModule(nextModule);
      if (status.enabled && status.keyPresent && status.chemistryToolsEnabled) {
        const [tools, runs] = await Promise.all([
          fetchControlPlaneHarnessModuleTools(nextAuth, nextModule),
          fetchControlPlaneHarnessModuleRuns(nextAuth, nextModule),
        ]);
        setHarnessTools(tools);
        setHarnessRuns(runs);
      } else {
        setHarnessTools(null);
        setHarnessRuns(null);
      }
    } catch (caught) {
      setHarnessStatus(null);
      setHarnessTools(null);
      setHarnessRuns(null);
      setHarnessError(caught instanceof Error ? caught.message : 'Harness status refresh failed.');
    } finally {
      setMetadataLoading((current) => ({ ...current, harness: false }));
    }
  }

  useEffect(() => {
    if (!auth) {
      return;
    }
    void run('Load control plane', async () => {
      await refresh(auth);
      setMessage('Control plane session is ready.');
    });
  }, []);

  useEffect(() => {
    if (!auth || !selectedWorkspaceId) {
      setSessions([]);
      setSelectedSessionId('');
      return;
    }

    setSelectedSessionId('');
    setMetadataLoading((current) => ({ ...current, sessions: true }));
    void run('Load sessions', async () => {
      try {
        const result = await fetchControlPlaneSessions(auth, selectedWorkspaceId);
        setSessions(result.sessions);
      } finally {
        setMetadataLoading((current) => ({ ...current, sessions: false }));
      }
    });
  }, [auth, selectedWorkspaceId]);

  useEffect(() => {
    if (!auth || !sandbox || !sandboxProvisioning) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchControlPlaneSandboxHealth(auth)
        .then((health) => {
          if (!cancelled) {
            setSandbox(health.sandbox);
          }
        })
        .catch((caught) => {
          if (!cancelled) {
            setSandboxOffline(caught instanceof Error ? caught.message : 'Sandbox health refresh failed.');
          }
        });
    }, SANDBOX_HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [auth, sandbox?.state, sandbox?.startupProgress, sandbox?.updatedAt, sandboxProvisioning]);

  useEffect(() => {
    if (!auth || !sandboxReady) {
      setHarnessStatus(null);
      setHarnessTools(null);
      setHarnessRuns(null);
      setHarnessError(null);
      return;
    }
    void refreshHarness(auth, selectedHarnessModule);
  }, [auth, sandboxReady, sandbox?.updatedAt]);

  useEffect(() => {
    if (!auth || !selectedProjectId) {
      setWorkspaces([]);
      setSelectedWorkspaceId('');
      setSessions([]);
      setSelectedSessionId('');
      return;
    }

    setSelectedWorkspaceId('');
    setSessions([]);
    setSelectedSessionId('');
    setMetadataLoading((current) => ({ ...current, workspaces: true }));
    void run('Load workspaces', async () => {
      try {
        const result = await fetchControlPlaneWorkspaces(auth, selectedProjectId);
        setWorkspaces(result.workspaces);
      } finally {
        setMetadataLoading((current) => ({ ...current, workspaces: false }));
      }
    });
  }, [auth, selectedProjectId]);

  useEffect(
    () => () => {
      if (routeTokenRefreshTimerRef.current) {
        clearTimeout(routeTokenRefreshTimerRef.current);
      }
      closeWorkerSocket();
    },
    [],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      setAccountMenuOpen(false);
      setCreatePanelOpen(null);
      setOpenSessionMenuId(null);
      setInspectorOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function closeWorkerSocket() {
    const socket = workerSocketRef.current;
    workerSocketRef.current = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
  }

  function clearRouteTokenRefreshTimer() {
    if (routeTokenRefreshTimerRef.current) {
      clearTimeout(routeTokenRefreshTimerRef.current);
      routeTokenRefreshTimerRef.current = null;
    }
  }

  function workerWebSocketUrlForToken(token: ControlPlaneRouteToken) {
    const base = token.wsBaseUrl.replace(/\/+$/, '');
    return `${base}/api/sandboxes/${encodeURIComponent(token.sandboxId)}/ws?token=${encodeURIComponent(token.token)}`;
  }

  function connectWorkerSocket(token: ControlPlaneRouteToken, state: 'connecting' | 'reconnecting' = 'connecting') {
    closeWorkerSocket();
    const socketUrl = workerWebSocketUrlForToken(token);
    setWorkerSocketUrl(socketUrl);
    setSandboxOffline(null);
    setWorkerConnectionState(state);
    const socket = new WebSocket(socketUrl);
    workerSocketRef.current = socket;
    socket.addEventListener('open', () => {
      if (workerSocketRef.current === socket) {
        setWorkerConnectionState('ready');
      }
    });
    socket.addEventListener('error', () => {
      if (workerSocketRef.current === socket) {
        setSandboxOffline('Sandbox route connection failed.');
        setWorkerConnectionState('idle');
      }
    });
    socket.addEventListener('close', (event) => {
      if (workerSocketRef.current === socket) {
        setSandboxOffline(
          event.reason || 'Sandbox route closed before the session could stay connected.',
        );
        setWorkerConnectionState('idle');
      }
    });
  }

  function scheduleRouteTokenRefresh(token: ControlPlaneRouteToken | null) {
    clearRouteTokenRefreshTimer();
    if (!token) {
      return;
    }
    const expiresAtMs = Date.parse(token.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }
    const delayMs = Math.max(
      ROUTE_TOKEN_MIN_REFRESH_MS,
      expiresAtMs - Date.now() - ROUTE_TOKEN_REFRESH_SKEW_MS,
    );
    routeTokenRefreshTimerRef.current = setTimeout(() => {
      void refreshRouteTokenBeforeExpiry();
    }, delayMs);
  }

  async function handleLogout() {
    clearStoredControlPlaneAuth();
    setAuth(null);
    setUser(null);
    setSandbox(null);
    setAdminSandboxDetail(null);
    setUsage(null);
    setUsageEvents([]);
    setAdminUsersForbidden(null);
    setProjects([]);
    setWorkspaces([]);
    setSessions([]);
    setHarnessUsage(null);
    setHarnessUsageEvents([]);
    setRouteToken(null);
    setAccountMenuOpen(false);
    setCreatePanelOpen(null);
    clearRouteTokenRefreshTimer();
    setWorkerConnectionState('idle');
    setMessage('Signed out locally.');
  }

  async function handleProfileSave(event: FormEvent) {
    event.preventDefault();
    if (!auth) {
      return;
    }
    await run('Update profile', async () => {
      const result = await updateControlPlaneMe(auth, {
        displayName: profileName,
      });
      setUser(result.user);
      const stored = readStoredControlPlaneAuth();
      if (stored) {
        writeStoredControlPlaneAuth({
          ...stored,
          email: result.user.email,
          displayName: result.user.displayName,
        });
      }
      setMessage('Profile updated.');
    });
  }

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    if (!auth) {
      return;
    }
    await run('Create project', async () => {
      const created = await createControlPlaneProject(auth, {
        name: projectName,
        slug: slugFromName(projectName),
      });
      await refresh(auth);
      setCreatePanelOpen(null);
      setMessage(`Project "${created.project.name}" created. Select it before creating a workspace.`);
    });
  }

  async function handleCreateWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!auth || !selectedProject) {
      return;
    }
    await run('Create workspace', async () => {
      const created = await createControlPlaneWorkspace(auth, {
        projectId: selectedProject.id,
        name: workspaceName,
        slug: slugFromName(workspaceName),
      });
      const result = await fetchControlPlaneWorkspaces(auth, selectedProject.id);
      setWorkspaces(result.workspaces);
      setSelectedWorkspaceId('');
      setSessions([]);
      setSelectedSessionId('');
      setCreatePanelOpen(null);
      setMessage(`Workspace "${created.workspace.name}" created. Select it before creating a session.`);
    });
  }

  async function handleCreateSession(event: FormEvent) {
    event.preventDefault();
    if (!auth || !selectedWorkspace || !sandboxReady) {
      return;
    }
    await run('Create session', async () => {
      const created = await createControlPlaneSession(auth, selectedWorkspace.id, {
        provider: sessionProvider,
        title: sessionTitle,
      });
      const result = await fetchControlPlaneSessions(auth, selectedWorkspace.id);
      setSessions(result.sessions);
      setSelectedSessionId('');
      setCreatePanelOpen(null);
      setMessage(`Session "${created.session.title}" created. Select it before connecting.`);
    });
  }

  async function sandboxAction(action: 'start' | 'stop' | 'restart' | 'health') {
    if (!auth) {
      return;
    }
    await run(`${action} sandbox`, async () => {
      if (action === 'start') {
        setSandbox((await startControlPlaneSandbox(auth)).sandbox);
      } else if (action === 'stop') {
        setSandbox((await stopControlPlaneSandbox(auth)).sandbox);
        setRouteToken(null);
        setWorkerSocketUrl(null);
        closeWorkerSocket();
        clearRouteTokenRefreshTimer();
        setWorkerConnectionState('idle');
      } else if (action === 'restart') {
        setSandbox((await restartControlPlaneSandbox(auth)).sandbox);
        setRouteToken(null);
        setWorkerSocketUrl(null);
        closeWorkerSocket();
        clearRouteTokenRefreshTimer();
        setWorkerConnectionState('idle');
      } else {
        const health = await fetchControlPlaneSandboxHealth(auth);
        setSandbox(health.sandbox);
        setMessage(`Sandbox health is ${statusLabel(health.status.state)}.`);
      }
    });
  }

  async function handleHarnessModuleSelect(module: ControlPlaneHarnessModule) {
    setSelectedHarnessModule(module);
    if (!auth || !sandboxReady) {
      return;
    }
    setMetadataLoading((current) => ({ ...current, harness: true }));
    setHarnessError(null);
    try {
      const [tools, runs] = await Promise.all([
        fetchControlPlaneHarnessModuleTools(auth, module),
        fetchControlPlaneHarnessModuleRuns(auth, module),
      ]);
      setHarnessTools(tools);
      setHarnessRuns(runs);
    } catch (caught) {
      setHarnessTools(null);
      setHarnessRuns(null);
      setHarnessError(caught instanceof Error ? caught.message : 'Harness module refresh failed.');
    } finally {
      setMetadataLoading((current) => ({ ...current, harness: false }));
    }
  }

  async function handleInspectSandbox() {
    if (!auth || !sandbox) {
      return;
    }
    await run('Inspect sandbox', async () => {
      const detail = await fetchControlPlaneAdminSandboxDetail(auth, sandbox.id);
      setAdminSandboxDetail(detail);
      setMessage('Sandbox detail loaded.');
    });
  }

  async function handleRouteToken(
    connectionState: 'connecting' | 'reconnecting' = 'connecting',
    sessionId = selectedSessionId,
  ) {
    if (!auth || !sandbox || !sandboxReady) {
      return null;
    }
    return run('Create route token', async () => {
      const routeTokenInput: {
        projectId?: string;
        workspaceId?: string;
        sessionId?: string;
        scopes: string[];
      } = {
        scopes: ['worker:read', 'worker:write', 'session:prompt', 'provider:turn:create'],
      };
      if (selectedProject?.id) {
        routeTokenInput.projectId = selectedProject.id;
      }
      if (selectedWorkspaceId) {
        routeTokenInput.workspaceId = selectedWorkspaceId;
      }
      if (sessionId) {
        routeTokenInput.sessionId = sessionId;
      }
      const token = await createControlPlaneRouteToken(auth, sandbox.id, routeTokenInput);
      setRouteToken(token);
      scheduleRouteTokenRefresh(token);
      connectWorkerSocket(token, connectionState);
      setMessage('Route token is available in memory.');
      return token;
    });
  }

  async function refreshRouteTokenBeforeExpiry() {
    if (!auth || !sandbox || sandbox.state !== 'running' || !selectedSessionId) {
      return;
    }
    setWorkerConnectionState('reconnecting');
    const token = await handleRouteToken('reconnecting', selectedSessionId);
    if (!token) {
      setWorkerConnectionState('idle');
    }
  }

  function handleOpenSession(session: ControlPlaneSession) {
    setOpenSessionMenuId(null);
    setSelectedSessionId(session.id);
    setRouteToken(null);
    setWorkerSocketUrl(null);
    closeWorkerSocket();
    clearRouteTokenRefreshTimer();
    setWorkerConnectionState('idle');
    setInspectorTab('summary');
    setInspectorOpen(true);
  }

  function handleShowSessionDetails(session: ControlPlaneSession) {
    handleOpenSession(session);
    setInspectorOpen(true);
  }

  function handleCopySessionField(label: string, value: string | null | undefined) {
    if (!value) {
      return;
    }
    setOpenSessionMenuId(null);
    void navigator.clipboard?.writeText(value);
    setMessage(`${label} copied.`);
  }

  function startEditEntity(entity: EditableEntity, name: string) {
    setEditingEntity(entity);
    setEditingName(name);
    setOpenSessionMenuId(null);
  }

  function cancelEditEntity() {
    setEditingEntity(null);
    setEditingName('');
  }

  async function saveEditEntity(event: FormEvent) {
    event.preventDefault();
    if (!auth || !editingEntity) {
      return;
    }
    const nextName = editingName.trim();
    if (!nextName) {
      setError('Name is required.');
      return;
    }

    const entity = editingEntity;
    await run(`Rename ${entity.type}`, async () => {
      if (entity.type === 'project') {
        const result = await updateControlPlaneProject(auth, entity.id, {
          name: nextName,
          slug: slugFromName(nextName),
        });
        setProjects((current) =>
          current.map((project) => (project.id === result.project.id ? result.project : project)),
        );
      } else if (entity.type === 'workspace') {
        const result = await updateControlPlaneWorkspace(auth, entity.id, { name: nextName });
        setWorkspaces((current) =>
          current.map((workspace) =>
            workspace.id === result.workspace.id ? result.workspace : workspace,
          ),
        );
      } else {
        const result = await updateControlPlaneSession(auth, entity.id, { title: nextName });
        setSessions((current) =>
          current.map((session) => (session.id === result.session.id ? result.session : session)),
        );
      }
      cancelEditEntity();
      setMessage(`${statusLabel(entity.type)} renamed.`);
    });
  }

  function deleteDialogCopy(entity: EditableEntity | null) {
    if (!entity) {
      return {
        title: 'Delete item',
        description: 'This item will be removed from the active control plane view.',
      };
    }
    if (entity.type === 'project') {
      const target = projects.find((project) => project.id === entity.id);
      return {
        title: `Delete project ${target?.name ?? ''}`.trim(),
        description:
          'The project will be archived and removed from the active project list. Its existing workspace records remain in the control plane database.',
      };
    }
    if (entity.type === 'workspace') {
      const target = workspaces.find((workspace) => workspace.id === entity.id);
      return {
        title: `Delete workspace ${target?.name ?? ''}`.trim(),
        description:
          'The workspace will be marked deleted and removed from this project view. Sessions under it will no longer be shown from the active workspace browser.',
      };
    }
    const target = sessions.find((session) => session.id === entity.id);
    return {
      title: `Delete session ${target?.title ?? ''}`.trim(),
      description:
        'The session will be marked deleted and removed from this workspace view. This does not delete files in the sandbox workspace.',
    };
  }

  async function confirmDeleteEntity() {
    if (!auth || !pendingDelete) {
      return;
    }
    const entity = pendingDelete;
    await run(`Delete ${entity.type}`, async () => {
      if (entity.type === 'project') {
        const result = await deleteControlPlaneProject(auth, entity.id);
        setProjects((current) => current.filter((project) => project.id !== result.project.id));
        if (selectedProjectId === result.project.id) {
          setSelectedProjectId('');
          setSelectedWorkspaceId('');
          setSelectedSessionId('');
          setWorkspaces([]);
          setSessions([]);
        }
      } else if (entity.type === 'workspace') {
        const result = await updateControlPlaneWorkspace(auth, entity.id, { status: 'deleted' });
        setWorkspaces((current) =>
          current.filter((workspace) => workspace.id !== result.workspace.id),
        );
        if (selectedWorkspaceId === result.workspace.id) {
          setSelectedWorkspaceId('');
          setSelectedSessionId('');
          setSessions([]);
        }
      } else {
        const result = await updateControlPlaneSession(auth, entity.id, { status: 'deleted' });
        setSessions((current) => current.filter((session) => session.id !== result.session.id));
        if (selectedSessionId === result.session.id) {
          setSelectedSessionId('');
        }
      }
      if (editingEntity && entityKey(editingEntity) === entityKey(entity)) {
        cancelEditEntity();
      }
      setPendingDelete(null);
      setRouteToken(null);
      setWorkerSocketUrl(null);
      closeWorkerSocket();
      clearRouteTokenRefreshTimer();
      setWorkerConnectionState('idle');
      setMessage(`${statusLabel(entity.type)} deleted.`);
    });
  }

  async function handleCloseSession(session: ControlPlaneSession) {
    if (!auth || !sandboxReady) {
      return;
    }
    await run('Close session', async () => {
      const result = await closeControlPlaneSession(auth, session.id);
      setSessions((current) =>
        current.map((item) => (item.id === result.session.id ? result.session : item)),
      );
      setSelectedSessionId(result.session.id);
      setRouteToken(null);
      setWorkerSocketUrl(null);
      closeWorkerSocket();
      clearRouteTokenRefreshTimer();
      setWorkerConnectionState('idle');
      setMessage('Session finalized and disconnected.');
    });
  }

  async function handleResumeSession(session: ControlPlaneSession) {
    if (!auth || !sandboxReady) {
      return;
    }
    await run('Resume session', async () => {
      const result = await resumeControlPlaneSession(auth, session.id);
      setSessions((current) =>
        current.map((item) => (item.id === result.session.id ? result.session : item)),
      );
      setSelectedSessionId(result.session.id);
      await handleRouteToken('connecting', result.session.id);
      setMessage('Session resumed.');
      navigate(`/control-plane/sessions/${encodeURIComponent(result.session.id)}`);
    });
  }

  const topBar = (
      <ControlPlaneTopBar
        title={toolbarTitle}
        subtitle={toolbarSubtitle}
        actions={
          <>
          {sandbox ? (
            <span className={`control-status-pill ${statusTone(sandbox.state)}`}>
              {statusLabel(sandbox.state)}
            </span>
          ) : null}
          <ActionButton onClick={() => void refresh(auth)} disabled={!auth || busy === 'Load control plane'}>
            Refresh
          </ActionButton>
          <ActionButton
            onClick={() => setInspectorOpen((open) => !open)}
            ariaLabel={inspectorOpen ? 'Hide details inspector' : 'Show details inspector'}
          >
            Inspector
          </ActionButton>
          <div className="control-account-menu">
            <button
              type="button"
              className="control-avatar-button"
              onClick={() => setAccountMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-label="Open account menu"
            >
              {accountInitial}
            </button>
            {accountMenuOpen ? (
              <div className="control-account-popover" role="menu">
                <div className="control-account-identity">
                  <span className="control-avatar-badge">{accountInitial}</span>
                  <div>
                    <strong>{user?.displayName || user?.email || 'Account'}</strong>
                    <span>{user?.email ?? 'Loading account'}</span>
                  </div>
                </div>
                <dl className="control-detail-list compact two">
                  <div><dt>Status</dt><dd>{statusLabel(user?.status ?? 'loading')}</dd></div>
                  <div><dt>Plan</dt><dd>{user?.plan ?? 'developer'}</dd></div>
                  <div><dt>Quota</dt><dd>{user?.quotaProfile ?? 'default'}</dd></div>
                </dl>
                <form onSubmit={handleProfileSave} className="control-inline-form">
                  <Field label="Display name" value={profileName} onChange={setProfileName} />
                  <ActionButton type="submit" disabled={!auth || busy === 'Update profile'}>
                    Save
                  </ActionButton>
                </form>
                <div className="control-usage-grid compact">
                  <div><span>Requests</span><strong>{usage?.requestCount ?? 0}</strong></div>
                  <div><span>Tokens</span><strong>{totalTokens}</strong></div>
                  <div><span>Total cost</span><strong>${totalCostUsd.toFixed(2)}</strong></div>
                  <div><span>Harness</span><strong>{harnessUsage?.eventCount ?? 0}</strong></div>
                  <div><span>Compute</span><strong>{Number(harnessUsage?.computeUnits ?? 0).toFixed(1)}</strong></div>
                  <div><span>LLM cost</span><strong>${Number(usage?.costUsd ?? 0).toFixed(2)}</strong></div>
                  <div><span>Harness cost</span><strong>${Number(harnessUsage?.costUsd ?? 0).toFixed(2)}</strong></div>
                </div>
                <details className="control-account-disclosure">
                  <summary>Account details</summary>
                  <dl className="control-detail-list compact">
                    <CopyField label="Control plane API" value={controlPlaneBaseUrl} />
                  </dl>
                </details>
                <details className="control-account-disclosure">
                  <summary>Usage history</summary>
                  <div className="control-usage-events compact">
                    {metadataLoading.usageEvents ? (
                      <p className="control-empty">Loading LLM usage...</p>
                    ) : usageEvents.length === 0 ? (
                      <p className="control-empty">No LLM usage events yet.</p>
                    ) : (
                      usageEvents.slice(0, 4).map((event) => (
                        <div key={event.id}>
                          <strong>{event.model}</strong>
                          <span>{event.provider}, {event.inputTokens + event.outputTokens} tokens, ${Number(event.costUsd).toFixed(2)}</span>
                          <small>{event.occurredAt}</small>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="control-usage-events compact">
                    {metadataLoading.usageEvents ? (
                      <p className="control-empty">Loading Harness usage...</p>
                    ) : harnessUsageEvents.length === 0 ? (
                      <p className="control-empty">No Harness usage events yet.</p>
                    ) : (
                      harnessUsageEvents.slice(0, 4).map((event) => (
                        <div key={event.id}>
                          <strong>{event.tool ?? event.module}</strong>
                          <span>{event.module}, {event.status}, ${Number(event.costUsd).toFixed(2)}</span>
                          <small>{event.occurredAt}</small>
                        </div>
                      ))
                    )}
                  </div>
                </details>
                <ActionButton onClick={handleLogout}>
                  Sign out
                </ActionButton>
              </div>
            ) : null}
          </div>
          </>
        }
      />
  );

  const alerts = (
    <>
        {error ? <div className="control-alert danger">{error}</div> : null}
        {message ? <div className="control-alert success">{message}</div> : null}
        {gatewayUnavailable ? <div className="control-alert warning">LLM gateway unavailable: {gatewayUnavailable}</div> : null}
        {quotaExceeded ? <div className="control-alert danger">LLM quota exceeded: {quotaExceeded}</div> : null}
        {disabledAccount ? <div className="control-alert danger">Account disabled: {disabledAccount}</div> : null}
        {expiredSession ? <div className="control-alert warning">Session expired: {expiredSession}</div> : null}
        {adminUsersForbidden ? <div className="control-alert warning">Admin access denied: {adminUsersForbidden}</div> : null}
        {workerConnectionState === 'reconnecting' ? <div className="control-alert warning">Reconnecting sandbox route.</div> : null}
        {workerConnectionState === 'connecting' ? <div className="control-alert neutral">Connecting sandbox route.</div> : null}
        {sandboxOffline ? <div className="control-alert danger">Sandbox offline: {sandboxOffline}</div> : null}
        {sandboxNotice ? <div className={`control-alert ${sandboxNotice.tone}`}>{sandboxNotice.text}</div> : null}
    </>
  );

  const deleteCopy = deleteDialogCopy(pendingDelete);

  return (
    <>
    <ControlPlaneShell
      topBar={topBar}
      alerts={alerts}
      sidebar={null}
      main={null}
      inspector={null}
      inspectorOpen={inspectorOpen}
    >
        <ControlPlaneSidebar>
          <div className="control-explorer-toolbar">
            <div>
              <h2>Remote Codex</h2>
              <span>{user?.email ?? 'Product account'}</span>
            </div>
            <button
              type="button"
              className="control-icon-button"
              onClick={() => setCreatePanelOpen(createTarget)}
              aria-label={`Open create panel for ${createTargetLabel.toLowerCase()}`}
              title={`Create ${createTargetLabel.toLowerCase()}`}
            >
              +
            </button>
          </div>

          {createPanelOpen ? (
            <div className="control-create-popover">
              <div className="control-panel-heading">
                <h2>{createPanelTitle}</h2>
                <button
                  type="button"
                  className="control-icon-button quiet"
                  onClick={() => setCreatePanelOpen(null)}
                  aria-label="Close create panel"
                >
                  x
                </button>
              </div>
              {createPanelOpen === 'project' ? (
                <form onSubmit={handleCreateProject} className="control-create-form">
                  <Field label="Project name" value={projectName} onChange={setProjectName} />
                  <ActionButton type="submit" disabled={!canUseControlPlane}>
                    Create project
                  </ActionButton>
                </form>
              ) : createPanelOpen === 'workspace' ? (
                <form onSubmit={handleCreateWorkspace} className="control-create-form">
                  <Field label="Workspace name" value={workspaceName} onChange={setWorkspaceName} />
                  {createPanelBlocker ? <p className="control-rule-note">{createPanelBlocker}</p> : null}
                  <ActionButton type="submit" disabled={!canCreateWorkspace} title={workspaceCreateBlocker}>
                    Create workspace
                  </ActionButton>
                </form>
              ) : (
                <form onSubmit={handleCreateSession} className="control-create-form">
                  <Field label="Session title" value={sessionTitle} onChange={setSessionTitle} />
                  <label className="control-field">
                    <span>Provider</span>
                    <select
                      value={sessionProvider}
                      onChange={(event) => setSessionProvider(event.currentTarget.value as AgentBackendIdDto)}
                      disabled={!canCreateSession}
                    >
                      <option value="codex">Codex</option>
                      <option value="claude">Claude</option>
                      <option value="opencode">OpenCode</option>
                    </select>
                  </label>
                  {createPanelBlocker ? <p className="control-rule-note">{createPanelBlocker}</p> : null}
                  <ActionButton type="submit" disabled={!canCreateSession} title={sessionCreateBlocker}>
                    Create session
                  </ActionButton>
                </form>
              )}
            </div>
          ) : null}

          <div className="control-sidebar-body">
            <section className="control-sidebar-section">
              <div className="control-sidebar-section-title">
                <span>Workspace</span>
                <strong>{selectedWorkspace?.name ?? selectedProject?.name ?? 'Not selected'}</strong>
              </div>
              <div className="control-context-card">
                <div>
                  <span>Project</span>
                  <strong>{selectedProject?.name ?? 'Choose project'}</strong>
                </div>
                <div>
                  <span>Workspace</span>
                  <strong>{selectedWorkspace?.name ?? 'Choose workspace'}</strong>
                </div>
              </div>
            </section>

            <section className="control-sidebar-section">
              <div className="control-sidebar-section-title">
                <span>Sessions</span>
                <strong>{sessions.length}</strong>
              </div>
              <div className="control-nav-list" aria-label="Session filters">
                {sessionFilters.map((filter, index) => (
                  <button key={filter.label} type="button" className={`control-nav-row ${index === 0 ? 'selected' : ''}`}>
                    <span>{filter.label}</span>
                    <strong>{filter.value}</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="control-sidebar-section">
              <div className="control-sidebar-section-title">
                <span>System</span>
              </div>
              <div className="control-nav-list" aria-label="System navigation">
                <button
                  type="button"
                  className="control-nav-row"
                  aria-label={`Open sandbox details, ${statusLabel(sandbox?.state)}`}
                  onClick={() => {
                    setInspectorTab('summary');
                    setInspectorOpen(true);
                  }}
                >
                  <span>Sandbox</span>
                  <strong>{statusLabel(sandbox?.state)}</strong>
                </button>
                <button
                  type="button"
                  className="control-nav-row"
                  onClick={() => setAccountMenuOpen(true)}
                >
                  <span>Usage</span>
                  <strong>${totalCostUsd.toFixed(2)}</strong>
                </button>
                <button
                  type="button"
                  className="control-nav-row"
                  onClick={() => setAccountMenuOpen(true)}
                >
                  <span>Settings</span>
                  <strong>{user?.plan ?? 'dev'}</strong>
                </button>
              </div>
            </section>
          </div>

          <div className="control-explorer-tree">
            {metadataLoading.projects ? (
              <p className="control-empty">Loading projects...</p>
            ) : projects.length === 0 ? (
              <p className="control-empty">No projects yet.</p>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="control-tree-group">
                  {entityKey(editingEntity) === `project:${project.id}` ? (
                    <TreeRenameForm
                      label="Project name"
                      value={editingName}
                      onChange={setEditingName}
                      onCancel={cancelEditEntity}
                      onSubmit={saveEditEntity}
                    />
                  ) : (
                    <div className={`control-tree-item ${selectedProjectId === project.id ? 'selected' : ''}`}>
                      <button
                        type="button"
                        aria-label={`Select project ${project.name}`}
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          setSelectedWorkspaceId('');
                          setSessions([]);
                          setSelectedSessionId('');
                          setRouteToken(null);
                          setWorkerSocketUrl(null);
                          closeWorkerSocket();
                          clearRouteTokenRefreshTimer();
                          setWorkerConnectionState('idle');
                        }}
                        className="control-tree-row project"
                      >
                        <span className="control-tree-caret">
                          <TreeChevron open={selectedProjectId === project.id} />
                        </span>
                        <span className="control-tree-icon">
                          <ProjectTreeIcon />
                        </span>
                        <strong>{project.name}</strong>
                        <small>{statusLabel(project.status)}</small>
                      </button>
                      <TreeEntityActions
                        label={`project ${project.name}`}
                        onEdit={() => startEditEntity({ type: 'project', id: project.id }, project.name)}
                        onDelete={() => setPendingDelete({ type: 'project', id: project.id })}
                      />
                    </div>
                  )}

                  {selectedProjectId === project.id ? (
                    <div className="control-tree-children">
                      {metadataLoading.workspaces ? (
                        <p className="control-empty">Loading workspaces...</p>
                      ) : workspaces.length === 0 ? (
                        <p className="control-empty">No workspaces in this project.</p>
                      ) : (
                        workspaces.map((workspace) => (
                          <div key={workspace.id} className="control-tree-group">
                            {entityKey(editingEntity) === `workspace:${workspace.id}` ? (
                              <TreeRenameForm
                                label="Workspace name"
                                value={editingName}
                                onChange={setEditingName}
                                onCancel={cancelEditEntity}
                                onSubmit={saveEditEntity}
                              />
                            ) : (
                              <div className={`control-tree-item ${selectedWorkspaceId === workspace.id ? 'selected' : ''}`}>
                                <button
                                  type="button"
                                  aria-label={`Select workspace ${workspace.name}`}
                                  onClick={() => {
                                    setSelectedWorkspaceId(workspace.id);
                                    setSelectedSessionId('');
                                    setRouteToken(null);
                                    setWorkerSocketUrl(null);
                                    closeWorkerSocket();
                                    clearRouteTokenRefreshTimer();
                                    setWorkerConnectionState('idle');
                                  }}
                                  className="control-tree-row workspace"
                                >
                                  <span className="control-tree-caret">
                                    <TreeChevron open={selectedWorkspaceId === workspace.id} />
                                  </span>
                                  <span className="control-tree-icon">
                                    <WorkspaceTreeIcon />
                                  </span>
                                  <strong>{workspace.name}</strong>
                                  <small>{workspaceTreeLabel(workspace)}</small>
                                </button>
                                <TreeEntityActions
                                  label={`workspace ${workspace.name}`}
                                  onEdit={() => startEditEntity({ type: 'workspace', id: workspace.id }, workspace.name)}
                                  onDelete={() => setPendingDelete({ type: 'workspace', id: workspace.id })}
                                />
                              </div>
                            )}

                            {selectedWorkspaceId === workspace.id ? (
                              <div className="control-tree-children sessions">
                                {metadataLoading.sessions ? (
                                  <p className="control-empty">Loading sessions...</p>
                                ) : sessions.length === 0 ? (
                                  <p className="control-empty">No sessions for this workspace.</p>
                                ) : (
                                  sessions.map((session) => (
                                    <div key={session.id} className="control-tree-group">
                                      {entityKey(editingEntity) === `session:${session.id}` ? (
                                        <TreeRenameForm
                                          label="Session title"
                                          value={editingName}
                                          onChange={setEditingName}
                                          onCancel={cancelEditEntity}
                                          onSubmit={saveEditEntity}
                                        />
                                      ) : (
                                        <div className={`control-tree-item ${selectedSessionId === session.id ? 'selected' : ''}`}>
                                          <button
                                            type="button"
                                            aria-label={`Open session ${session.title} from workspace browser`}
                                            onClick={() => void handleOpenSession(session)}
                                            className="control-tree-row session"
                                          >
                                            <span className="control-tree-caret" />
                                            <span className="control-tree-icon">
                                              <SessionTreeIcon />
                                            </span>
                                            <strong>{session.title}</strong>
                                            <small>
                                              {providerLabel(session.provider)} / {statusLabel(session.status)}
                                              {session.workerSessionId ? '' : ' / Not started'}
                                            </small>
                                          </button>
                                          <TreeEntityActions
                                            label={`session ${session.title}`}
                                            onEdit={() => startEditEntity({ type: 'session', id: session.id }, session.title)}
                                            onDelete={() => setPendingDelete({ type: 'session', id: session.id })}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  ))
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </ControlPlaneSidebar>

        <main className="control-main-column">
          <section className="control-workspace-hero" aria-label="Current control plane context">
            <div>
              <span>Current workspace</span>
              <h2>{selectedWorkspace?.name ?? selectedProject?.name ?? 'Select a workspace'}</h2>
              <p>
                {selectedWorkspace
                  ? `${selectedProject?.name ?? 'Project'} · ${workspaceSourceLabel(selectedWorkspace.sourceType)}`
                  : 'Pick a project and workspace before creating sessions.'}
              </p>
            </div>
            <div className="control-workspace-hero-actions">
              <span className={`control-status-pill ${statusTone(sandbox?.state ?? 'unknown')}`}>
                {statusLabel(sandbox?.state)}
              </span>
              <ActionButton
                onClick={() => void sandboxAction('start')}
                disabled={sandboxActions.start.disabled}
                title={sandboxActions.start.title}
                ariaLabel={`Sandbox ${sandboxActions.start.label}`}
              >
                {sandboxActions.start.label}
              </ActionButton>
              <ActionButton
                onClick={() => void sandboxAction('restart')}
                disabled={sandboxActions.restart.disabled}
                title={sandboxActions.restart.title}
                ariaLabel="Sandbox restart"
              >
                {sandboxActions.restart.label}
              </ActionButton>
              <ActionButton
                onClick={() => void sandboxAction('health')}
                disabled={sandboxActions.health.disabled}
                title={sandboxActions.health.title}
                ariaLabel="Sandbox health"
              >
                {sandboxActions.health.label}
              </ActionButton>
              <ActionButton
                onClick={() => setCreatePanelOpen(createTarget)}
                disabled={createTarget === 'workspace' ? !canCreateWorkspace : createTarget === 'session' ? !canCreateSession : !canUseControlPlane}
                title={createTarget === 'workspace' ? workspaceCreateBlocker : createTarget === 'session' ? sessionCreateBlocker : undefined}
              >
                New {createTargetLabel}
              </ActionButton>
            </div>
          </section>

          <section className="control-overview-strip" aria-label="Control plane overview">
            <div>
              <span>Projects</span>
              <strong>{projects.length}</strong>
            </div>
            <div>
              <span>Workspaces</span>
              <strong>{workspaces.length}</strong>
            </div>
            <div>
              <span>Active sessions</span>
              <strong>{activeSessions}</strong>
            </div>
            <div>
              <span>Sandbox</span>
              <strong>{statusLabel(sandbox?.state)}</strong>
            </div>
          </section>

          <section className="control-panel control-session-list-panel">
            <div className="control-panel-heading">
              <h2>Sessions</h2>
              <span>
                {selectedWorkspace
                  ? `${sessions.length} in workspace`
                  : 'Select workspace'}
              </span>
            </div>
            {selectedWorkspace ? (
              <>
                {sessionCreateBlocker ? <p className="control-rule-note">{sessionCreateBlocker}</p> : null}
                {metadataLoading.sessions ? (
                  <p className="control-empty">Loading sessions...</p>
                ) : sessions.length === 0 ? (
                  <p className="control-empty">No sessions in this workspace. Start the sandbox, then create a session.</p>
                ) : (
                  <div className="control-session-list" role="list" aria-label="Workspace sessions">
                    {sessions.map((session) => (
                      <article
                        key={session.id}
                        role="listitem"
                        className={`control-session-row ${selectedSessionId === session.id ? 'selected' : ''}`}
                      >
                        <button
                          type="button"
                          aria-label={`Open session ${session.title} summary`}
                          className="control-session-row-main"
                          onClick={() => void handleOpenSession(session)}
                        >
                          <strong>{session.title}</strong>
                          <span>{providerLabel(session.provider)} · {formatRelativeTime(session.lastActivityAt ?? session.updatedAt)}</span>
                        </button>
                        <div className="control-session-row-state">
                          <SessionStatusBadge status={session.status} />
                          <span>{sessionRuntimeLabel(session)}</span>
                        </div>
                        <div className="control-session-row-actions">
                          <ActionButton
                            onClick={() => void handleResumeSession(session)}
                            disabled={!auth || !sandboxReady}
                            title={!sandboxReady ? 'Start the sandbox before opening this session.' : undefined}
                            ariaLabel={`${session.workerSessionId ? 'Resume' : 'Start'} session ${session.title} from summary`}
                          >
                            {session.workerSessionId ? 'Resume' : 'Start'}
                          </ActionButton>
                          <div className="control-row-menu">
                            <button
                              type="button"
                              className="control-row-menu-trigger"
                              aria-label={`More actions for session ${session.title}`}
                              aria-haspopup="menu"
                              aria-expanded={openSessionMenuId === session.id}
                              onClick={() =>
                                setOpenSessionMenuId((current) => (current === session.id ? null : session.id))
                              }
                            >
                              ...
                            </button>
                            {openSessionMenuId === session.id ? (
                              <div className="control-row-menu-popover" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => handleShowSessionDetails(session)}
                                >
                                  Show details
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => handleCopySessionField('Session ID', session.id)}
                                >
                                  Copy session ID
                                </button>
                                {session.sandboxId ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => handleCopySessionField('Sandbox ID', session.sandboxId)}
                                  >
                                    Copy sandbox ID
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={!auth || !session.workerSessionId || !sandboxReady}
                                  title={!session.workerSessionId ? 'Session has not been started yet.' : undefined}
                                  onClick={() => {
                                    setOpenSessionMenuId(null);
                                    void handleCloseSession(session);
                                  }}
                                >
                                  Close session
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <div className="control-action-row start">
                  <ActionButton
                    onClick={() => setCreatePanelOpen('session')}
                    disabled={!canCreateSession}
                    title={sessionCreateBlocker}
                  >
                    Create session
                  </ActionButton>
                </div>
              </>
            ) : (
              <p className="control-empty">Choose a workspace from the browser to see its sessions.</p>
            )}
          </section>

          <section className="control-panel control-selected-panel control-context-summary-panel">
            <div className="control-panel-heading">
              <h2>{selectedSession ? 'Selected session' : selectedWorkspace ? 'Workspace context' : selectedProject ? 'Project context' : 'Selection'}</h2>
              <span>
                {selectedSession
                  ? statusLabel(selectedSession.status)
                  : selectedWorkspace
                    ? workspaceSourceLabel(selectedWorkspace.sourceType)
                    : selectedProject
                      ? statusLabel(selectedProject.status)
                      : 'Root'}
              </span>
            </div>

            {selectedSession ? (
              <>
                <dl className="control-detail-list compact summary">
                  <div><dt>Title</dt><dd>{selectedSession.title}</dd></div>
                  <div><dt>Provider</dt><dd>{providerLabel(selectedSession.provider)}</dd></div>
                  <div><dt>Status</dt><dd><span className={`control-status-pill compact ${statusTone(selectedSession.status)}`}>{statusLabel(selectedSession.status)}</span></dd></div>
                  <div><dt>Last activity</dt><dd>{formatRelativeTime(selectedSessionActivity)}</dd></div>
                  <div><dt>Sandbox</dt><dd>{sandboxReady ? 'Ready' : statusLabel(sandbox?.state)}</dd></div>
                  <div><dt>Runtime</dt><dd>{sessionRuntimeLabel(selectedSession)}</dd></div>
                </dl>
                <div className="control-action-row start">
                  <ActionButton
                    onClick={() => void handleResumeSession(selectedSession)}
                    disabled={!auth || !sandboxReady}
                    title={!sandboxReady ? 'Start the sandbox before opening this session.' : undefined}
                    ariaLabel={`${selectedSession.workerSessionId ? 'Resume' : 'Start'} session ${selectedSession.title} from detail`}
                  >
                    {selectedSession.workerSessionId ? 'Resume' : 'Start sandbox session'}
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      setInspectorTab('metadata');
                      setInspectorOpen(true);
                    }}
                  >
                    Details
                  </ActionButton>
                </div>
              </>
            ) : selectedWorkspace ? (
              <>
                <dl className="control-detail-list compact summary">
                  <div><dt>Workspace</dt><dd>{selectedWorkspace.name}</dd></div>
                  <div><dt>Project</dt><dd>{selectedProject?.name ?? selectedWorkspace.projectId}</dd></div>
                  <div><dt>Source</dt><dd>{workspaceSourceLabel(selectedWorkspace.sourceType)}</dd></div>
                  <div><dt>Sessions</dt><dd>{sessions.length}</dd></div>
                  <div><dt>Active</dt><dd>{activeSessions}</dd></div>
                  <div><dt>Not started</dt><dd>{sessionsNeedingStart}</dd></div>
                  <div><dt>Sandbox</dt><dd>{statusLabel(sandbox?.state)}</dd></div>
                </dl>
              </>
            ) : selectedProject ? (
              <>
                <dl className="control-detail-list compact summary">
                  <div><dt>Selected project</dt><dd>{selectedProject.name}</dd></div>
                  <div><dt>Status</dt><dd>{statusLabel(selectedProject.status)}</dd></div>
                  <div><dt>Workspaces</dt><dd>{workspaces.length}</dd></div>
                  <div><dt>Path</dt><dd>{selectedPath}</dd></div>
                </dl>
                <div className="control-action-row start">
                  <ActionButton
                    onClick={() => setCreatePanelOpen('workspace')}
                    disabled={!canCreateWorkspace}
                    title={workspaceCreateBlocker}
                  >
                    Create workspace
                  </ActionButton>
                </div>
              </>
            ) : (
              <p className="control-empty">Select a project to open the workspace hierarchy.</p>
            )}
          </section>

        </main>

        {inspectorOpen ? (
          <button
            type="button"
            className="control-inspector-scrim"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setInspectorOpen(false)}
          />
        ) : null}
        <ControlPlaneInspector
          eyebrow={selectedSession ? 'Session' : selectedWorkspace ? 'Workspace' : selectedProject ? 'Project' : 'Sandbox'}
          hidden={!inspectorOpen}
          onClose={() => setInspectorOpen(false)}
        >

            <div className="control-inspector-tabs" role="tablist" aria-label="Inspector sections">
              {(['summary', 'metadata', 'route', 'logs'] as InspectorTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === tab}
                  className={inspectorTab === tab ? 'selected' : ''}
                  onClick={() => setInspectorTab(tab)}
                >
                  {tab === 'summary' ? 'Summary' : tab === 'metadata' ? 'Metadata' : tab === 'route' ? 'Route' : 'Logs'}
                </button>
              ))}
            </div>

            {inspectorTab === 'summary' ? (
              <div className="control-inspector-tab-panel" role="tabpanel">
                <div className="control-inspector-section">
                  <div className="control-panel-heading compact">
                    <h2>Sandbox</h2>
                    {sandbox ? <span>{sandbox.resourceProfile}</span> : null}
                  </div>
                  {sandbox ? (
                    <dl className="control-detail-list compact summary">
                      <div><dt>State</dt><dd><span className={`control-status-pill compact ${statusTone(sandbox.state)}`}>{statusLabel(sandbox.state)}</span></dd></div>
                      <div><dt>Stage</dt><dd>{sandboxProgressLabel}</dd></div>
                      <div><dt>Health</dt><dd>{sandboxHealthSummary}</dd></div>
                      <div><dt>Last seen</dt><dd>{formatRelativeTime(sandboxActivity)}</dd></div>
                    </dl>
                  ) : (
                    <p className="control-empty">Loading sandbox registry.</p>
                  )}
                </div>
                <div className="control-action-row">
                  <ActionButton
                    onClick={() => void sandboxAction('stop')}
                    disabled={sandboxActions.stop.disabled}
                    title={sandboxActions.stop.title}
                  >
                    {sandboxActions.stop.label}
                  </ActionButton>
                  <ActionButton
                    onClick={handleInspectSandbox}
                    disabled={sandboxActions.inspect.disabled}
                    title={sandboxActions.inspect.title}
                  >
                    {sandboxActions.inspect.label}
                  </ActionButton>
                </div>
                {sandbox && typeof sandbox.startupProgress === 'number' && sandbox.startupProgress > 0 && sandbox.startupProgress < 100 ? (
                  <div className="control-progress">
                    <span>{sandboxProgressLabel}</span>
                    <span>{sandbox.startupProgress}%</span>
                    <div><i style={{ width: `${sandbox.startupProgress}%` }} /></div>
                  </div>
                ) : null}
                {selectedSession || selectedWorkspace || selectedProject ? (
                  <div className="control-inspector-section">
                    <div className="control-panel-heading compact">
                      <h2>{selectedSession ? 'Session' : selectedWorkspace ? 'Workspace' : 'Project'}</h2>
                      <span>{selectedSession ? statusLabel(selectedSession.status) : selectedWorkspace ? workspaceSourceLabel(selectedWorkspace.sourceType) : statusLabel(selectedProject?.status)}</span>
                    </div>
                    <dl className="control-detail-list compact summary">
                      {selectedSession ? (
                        <>
                          <div><dt>Title</dt><dd>{selectedSession.title}</dd></div>
                          <div><dt>Provider</dt><dd>{providerLabel(selectedSession.provider)}</dd></div>
                          <div><dt>Runtime</dt><dd>{sessionRuntimeLabel(selectedSession)}</dd></div>
                        </>
                      ) : selectedWorkspace ? (
                        <>
                          <div><dt>Workspace</dt><dd>{selectedWorkspace.name}</dd></div>
                          <div><dt>Sessions</dt><dd>{sessions.length}</dd></div>
                          <div><dt>Active</dt><dd>{activeSessions}</dd></div>
                        </>
                      ) : selectedProject ? (
                        <>
                          <div><dt>Project</dt><dd>{selectedProject.name}</dd></div>
                          <div><dt>Workspaces</dt><dd>{workspaces.length}</dd></div>
                          <div><dt>Status</dt><dd>{statusLabel(selectedProject.status)}</dd></div>
                        </>
                      ) : null}
                    </dl>
                  </div>
                ) : (
                  <div className="control-inspector-empty">
                    <strong>No object selected</strong>
                    <span>Select a project, workspace, or session to inspect its metadata.</span>
                  </div>
                )}
                <div className="control-inspector-section">
                  <div className="control-panel-heading compact">
                    <h2>Harness</h2>
                    <span className={`control-status-pill ${harnessTone(harnessStatusText)}`}>
                      {statusLabel(harnessStatusText)}
                    </span>
                  </div>
                  {!sandboxReady ? (
                    <p className="control-empty">Start the sandbox to inspect Harness tools.</p>
                  ) : (
                    <>
                      <div className="control-action-row">
                        <ActionButton
                          onClick={() => void refreshHarness(auth, selectedHarnessModule)}
                          disabled={!auth || metadataLoading.harness}
                        >
                          {metadataLoading.harness ? 'Checking...' : 'Refresh'}
                        </ActionButton>
                      </div>
                      {harnessError ? (
                        <div className="control-alert warning">Harness unavailable: {harnessError}</div>
                      ) : null}
                      <dl className="control-detail-list compact summary">
                        <div><dt>Key</dt><dd>{harnessStatus?.keyPresent ? 'Present' : 'Not present'}</dd></div>
                        <div><dt>Chemistry</dt><dd>{harnessStatus?.chemistryToolsEnabled ? 'Enabled' : 'Disabled'}</dd></div>
                        <div><dt>Health</dt><dd>{harnessStatus?.health ? 'OK' : 'Not available'}</dd></div>
                        <div><dt>Module</dt><dd>{HARNESS_MODULE_LABELS[selectedHarnessModule]}</dd></div>
                        <div><dt>Tools</dt><dd>{harnessToolItems.length || 'folder index'}</dd></div>
                        <div><dt>Runs</dt><dd>{harnessRunItems.length || 'history available'}</dd></div>
                      </dl>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {inspectorTab === 'metadata' ? (
              <div className="control-inspector-tab-panel" role="tabpanel">
                {selectedSession ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Session metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Session ID" value={selectedSession.id} />
                      <CopyField label="Worker session" value={selectedSession.workerSessionId} />
                      <CopyField label="Workspace ID" value={selectedSession.workspaceId} />
                      <CopyField label="Sandbox ID" value={selectedSession.sandboxId} />
                      <div><dt>Created</dt><dd>{selectedSession.createdAt}</dd></div>
                      <div><dt>Updated</dt><dd>{selectedSession.updatedAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
                {selectedWorkspace ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Workspace metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Workspace ID" value={selectedWorkspace.id} />
                      <CopyField label="Project ID" value={selectedWorkspace.projectId} />
                      <CopyField label="Path" value={selectedWorkspace.path} />
                      <div><dt>Slug</dt><dd>{selectedWorkspace.slug}</dd></div>
                      <div><dt>Created</dt><dd>{selectedWorkspace.createdAt}</dd></div>
                      <div><dt>Updated</dt><dd>{selectedWorkspace.updatedAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
                {selectedProject ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Project metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Project ID" value={selectedProject.id} />
                      <div><dt>Slug</dt><dd>{selectedProject.slug}</dd></div>
                      <div><dt>Created</dt><dd>{selectedProject.createdAt}</dd></div>
                      <div><dt>Updated</dt><dd>{selectedProject.updatedAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
                {sandbox ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Sandbox metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Sandbox ID" value={sandbox.id} />
                      <CopyField label="Image" value={sandbox.image} />
                      <CopyField label="Worker ID" value={sandbox.workerServiceName} />
                      <CopyField label="S3 prefix" value={sandbox.s3Prefix} />
                      {sandbox.statusReason ? <div><dt>Status</dt><dd>{sandbox.statusReason}</dd></div> : null}
                      {sandbox.lastFailureCode ? <div><dt>Failure</dt><dd>{sandbox.lastFailureCode}</dd></div> : null}
                      {sandbox.lastFailureMessage ? <div><dt>Failure message</dt><dd>{sandbox.lastFailureMessage}</dd></div> : null}
                      <div><dt>Created</dt><dd>{sandbox.createdAt}</dd></div>
                      <div><dt>Updated</dt><dd>{sandbox.updatedAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
              </div>
            ) : null}

            {inspectorTab === 'route' ? (
              <div className="control-inspector-tab-panel" role="tabpanel">
                <section className="control-inspector-section">
                  <div className="control-panel-heading compact">
                    <h2>Route</h2>
                    <ActionButton
                      onClick={() => void handleRouteToken('connecting', selectedSessionId)}
                      disabled={!sandboxReady || !selectedSession}
                      title={sessionConnectBlocker}
                    >
                      Create route token
                    </ActionButton>
                  </div>
                  {routeToken ? (
                    <dl className="control-detail-list compact summary route-token">
                      <div><dt>Session</dt><dd>{selectedSession?.title ?? selectedSessionId}</dd></div>
                      <div><dt>Connection</dt><dd>{connectionLabel(workerConnectionState)}</dd></div>
                      <div><dt>Token</dt><dd>{formatRelativeTime(routeToken.expiresAt)} expiry</dd></div>
                    </dl>
                  ) : (
                    <p className="control-empty">
                      {selectedSession ? `Selected session: ${selectedSession.title}. Create a route token after the sandbox is running.` : 'Select a session before creating a route token.'}
                    </p>
                  )}
                </section>
                {routeToken ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Route metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Router URL" value={routeToken.routerBaseUrl} />
                      <CopyField label="WebSocket URL" value={routeToken.wsBaseUrl} />
                      <CopyField label="Worker socket" value={workerSocketUrl} />
                      <div><dt>Connection</dt><dd>{connectionLabel(workerConnectionState)}</dd></div>
                      <div><dt>Expires</dt><dd>{routeToken.expiresAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
              </div>
            ) : null}

            {inspectorTab === 'logs' ? (
              <div className="control-inspector-tab-panel" role="tabpanel">
                <section className="control-inspector-section">
                  <div className="control-panel-heading compact">
                    <h2>Harness details</h2>
                    <span className={`control-status-pill ${harnessTone(harnessStatusText)}`}>
                      {statusLabel(harnessStatusText)}
                    </span>
                  </div>
                  {sandboxReady ? (
                    <>
                      <div className="control-segment-row" role="tablist" aria-label="Harness modules">
                        {harnessModules.map((module) => (
                          <button
                            key={module}
                            type="button"
                            role="tab"
                            aria-selected={selectedHarnessModule === module}
                            className={selectedHarnessModule === module ? 'selected' : ''}
                            onClick={() => void handleHarnessModuleSelect(module)}
                            disabled={metadataLoading.harness || !harnessStatus?.enabled || !harnessStatus.keyPresent}
                          >
                            {HARNESS_MODULE_LABELS[module]}
                          </button>
                        ))}
                      </div>
                      <dl className="control-detail-list">
                        <CopyField label="Base URL" value={harnessStatus?.baseUrl} />
                        <div><dt>Enabled</dt><dd>{harnessStatus?.enabled ? 'yes' : 'no'}</dd></div>
                        <div><dt>Modules</dt><dd>{harnessModules.map((module) => HARNESS_MODULE_LABELS[module]).join(', ')}</dd></div>
                      </dl>
                      <div className="control-usage-events compact">
                        <div>
                          <strong>{HARNESS_MODULE_LABELS[selectedHarnessModule]} tools</strong>
                          <small>{harnessToolItems.length} advertised</small>
                        </div>
                        {harnessToolItems.slice(0, 5).map((item, index) => (
                          <div key={`${selectedHarnessModule}-tool-${index}`}>
                            <strong>{payloadItemLabel(item, `tool-${index + 1}`)}</strong>
                            <span>{payloadItemMeta(item) || 'tool'}</span>
                          </div>
                        ))}
                        {harnessToolItems.length === 0 && harnessToolsPreview ? (
                          <div><span>{harnessToolsPreview.slice(0, 180)}</span></div>
                        ) : null}
                        {harnessToolItems.length === 0 && !harnessToolsPreview ? (
                          <p className="control-empty">No tools reported for this module.</p>
                        ) : null}
                      </div>
                      <div className="control-usage-events compact">
                        <div>
                          <strong>Recent runs</strong>
                          <small>{harnessRunItems.length} reported</small>
                        </div>
                        {harnessRunItems.slice(0, 4).map((item, index) => (
                          <div key={`${selectedHarnessModule}-run-${index}`}>
                            <strong>{payloadItemLabel(item, `run-${index + 1}`)}</strong>
                            <span>{payloadItemMeta(item) || 'run'}</span>
                          </div>
                        ))}
                        {harnessRunItems.length === 0 && harnessRunsPreview ? (
                          <div><span>{harnessRunsPreview.slice(0, 180)}</span></div>
                        ) : null}
                        {harnessRunItems.length === 0 && !harnessRunsPreview ? (
                          <p className="control-empty">No runs reported yet.</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="control-empty">Start the sandbox to inspect Harness tools.</p>
                  )}
                </section>
                {adminSandboxDetail ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact">
                      <h2>Admin inspection</h2>
                      <span>{statusLabel(adminSandboxDetail.runtimeStatus.state)}</span>
                    </div>
                    <dl className="control-detail-list">
                      <div><dt>Namespace</dt><dd>{adminSandboxDetail.sandbox.k8sNamespace ?? adminSandboxDetail.runtimeStatus.k8sNamespace ?? 'not assigned'}</dd></div>
                      <div><dt>Pod</dt><dd>{adminSandboxDetail.sandbox.k8sPodName ?? adminSandboxDetail.runtimeStatus.k8sPodName ?? 'not assigned'}</dd></div>
                      <div><dt>Endpoint</dt><dd>{adminSandboxDetail.endpoint.routerBaseUrl ?? 'not assigned'}</dd></div>
                      <div><dt>Worker URL</dt><dd>{adminSandboxDetail.workerBaseUrl ?? 'not assigned'}</dd></div>
                    </dl>
                    {adminSandboxDetail.runtimeStatus.statusReason ? (
                      <p className="control-empty">{adminSandboxDetail.runtimeStatus.statusReason}</p>
                    ) : null}
                    <div className="control-usage-events">
                      {adminSandboxDetail.recentLifecycleErrors.length === 0 ? (
                        <p className="control-empty">No lifecycle audit entries.</p>
                      ) : (
                        adminSandboxDetail.recentLifecycleErrors.slice(0, 5).map((entry) => (
                          <div key={entry.id}>
                            <strong>{entry.action}</strong>
                            <small>{entry.createdAt}</small>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                ) : (
                  <div className="control-inspector-empty">
                    <strong>No admin inspection loaded</strong>
                    <span>Use Inspect from Summary to load sandbox runtime diagnostics.</span>
                  </div>
                )}
              </div>
            ) : null}
        </ControlPlaneInspector>
    </ControlPlaneShell>
    <ConfirmDialog
      open={Boolean(pendingDelete)}
      title={deleteCopy.title}
      description={deleteCopy.description}
      confirmLabel="Delete"
      busy={Boolean(busy?.startsWith('Delete '))}
      onCancel={() => setPendingDelete(null)}
      onConfirm={confirmDeleteEntity}
    />
    </>
  );
}
