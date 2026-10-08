import { expect, it } from 'vitest';
import { nativeSummaries } from './workbenchNativeModel';
import type { ThreadDetailDto, ThreadTurnDto } from '@remote-codex/shared';
it('retains native terminal facts from history after the active list clears, with real item targets', () => {
  const history = [
    {
      id: 'turn',
      startedAt: null,
      completedAt: null,
      items: [
        {
          id: 'done',
          kind: 'agentToolCall',
          text: 'Review',
          status: 'completed',
        },
        {
          id: 'failed',
          kind: 'agentToolCall',
          text: 'Check',
          status: 'failed',
        },
        {
          id: 'other',
          kind: 'toolCall',
          text: 'Task board tool',
          status: 'completed',
        },
      ],
    },
  ] as ThreadTurnDto[];
  const detail = {
    thread: { activeTurnId: null },
    turns: [],
    activeSubagents: [],
  } as unknown as ThreadDetailDto;
  expect(
    nativeSummaries(detail, history, null).map((agent) => [
      agent.id,
      agent.status,
      agent.target,
    ]),
  ).toEqual([
    ['done', 'completed', { turnId: 'turn', itemId: 'done' }],
    ['failed', 'failed', { turnId: 'turn', itemId: 'failed' }],
  ]);
});
it('keeps absent or unconfirmed native status unknown instead of inventing completion', () => {
  const detail = {
    thread: { activeTurnId: null },
    turns: [],
    activeSubagents: [{ id: 'native', name: 'Worker', status: 'unknown' }],
  } as unknown as ThreadDetailDto;
  expect(nativeSummaries(detail, [], null)[0]?.status).toBe('unknown');
  expect(nativeSummaries({ ...detail, activeSubagents: [] }, [], null)).toEqual(
    [],
  );
});
