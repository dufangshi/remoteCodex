import type {
  ThreadDetailDto,
  ThreadEventEnvelope,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '@remote-codex/shared';

type ProjectableThreadEvent = Extract<
  ThreadEventEnvelope,
  {
    type:
      | 'thread.turn.started'
      | 'thread.item.started'
      | 'thread.item.completed'
      | 'thread.output.delta'
      | 'thread.turn.completed'
      | 'thread.turn.failed'
      | 'thread.plan.updated'
      | 'thread.request.created'
      | 'thread.request.resolved'
      | 'thread.turn.token.updated';
  }
>;

export interface ThreadEventProjectionResult {
  detail: ThreadDetailDto;
  projected: boolean;
}

export function projectThreadEventIntoDetail(
  detail: ThreadDetailDto,
  event: { type: string; timestamp?: string | null; payload?: unknown },
): ThreadEventProjectionResult {
  if (!isProjectableThreadEvent(event)) {
    return { detail, projected: false };
  }

  switch (event.type) {
    case 'thread.turn.started':
      return {
        detail: ensureTurn(detail, event.payload.turnId, event.timestamp, {
          status: 'inProgress',
        }),
        projected: true,
      };
    case 'thread.item.started':
    case 'thread.item.completed':
      return {
        detail: upsertTurnItem(
          ensureTurn(detail, event.payload.turnId, event.timestamp, {
            status: 'inProgress',
          }),
          event.payload.turnId,
          event.payload.item,
        ),
        projected: true,
      };
    case 'thread.output.delta':
      return {
        detail: appendOutputDelta(
          ensureTurn(detail, event.payload.turnId, event.timestamp, {
            status: 'inProgress',
          }),
          event.payload,
          event.timestamp,
        ),
        projected: true,
      };
    case 'thread.turn.completed':
      return {
        detail: updateTurnStatus(detail, event.payload.turnId, event.timestamp, {
          status: event.payload.status,
          error: event.payload.error,
          threadStatus: event.payload.status === 'failed' ? 'failed' : 'idle',
        }),
        projected: true,
      };
    case 'thread.turn.failed':
      return {
        detail: updateTurnStatus(detail, event.payload.turnId, event.timestamp, {
          status: 'failed',
          error: event.payload.error,
          threadStatus: 'failed',
        }),
        projected: true,
      };
    case 'thread.plan.updated':
      return {
        detail: {
          ...detail,
          livePlan: {
            turnId: event.payload.turnId,
            explanation: event.payload.explanation,
            plan: event.payload.plan,
            updatedAt: event.timestamp ?? new Date().toISOString(),
          },
        },
        projected: true,
      };
    case 'thread.request.created':
      return {
        detail: {
          ...detail,
          pendingRequests: upsertById(detail.pendingRequests, event.payload.request),
        },
        projected: true,
      };
    case 'thread.request.resolved':
      return {
        detail: {
          ...detail,
          pendingRequests: detail.pendingRequests.filter(
            (request) => request.id !== event.payload.requestId,
          ),
        },
        projected: true,
      };
    case 'thread.turn.token.updated':
      return {
        detail: updateTurn(detail, event.payload.turnId, (turn) => ({
          ...turn,
          tokenUsage: event.payload.tokenUsage,
          priceEstimate: event.payload.priceEstimate,
        })),
        projected: true,
      };
  }
}

function ensureTurn(
  detail: ThreadDetailDto,
  turnId: string,
  timestamp: string | null | undefined,
  input: { status: ThreadTurnDto['status'] },
): ThreadDetailDto {
  const existing = detail.turns.some((turn) => turn.id === turnId);
  const turns = existing
    ? detail.turns.map((turn) =>
        turn.id === turnId
          ? { ...turn, status: input.status, error: null }
          : turn,
      )
    : [
        ...detail.turns,
        {
          id: turnId,
          startedAt: timestamp ?? new Date().toISOString(),
          status: input.status,
          error: null,
          items: [],
        },
      ];

  return {
    ...detail,
    thread: {
      ...detail.thread,
      status: 'running',
      activeTurnId: turnId,
      lastError: null,
      lastTurnStartedAt: timestamp ?? detail.thread.lastTurnStartedAt,
      updatedAt: timestamp ?? detail.thread.updatedAt,
    },
    turns,
    totalTurnCount: Math.max(detail.totalTurnCount ?? 0, turns.length),
  };
}

function updateTurnStatus(
  detail: ThreadDetailDto,
  turnId: string,
  timestamp: string | null | undefined,
  input: {
    status: ThreadTurnDto['status'];
    error: string | null;
    threadStatus: ThreadDetailDto['thread']['status'];
  },
): ThreadDetailDto {
  const ensured = ensureTurn(detail, turnId, timestamp, { status: input.status });
  return {
    ...ensured,
    thread: {
      ...ensured.thread,
      status: input.threadStatus,
      activeTurnId: null,
      lastError: input.error,
      lastTurnCompletedAt: timestamp ?? ensured.thread.lastTurnCompletedAt,
      updatedAt: timestamp ?? ensured.thread.updatedAt,
    },
    turns: ensured.turns.map((turn) =>
      turn.id === turnId
        ? { ...turn, status: input.status, error: input.error }
        : turn,
    ),
    liveItems: ensured.liveItems?.turnId === turnId ? null : (ensured.liveItems ?? null),
    livePlan: ensured.livePlan?.turnId === turnId ? null : (ensured.livePlan ?? null),
    pendingSteers: ensured.pendingSteers.filter(
      (steer) => steer.turnId !== turnId,
    ),
  };
}

function upsertTurnItem(
  detail: ThreadDetailDto,
  turnId: string,
  item: ThreadHistoryItemDto,
) {
  return updateTurn(detail, turnId, (turn) => ({
    ...turn,
    items: upsertById(turn.items, item),
  }));
}

function appendOutputDelta(
  detail: ThreadDetailDto,
  payload: Extract<ThreadEventEnvelope, { type: 'thread.output.delta' }>['payload'],
  timestamp: string | null | undefined,
) {
  return updateTurn(detail, payload.turnId, (turn) => {
    const existing = turn.items.find((item) => item.id === payload.itemId);
    const text = existing?.text ?? '';
    const nextText = text.endsWith(payload.delta)
      ? text
      : `${text}${payload.delta}`;
    const nextItem: ThreadHistoryItemDto = existing
      ? {
          ...existing,
          text: nextText,
          status: existing.status ?? 'running',
        }
      : {
          id: payload.itemId,
          createdAt: payload.createdAt ?? timestamp ?? null,
          kind: 'agentMessage',
          text: payload.delta,
          status: 'running',
          sequence: payload.sequence,
        };
    return {
      ...turn,
      items: upsertById(turn.items, nextItem),
    };
  });
}

function updateTurn(
  detail: ThreadDetailDto,
  turnId: string,
  updater: (turn: ThreadTurnDto) => ThreadTurnDto,
) {
  return {
    ...detail,
    turns: detail.turns.map((turn) =>
      turn.id === turnId ? updater(turn) : turn,
    ),
  };
}

function upsertById<T extends { id: string }>(items: T[], next: T) {
  const existingIndex = items.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) {
    return [...items, next];
  }
  return items.map((item, index) => (index === existingIndex ? next : item));
}

