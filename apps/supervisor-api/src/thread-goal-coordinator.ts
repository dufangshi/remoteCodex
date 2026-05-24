import type {
  AgentGoal,
  AgentRuntime,
} from '../../../packages/agent-runtime/src/index';
import {
  listThreadGoalRecordsByThreadId,
  markActiveThreadGoalRecordTerminated,
  upsertThreadGoalRecord,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import type {
  ThreadEventPayloadMap,
  ThreadGoalDto,
  UpdateThreadGoalInput,
} from '../../../packages/shared/src/index';
import { HttpError } from './app';

type UpstreamThreadGoalStatus = Exclude<ThreadGoalDto['status'], 'terminated'>;
type NormalizedThreadGoal = ThreadGoalDto;

export interface ThreadGoalRecordContext {
  id: string;
  providerSessionId: string | null;
  provider?: string | null;
  model?: string | null;
  sandboxMode?: string | null;
  approvalMode?: string | null;
  providerTurnId?: string | null;
  status?: string | null;
  isConnected?: boolean | null;
}

interface ThreadGoalCoordinatorCallbacks {
  emitThreadEvent<Type extends 'thread.goal.updated' | 'thread.goal.cleared'>(
    type: Type,
    threadId: string,
    payload: ThreadEventPayloadMap[Type],
  ): void;
  ensureThreadLoaded(record: ThreadGoalRecordContext): Promise<void>;
  requireProviderSessionId(record: { providerSessionId?: string | null }): string;
  runtimeForProvider(provider: string | null | undefined): AgentRuntime;
}

export interface ThreadGoalFeatureManagement {
  mapGoalError(error: unknown): never;
  ensureGoalsFeatureEnabled(provider: string | null | undefined): Promise<void>;
  isRuntimeRequestError(error: unknown): boolean;
}

export class ThreadGoalCoordinator {
  constructor(
    private readonly db: DatabaseClient,
    private readonly goalFeatureManagement: ThreadGoalFeatureManagement,
    private readonly callbacks: ThreadGoalCoordinatorCallbacks,
  ) {}

  async getThreadGoal(
    record: ThreadGoalRecordContext,
  ): Promise<ThreadGoalDto | null> {
    this.callbacks.requireProviderSessionId(record);

    return await this.getThreadGoalForRecord(record, { allowEnableFeature: true }) ??
      localGoalSnapshotForFallback(this.listThreadGoalHistory(record.id));
  }

  async updateThreadGoal(
    record: ThreadGoalRecordContext,
    input: UpdateThreadGoalInput,
  ): Promise<ThreadGoalDto | null> {
    const providerSessionId = this.callbacks.requireProviderSessionId(record);

    if (record.isConnected === false) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Connect this thread before changing its goal.',
      });
    }

    const runtime = this.callbacks.runtimeForProvider(record.provider);
    if (!runtime.setGoal || !runtime.capabilities.controls.goals) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support goals.',
      });
    }

    try {
      await this.ensureGoalsFeatureEnabled(record.provider);
      await this.callbacks.ensureThreadLoaded(record);
      const activeGoal = this.listThreadGoalHistory(record.id).find((goal) =>
        ['active', 'paused', 'budgetLimited'].includes(goal.status),
      ) ?? null;
      const creatingNewGoal = goalObjectiveChanged(activeGoal, input.objective);
      if (creatingNewGoal) {
        markActiveThreadGoalRecordTerminated(this.db, record.id);
      }
      if (input.status === 'terminated') {
        const terminatedGoal = markActiveThreadGoalRecordTerminated(this.db, record.id);
        const goalHistory = this.listThreadGoalHistory(record.id);
        const goal = terminatedGoal ? toThreadGoalDtoFromRecord(terminatedGoal) : goalHistory[0] ?? null;
        this.callbacks.emitThreadEvent('thread.goal.updated', record.id, {
          goal,
          goalHistory,
        });
        return goal;
      }
      const upstreamStatus =
        input.status as UpstreamThreadGoalStatus | null | undefined;
      const goal = await runtime.setGoal({
        providerSessionId,
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(upstreamStatus !== undefined ? { status: upstreamStatus } : {}),
        ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
      });
      const upstreamDto = normalizeThreadGoalStatusForThread(
        toThreadGoalDtoFromAgentGoal(goal),
        record,
      );
      const dto = creatingNewGoal ? resetGoalProgress(upstreamDto) : upstreamDto;
      const persistedGoal = toThreadGoalDtoFromRecord(
        this.persistThreadGoalSnapshot(record.id, dto),
      );
      this.callbacks.emitThreadEvent('thread.goal.updated', record.id, {
        goal: persistedGoal,
        goalHistory: this.listThreadGoalHistory(record.id),
      });
      return persistedGoal;
    } catch (error) {
      this.goalFeatureManagement.mapGoalError(error);
    }
  }

  async clearThreadGoal(
    record: ThreadGoalRecordContext,
  ): Promise<{ cleared: boolean; goalHistory: ThreadGoalDto[] }> {
    const providerSessionId = this.callbacks.requireProviderSessionId(record);

    if (record.isConnected === false) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Connect this thread before clearing its goal.',
      });
    }

    const runtime = this.callbacks.runtimeForProvider(record.provider);
    if (!runtime.clearGoal || !runtime.capabilities.controls.goals) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support goals.',
      });
    }

    try {
      await this.ensureGoalsFeatureEnabled(record.provider);
      await this.callbacks.ensureThreadLoaded(record);
      const cleared = await runtime.clearGoal(providerSessionId);
      markActiveThreadGoalRecordTerminated(this.db, record.id);
      const goalHistory = this.listThreadGoalHistory(record.id);
      this.callbacks.emitThreadEvent('thread.goal.cleared', record.id, { goalHistory });
      return { cleared, goalHistory };
    } catch (error) {
      this.goalFeatureManagement.mapGoalError(error);
    }
  }

  async getThreadGoalForRecord(
    record: ThreadGoalRecordContext,
    options: { allowEnableFeature?: boolean } = {},
  ): Promise<ThreadGoalDto | null> {
    if (!record.providerSessionId) {
      return null;
    }

    try {
      if (options.allowEnableFeature) {
        await this.ensureGoalsFeatureEnabled(record.provider);
        await this.callbacks.ensureThreadLoaded(record);
      }
      const runtime = this.callbacks.runtimeForProvider(record.provider);
      if (!runtime.getGoal || !runtime.capabilities.controls.goals) {
        return null;
      }
      const goal = await runtime.getGoal(record.providerSessionId);
      if (!goal) {
        return null;
      }

      const dto = normalizeThreadGoalStatusForThread(toThreadGoalDtoFromAgentGoal(goal), record);
      const localGoal = localGoalSnapshotToPreserve(
        this.listThreadGoalHistory(record.id),
        dto,
      );
      if (localGoal) {
        return localGoal;
      }
      return toThreadGoalDtoFromRecord(this.persistThreadGoalSnapshot(record.id, dto));
    } catch (error) {
      if (this.goalFeatureManagement.isRuntimeRequestError(error)) {
        return null;
      }
      throw error;
    }
  }

  persistThreadGoalSnapshot(
    localThreadId: string,
    goal: ThreadGoalDto | Parameters<typeof toThreadGoalDto>[0],
  ) {
    const dto =
      'createdAt' in goal && typeof goal.createdAt === 'string'
        ? (goal as ThreadGoalDto)
        : toThreadGoalDto(goal as Parameters<typeof toThreadGoalDto>[0]);
    return upsertThreadGoalRecord(this.db, {
      threadId: localThreadId,
      providerSessionId: dto.threadId,
      localGoalId: dto.localGoalId ?? null,
      objective: dto.objective,
      status: dto.status,
      tokenBudget: dto.tokenBudget,
      tokensUsed: dto.tokensUsed,
      timeUsedSeconds: dto.timeUsedSeconds,
      startedAt: dto.createdAt,
      completedAt: dto.completedAt ?? null,
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
    });
  }

  listThreadGoalHistory(localThreadId: string): ThreadGoalDto[] {
    const deduped = new Map<string, ThreadGoalDto>();
    for (const goal of listThreadGoalRecordsByThreadId(this.db, localThreadId).map(
      toThreadGoalDtoFromRecord,
    )) {
      const key = goalHistoryKey(goal);
      const existing = deduped.get(key);
      deduped.set(key, existing ? mergeGoalHistoryEntry(existing, goal) : goal);
    }
    return [...deduped.values()].sort(
      (left, right) => {
        const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
        if (updatedDelta !== 0) {
          return updatedDelta;
        }
        return goalHistoryStatusRank(left.status) - goalHistoryStatusRank(right.status);
      },
    );
  }

  localGoalSnapshotForFallback(goalHistory: ThreadGoalDto[]) {
    return localGoalSnapshotForFallback(goalHistory);
  }

  toThreadGoalDtoFromAgentGoal(goal: AgentGoal): ThreadGoalDto {
    return toThreadGoalDtoFromAgentGoal(goal);
  }

  toThreadGoalDtoFromRecord(record: unknown): ThreadGoalDto {
    return toThreadGoalDtoFromRecord(
      record as ReturnType<typeof listThreadGoalRecordsByThreadId>[number],
    );
  }

  normalizeThreadGoalStatusForThread(
    goal: ThreadGoalDto,
    record: ThreadGoalRecordContext,
  ): ThreadGoalDto {
    return normalizeThreadGoalStatusForThread(goal, record);
  }

  private async ensureGoalsFeatureEnabled(provider: string | null | undefined) {
    await this.goalFeatureManagement.ensureGoalsFeatureEnabled(provider);
  }
}

