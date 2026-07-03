import type {
  ThreadDetailDto,
  ThreadDto,
  ThreadTurnDto,
} from '@remote-codex/shared';

export function buildOptimisticPromptDetail(
  detail: ThreadDetailDto,
  prompt: string,
): { detail: ThreadDetailDto; thread: ThreadDto; turn: ThreadTurnDto } {
  const now = new Date().toISOString();
  const turnId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `android-web-optimistic-${crypto.randomUUID()}`
      : `android-web-optimistic-${Date.now()}`;
  const optimisticThread: ThreadDto = {
    ...detail.thread,
    status: 'running',
    activeTurnId: turnId,
    summaryText: prompt,
    lastError: null,
    updatedAt: now,
    lastTurnStartedAt: now,
  };
  const optimisticTurn: ThreadTurnDto = {
    id: turnId,
    startedAt: now,
    status: 'inProgress',
    error: null,
    model: detail.thread.model,
    reasoningEffort: detail.thread.reasoningEffort,
    reasoningEffortAvailable: detail.thread.reasoningEffort !== null,
    tokenUsage: null,
    priceEstimate: null,
    items: [
      {
        id: `${turnId}:user`,
        createdAt: now,
        kind: 'userMessage',
        text: prompt,
        sourceTurnId: turnId,
      },
      {
        id: `${turnId}:assistant`,
        createdAt: now,
        kind: 'agentMessage',
        text: 'Waiting for the agent...',
        status: 'running',
        sourceTurnId: turnId,
      },
    ],
  };

  return {
    thread: optimisticThread,
    turn: optimisticTurn,
    detail: {
      ...detail,
      thread: optimisticThread,
      turns: [...detail.turns, optimisticTurn],
      totalTurnCount: (detail.totalTurnCount ?? detail.turns.length) + 1,
    },
  };
}