function isProjectableThreadEvent(
  event: { type: string; payload?: unknown },
): event is ProjectableThreadEvent {
  if (!isRecord(event.payload)) {
    return false;
  }
  switch (event.type) {
    case 'thread.turn.started':
      return typeof event.payload.turnId === 'string';
    case 'thread.item.started':
    case 'thread.item.completed':
      return (
        typeof event.payload.turnId === 'string' &&
        isThreadHistoryItem(event.payload.item)
      );
    case 'thread.output.delta':
      return (
        typeof event.payload.turnId === 'string' &&
        typeof event.payload.itemId === 'string' &&
        typeof event.payload.delta === 'string'
      );
    case 'thread.turn.completed':
      return (
        typeof event.payload.turnId === 'string' &&
        isTurnStatus(event.payload.status) &&
        (typeof event.payload.error === 'string' ||
          event.payload.error === null)
      );
    case 'thread.turn.failed':
      return (
        typeof event.payload.turnId === 'string' &&
        (typeof event.payload.error === 'string' ||
          event.payload.error === null)
      );
    case 'thread.plan.updated':
      return (
        typeof event.payload.turnId === 'string' &&
        (typeof event.payload.explanation === 'string' ||
          event.payload.explanation === null) &&
        Array.isArray(event.payload.plan)
      );
    case 'thread.request.created':
      return isRecord(event.payload.request) &&
        typeof event.payload.request.id === 'string';
    case 'thread.request.resolved':
      return typeof event.payload.requestId === 'string';
    case 'thread.turn.token.updated':
      return (
        typeof event.payload.turnId === 'string' &&
        isRecord(event.payload.tokenUsage)
      );
    default:
      return false;
  }
}

function isThreadHistoryItem(value: unknown): value is ThreadHistoryItemDto {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.text === 'string'
  );
}

function isTurnStatus(value: unknown): value is ThreadTurnDto['status'] {
  return (
    value === 'completed' ||
    value === 'interrupted' ||
    value === 'failed' ||
    value === 'inProgress'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