function toIsoFromEpoch(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return new Date().toISOString();
  }
  const epochMs = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(epochMs).toISOString();
}

function toThreadGoalDto(goal: {
  threadId: string;
  localGoalId?: string | null;
  objective: string;
  status: ThreadGoalDto['status'];
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number | string;
  updatedAt: number | string;
  completedAt?: string | null;
}): ThreadGoalDto {
  return {
    threadId: goal.threadId,
    localGoalId: goal.localGoalId ?? null,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.tokenBudget,
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt:
      typeof goal.createdAt === 'string'
        ? goal.createdAt
        : toIsoFromEpoch(goal.createdAt),
    updatedAt:
      typeof goal.updatedAt === 'string'
        ? goal.updatedAt
        : toIsoFromEpoch(goal.updatedAt),
    completedAt: goal.completedAt ?? null,
  };
}

function toThreadGoalDtoFromAgentGoal(goal: AgentGoal): ThreadGoalDto {
  return toThreadGoalDto({
    threadId: goal.providerSessionId,
    objective: goal.objective,
    status: goal.status as ThreadGoalDto['status'],
    tokenBudget: goal.tokenBudget,
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  });
}

function toThreadGoalDtoFromRecord(record: ReturnType<typeof listThreadGoalRecordsByThreadId>[number]): ThreadGoalDto {
  const terminalCompletedAt =
    record.completedAt ??
    (['complete', 'terminated'].includes(record.status) ? record.updatedAt : null);
  return toThreadGoalDto({
    threadId: record.providerSessionId,
    localGoalId: record.id,
    objective: record.objective,
    status: record.status as ThreadGoalDto['status'],
    tokenBudget: record.tokenBudget,
    tokensUsed: record.tokensUsed,
    timeUsedSeconds: record.timeUsedSeconds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: terminalCompletedAt,
  });
}

