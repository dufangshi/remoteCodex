import type {
  ThreadDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '@remote-codex/shared';

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
      return 'ui-status-neutral';
    case 'running':
      return 'ui-status-info';
    case 'interrupted':
      return 'ui-status-warning';
    case 'failed':
    case 'system_error':
      return 'ui-status-danger';
    case 'not_loaded':
      return 'ui-status-neutral';
  }
}

export function turnStatusLabel(status: ThreadTurnDto['status'] | 'sending') {
  switch (status) {
    case 'sending':
      return 'Sending';
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

export function turnStatusClassName(status: ThreadTurnDto['status'] | 'sending') {
  switch (status) {
    case 'sending':
      return 'ui-status-info';
    case 'completed':
      return 'ui-status-success';
    case 'interrupted':
      return 'ui-status-warning';
    case 'failed':
      return 'ui-status-danger';
    case 'inProgress':
      return 'ui-status-info';
  }
}

export function historyItemAccentClassName(kind: ThreadHistoryItemDto['kind']) {
  switch (kind) {
    case 'userMessage':
      return 'timeline-kind-user';
    case 'agentMessage':
      return 'timeline-kind-agent';
    case 'artifact':
      return 'timeline-kind-action';
    case 'image':
      return 'timeline-kind-action';
    case 'contextCompaction':
      return 'timeline-kind-action';
    case 'commandExecution':
      return 'timeline-kind-command';
    case 'webSearch':
      return 'timeline-kind-search';
    case 'fileRead':
      return 'timeline-kind-file-read';
    case 'reasoning':
      return 'timeline-kind-reasoning';
    case 'agentToolCall':
      return 'timeline-kind-agent-tool';
    case 'skillToolCall':
      return 'timeline-kind-skill-tool';
    case 'toolCall':
      return 'timeline-kind-action';
    case 'plan':
      return 'timeline-kind-plan';
    case 'fileChange':
      return 'timeline-kind-file';
    case 'hook':
      return 'timeline-kind-action';
    case 'other':
      return 'ui-status-neutral';
  }
}

export function historyItemLabel(kind: ThreadHistoryItemDto['kind']) {
  switch (kind) {
    case 'userMessage':
      return 'User';
    case 'agentMessage':
      return 'Agent';
    case 'artifact':
      return 'Artifact';
    case 'image':
      return 'Image';
    case 'contextCompaction':
      return 'Context';
    case 'commandExecution':
      return 'Command';
    case 'webSearch':
      return 'Web Search';
    case 'fileRead':
      return 'File Read';
    case 'reasoning':
      return 'Reasoning';
    case 'agentToolCall':
      return 'Agent';
    case 'skillToolCall':
      return 'Skill';
    case 'toolCall':
      return 'Tool';
    case 'plan':
      return 'Plan';
    case 'fileChange':
      return 'File Change';
    case 'hook':
      return 'Hook';
    case 'other':
      return 'Other';
  }
}

export function isScrollableHistoryItem(kind: ThreadHistoryItemDto['kind']) {
  return kind === 'commandExecution' || kind === 'reasoning';
}
