import { describe, expect, it } from 'vitest';

import {
  AcpTurnItemMapper,
  acpToolCallToHistoryItem,
} from './item-mapper';

describe('AcpTurnItemMapper', () => {
  it('maps streamed ACP updates into ordered Remote Codex items', () => {
    const mapper = new AcpTurnItemMapper('turn-1', [{
      id: 'turn-1:user',
      kind: 'userMessage',
      text: 'Inspect the project',
    }]);

    const message = mapper.apply({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'I will inspect it.' },
    });
    expect(message.outputDeltas).toEqual([{
      itemId: 'turn-1:agent:1',
      delta: 'I will inspect it.',
    }]);

    mapper.apply({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'Need the source tree.' },
    });
    mapper.apply({
      sessionUpdate: 'tool_call',
      toolCallId: 'read-1',
      title: 'Read package.json',
      kind: 'read',
      status: 'in_progress',
      locations: [{ path: '/workspace/package.json' }],
      rawInput: { path: '/workspace/package.json' },
    });
    mapper.apply({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'read-1',
      status: 'completed',
      rawOutput: { content: '{}' },
    });
    const plan = mapper.apply({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Inspect files', priority: 'high', status: 'completed' },
        { content: 'Apply fix', priority: 'high', status: 'in_progress' },
      ],
    });
    expect(plan.planUpdate?.plan).toEqual([
      { step: 'Inspect files', status: 'completed' },
      { step: 'Apply fix', status: 'in_progress' },
    ]);
    mapper.apply({
      sessionUpdate: 'compaction_update',
      compactionId: 'compact-1',
      status: 'completed',
      summary: [{ type: 'text', text: 'Retained summary' }],
    });

    const { turn } = mapper.complete('completed');
    expect(turn.items.map((item) => item.kind)).toEqual([
      'userMessage',
      'agentMessage',
      'reasoning',
      'fileRead',
      'plan',
      'contextCompaction',
    ]);
    expect(turn.items.find((item) => item.id === 'read-1')).toMatchObject({
      text: '/workspace/package.json',
      status: 'completed',
    });
  });

  it.each([
    ['execute', 'Run tests', 'commandExecution'],
    ['edit', 'Edit source', 'fileChange'],
    ['read', 'Read source', 'fileRead'],
    ['fetch', 'Fetch docs', 'webSearch'],
    ['other', 'Launch subagent', 'agentToolCall'],
    ['other', 'Load skill', 'skillToolCall'],
    ['other', 'Custom action', 'toolCall'],
  ] as const)('maps %s %s tools to %s', (kind, title, expected) => {
    const item = acpToolCallToHistoryItem({
      toolCallId: `${kind}:${title}`,
      title,
      kind,
      status: 'completed',
    });
    expect(item.kind).toBe(expected);
  });

  it('preserves file diff details and stats', () => {
    const item = acpToolCallToHistoryItem({
      toolCallId: 'edit-1',
      title: 'Edit source',
      kind: 'edit',
      status: 'completed',
      content: [{
        type: 'diff',
        path: '/workspace/a.ts',
        oldText: 'one\ntwo',
        newText: 'one\ntwo\nthree',
      }],
    });
    expect(item).toMatchObject({
      kind: 'fileChange',
      changedFiles: 1,
      addedLines: 1,
      removedLines: 0,
    });
    expect(item.detailText).toContain('/workspace/a.ts');
  });

  it('clears experimental plans when the agent removes them', () => {
    const mapper = new AcpTurnItemMapper('turn-plan');
    mapper.apply({
      sessionUpdate: 'plan_update',
      plan: {
        type: 'markdown',
        planId: 'plan-1',
        content: '# Plan',
      },
    });
    const removed = mapper.apply({
      sessionUpdate: 'plan_removed',
      planId: 'plan-1',
    });

    expect(removed.planUpdate).toEqual({ explanation: null, plan: [] });
    expect(removed.itemUpdates).toMatchObject([
      { item: { id: 'turn-plan:plan:plan-1', status: 'cancelled' }, completed: true },
    ]);
  });
});
