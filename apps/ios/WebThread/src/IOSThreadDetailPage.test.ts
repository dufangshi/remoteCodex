import { describe, expect, it, vi } from 'vitest';

import type { ThreadDetailDto, ThreadEventEnvelope } from '@remote-codex/shared';

import {
  IOS_THREAD_HISTORY_INITIAL_LIMIT,
  nextThreadHistoryLimit,
} from './IOSHistoryPaging';
import { buildOptimisticPromptDetail } from './IOSOptimisticPrompt';
import { projectThreadEventIntoDetail } from './IOSWebSocketProjection';

function threadDetail(): ThreadDetailDto {
  return {
    thread: {
      id: 'thread-1',
      workspaceId: 'workspace-1',
      provider: 'claude',
      providerSessionId: 'session-1',
      source: 'supervisor',
      title: 'Optimistic thread',
      model: 'ios-e2e-stream',
      reasoningEffort: 'medium',
      fastMode: false,
      collaborationMode: 'default',
      approvalMode: 'guarded',
      sandboxMode: 'danger-full-access',
      status: 'idle',
      summaryText: null,
      lastError: null,
      activeTurnId: null,
      isLoaded: true,
      isPinned: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      lastTurnStartedAt: null,
      lastTurnCompletedAt: null,
    },
    workspace: {
      id: 'workspace-1',
      hostId: 'local',
      label: 'Workspace',
      absPath: '/tmp/workspace',
      isFavorite: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      lastOpenedAt: '2026-07-01T00:00:00.000Z',
    },
    workspacePathStatus: 'present',
    turns: [],
    totalTurnCount: 0,
    pendingRequests: [
      {
        id: 'request-1',
        kind: 'planDecision',
        title: 'Pending request',
        description: null,
        turnId: 'turn-1',
        itemId: 'item-1',
        createdAt: '2026-07-01T00:00:00.000Z',
        questions: [],
      },
    ],
    pendingSteers: [],
  };
}

describe('buildOptimisticPromptDetail', () => {
  it('adds a local in-progress turn before the supervisor responds', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => 'optimistic-id',
    });

    const optimistic = buildOptimisticPromptDetail(
      threadDetail(),
      'hello from optimistic webview',
    );

    expect(optimistic.turn.id).toBe('ios-web-optimistic-optimistic-id');
    expect(optimistic.thread.status).toBe('running');
    expect(optimistic.thread.activeTurnId).toBe(optimistic.turn.id);
    expect(optimistic.detail.totalTurnCount).toBe(1);
    expect(optimistic.detail.pendingRequests).toEqual(
      threadDetail().pendingRequests,
    );
    expect(optimistic.detail.turns).toHaveLength(1);
    expect(optimistic.detail.turns[0]?.items).toEqual([
      expect.objectContaining({
        kind: 'userMessage',
        text: 'hello from optimistic webview',
      }),
      expect.objectContaining({
        kind: 'agentMessage',
        text: 'Waiting for the agent...',
        status: 'running',
      }),
    ]);

    vi.unstubAllGlobals();
  });
});

describe('nextThreadHistoryLimit', () => {
  it('loads older server-managed history in fixed steps up to the known total', () => {
    const detail = {
      ...threadDetail(),
      turns: Array.from({ length: 30 }, (_, index) => ({
        id: `turn-${index + 16}`,
        startedAt: '2026-07-01T00:00:00.000Z',
        status: 'completed' as const,
        error: null,
        model: 'ios-e2e-stream',
        reasoningEffort: 'medium' as const,
        reasoningEffortAvailable: true,
        tokenUsage: null,
        priceEstimate: null,
        items: [],
      })),
      totalTurnCount: 45,
    };

    expect(
      nextThreadHistoryLimit(detail, IOS_THREAD_HISTORY_INITIAL_LIMIT),
    ).toBe(40);
  });

  it('does not request beyond fully loaded history', () => {
    const detail = {
      ...threadDetail(),
      turns: Array.from({ length: 45 }, (_, index) => ({
        id: `turn-${index + 1}`,
        startedAt: '2026-07-01T00:00:00.000Z',
        status: 'completed' as const,
        error: null,
        model: 'ios-e2e-stream',
        reasoningEffort: 'medium' as const,
        reasoningEffortAvailable: true,
        tokenUsage: null,
        priceEstimate: null,
        items: [],
      })),
      totalTurnCount: 45,
    };

    expect(nextThreadHistoryLimit(detail, 45)).toBe(45);
  });
});

