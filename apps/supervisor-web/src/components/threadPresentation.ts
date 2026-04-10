import type {
  ThreadDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../../../packages/shared/src/index';

export function formatShortTimestamp(value: string | null) {
  if (!value) {
    return 'Time unavailable';
  }

  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatLongTimestamp(value: string | null) {
  if (!value) {
    return 'Time unavailable';
  }

  return new Date(value).toLocaleString();
}

export function threadStatusLabel(status: ThreadDto['status']) {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'running':
      return 'Running';
    case 'interrupted':
      return 'Interrupted';
    case 'failed':
      return 'Failed';
    case 'not_loaded':
      return 'Not Loaded';
    case 'system_error':
      return 'System Error';
  }
}

export function threadStatusClassName(status: ThreadDto['status']) {
  switch (status) {
    case 'idle':
      return 'border-stone-700 bg-stone-900/80 text-stone-300';
    case 'running':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
    case 'interrupted':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'failed':
    case 'system_error':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
    case 'not_loaded':
      return 'border-stone-700 bg-stone-950 text-stone-400';
  }
}

export function turnStatusLabel(status: ThreadTurnDto['status']) {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'interrupted':
      return 'Interrupted';
    case 'failed':
      return 'Failed';
    case 'inProgress':
      return 'Running';
  }
}

export function turnStatusClassName(status: ThreadTurnDto['status']) {
  switch (status) {
    case 'completed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'interrupted':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'failed':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
    case 'inProgress':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
  }
}

export function historyItemAccentClassName(kind: ThreadHistoryItemDto['kind']) {
  switch (kind) {
    case 'userMessage':
      return 'border-cyan-400/45';
    case 'agentMessage':
      return 'border-emerald-400/45';
    case 'commandExecution':
      return 'border-amber-300/45';
    case 'reasoning':
      return 'border-violet-400/45';
    case 'toolCall':
      return 'border-fuchsia-400/45';
    case 'plan':
      return 'border-sky-400/45';
    case 'fileChange':
      return 'border-lime-400/45';
    case 'other':
      return 'border-stone-500/45';
  }
}

export function historyItemLabel(kind: ThreadHistoryItemDto['kind']) {
  switch (kind) {
    case 'userMessage':
      return 'User';
    case 'agentMessage':
      return 'Agent';
    case 'commandExecution':
      return 'Command';
    case 'reasoning':
      return 'Reasoning';
    case 'toolCall':
      return 'Tool';
    case 'plan':
      return 'Plan';
    case 'fileChange':
      return 'File Change';
    case 'other':
      return 'Other';
  }
}

export function isScrollableHistoryItem(kind: ThreadHistoryItemDto['kind']) {
  return kind === 'commandExecution' || kind === 'reasoning';
}
