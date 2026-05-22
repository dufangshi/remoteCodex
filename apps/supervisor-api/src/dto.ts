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
  approvalMode: ApprovalMode | null | undefined,
): SandboxModeDto {
  return approvalMode === 'guarded' ? 'workspace-write' : 'danger-full-access';
}

export function normalizeSandboxMode(
  value: string | null | undefined,
): SandboxModeDto | null {
  switch (value) {
    case 'read-only':
    case 'workspace-write':
    case 'danger-full-access':
      return value;
    default:
      return null;
  }
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
  const failedTurn = 'turns' in remoteSession
    ? remoteSession.turns.find((turn) => turn.status === 'failed')
    : null;
  return {
    provider: remoteSession.provider,
    providerSessionId: remoteSession.providerSessionId,
    status: remoteSession.status,
    summaryText: remoteSession.preview || null,
    model: model ?? null,
    reasoningEffort: normalizeReasoningEffort(reasoningEffort),
    lastError: failedTurn?.error?.message ?? null,
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
    status: (record.status ?? 'idle') as ThreadStatusDto,
    summaryText: record.summaryText ?? null,
    lastError: record.lastError ?? null,
    activeTurnId: record.providerTurnId ?? null,
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
