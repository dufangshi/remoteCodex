import { describe, expect, it } from 'vitest';

import type { ThreadDetailDto } from '@remote-codex/shared';
import {
  appendLatestTurns,
  applyLiveItemTimestampsToTurns,
  findTurnWithUserMessage,
  mergeGoalHistory,
  mergeLiveHistoryItem,
  mergePendingRequests,
  prependTurns,
  reconcileLiveItemsWithDetail,
  removePendingRequestFromDetail,
} from './threadDetailModel';

function makeTurn(
  id: string,
  items: ThreadDetailDto['turns'][number]['items'] = [],
): ThreadDetailDto['turns'][number] {
  return {
    id,
    startedAt: `2026-05-24T00:00:0${id.length}.000Z`,
    status: 'completed',
    error: null,
    items,
  };
}

function makePendingRequest(
  id: string,
  createdAt: string,
): ThreadDetailDto['pendingRequests'][number] {
  return {
    id,
    kind: 'requestUserInput',
    title: `Request ${id}`,
    description: null,
    turnId: null,
    itemId: null,
    createdAt,
    questions: [],
  };
}

describe('threadDetailModel', () => {
  it('prepends and appends turn pages without duplicating overlapping turn ids', () => {
    const existing = [makeTurn('turn-2'), makeTurn('turn-3')];

    expect(prependTurns(existing, [makeTurn('turn-1'), makeTurn('turn-2')]).map((turn) => turn.id))
      .toEqual(['turn-1', 'turn-2', 'turn-3']);
    expect(appendLatestTurns(existing, [makeTurn('turn-3'), makeTurn('turn-4')]).map((turn) => turn.id))
      .toEqual(['turn-2', 'turn-3', 'turn-4']);
  });

  it('merges pending requests by id, removes resolved requests, and keeps creation order', () => {
    const requestA = makePendingRequest('a', '2026-05-24T00:00:01.000Z');
    const staleRequestB = makePendingRequest('b', '2026-05-24T00:00:02.000Z');
    const requestB = {
      ...staleRequestB,
      title: 'Updated request b',
    };
    const requestC = makePendingRequest('c', '2026-05-24T00:00:00.000Z');

    expect(
      mergePendingRequests(
        [requestA, staleRequestB],
        [requestB, requestC],
        new Set(['a']),
      ),
    ).toEqual([requestC, requestB]);
  });

  it('returns the original detail object when removing a missing pending request', () => {
    const detail = {
      pendingRequests: [makePendingRequest('a', '2026-05-24T00:00:01.000Z')],
    } as ThreadDetailDto;

    expect(removePendingRequestFromDetail(detail, 'missing')).toBe(detail);
  });

  it('keeps the longer live agent message while preserving incoming ordering hints', () => {
    const merged = mergeLiveHistoryItem(
      {
        id: 'agent-1',
        kind: 'agentMessage',
        text: 'hello world',
        sequence: 1,
      },
      {
        id: 'agent-1',
        kind: 'agentMessage',
        text: 'hello',
        sequence: 2,
      },
    );

    expect(merged).toMatchObject({
      id: 'agent-1',
      kind: 'agentMessage',
      text: 'hello world',
      sequence: 2,
    });
  });

  it('drops live items already covered by materialized turn details', () => {
    const current = {
      turnId: 'turn-1',
      updatedAt: '2026-05-24T00:00:01.000Z',
      items: [
        {
          id: 'live-agent',
          kind: 'agentMessage' as const,
          text: 'partial answer',
        },
      ],
    };

    const result = reconcileLiveItemsWithDetail(
      current,
      null,
      [
        makeTurn('turn-1', [
          {
            id: 'agent-final',
            kind: 'agentMessage',
            text: 'partial answer with more text',
          },
        ]),
      ],
    );

    expect(result).toBeNull();
  });

  it('keeps live agent timestamps when materialized turns only have fallback turn time', () => {
    const turnStartedAt = '2026-05-24T00:00:00.000Z';
    const liveAgentCreatedAt = '2026-05-24T00:00:21.000Z';

    const turns = applyLiveItemTimestampsToTurns(
      [
        {
          ...makeTurn('turn-1'),
          startedAt: turnStartedAt,
          items: [
            {
              id: 'agent-1',
              kind: 'agentMessage',
              text: 'streamed answer text',
              createdAt: turnStartedAt,
            },
          ],
        },
      ],
      {
        turnId: 'turn-1',
        updatedAt: liveAgentCreatedAt,
        items: [
          {
            id: 'agent-1',
            kind: 'agentMessage',
            text: 'streamed answer',
            createdAt: liveAgentCreatedAt,
          },
        ],
      },
    );

    expect(turns[0]?.items[0]).toMatchObject({
      id: 'agent-1',
      createdAt: liveAgentCreatedAt,
    });
  });

  it('matches photo prompts by their user text even when upload placeholders differ', () => {
    const turn = makeTurn('turn-1', [
      {
        id: 'user-1',
        kind: 'userMessage',
        text: 'Describe this [localImage] please',
      },
    ]);

    expect(
      findTurnWithUserMessage(
        [turn],
        'Describe this [PHOTO clipboard.png] please',
      )?.id,
    ).toBe('turn-1');
  });

  it('deduplicates goal history and keeps the latest update while preserving local goal ids', () => {
    const olderGoal = {
      threadId: 'thread-1',
      objective: 'ship it',
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:01.000Z',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 10,
      timeUsedSeconds: 60,
      localGoalId: 'local-1',
    } satisfies NonNullable<ThreadDetailDto['goal']>;
    const newerGoal = {
      ...olderGoal,
      updatedAt: '2026-05-24T00:00:02.000Z',
      tokensUsed: 25,
      localGoalId: null,
    } satisfies NonNullable<ThreadDetailDto['goal']>;

    expect(mergeGoalHistory([olderGoal], newerGoal)).toEqual([
      {
        ...newerGoal,
        localGoalId: 'local-1',
      },
    ]);
  });
});
