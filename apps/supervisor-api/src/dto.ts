import type {
  AgentSessionDetail,
  AgentSessionSummary,
} from '../../../packages/agent-runtime/src/index';
import type {
  ApprovalMode,
  CollaborationModeDto,
  SandboxModeDto,
  ThreadContextUsageDto,
  ThreadDto,
  ThreadSourceDto,
  ThreadStatusDto,
  WorkspaceDto,
} from '../../../packages/shared/src/index';
import { normalizeReasoningEffort } from './thread-provider-runtime-coordinator';

export function toWorkspaceDto(record: {
  id: string;
  hostId: string;
  label: string;
  absPath: string;
  isFavorite: boolean;
  createdAt: string;
  lastOpenedAt: string | null;
}): WorkspaceDto {
  return {
    id: record.id,
    hostId: record.hostId,
    label: record.label,
    absPath: record.absPath,
    isFavorite: record.isFavorite,
    createdAt: record.createdAt,
    lastOpenedAt: record.lastOpenedAt,
  };
}

export function defaultSandboxModeForApprovalMode(
  _approvalMode: ApprovalMode | null | undefined,
): SandboxModeDto {
  return 'danger-full-access';
}

export function normalizeSandboxMode(
  _value: string | null | undefined,
): SandboxModeDto | null {
  return 'danger-full-access';
}

export function normalizeCollaborationMode(
  value: string | null | undefined,
): CollaborationModeDto {
  return value === 'plan' ? 'plan' : 'default';
}

export function buildThreadPatch(
  remoteSession: AgentSessionSummary | AgentSessionDetail,
  model: string | null | undefined,
  reasoningEffort: string | null | undefined,
) {
  const latestTurn = 'turns' in remoteSession
    ? remoteSession.turns.at(-1) ?? null
    : null;
  const latestStatus =
    latestTurn?.status === 'failed'
      ? 'failed'
      : latestTurn?.status === 'interrupted'
        ? 'interrupted'
        : remoteSession.status;
  return {
    provider: remoteSession.provider,
    providerSessionId: remoteSession.providerSessionId,
    status: latestStatus,
    summaryText: remoteSession.preview || null,
    model: model ?? null,
    reasoningEffort: normalizeReasoningEffort(reasoningEffort),
    lastError: latestTurn?.status === 'failed'
      ? latestTurn.error?.message ?? 'Turn failed.'
      : null,
    updatedAt: remoteSession.updatedAt ?? new Date().toISOString(),
  };
}

export function toThreadDto(
  record: {
    id: string;
    workspaceId: string;
    provider?: string | null;
    providerSessionId?: string | null;
    source?: string | null;
    title: string;
    model?: string | null;
    reasoningEffort?: string | null;
    fastMode?: unknown;
    collaborationMode?: string | null;
    approvalMode?: string | null;
    sandboxMode?: string | null;
    status?: string | null;
    summaryText?: string | null;
    lastError?: string | null;
    providerTurnId?: string | null;
    isConnected?: boolean | null;
    isPinned: boolean;
    createdAt: string;
    updatedAt: string;
    lastTurnStartedAt?: string | null;
    lastTurnCompletedAt?: string | null;
  },
  loadedIds: Set<string>,
  callbacks: {
    fastModeForProvider(provider: string | null | undefined, fastMode: unknown): boolean;
    getThreadContextUsage(localThreadId: string): ThreadContextUsageDto;
  },
): ThreadDto {
  const status = (record.status ?? 'idle') as ThreadStatusDto;
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    provider: (record.provider ?? 'codex') as ThreadDto['provider'],
    providerSessionId: record.providerSessionId ?? null,
    source: (record.source ?? 'supervisor') as ThreadSourceDto,
    title: record.title,
    model: record.model ?? null,
    reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
    fastMode: callbacks.fastModeForProvider(record.provider, record.fastMode),
    collaborationMode: normalizeCollaborationMode(record.collaborationMode),
    approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
    sandboxMode:
      normalizeSandboxMode(record.sandboxMode) ??
      defaultSandboxModeForApprovalMode((record.approvalMode ?? 'yolo') as ApprovalMode),
    status,
    summaryText: record.summaryText ?? null,
    lastError: record.lastError ?? null,
    activeTurnId: status === 'running' ? record.providerTurnId ?? null : null,
    isLoaded:
      record.isConnected !== false &&
      (record.providerSessionId ? loadedIds.has(record.providerSessionId) : false),
    isPinned: record.isPinned,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastTurnStartedAt: record.lastTurnStartedAt ?? null,
    lastTurnCompletedAt: record.lastTurnCompletedAt ?? null,
    contextUsage: callbacks.getThreadContextUsage(record.id),
  };
}
