import { describe, expect, it } from 'vitest';

import type { AgentTurn } from '../../../packages/agent-runtime/src/index';
import { agentTurnToThreadTurnDto, mergePersistedHistoryItemsIntoTurns } from './thread-history-items';

describe('agentTurnToThreadTurnDto', () => {
  it('normalizes item timestamps without overwriting explicit createdAt values', () => {
    const turnStartedAt = '2026-04-09T06:01:00.000Z';
    const explicitItemCreatedAt = '2026-04-09T06:01:05.000Z';
    const uuidV7ItemCreatedAt = '2026-04-09T06:02:21.000Z';

    const turn: AgentTurn = {
      providerTurnId: 'turn-1',
      startedAt: turnStartedAt,
      status: 'completed',
      error: null,
      items: [
        {
          id: 'explicit-item',
          kind: 'userMessage',
          text: 'Prompt',
          createdAt: explicitItemCreatedAt,
        },
        {
          id: '019d70d59dc870008000000000000000',
          kind: 'agentMessage',
          text: 'Final answer',
        },
        {
          id: 'legacy-item',
          kind: 'commandExecution',
          text: 'Legacy item without timestamp',
          status: 'completed',
        },
      ],
    };

    expect(agentTurnToThreadTurnDto(turn).items).toMatchObject([
      {
        id: 'explicit-item',
        createdAt: explicitItemCreatedAt,
      },
      {
        id: '019d70d59dc870008000000000000000',
        createdAt: uuidV7ItemCreatedAt,
      },
      {
        id: 'legacy-item',
        createdAt: turnStartedAt,
      },
    ]);
  });

  it('uses persisted live timestamps for final agent messages without provider timestamps', () => {
    const turnStartedAt = '2026-04-09T06:01:00.000Z';
    const persistedAgentCreatedAt = '2026-04-09T06:02:21.000Z';
    const deferredDetails = new Map();

    const normalizedTurn = agentTurnToThreadTurnDto({
      providerTurnId: 'turn-1',
      startedAt: turnStartedAt,
      status: 'completed',
      error: null,
      items: [
        {
          id: 'msg-final',
          kind: 'agentMessage',
          text: 'Final answer',
        },
      ],
    });

    expect(normalizedTurn.items[0]?.createdAt).toBe(turnStartedAt);

    const mergedTurns = mergePersistedHistoryItemsIntoTurns(
      [normalizedTurn],
      new Map([
        [
          'turn-1',
          [
            {
              id: 'msg-final',
              kind: 'agentMessage',
              text: 'Final answer',
              createdAt: persistedAgentCreatedAt,
              sequence: 1,
              sourceTurnId: 'turn-1',
            },
          ],
        ],
      ]),
      deferredDetails,
    );

    expect(mergedTurns[0]?.items[0]).toMatchObject({
      id: 'msg-final',
      createdAt: persistedAgentCreatedAt,
      sequence: 1,
    });
  });

  it('uses persisted photo prompt text when provider history only keeps a local image placeholder', () => {
    const normalizedTurn = agentTurnToThreadTurnDto({
      providerTurnId: 'turn-1',
      startedAt: '2026-04-09T06:01:00.000Z',
      status: 'completed',
      error: null,
      items: [
        {
          id: 'user-photo',
          kind: 'userMessage',
          text: 'Inspect this\n[localImage]',
        },
      ],
    });

    const mergedTurns = mergePersistedHistoryItemsIntoTurns(
      [normalizedTurn],
      new Map([
        [
          'turn-1',
          [
            {
              id: 'user-photo',
              kind: 'userMessage',
              text: 'Inspect this [PHOTO ./.temp/threads/thread-1/photo.png]',
            },
          ],
        ],
      ]),
      new Map(),
    );

    expect(mergedTurns[0]?.items[0]).toMatchObject({
      id: 'user-photo',
      text: 'Inspect this [PHOTO ./.temp/threads/thread-1/photo.png]',
    });
  });
});