describe('projectThreadEventIntoDetail', () => {
  it('projects a live turn stream into the thread detail without refreshing', () => {
    const base = threadDetail();
    const firstDelta = 'IOS_STREAM_DELTA_READY';
    const secondDelta = ' IOS_STREAM_COMPLETED';
    const events: ThreadEventEnvelope[] = [
      {
        type: 'thread.turn.started',
        threadId: 'thread-1',
        timestamp: '2026-07-01T00:00:01.000Z',
        payload: { turnId: 'turn-1' },
      },
      {
        type: 'thread.item.started',
        threadId: 'thread-1',
        timestamp: '2026-07-01T00:00:02.000Z',
        payload: {
          turnId: 'turn-1',
          item: {
            id: 'turn-1:assistant',
            createdAt: '2026-07-01T00:00:02.000Z',
            kind: 'agentMessage',
            text: firstDelta,
            status: 'running',
          },
        },
      },
      {
        type: 'thread.output.delta',
        threadId: 'thread-1',
        timestamp: '2026-07-01T00:00:02.000Z',
        payload: {
          turnId: 'turn-1',
          itemId: 'turn-1:assistant',
          sequence: 0,
          delta: firstDelta,
        },
      },
      {
        type: 'thread.output.delta',
        threadId: 'thread-1',
        timestamp: '2026-07-01T00:00:03.000Z',
        payload: {
          turnId: 'turn-1',
          itemId: 'turn-1:assistant',
          sequence: 1,
          delta: secondDelta,
        },
      },
      {
        type: 'thread.item.completed',
        threadId: 'thread-1',
        timestamp: '2026-07-01T00:00:04.000Z',
        payload: {
          turnId: 'turn-1',
          item: {
            id: 'turn-1:assistant',
            createdAt: '2026-07-01T00:00:02.000Z',
            kind: 'agentMessage',
            text: `${firstDelta}${secondDelta}`,
            status: 'completed',
          },
        },
      },
      {
        type: 'thread.turn.completed',
        threadId: 'thread-1',
        timestamp: '2026-07-01T00:00:04.000Z',
        payload: {
          turnId: 'turn-1',
          status: 'completed',
          error: null,
        },
      },
    ];

    const projected = events.reduce((detail, event) => {
      const result = projectThreadEventIntoDetail(detail, event);
      expect(result.projected).toBe(true);
      return result.detail;
    }, base);

    expect(projected.thread.status).toBe('idle');
    expect(projected.thread.activeTurnId).toBeNull();
    expect(projected.totalTurnCount).toBe(1);
    expect(projected.turns[0]?.status).toBe('completed');
    expect(projected.turns[0]?.items).toEqual([
      expect.objectContaining({
        id: 'turn-1:assistant',
        text: 'IOS_STREAM_DELTA_READY IOS_STREAM_COMPLETED',
        status: 'completed',
      }),
    ]);
  });

  it('leaves unprojected event families for the refresh fallback', () => {
    const detail = threadDetail();
    const result = projectThreadEventIntoDetail(detail, {
      type: 'thread.updated',
      timestamp: '2026-07-01T00:00:01.000Z',
      payload: { title: 'Server title' },
    });

    expect(result.projected).toBe(false);
    expect(result.detail).toBe(detail);
  });
});
