import type { TourChapterId } from './tourChapters';

export interface TourProgress {
  /** First-run prompt answered (started or postponed). */
  welcomeDismissed: boolean;
  completed: TourChapterId[];
  /** Last step reached per unfinished chapter, by step id. */
  resume: Partial<Record<TourChapterId, string>>;
}

const STORAGE_PREFIX = 'pockymoe.onboarding.v1:';

export const EMPTY_PROGRESS: TourProgress = { welcomeDismissed: false, completed: [], resume: {} };

/** Progress is per browser origin and per account, so a shared browser never mixes users. */
export function progressStorageKey(account: string, origin = window.location.origin) {
  return `${STORAGE_PREFIX}${JSON.stringify([origin, account])}`;
}

export function readProgress(key: string): TourProgress {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Partial<TourProgress> | null;
    if (!parsed || typeof parsed !== 'object') return EMPTY_PROGRESS;
    return {
      welcomeDismissed: parsed.welcomeDismissed === true,
      completed: Array.isArray(parsed.completed) ? parsed.completed.filter((id) => typeof id === 'string') : [],
      resume: parsed.resume && typeof parsed.resume === 'object' ? parsed.resume : {},
    };
  } catch {
    return EMPTY_PROGRESS;
  }
}

export function writeProgress(key: string, progress: TourProgress) {
  try {
    window.localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    /* Private browsing may disable storage; progress then lasts for this page only. */
  }
}
