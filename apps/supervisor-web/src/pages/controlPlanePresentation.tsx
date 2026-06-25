import { type FormEvent, type ReactNode } from 'react';

import type {
  ControlPlaneHarnessModule,
  ControlPlaneHarnessPayload,
  ControlPlaneHarnessStatus,
  ControlPlaneSandbox,
  ControlPlaneSession,
  ControlPlaneWorkspace,
} from '../lib/api';

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

export {
  ActionButton,
  CopyField,
  Field,
  HARNESS_MODULE_LABELS,
  MetadataDisclosure,
  ProjectTreeIcon,
  SessionStatusBadge,
  SessionTreeIcon,
  TreeChevron,
  TreeEntityActions,
  TreeRenameForm,
  WorkspaceTreeIcon,
  connectionLabel,
  entityKey,
  formatRelativeTime,
  harnessState,
  harnessTone,
  payloadItemLabel,
  payloadItemMeta,
  payloadItems,
  payloadPreview,
  providerLabel,
  sandboxActionPresentation,
  sandboxBanner,
  sandboxHealthLabel,
  sandboxStageLabel,
  sessionRuntimeLabel,
  slugFromName,
  statusLabel,
  statusTone,
  workspaceSourceLabel,
  workspaceTreeLabel,
};

export type {
  CreatePanelKind,
  EditableEntity,
  InspectorTab,
  SandboxActionPresentation,
  SandboxLifecycleAction,
};
