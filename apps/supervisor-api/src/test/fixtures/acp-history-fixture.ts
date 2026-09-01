import {
  createThreadRecord,
  createWorkspaceRecord,
  upsertThreadHistoryItemRecord,
  upsertThreadTurnMetadata,
  type DatabaseClient,
} from '../../../../../packages/db/src/index';
import type { ThreadHistoryItemDto } from '../../../../../packages/shared/src/index';
import { stringifyStoredThreadTurnTokenUsageState } from '../../thread-usage-accounting';

const startedAt = '2026-08-31T12:00:00.000Z';
const secondStartedAt = '2026-08-31T12:01:00.000Z';

function tokenUsage(totalTokens: number) {
  const total = {
    totalTokens,
    inputTokens: Math.floor(totalTokens * 0.6),
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: Math.floor(totalTokens * 0.3),
    reasoningOutputTokens: Math.floor(totalTokens * 0.1),
  };
  return stringifyStoredThreadTurnTokenUsageState({
    baselineTotal: null,
    usage: {
      total,
      last: total,
      modelContextWindow: 4096,
    },
    modelContextWindow: 4096,
  });
}

const firstTurnItems: ThreadHistoryItemDto[] = [
  {
    id: 'acp-history-turn-1:user',
    kind: 'userMessage',
    text: 'Inspect the persisted ACP fixture.',
    status: 'completed',
    createdAt: startedAt,
    sequence: 0,
  },
  {
    id: 'acp-history-turn-1:reasoning',
    kind: 'reasoning',
    text: 'The fixture needs a durable history projection.',
    status: 'completed',
    createdAt: startedAt,
    sequence: 1,
  },
  {
    id: 'acp-history-turn-1:optional-check',
    kind: 'commandExecution',
    text: 'optional fixture check',
    status: 'failed',
    createdAt: startedAt,
    sequence: 2,
  },
  {
    id: 'acp-history-turn-1:plan',
    kind: 'plan',
    text: '- [x] Seed history\n- [x] Reassemble history',
    status: 'completed',
    createdAt: startedAt,
    sequence: 3,
  },
  {
    id: 'acp-history-turn-1:agent',
    kind: 'agentMessage',
    text: 'The first persisted ACP turn is complete.',
    status: 'completed',
    createdAt: startedAt,
    sequence: 4,
    sourceTurnId: 'acp-history-turn-1',
  },
];

const secondTurnItems: ThreadHistoryItemDto[] = [
  {
    id: 'acp-history-turn-2:user',
    kind: 'userMessage',
    text: 'Read the second fixture turn.',
    status: 'completed',
    createdAt: secondStartedAt,
    sequence: 0,
  },
  {
    id: 'acp-history-turn-2:read',
    kind: 'fileRead',
    text: 'fixture.txt',
    status: 'completed',
    createdAt: secondStartedAt,
    sequence: 1,
  },
  {
    id: 'acp-history-turn-2:tool',
    kind: 'toolCall',
    text: 'Inspect fixture metadata',
    status: 'completed',
    createdAt: secondStartedAt,
    sequence: 2,
  },
  {
    id: 'acp-history-turn-2:agent',
    kind: 'agentMessage',
    text: 'The second persisted ACP turn is complete.',
    status: 'completed',
    createdAt: secondStartedAt,
    sequence: 3,
    sourceTurnId: 'acp-history-turn-2',
  },
];

export function seedAcpHistoryFixture(
  db: DatabaseClient,
  workspacePath: string,
) {
  const workspace = createWorkspaceRecord(db, {
    label: 'ACP history fixture',
    absPath: workspacePath,
  });
  const thread = createThreadRecord(db, {
    workspaceId: workspace.id,
    provider: 'acp',
    agentId: 'fixture-agent',
    providerSessionId: 'fixture-agent::persisted-session',
    title: 'Persisted ACP fixture',
    model: 'fixture-model',
    reasoningEffort: 'medium',
    approvalMode: 'guarded',
  });

  const turns = [
    {
      id: 'acp-history-turn-1',
      startedAt,
      prompt: 'Inspect the persisted ACP fixture.',
      usage: tokenUsage(100),
      items: firstTurnItems,
    },
    {
      id: 'acp-history-turn-2',
      startedAt: secondStartedAt,
      prompt: 'Read the second fixture turn.',
      usage: tokenUsage(160),
      items: secondTurnItems,
    },
  ];

  for (const turn of turns) {
    upsertThreadTurnMetadata(db, {
      threadId: thread.id,
      turnId: turn.id,
      createdAt: turn.startedAt,
      model: 'fixture-model',
      reasoningEffort: 'medium',
      reasoningEffortAvailable: true,
      displayPrompt: turn.prompt,
      tokenUsageJson: turn.usage,
    });
    for (const item of turn.items) {
      upsertThreadHistoryItemRecord(db, {
        threadId: thread.id,
        turnId: turn.id,
        itemId: item.id,
        itemJson: JSON.stringify(item),
      });
    }
  }

  return { workspace, thread, turns };
}
