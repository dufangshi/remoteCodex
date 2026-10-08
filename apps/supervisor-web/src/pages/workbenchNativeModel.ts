import type {
  ThreadDetailDto,
  ThreadSubagentDto,
  ThreadTurnDto,
} from '@remote-codex/shared';
export interface NativeSummary extends ThreadSubagentDto {
  target?: { turnId: string; itemId: string };
}
/** Completion is read from durable native tool records, never inferred from disappearance from activeSubagents. */
export function nativeSummaries(
  detail: ThreadDetailDto | null,
  history: ThreadTurnDto[],
  liveItems: ThreadDetailDto['liveItems'],
): NativeSummary[] {
  if (!detail) return [];
  const result = new Map<string, NativeSummary>();
  const collect = (
    turnId: string,
    items: ThreadTurnDto['items'],
    startedAt: string | null,
    completedAt: string | null,
  ) => {
    for (const item of items)
      if (item.kind === 'agentToolCall')
        result.set(`${turnId}:${item.id}`, {
          id: item.id,
          name: item.text || item.id,
          status: item.status ?? 'unknown',
          startedAt,
          completedAt,
          parentToolCallId: null,
          target: { turnId, itemId: item.id },
        });
  };
  for (const turn of history)
    collect(turn.id, turn.items, turn.startedAt ?? null, turn.completedAt ?? null);
  for (const turn of detail.turns.slice(-3))
    collect(turn.id, turn.items, turn.startedAt ?? null, turn.completedAt ?? null);
  if (liveItems) collect(liveItems.turnId, liveItems.items, null, null);
  for (const agent of detail.activeSubagents ?? []) {
    const key = `${detail.thread.activeTurnId ?? 'active'}:${agent.id}`;
    const existing = result.get(key);
    result.set(key, { ...existing, ...agent });
  }
  return [...result.values()].slice(-20);
}
