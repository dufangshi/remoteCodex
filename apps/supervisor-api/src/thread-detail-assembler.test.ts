import { describe, expect, it, vi } from 'vitest';

import type {
  AgentSessionDetail,
  AgentTurn,
} from '../../../packages/agent-runtime/src/index';
import type { ThreadHistoryItemDto } from '../../../packages/shared/src/index';
import { ThreadLiveStateStore } from './thread-live-state-store';
import {
  ThreadDetailAssembler,
  type ThreadDetailRecord,
} from './thread-detail-assembler';

const record: ThreadDetailRecord = {
  id: 'thread-1',
  workspaceId: 'workspace-1',
  provider: 'codex',
  providerSessionId: 'provider-session-1',
  collaborationMode: 'default',
  model: 'gpt-5',
  reasoningEffort: 'medium',
};

function turn(id: string): AgentTurn {
  return {
    providerTurnId: id,
    startedAt: '2026-06-07T00:00:00.000Z',
    status: 'completed',
    error: null,
    items: [
      {
        id: `${id}-user-message`,
        kind: 'userMessage',
        text: `Prompt ${id}`,
      },
    ],
  };
}

function session(turns: AgentTurn[], totalTurnCount = turns.length): AgentSessionDetail {
  return {
    provider: 'codex',
    providerSessionId: 'provider-session-1',
    cwd: '/tmp/workspace',
    title: 'Demo Thread',
    preview: 'Preview',
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
    status: 'idle',
    turns,
    totalTurnCount,
  };
}

function createAssembler(remoteSession: AgentSessionDetail) {
  const liveState = new ThreadLiveStateStore();
  const readRemoteSession = vi.fn(async () => remoteSession);
  const callbacks = {
    buildThreadPatch: vi.fn(() => ({})),
    findLocalSession: vi.fn(async () => null),
    listPersistedHistoryItemsByTurnId: vi.fn(() => new Map()),
    materializeHiddenRuntimeTurns: vi.fn(),
    readRemoteSession,
    resumeRemoteSession: vi.fn(async () => remoteSession),
    syncAfterRemoteSession: vi.fn(),
    updateThreadRecord: vi.fn(),
    getUpdatedThreadRecord: vi.fn(() => record),
  };

  return {
    assembler: new ThreadDetailAssembler({
      liveState,
      callbacks,
    }),
    callbacks,
    liveState,
  };
}