function normalizeThreadGoalStatusForThread(
  goal: ThreadGoalDto,
  record: {
    id?: string;
    providerSessionId?: string | null;
    providerTurnId?: string | null;
    status?: string | null;
  },
): NormalizedThreadGoal {
  if (
    goal.status === 'complete' &&
    (record.providerTurnId || record.status === 'running')
  ) {
    return {
      ...goal,
      status: 'active',
      completedAt: null,
    };
  }

  return goal;
}

function goalHistoryKey(goal: ThreadGoalDto) {
  return `${goal.threadId}:${goal.objective}:${goal.createdAt}`;
}

function mergeGoalHistoryEntry(existing: ThreadGoalDto, incoming: ThreadGoalDto) {
  const existingUpdatedAt = Date.parse(existing.updatedAt) || 0;
  const incomingUpdatedAt = Date.parse(incoming.updatedAt) || 0;
  const latest = incomingUpdatedAt >= existingUpdatedAt ? incoming : existing;
  const fallback = latest === incoming ? existing : incoming;

  return {
    ...latest,
    localGoalId: latest.localGoalId ?? fallback.localGoalId ?? null,
  };
}

function goalHistoryStatusRank(status: ThreadGoalDto['status']) {
  return ['active', 'paused', 'budgetLimited'].includes(status) ? 0 : 1;
}

function resetGoalProgress(goal: ThreadGoalDto): ThreadGoalDto {
  return {
    ...goal,
    tokensUsed: 0,
    timeUsedSeconds: 0,
  };
}

function goalObjectiveChanged(
  existing: ThreadGoalDto | null,
  nextObjective: string | null | undefined,
) {
  return (
    existing !== null &&
    typeof nextObjective === 'string' &&
    nextObjective.trim().length > 0 &&
    nextObjective !== existing.objective
  );
}

function isLocalGoalStatus(status: ThreadGoalDto['status']) {
  return ['active', 'paused', 'budgetLimited'].includes(status);
}

function localGoalSnapshotForFallback(goalHistory: ThreadGoalDto[]) {
  const activeGoal = goalHistory.find((entry) => isLocalGoalStatus(entry.status)) ?? null;
  if (activeGoal) {
    return activeGoal;
  }
  return goalHistory.find((entry) => entry.status === 'terminated') ?? null;
}

function localGoalSnapshotToPreserve(
  goalHistory: ThreadGoalDto[],
  remoteGoal: ThreadGoalDto,
) {
  const activeGoal = goalHistory.find((entry) => isLocalGoalStatus(entry.status)) ?? null;
  const hasTerminatedHistory = goalHistory.some((entry) => entry.status === 'terminated');
  if (
    activeGoal &&
    hasTerminatedHistory &&
    isLocalGoalStatus(remoteGoal.status) &&
    activeGoal.objective === remoteGoal.objective &&
    activeGoal.tokensUsed === 0 &&
    activeGoal.timeUsedSeconds === 0 &&
    (remoteGoal.tokensUsed > 0 || remoteGoal.timeUsedSeconds > 0)
  ) {
    return activeGoal;
  }

  return activeGoal ? null : goalHistory.find((entry) => entry.status === 'terminated') ?? null;
}
