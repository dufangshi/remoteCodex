import type { ThreadDetailDto } from '@remote-codex/shared';

export const IOS_THREAD_HISTORY_INITIAL_LIMIT = 3;
export const IOS_THREAD_HISTORY_PAGE_STEP = 3;

export function canLoadEarlierThreadHistory(detail: ThreadDetailDto) {
  const loadedTurnCount = detail.turns.length;
  const totalTurnCount = detail.totalTurnCount ?? loadedTurnCount;

  return loadedTurnCount < totalTurnCount && loadedTurnCount > 0;
}

export function mergeEarlierThreadHistory(
  current: ThreadDetailDto,
  earlier: ThreadDetailDto,
) {
  const existingIds = new Set(current.turns.map((turn) => turn.id));
  const mergedTurns = [
    ...earlier.turns.filter((turn) => !existingIds.has(turn.id)),
    ...current.turns,
  ];

  return {
    ...earlier,
    turns: mergedTurns,
    totalTurnCount: Math.max(
      current.totalTurnCount ?? current.turns.length,
      earlier.totalTurnCount ?? earlier.turns.length,
      mergedTurns.length,
    ),
  };
}
