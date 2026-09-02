import { describe, expect, it, vi } from 'vitest';

import type {
  AgentSessionDetail,
  AgentTurn,
} from '../../../packages/agent-runtime/src/index';
import type {
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../../packages/shared/src/index';
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

function createAssembler(remoteSession: AgentSessionDetail | null) {
  const liveState = new ThreadLiveStateStore();
  const readRemoteSession = vi.fn(async () => remoteSession);
  const findLocalSession = vi.fn(
    async (): Promise<{ turns: ThreadTurnDto[] } | null> => null,
  );
  const callbacks = {
    buildThreadPatch: vi.fn(() => ({})),
    findLocalSession,
    listPersistedHistoryItemsByTurnId: vi.fn(() => new Map()),
    materializeHiddenRuntimeTurns: vi.fn(),
    readRemoteSession,
    resumeRemoteSession: vi.fn(async () => {
      if (!remoteSession) {
        throw new Error('Provider session is unavailable.');
      }
      return remoteSession;
    }),
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
  it('keeps persisted ACP history readable when provider bootstrap is unavailable', async () => {
    const persistedItems: ThreadHistoryItemDto[] = [
      {
        id: 'offline-turn:user',
        kind: 'userMessage',
        text: 'Persisted prompt',
        status: 'completed',
        createdAt: '2026-08-31T12:00:00.000Z',
      },
      {
        id: 'offline-turn:agent',
        kind: 'agentMessage',
        text: 'Persisted response',
        status: 'completed',
        createdAt: '2026-08-31T12:00:01.000Z',
        sourceTurnId: 'offline-turn',
      },
    ];
    const { assembler, callbacks } = createAssembler(null);
    callbacks.listPersistedHistoryItemsByTurnId.mockReturnValue(
      new Map([['offline-turn', persistedItems]]),
    );

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record: { ...record, provider: 'acp' },
      turnMetadataById: new Map(),
    });

    expect(entry.turns).toMatchObject([{
      id: 'offline-turn',
      status: 'completed',
      items: [
        { kind: 'userMessage', text: 'Persisted prompt' },
        { kind: 'agentMessage', text: 'Persisted response' },
      ],
    }]);
  });

  it('serves a paged ACP summary from persisted history without restoring the provider', async () => {
    const persistedTurn = (id: string, createdAt: string): ThreadHistoryItemDto[] => [
      {
        id: `${id}:user`,
        kind: 'userMessage',
        text: `Prompt ${id}`,
        createdAt,
      },
      {
        id: `${id}:agent`,
        kind: 'agentMessage',
        text: `Reply ${id}`,
        createdAt,
        sourceTurnId: id,
      },
    ];
    const { assembler, callbacks } = createAssembler(session([turn('remote-turn')]));
    callbacks.listPersistedHistoryItemsByTurnId.mockReturnValue(
      new Map([
        ['persisted-1', persistedTurn('persisted-1', '2026-08-31T12:00:00.000Z')],
        ['persisted-2', persistedTurn('persisted-2', '2026-08-31T12:01:00.000Z')],
        [
          'acp-hydrated:persisted-2',
          persistedTurn('persisted-2', '2026-08-31T12:01:00.000Z').map((item) => ({
            ...item,
            id: `acp-hydrated:${item.id}`,
            ...(item.kind === 'agentMessage'
              ? { sourceTurnId: 'acp-hydrated:persisted-2' }
              : {}),
          })),
        ],
      ]),
    );

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record: { ...record, provider: 'acp' },
      turnMetadataById: new Map(),
      options: { limit: 1, preferPersistedHistory: true },
    });

    expect(callbacks.readRemoteSession).not.toHaveBeenCalled();
    expect(callbacks.findLocalSession).not.toHaveBeenCalled();
    expect(entry.totalTurnCount).toBe(2);
    expect(entry.turns).toMatchObject([
      {
        id: 'persisted-2',
        items: [
          { kind: 'userMessage', text: 'Prompt persisted-2' },
          { kind: 'agentMessage', text: 'Reply persisted-2' },
        ],
      },
    ]);
  });

  it('uses rollout history without reading an unconnected imported session', async () => {
    const { assembler, callbacks } = createAssembler(session([]));
    callbacks.findLocalSession.mockResolvedValue({
      turns: [
        {
          id: 'local-turn-1',
          startedAt: '2026-06-07T00:00:00.000Z',
          status: 'completed',
          error: null,
          items: [
            {
              id: 'local-message-1',
              kind: 'agentMessage',
              text: 'Recovered from the rollout file.',
              createdAt: '2026-06-07T00:00:05.000Z',
            },
          ],
        },
      ],
    });

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record: {
        ...record,
        source: 'local_codex_import',
        isConnected: false,
      },
      turnMetadataById: new Map(),
    });

    expect(callbacks.readRemoteSession).not.toHaveBeenCalled();
    expect(entry.turns).toEqual([
      expect.objectContaining({
        id: 'local-turn-1',
        items: [
          expect.objectContaining({
            text: 'Recovered from the rollout file.',
            createdAt: '2026-06-07T00:00:05.000Z',
          }),
        ],
      }),
    ]);
  });

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
      },
      {
        id: 'agent-live-1',
        createdAt: liveAgentCreatedAt,
        sequence,
      },
    ]);
    liveState.getLiveItems(record.id, entry.turns);
    liveState.appendLiveAgentMessageDelta({
      localThreadId: record.id,
      turnId: 'turn-1',
      itemId: 'agent-live-1',
      delta: ' continued',
      sequence,
      createdAt: '2026-06-07T00:00:40.000Z',
    });
    expect(
      liveState.getLiveItemsForTurn(record.id, 'turn-1')?.items.find(
        (item) => item.id === 'agent-live-1',
      ),
    ).toMatchObject({
      text: 'Materialized response text continued',
      createdAt: liveAgentCreatedAt,
    });
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

  it('fills missing ACP turns from supervisor-persisted history', async () => {
    const persistedItems: ThreadHistoryItemDto[] = [
      {
        id: 'acp-turn-1:user',
        kind: 'userMessage',
        text: 'Previous ACP prompt',
        createdAt: '2026-06-06T23:59:00.000Z',
        sequence: 0,
      },
      {
        id: 'acp-turn-1:agent',
        kind: 'agentMessage',
        text: 'Previous ACP response',
        createdAt: '2026-06-06T23:59:01.000Z',
        sequence: 1,
        sourceTurnId: 'acp-turn-1',
        status: 'completed',
      },
    ];
    const latestTurn = turn('acp-turn-2');
    const { assembler, callbacks } = createAssembler(session([latestTurn], 2));
    callbacks.listPersistedHistoryItemsByTurnId.mockReturnValue(
      new Map([['acp-turn-1', persistedItems]]),
    );

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record: { ...record, provider: 'acp' },
      turnMetadataById: new Map([
        ['acp-turn-1', {
          model: null,
          reasoningEffort: null,
          reasoningEffortAvailable: null,
          pricingModelKey: null,
          pricingTierKey: null,
          tokenUsageJson: null,
          createdAt: '2026-06-06T23:59:00.000Z',
        }],
      ]),
      options: { limit: 10 },
    });

    expect(entry.turns.map((candidate) => candidate.id)).toEqual([
      'acp-turn-1',
      'acp-turn-2',
    ]);
    expect(entry.turns[0]).toMatchObject({
      id: 'acp-turn-1',
      status: 'completed',
      items: [
        { kind: 'userMessage', text: 'Previous ACP prompt' },
        { kind: 'agentMessage', text: 'Previous ACP response' },
      ],
    });
  });

  it('aligns hydrated ACP turns with their supervisor-persisted live turn', async () => {
    const persistedItems: ThreadHistoryItemDto[] = [
      {
        id: 'local-live:user',
        kind: 'userMessage',
        text: 'Remember the restart marker.',
        status: 'completed',
        createdAt: '2026-08-31T11:58:00.000Z',
      },
      {
        id: 'local-live:agent',
        kind: 'agentMessage',
        text: 'PARTIAL_MARKER',
        status: 'running',
        sourceTurnId: 'local-live-turn',
        createdAt: '2026-08-31T11:59:00.000Z',
      },
    ];
    const hydrated: AgentTurn = {
      providerTurnId: 'acp-hydrated:provider-user-message',
      startedAt: '2026-08-31T12:00:00.000Z',
      status: 'completed',
      error: null,
      items: [
        {
          id: 'provider-user-message',
          kind: 'userMessage',
          text:
            'Developer instructions:\nKeep the response concise.\n\n' +
            'Remember the restart marker.',
          status: 'completed',
        },
        {
          id: 'provider-agent-message',
          kind: 'agentMessage',
          text: 'PARTIAL_MARKER_COMPLETE',
          status: 'completed',
          sourceTurnId: 'acp-hydrated:provider-user-message',
        },
      ],
    };
    const { assembler, callbacks } = createAssembler(session([hydrated]));
    callbacks.listPersistedHistoryItemsByTurnId.mockReturnValue(
      new Map([
        ['local-live-turn', persistedItems],
        ['acp-hydrated:stale-duplicate', persistedItems.map((item) => ({
          ...item,
          id: `stale:${item.id}`,
          ...(item.kind === 'userMessage'
            ? {
                text:
                  'Developer instructions:\nKeep the response concise.\n\n' +
                  item.text,
              }
            : {}),
        }))],
      ]),
    );

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record: { ...record, provider: 'acp' },
      turnMetadataById: new Map(),
    });

    expect(entry.turns).toHaveLength(1);
    expect(entry.turns[0]).toMatchObject({
      id: 'local-live-turn',
      startedAt: '2026-08-31T11:58:00.000Z',
      status: 'completed',
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'local-live:user',
          kind: 'userMessage',
          text: 'Remember the restart marker.',
          createdAt: '2026-08-31T11:58:00.000Z',
        }),
        expect.objectContaining({
          id: 'local-live:agent',
          text: 'PARTIAL_MARKER_COMPLETE',
          sourceTurnId: 'local-live-turn',
        }),
      ]),
    });
    expect(
      entry.turns[0]?.items.filter((item) => item.kind === 'userMessage'),
    ).toHaveLength(1);
    expect(callbacks.syncAfterRemoteSession).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        turns: [expect.objectContaining({ providerTurnId: 'local-live-turn' })],
      }),
    );
  });

  it('does not turn a completed ACP turn into a failure because one tool failed', async () => {
    const persistedItems: ThreadHistoryItemDto[] = [
      {
        id: 'acp-turn-1:user',
        kind: 'userMessage',
        text: 'Run checks',
        status: 'completed',
      },
      {
        id: 'acp-turn-1:command',
        kind: 'commandExecution',
        text: 'optional check',
        status: 'failed',
      },
      {
        id: 'acp-turn-1:agent',
        kind: 'agentMessage',
        text: 'Recovered and completed.',
        status: 'completed',
        sourceTurnId: 'acp-turn-1',
      },
    ];
    const { assembler, callbacks } = createAssembler(session([]));
    callbacks.listPersistedHistoryItemsByTurnId.mockReturnValue(
      new Map([['acp-turn-1', persistedItems]]),
    );
    callbacks.buildThreadPatch.mockReturnValue({ status: 'idle' });

    const entry = await assembler.buildCacheEntry({
      localThreadId: record.id,
      record: { ...record, provider: 'acp' },
      turnMetadataById: new Map(),
      options: { limit: 10 },
    });

    expect(entry.totalTurnCount).toBe(1);
    expect(entry.turns[0]).toMatchObject({
      id: 'acp-turn-1',
      status: 'completed',
      error: null,
    });
    expect(callbacks.updateThreadRecord).toHaveBeenCalledWith(
      record.id,
      expect.not.objectContaining({ status: 'failed' }),
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