describe('ThreadDetailAssembler', () => {
  it('caches repeated latest paged detail reads within the ttl', async () => {
    const { assembler, callbacks } = createAssembler(
      session([turn('turn-2'), turn('turn-3'), turn('turn-4')], 4),
    );

    const first = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3 },
    });
    const second = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3 },
    });

    expect(callbacks.readRemoteSession).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(second.turns.map((item) => item.id)).toEqual([
      'turn-2',
      'turn-3',
      'turn-4',
    ]);
    expect(second.totalTurnCount).toBe(4);
  });

  it('keeps latest page cache entries separate by requested limit', async () => {
    const { assembler, callbacks } = createAssembler(
      session([turn('turn-2'), turn('turn-3'), turn('turn-4')], 4),
    );

    await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3 },
    });
    await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 2 },
    });

    expect(callbacks.readRemoteSession).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a latest page cache entry for earlier history pages', async () => {
    const { assembler, callbacks } = createAssembler(
      session([turn('turn-2'), turn('turn-3'), turn('turn-4')], 4),
    );

    await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3 },
    });
    await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3, beforeTurnId: 'turn-2' },
    });

    expect(callbacks.readRemoteSession).toHaveBeenCalledTimes(2);
  });

  it('does not cache repeated earlier history page reads', async () => {
    const { assembler, callbacks } = createAssembler(
      session([turn('turn-1')], 4),
    );

    await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3, beforeTurnId: 'turn-2' },
    });
    await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3, beforeTurnId: 'turn-2' },
    });

    expect(callbacks.readRemoteSession).toHaveBeenCalledTimes(2);
  });

  it('re-reads latest paged detail after invalidation', async () => {
    const { assembler, callbacks } = createAssembler(
      session([turn('turn-2'), turn('turn-3'), turn('turn-4')], 4),
    );

    await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3 },
    });
    assembler.invalidate(record.id);
    await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3 },
    });

    expect(callbacks.readRemoteSession).toHaveBeenCalledTimes(2);
  });

  it('clears stale active turn ids when the remote session is no longer running', async () => {
    const { assembler, callbacks } = createAssembler(session([turn('turn-1')]));
    callbacks.buildThreadPatch.mockReturnValue({
      status: 'idle',
      providerSessionId: 'provider-session-1',
    });

    await assembler.buildCacheEntry({
      localThreadId: record.id,
      record: {
        ...record,
        providerTurnId: 'stale-active-turn',
      },
      turnMetadataById: new Map(),
      options: { limit: 3 },
    });

    expect(callbacks.updateThreadRecord).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        status: 'idle',
        providerTurnId: null,
      }),
    );
  });

  it('keeps live agent timestamps after running items materialize in readThread', async () => {
    const turnStartedAt = '2026-06-07T00:00:00.000Z';
    const liveAgentCreatedAt = '2026-06-07T00:00:21.000Z';
    const { assembler, liveState } = createAssembler(
      session([
        {
          providerTurnId: 'turn-1',
          startedAt: turnStartedAt,
          status: 'inProgress',
          error: null,
          items: [
            {
              id: 'user-1',
              kind: 'userMessage',
              text: 'Prompt',
            },
            {
              id: 'agent-live-1',
              kind: 'agentMessage',
              text: 'Materialized response text',
            },
          ],
        },
      ]),
    );

    liveState.recordTurnItemOrder(record.id, 'turn-1', 'user-1');
    const sequence = liveState.recordTurnItemOrder(record.id, 'turn-1', 'agent-live-1');
    liveState.appendLiveAgentMessageDelta({
      localThreadId: record.id,
      turnId: 'turn-1',
      itemId: 'agent-live-1',
      delta: 'Materialized response text',
      sequence,
      createdAt: liveAgentCreatedAt,
    });

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map(),
      options: { limit: 3 },
    });

    expect(entry.turns[0]?.items).toMatchObject([
      {
        id: 'user-1',
        createdAt: turnStartedAt,
      },
      {
        id: 'agent-live-1',
        createdAt: liveAgentCreatedAt,
        sequence,
      },
    ]);
  });

  it('uses stored display prompt when Codex history returns local image placeholders', async () => {
    const { assembler } = createAssembler(
      session([
        {
          providerTurnId: 'turn-image-1',
          startedAt: '2026-06-07T00:00:00.000Z',
          status: 'completed',
          error: null,
          items: [
            {
              id: 'user-image-1',
              kind: 'userMessage',
              text: '图中内容是什么\n[localImage]',
            },
            {
              id: 'agent-image-1',
              kind: 'agentMessage',
              text: '图中是一张截图。',
            },
          ],
        },
      ]),
    );

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map([
        [
          'turn-image-1',
          {
            model: 'gpt-5',
            reasoningEffort: 'medium',
            reasoningEffortAvailable: true,
            pricingModelKey: null,
            pricingTierKey: null,
            tokenUsageJson: null,
            displayPrompt: '图中内容是什么 [PHOTO ./.temp/threads/thread-1/image.png]',
            createdAt: '2026-06-07T00:00:00.000Z',
          },
        ],
      ]),
      options: { limit: 3 },
    });

    expect(entry.turns[0]?.items[0]).toMatchObject({
      id: 'user-image-1',
      kind: 'userMessage',
      text: '图中内容是什么 [PHOTO ./.temp/threads/thread-1/image.png]',
    });
  });

  it('shows a persisted failed turn when the provider never created one', async () => {
    const failedAt = '2026-06-07T00:00:30.000Z';
    const persistedFailureItems: ThreadHistoryItemDto[] = [
      {
        id: 'local-failed-turn:user',
        kind: 'userMessage',
        text: 'hello',
        createdAt: failedAt,
        transcriptOrder: 0,
      },
      {
        id: 'local-failed-turn:error',
        kind: 'agentMessage',
        text: 'Missing API key',
        createdAt: failedAt,
        transcriptOrder: 1,
        status: 'failed',
        sourceTurnId: 'local-failed-turn',
      },
    ];
    const { assembler, callbacks } = createAssembler(
      session([turn('turn-1')]),
    );
    callbacks.listPersistedHistoryItemsByTurnId.mockReturnValue(
      new Map([['local-failed-turn', persistedFailureItems]]),
    );

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map([
        [
          'local-failed-turn',
          {
            model: 'gpt-5',
            reasoningEffort: 'medium',
            reasoningEffortAvailable: true,
            pricingModelKey: null,
            pricingTierKey: null,
            tokenUsageJson: null,
            displayPrompt: 'hello',
            createdAt: failedAt,
          },
        ],
      ]),
      options: { limit: 3 },
    });

    expect(entry.turns.map((item) => item.id)).toEqual([
      'turn-1',
      'local-failed-turn',
    ]);
    expect(entry.turns[1]).toMatchObject({
      id: 'local-failed-turn',
      status: 'failed',
      error: 'Missing API key',
    });
    expect(entry.turns[1]?.items).toMatchObject([
      { kind: 'userMessage', text: 'hello' },
      { kind: 'agentMessage', text: 'Missing API key', status: 'failed' },
    ]);
    expect(callbacks.updateThreadRecord).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        status: 'failed',
        lastError: 'Missing API key',
        providerTurnId: null,
      }),
    );
  });

  it('does not promote failed items from completed remote turns to thread failure', async () => {
    const failedAt = '2026-06-07T00:00:30.000Z';
    const persistedFailureItems: ThreadHistoryItemDto[] = [
      {
        id: 'turn-1:user',
        kind: 'userMessage',
        text: 'run checks',
        createdAt: '2026-06-07T00:00:00.000Z',
        transcriptOrder: 0,
      },
      {
        id: 'turn-1:command',
        kind: 'commandExecution',
        text: 'npm test',
        createdAt: failedAt,
        transcriptOrder: 1,
        status: 'failed',
        sourceTurnId: 'turn-1',
      },
    ];
    const { assembler, callbacks } = createAssembler(
      session([turn('turn-1')]),
    );
    callbacks.buildThreadPatch.mockReturnValue({
      status: 'idle',
      lastError: null,
    });
    callbacks.listPersistedHistoryItemsByTurnId.mockReturnValue(
      new Map([['turn-1', persistedFailureItems]]),
    );

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record,
      turnMetadataById: new Map([
        [
          'turn-1',
          {
            model: 'gpt-5',
            reasoningEffort: 'medium',
            reasoningEffortAvailable: true,
            pricingModelKey: null,
            pricingTierKey: null,
            tokenUsageJson: null,
            displayPrompt: 'run checks',
            createdAt: '2026-06-07T00:00:00.000Z',
          },
        ],
      ]),
      options: { limit: 3 },
    });

    expect(entry.turns).toHaveLength(1);
    expect(entry.turns[0]).toMatchObject({
      id: 'turn-1',
      status: 'completed',
    });
    expect(callbacks.updateThreadRecord).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        status: 'idle',
        lastError: null,
        providerTurnId: null,
      }),
    );
  });
});
