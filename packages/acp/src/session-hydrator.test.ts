import { describe, expect, it } from 'vitest';

import { AcpSessionHydrator } from './session-hydrator';

describe('AcpSessionHydrator', () => {
  it('reconstructs stable turns from replayed user-message boundaries', () => {
    const hydrate = () => {
      const hydrator = new AcpSessionHydrator('session-1');
      hydrator.apply({
        sessionUpdate: 'user_message_chunk',
        messageId: 'user-1',
        content: { type: 'text', text: 'First prompt' },
      });
      hydrator.apply({
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'reasoning-1',
        content: { type: 'text', text: 'First reasoning' },
      });
      hydrator.apply({
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Optional check',
        kind: 'execute',
        status: 'failed',
      });
      hydrator.apply({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'agent-1',
        content: { type: 'text', text: 'First response' },
      });
      hydrator.apply({
        sessionUpdate: 'user_message_chunk',
        messageId: 'user-2',
        content: { type: 'text', text: 'Second prompt' },
      });
      hydrator.apply({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'agent-2',
        content: { type: 'text', text: 'Second response' },
      });
      return hydrator.complete();
    };

    const first = hydrate();
    const second = hydrate();
    expect(first.map((turn) => turn.providerTurnId)).toEqual([
      'acp-hydrated:user-1',
      'acp-hydrated:user-2',
    ]);
    expect(second.map((turn) => turn.providerTurnId)).toEqual(
      first.map((turn) => turn.providerTurnId),
    );
    expect(first[0]).toMatchObject({
      status: 'completed',
      items: [
        { id: 'user-1', kind: 'userMessage', text: 'First prompt' },
        { id: 'reasoning-1', kind: 'reasoning', text: 'First reasoning' },
        { id: 'tool-1', kind: 'commandExecution', status: 'failed' },
        { id: 'agent-1', kind: 'agentMessage', text: 'First response' },
      ],
    });
    expect(first[1]?.items).toMatchObject([
      { id: 'user-2', kind: 'userMessage' },
      { id: 'agent-2', kind: 'agentMessage' },
    ]);
    const coverageHydrator = new AcpSessionHydrator('session-coverage');
    coverageHydrator.apply({
      sessionUpdate: 'user_message_chunk',
      messageId: 'coverage-user',
      content: { type: 'text', text: 'Coverage prompt' },
    });
    coverageHydrator.apply({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'coverage-agent',
      content: { type: 'text', text: 'Coverage response' },
    });
    expect(coverageHydrator.coverage()).toEqual({
      source: 'providerReplay',
      completeness: 'unknown',
      replayedTurnCount: 1,
      replayedItemCount: 2,
      providerIdentifiedTurnCount: 1,
    });
  });

  it('keeps consecutive anonymous user chunks in one turn', () => {
    const hydrator = new AcpSessionHydrator('session-anonymous');
    hydrator.apply({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'First ' },
    });
    hydrator.apply({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'prompt' },
    });
    hydrator.apply({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Response' },
    });
    expect(hydrator.complete()).toMatchObject([{
      items: [
        { kind: 'userMessage', text: 'First prompt' },
        { kind: 'agentMessage', text: 'Response' },
      ],
    }]);
  });

  it('attaches leading replay updates to the first user turn', () => {
    const hydrator = new AcpSessionHydrator('session-leading');
    hydrator.apply({
      sessionUpdate: 'agent_thought_chunk',
      messageId: 'leading-reasoning',
      content: { type: 'text', text: 'Recovered leading context' },
    });
    hydrator.apply({
      sessionUpdate: 'user_message_chunk',
      messageId: 'user-leading',
      content: { type: 'text', text: 'Actual prompt' },
    });
    hydrator.apply({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'agent-leading',
      content: { type: 'text', text: 'Actual response' },
    });

    expect(hydrator.complete()).toMatchObject([{
      providerTurnId: 'acp-hydrated:user-leading',
      items: [
        { id: 'user-leading', kind: 'userMessage' },
        { id: 'leading-reasoning', kind: 'reasoning' },
        { id: 'agent-leading', kind: 'agentMessage' },
      ],
    }]);
  });

  it('preserves provider event timestamps during replay hydration', () => {
    const hydrator = new AcpSessionHydrator('session-timestamps');
    hydrator.apply({
      sessionUpdate: 'user_message_chunk',
      messageId: 'timestamp-user',
      content: { type: 'text', text: 'Timestamp prompt' },
      _meta: { agentTimestampMs: 1_788_230_400_123 },
    });
    hydrator.apply({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'timestamp-agent',
      content: { type: 'text', text: 'Timestamp response' },
      _meta: { agentTimestampMs: 1_788_230_405_456 },
    });

    expect(hydrator.complete()).toMatchObject([{
      startedAt: '2026-09-01T02:40:00.123Z',
      items: [
        {
          id: 'timestamp-user',
          createdAt: '2026-09-01T02:40:00.123Z',
        },
        {
          id: 'timestamp-agent',
          createdAt: '2026-09-01T02:40:05.456Z',
        },
      ],
    }]);
  });
});
