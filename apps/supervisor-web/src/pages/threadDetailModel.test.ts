import { describe, expect, it } from 'vitest';

import type { ThreadDetailDto, ThreadHistoryItemDto, ThreadTurnDto } from '@remote-codex/shared';
import { appendLatestTurns, appendLiveAgentDeltaToItems, reconcileLiveItemsWithDetail } from './threadDetailModel';

const startedAt = '2026-09-05T00:00:00.000Z';

function turn(items: ThreadHistoryItemDto[]): ThreadTurnDto {
  return { id: 'turn-1', status: 'inProgress', startedAt, error: null, items };
}

function live(items: ThreadHistoryItemDto[]): NonNullable<ThreadDetailDto['liveItems']> {
  return { turnId: 'turn-1', updatedAt: startedAt, items };
}

describe('live usage reconciliation', () => {
  it('keeps newer usage through a stale running snapshot and accepts the final snapshot', () => {
    const total = { totalTokens: 300, inputTokens: 200, outputTokens: 100, cachedInputTokens: 20, reasoningOutputTokens: 50 };
    const current = {
      ...turn([]), model: 'gpt-6-astra', reasoningEffort: 'high' as const,
      tokenUsage: { total, last: total, modelContextWindow: 1050000 },
      priceEstimate: {
        pricingModelKey: 'gpt-6-astra', pricingTierKey: 'standard' as const, currency: 'USD' as const,
        inputUsd: 0.0018, cachedInputUsd: 0.00002, outputUsd: 0.005, totalUsd: 0.00682,
      },
    };
    const stale = turn([{ id: 'new-command', kind: 'commandExecution', text: 'cargo test' }]);
    const merged = appendLatestTurns([current], [stale], current.id);
    expect(merged[0]).toMatchObject({
      model: current.model, reasoningEffort: current.reasoningEffort,
      tokenUsage: current.tokenUsage, priceEstimate: current.priceEstimate,
      items: stale.items,
    });
    const final = { ...stale, status: 'completed' as const };
    expect(appendLatestTurns([current], [final])[0]).toEqual(final);
  });
});

