import type { ThreadDetailDto } from '@remote-codex/shared';

export const IOS_THREAD_HISTORY_INITIAL_LIMIT = 30;
export const IOS_THREAD_HISTORY_PAGE_STEP = 10;
export const IOS_THREAD_HISTORY_MAX_LIMIT = 100;

export function nextThreadHistoryLimit(
  detail: ThreadDetailDto,
  currentLimit: number,
) {
  const loadedTurnCount = detail.turns.length;
  const totalTurnCount = detail.totalTurnCount ?? loadedTurnCount;
  const maximumLimit = Math.min(totalTurnCount, IOS_THREAD_HISTORY_MAX_LIMIT);

  if (loadedTurnCount >= totalTurnCount || currentLimit >= maximumLimit) {
    return currentLimit;
  }

  return Math.min(
    maximumLimit,
    Math.max(
      currentLimit + IOS_THREAD_HISTORY_PAGE_STEP,
      loadedTurnCount + IOS_THREAD_HISTORY_PAGE_STEP,
    ),
  );
}
