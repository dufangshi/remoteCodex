import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

import type { ThreadDto } from '@remote-codex/shared';
import {
  mergeThreadListSnapshot,
  THREAD_LIST_POLL_INTERVAL_MS,
  useThreadListPolling,
} from './useThreadListPolling';

function makeThread(input: Partial<ThreadDto> & { id: string }): ThreadDto {
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? 'workspace-1',
    provider: input.provider ?? 'codex',
    providerSessionId: input.providerSessionId ?? `provider-${input.id}`,
    source: input.source ?? 'supervisor',
    title: input.title ?? input.id,
    model: input.model ?? 'gpt-5',
    reasoningEffort: input.reasoningEffort ?? 'medium',
    collaborationMode: input.collaborationMode ?? 'default',
    approvalMode: input.approvalMode ?? 'yolo',
    status: input.status ?? 'idle',
    summaryText: input.summaryText ?? null,
    lastError: input.lastError ?? null,
    activeTurnId: input.activeTurnId ?? null,
    isLoaded: input.isLoaded ?? true,
    isPinned: input.isPinned ?? false,
    createdAt: input.createdAt ?? '2026-07-01T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-07-01T00:00:00.000Z',
    lastTurnStartedAt: input.lastTurnStartedAt ?? null,
    lastTurnCompletedAt: input.lastTurnCompletedAt ?? null,
    ...(input.contextUsage ? { contextUsage: input.contextUsage } : {}),
  };
}

function PollingRooms({ initialThreads }: { initialThreads: ThreadDto[] }) {
  const [threads, setThreads] = useState(initialThreads);
  useThreadListPolling({ enabled: true, setThreads });

  return (
    <div>
      {threads.map((thread) => (
        <div key={thread.id}>
          <span>{thread.title}</span>
          <span>{thread.status}</span>
        </div>
      ))}
    </div>
  );
}

describe('useThreadListPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves unchanged thread object identity when merging snapshots', () => {
    const unchanged = makeThread({ id: 'thread-1', title: 'Stable' });
    const current = [unchanged];
    const next = [makeThread({ id: 'thread-1', title: 'Stable' })];

    expect(mergeThreadListSnapshot(current, next)).toBe(current);
  });

  it('silently refreshes rooms and status on the polling interval', async () => {
    const initial = makeThread({
      id: 'thread-1',
      title: 'Existing Room',
      status: 'running',
    });
    const refreshed = [
      makeThread({
        id: 'thread-1',
        title: 'Existing Room',
        status: 'idle',
      }),
      makeThread({
        id: 'thread-2',
        title: 'New Room',
        status: 'idle',
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => refreshed,
        }),
      ),
    );

    render(<PollingRooms initialThreads={[initial]} />);

    expect(screen.getByText('Existing Room')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_LIST_POLL_INTERVAL_MS);
    });

    expect(screen.getByText('New Room')).toBeInTheDocument();
    expect(screen.getAllByText('idle')).toHaveLength(2);
  });
});
