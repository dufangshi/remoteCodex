import { describe, expect, it } from 'vitest';

import {
  markTransientAgentHistoryItem,
  type AgentHistoryItem,
} from '../../agent-runtime/src/index';
import {
  agentTurnToThreadTurnDto,
  codexTurnToAgentTurn,
  liveCodexItemToHistoryItem,
  shouldPersistLiveHistoryItem,
  shouldPersistRuntimeFinalHistoryItem,
} from './historyItems';

describe('codex history item persistence policy', () => {
  it('keeps streamed assistant text out of live history persistence', () => {
    expect(
      shouldPersistLiveHistoryItem({
        id: 'agent-live-1',
        kind: 'agentMessage',
        text: 'Streaming draft',
      }),
    ).toBe(false);
  });

  it('keeps transient streamed assistant text out of final runtime persistence', () => {
    const transientMessage = markTransientAgentHistoryItem<AgentHistoryItem>({
      id: 'agent-live-1',
      kind: 'agentMessage',
      text: 'Streaming draft',
    });

    expect(shouldPersistRuntimeFinalHistoryItem(transientMessage, [transientMessage])).toBe(
      false,
    );
  });

  it('hides transient streamed assistant text once a final assistant message exists', () => {
    const transientMessage = markTransientAgentHistoryItem<AgentHistoryItem>({
      id: 'agent-live-1',
      kind: 'agentMessage',
      text: 'Streaming draft',
    });
    const finalMessage: AgentHistoryItem = {
      id: 'agent-final-1',
      kind: 'agentMessage',
      text: 'Final answer',
    };

    expect(
      agentTurnToThreadTurnDto({
        providerTurnId: 'turn-1',
        status: 'completed',
        error: null,
        items: [transientMessage, finalMessage],
      }).items,
    ).toEqual([{ ...finalMessage, transcriptOrder: 0 }]);
  });

  it('maps Codex collab agent tool calls to dedicated agent tool call items', () => {
    const turn = codexTurnToAgentTurn({
      id: 'turn-1',
      status: 'inProgress',
      error: null,
      items: [
        {
          id: 'agent-tool-1',
          type: 'collabAgentToolCall',
          status: 'running',
          action: {
            name: 'Review checkout flow',
            input: {
              prompt: 'Inspect checkout UI regressions.',
            },
          },
        },
      ],
    });

    expect(turn.items[0]).toMatchObject({
      id: 'agent-tool-1',
      kind: 'agentToolCall',
      text: 'Agent: Review checkout flow',
      previewText: 'Agent',
      status: 'running',
    });
  });

  it('keeps MCP tool result text extractable for plugin artifacts', () => {
    const artifactText = [
      'Created a 3D molecule artifact for Methane.',
      '',
      '```remote-codex-artifact',
      '{"type":"remote-codex.artifact","artifactType":"chemistry.molecule3d","title":"Methane","payload":{"format":"xyz","content":["5\\nmethane example"]}}',
      '```',
    ].join('\n');

    const turn = codexTurnToAgentTurn({
      id: 'turn-1',
      status: 'completed',
      error: null,
      items: [
        {
          id: 'mcp-tool-1',
          type: 'mcpToolCall',
          status: 'completed',
          action: {
            mcpServer: 'remote_codex_plugins',
            toolName: 'remote_codex_render_molecule',
          },
          result: {
            output: {
              content: [
                {
                  type: 'text',
                  text: artifactText,
                },
              ],
            },
          },
        },
      ],
    });

    const toolItem = turn.items[0];
    expect(toolItem).toMatchObject({
      kind: 'toolCall',
      text: 'remote_codex_plugins/remote_codex_render_molecule',
      detailText: expect.stringContaining('```remote-codex-artifact'),
    });
    expect(toolItem?.detailText).toContain('\n```remote-codex-artifact\n');
  });

  it('keeps Codex collab agent tool calls visible while running', () => {
    expect(
      liveCodexItemToHistoryItem(
        {
          id: 'agent-tool-1',
          type: 'collabAgentToolCall',
          status: 'running',
          action: {
            name: 'Inspect backend runtime boundaries',
          },
        },
        'started',
      ),
    ).toMatchObject({
      id: 'agent-tool-1',
      kind: 'agentToolCall',
      text: 'Agent: Inspect backend runtime boundaries',
      previewText: 'Agent',
      status: 'running',
    });
  });

  it('shows file changes using project-relative paths when absolute paths are reported', () => {
    const turn = codexTurnToAgentTurn({
      id: 'turn-1',
      status: 'completed',
      error: null,
      items: [
        {
          id: 'file-change-1',
          type: 'fileChange',
          changes: [
            {
              path: '/home/u/dev/remoteCodex/apps/supervisor-web/src/App.tsx',
              additions: 4,
              deletions: 1,
            },
          ],
        },
      ],
    });

    expect(turn.items[0]).toMatchObject({
      kind: 'fileChange',
      text: 'apps/supervisor-web/src/App.tsx',
      detailText: '- apps/supervisor-web/src/App.tsx (+4 -1)',
    });
  });
});