describe('live transcript reconciliation', () => {
  it('resumes a refreshed message from its persisted prefix and appends subsequent deltas once', () => {
    const persisted: ThreadHistoryItemDto = {
      id: 'assistant-1', kind: 'agentMessage', text: 'Before refresh.',
      createdAt: startedAt, sequence: 3,
    };
    const turns = [turn([persisted])];
    const first = appendLiveAgentDeltaToItems(null, turns, {
      turnId: 'turn-1', itemId: persisted.id, delta: ' After refresh.', sequence: 3,
      createdAt: '2026-09-05T00:00:10.000Z',
    });
    expect(first.items).toEqual([{ ...persisted, text: 'Before refresh. After refresh.' }]);
    const second = appendLiveAgentDeltaToItems(first, turns, {
      turnId: 'turn-1', itemId: persisted.id, delta: ' Still streaming.', sequence: 3,
    });
    expect(second.items[0]?.text).toBe('Before refresh. After refresh. Still streaming.');

    const caughtUpTurns = [turn(second.items)];
    const reconciled = reconcileLiveItemsWithDetail(second, null, caughtUpTurns);
    expect(reconciled).toBeNull();
    const resumed = appendLiveAgentDeltaToItems(reconciled, caughtUpTurns, {
      turnId: 'turn-1', itemId: persisted.id, delta: ' Done.', sequence: null,
    });
    expect(resumed.items).toEqual([{
      ...persisted, text: 'Before refresh. After refresh. Still streaming. Done.',
    }]);
  });

  it('resumes from a newer persisted snapshot when it has passed the live prefix', () => {
    const persisted: ThreadHistoryItemDto = {
      id: 'assistant-1', kind: 'agentMessage', text: 'First. Second.', sequence: 1,
    };
    const result = appendLiveAgentDeltaToItems(
      live([{ ...persisted, text: 'First.' }]),
      [turn([persisted])],
      { turnId: 'turn-1', itemId: persisted.id, delta: ' Third.', sequence: 1 },
    );
    expect(result.items[0]?.text).toBe('First. Second. Third.');
  });

  it('starts a new segment without carrying over another item or turn', () => {
    const persisted: ThreadHistoryItemDto = {
      id: 'assistant-1', kind: 'agentMessage', text: 'Previous segment.', sequence: 1,
    };
    const result = appendLiveAgentDeltaToItems(null, [turn([persisted])], {
      turnId: 'turn-1', itemId: 'assistant-2', delta: 'New segment.', sequence: 2,
    });
    expect(result.items[0]?.text).toBe('New segment.');
    const nextTurn = appendLiveAgentDeltaToItems(result, [turn([persisted])], {
      turnId: 'turn-2', itemId: 'assistant-1', delta: 'New turn.', sequence: 1,
    });
    expect(nextTurn.items).toHaveLength(1);
    expect(nextTurn.items[0]?.text).toBe('New turn.');
  });

  it('handles a snapshot that already includes an arriving delta without duplicating text', () => {
    const persisted: ThreadHistoryItemDto = {
      id: 'assistant-1', kind: 'agentMessage', text: 'Prefix and suffix.', sequence: 1,
    };
    const event = {
      turnId: 'turn-1', itemId: persisted.id, delta: ' and suffix.',
      text: persisted.text, sequence: 1,
    };
    const once = appendLiveAgentDeltaToItems(null, [turn([persisted])], event);
    const twice = appendLiveAgentDeltaToItems(once, [turn([persisted])], event);
    expect(once.items[0]?.text).toBe(persisted.text);
    expect(twice.items[0]?.text).toBe(persisted.text);
    const delayed = appendLiveAgentDeltaToItems(twice, [turn([persisted])], {
      ...event, delta: 'Prefix', text: 'Prefix',
    });
    expect(delayed.items[0]?.text).toBe(persisted.text);
    const continued = appendLiveAgentDeltaToItems(delayed, [turn([persisted])], {
      ...event, delta: ' Done.', text: `${persisted.text} Done.`,
    });
    expect(continued.items[0]?.text).toBe('Prefix and suffix. Done.');
  });

  it.each(['agentMessage', 'reasoning'] as const)(
    'retains newer %s text while a detail snapshot is behind',
    (kind) => {
      const item: ThreadHistoryItemDto = {
        id: 'item-1', kind, text: 'Persisted prefix and a newer live suffix.', sequence: 1,
      };
      const current = live([item]);
      const snapshot = turn([{ ...item, text: 'Persisted prefix' }]);

      expect(reconcileLiveItemsWithDetail(current, null, [snapshot])?.items)
        .toEqual([item]);
      expect(reconcileLiveItemsWithDetail(current, live([]), [snapshot])?.items)
        .toEqual([item]);
      expect(reconcileLiveItemsWithDetail(current, live(snapshot.items), [snapshot])?.items)
        .toEqual([item]);
      expect(reconcileLiveItemsWithDetail(current, null, [turn([item])])).toBeNull();
    },
  );

  it('retains complete live reasoning details until the snapshot contains them', () => {
    const item: ThreadHistoryItemDto = {
      id: 'reason-1', kind: 'reasoning', text: 'Checking the code',
      detailText: 'Checking the code and reading the test results.', sequence: 1,
    };
    expect(reconcileLiveItemsWithDetail(live([item]), null, [
      turn([{ ...item, detailText: 'Checking the code' }]),
    ])?.items).toEqual([item]);
    expect(reconcileLiveItemsWithDetail(live([item]), null, [turn([item])])).toBeNull();
  });

  it('keeps a live ordering hint until history catches up', () => {
    const item: ThreadHistoryItemDto = {
      id: 'item-1', kind: 'agentMessage', text: 'Same text.', sequence: 5,
    };
    expect(reconcileLiveItemsWithDetail(live([item]), null, [
      turn([{ ...item, sequence: 1 }]),
    ])?.items).toEqual([item]);
  });

  it('uses the completed snapshot after it covers streamed text', () => {
    const item: ThreadHistoryItemDto = {
      id: 'item-1', kind: 'agentMessage', text: 'Live prefix', status: 'running',
    };
    const completed = {
      ...turn([{ ...item, text: 'Live prefix and final text.', status: 'completed' }]),
      status: 'completed' as const,
    };
    expect(reconcileLiveItemsWithDetail(live([item]), null, [completed])).toBeNull();
  });
});
