import { describe, expect, it } from 'vitest';

import {
  openCodeMessagesToTurns,
  openCodeMessageToHistoryItems,
  openCodeMessagesToPlanUpdate,
} from './historyItems';

describe('OpenCode history item mapping', () => {
  it('maps projected OpenCode message kinds to timeline items', () => {
    const messages = [
      {
        id: 'user-1',
        type: 'user',
        text: 'Implement the feature',
        time: { created: 1_700_000_000_000 },
      },
      {
        id: 'assistant-1',
        type: 'assistant',
        time: { created: 1_700_000_001_000 },
        agent: 'build',
        model: { id: 'gpt-5', providerID: 'openai', variant: 'default' },
        content: [
          { type: 'reasoning', id: 'reasoning-1', text: 'Need to inspect files.' },
          { type: 'text', text: 'I will update the module.' },
          {
            type: 'tool',
            id: 'tool-1',
            name: 'bash',
            state: {
              status: 'completed',
              input: { command: 'pnpm test' },
              content: [{ type: 'text', text: 'ok' }],
              structured: {},
            },
          },
        ],
      },
      {
        id: 'shell-1',
        type: 'shell',
        command: 'git status',
        output: 'clean',
        time: { created: 1_700_000_002_000, completed: 1_700_000_003_000 },
      },
      {
        id: 'synthetic-1',
        type: 'synthetic',
        text: 'System note',
        time: { created: 1_700_000_004_000 },
      },
      {
        id: 'agent-1',
        type: 'agent-switched',
        agent: 'review',
        time: { created: 1_700_000_005_000 },
      },
      {
        id: 'model-1',
        type: 'model-switched',
        model: { id: 'claude-sonnet', providerID: 'anthropic', variant: 'default' },
        time: { created: 1_700_000_006_000 },
      },
      {
        id: 'compact-1',
        type: 'compaction',
        reason: 'manual',
        summary: 'Summary text',
        time: { created: 1_700_000_007_000 },
      },
    ];

    const turns = openCodeMessagesToTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.items.map((item) => item.kind)).toEqual([
      'userMessage',
      'reasoning',
      'agentMessage',
      'commandExecution',
      'commandExecution',
      'other',
      'other',
      'other',
      'contextCompaction',
    ]);
  });

  it('maps tool state variants without dropping bubbles', () => {
    const toolStates = ['pending', 'running', 'completed', 'error'].map((status, index) => ({
      id: `assistant-${index}`,
      type: 'assistant',
      content: [
        {
          type: 'tool',
          id: `tool-${index}`,
          name: index === 0 ? 'read' : index === 1 ? 'web_search' : index === 2 ? 'edit' : 'custom',
          state: {
            status,
            input: { path: 'src/index.ts', query: 'docs' },
            content: [{ type: 'text', text: 'result' }],
            structured: {},
            error: status === 'error' ? { message: 'failed' } : undefined,
          },
        },
      ],
    }));

    const items = toolStates.flatMap((message) => openCodeMessageToHistoryItems(message));
    expect(items.map((item) => item.kind)).toEqual([
      'fileRead',
      'webSearch',
      'fileChange',
      'toolCall',
    ]);
    expect(items.map((item) => item.status)).toEqual([
      'running',
      'running',
      'completed',
      'failed',
    ]);
  });

  it('summarizes bash tools with the command instead of the description', () => {
    const items = openCodeMessageToHistoryItems({
      id: 'assistant-bash',
      type: 'assistant',
      content: [
        {
          type: 'tool',
          id: 'bash-1',
          tool: 'bash',
          state: {
            status: 'completed',
            input: {
              command: 'npx tsx --test packages/frontend/src/tokenUsage.test.ts',
              description: 'Runs TypeScript token usage tests',
              timeout: 120000,
              workdir: '/home/u/dev/ElAgente/graphchat',
            },
            output: 'ok',
          },
        },
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'bash-1',
        kind: 'commandExecution',
        text: 'npx tsx --test packages/frontend/src/tokenUsage.test.ts',
        previewText: 'npx tsx --test packages/frontend/src/tokenUsage.test.ts',
      }),
    ]);
  });

  it('maps OpenCode todo tools to plan updates and apply_patch tools to useful bubbles', () => {
    const message = {
      id: 'assistant-tools',
      type: 'assistant',
      content: [
        {
          type: 'tool',
          id: 'todo-1',
          tool: 'todowrite',
          state: {
            status: 'completed',
            input: {
              todos: [
                { content: 'Inspect code', status: 'in_progress', priority: 'high' },
                { content: 'Patch code', status: 'pending', priority: 'high' },
              ],
            },
            output: '[]',
            title: '2 todos',
            metadata: {},
          },
        },
        {
          type: 'tool',
          id: 'patch-1',
          name: 'apply_patch',
          state: {
            status: 'completed',
            input: {
              patchText: [
                '*** Begin Patch',
                '*** Update File: /tmp/project/src/index.ts',
                '@@',
                '+const ok = true;',
                '-const ok = false;',
                '*** End Patch',
              ].join('\n'),
            },
            output: 'Success. Updated the following files:\nM src/index.ts',
            title: 'Success. Updated the following files',
            metadata: {
              files: [
                {
                  filePath: '/tmp/project/src/index.ts',
                  type: 'update',
                  additions: 1,
                  deletions: 1,
                },
              ],
            },
          },
        },
      ],
    };
    const items = openCodeMessageToHistoryItems({
      ...message,
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'patch-1',
        kind: 'fileChange',
        text: '/tmp/project/src/index.ts',
        previewText: '/tmp/project/src/index.ts',
        changedFiles: 1,
        addedLines: 1,
        removedLines: 1,
      }),
    ]);
    expect(openCodeMessagesToPlanUpdate([message])).toEqual({
      explanation: null,
      plan: [
        { step: 'Inspect code', status: 'in_progress' },
        { step: 'Patch code', status: 'pending' },
      ],
    });
  });

  it('extracts file read paths and suppresses empty pending apply_patch tools', () => {
    const items = openCodeMessageToHistoryItems({
      id: 'assistant-read-patch',
      type: 'assistant',
      content: [
        {
          type: 'tool',
          id: 'read-1',
          name: 'read',
          state: {
            status: 'completed',
            input: {
              filePath: '/tmp/project/src/tokenUsage.ts',
              limit: 260,
              offset: 1,
            },
            output: '<path>/tmp/project/src/tokenUsage.ts</path>',
          },
        },
        {
          type: 'tool',
          id: 'patch-pending-1',
          name: 'apply_patch',
          state: {
            status: 'pending',
            input: {},
            raw: '',
          },
        },
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'read-1',
        kind: 'fileRead',
        text: '/tmp/project/src/tokenUsage.ts',
        previewText: '/tmp/project/src/tokenUsage.ts',
      }),
    ]);
  });

  it('uses workspace-relative paths for file bubbles and keeps external absolute paths', () => {
    const items = openCodeMessageToHistoryItems({
      id: 'assistant-paths',
      type: 'assistant',
      content: [
        {
          type: 'tool',
          id: 'read-in-root',
          name: 'read',
          state: {
            status: 'completed',
            input: {
              filePath: '/tmp/project/src/tokenUsage.ts',
            },
            output: '',
          },
        },
        {
          type: 'tool',
          id: 'read-outside-root',
          name: 'read',
          state: {
            status: 'completed',
            input: {
              filePath: '/tmp/other/src/tokenUsage.ts',
            },
            output: '',
          },
        },
        {
          type: 'tool',
          id: 'patch-in-root',
          name: 'apply_patch',
          state: {
            status: 'completed',
            input: {},
            metadata: {
              files: [
                {
                  filePath: '/tmp/project/src/index.ts',
                  additions: 2,
                  deletions: 1,
                },
              ],
            },
          },
        },
      ],
    }, {
      workspacePath: '/tmp/project',
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'read-in-root',
        kind: 'fileRead',
        text: 'src/tokenUsage.ts',
        previewText: 'src/tokenUsage.ts',
      }),
      expect.objectContaining({
        id: 'read-outside-root',
        kind: 'fileRead',
        text: '/tmp/other/src/tokenUsage.ts',
        previewText: '/tmp/other/src/tokenUsage.ts',
      }),
      expect.objectContaining({
        id: 'patch-in-root',
        kind: 'fileChange',
        text: 'src/index.ts',
        previewText: 'src/index.ts',
      }),
    ]);
  });

  it('maps OpenCode SDK part variants without falling back to raw JSON', () => {
    const items = openCodeMessageToHistoryItems({
      id: 'assistant-parts',
      type: 'assistant',
      content: [
        {
          id: 'file-1',
          type: 'file',
          filename: 'src/index.ts',
          mime: 'text/typescript',
          url: 'file:///tmp/project/src/index.ts',
          source: {
            type: 'file',
            path: 'src/index.ts',
            text: { value: 'export {}', start: 0, end: 9 },
          },
        },
        {
          id: 'patch-part-1',
          type: 'patch',
          hash: 'abc',
          files: ['src/index.ts', 'src/app.ts'],
        },
        {
          id: 'step-start-1',
          type: 'step-start',
        },
        {
          id: 'step-finish-1',
          type: 'step-finish',
          reason: 'stop',
          cost: 0.01,
          tokens: {
            input: 10,
            output: 5,
            reasoning: 2,
            cache: { read: 1, write: 0 },
          },
        },
        {
          id: 'agent-1',
          type: 'agent',
          name: 'build',
          source: { value: 'Use build agent', start: 0, end: 15 },
        },
        {
          id: 'subtask-1',
          type: 'subtask',
          prompt: 'Inspect files',
          description: 'Inspect repository',
          agent: 'build',
        },
        {
          id: 'retry-1',
          type: 'retry',
          attempt: 2,
          error: { message: 'rate limited' },
          time: { created: 1 },
        },
        {
          id: 'compact-1',
          type: 'compaction',
          auto: true,
        },
      ],
    });

    expect(items.map((item) => item.kind)).toEqual([
      'fileRead',
      'fileChange',
      'agentToolCall',
      'agentToolCall',
      'other',
      'contextCompaction',
    ]);
    expect(items[0]).toMatchObject({
      text: 'src/index.ts',
      detailText: 'export {}',
    });
    expect(items[1]).toMatchObject({
      text: 'src/index.ts\nsrc/app.ts',
      changedFiles: 2,
    });
    expect(items[4]).toMatchObject({
      text: 'Retry 2: rate limited',
      status: 'failed',
    });
  });

  it('maps legacy SDK message wrappers to timeline items', () => {
    const turns = openCodeMessagesToTurns([
      {
        info: {
          id: 'user-1',
          role: 'user',
          time: { created: 1_700_000_000_000 },
        },
        parts: [{ type: 'text', text: 'hi' }],
      },
      {
        info: {
          id: 'assistant-1',
          role: 'assistant',
          time: { created: 1_700_000_001_000, completed: 1_700_000_002_000 },
          providerID: 'openai',
          modelID: 'gpt-5.5',
        },
        parts: [
          { id: 'text-1', type: 'text', text: 'hello' },
          {
            id: 'tool-1',
            type: 'tool',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'pwd' },
              output: '/tmp/project',
            },
          },
        ],
      },
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.items.map((item) => item.kind)).toEqual([
      'userMessage',
      'agentMessage',
      'commandExecution',
    ]);
    expect(turns[0]!.items[1]).toMatchObject({
      kind: 'agentMessage',
      text: 'hello',
    });
  });

  it('keeps user-only legacy turns in progress', () => {
    const turns = openCodeMessagesToTurns([
      {
        info: {
          id: 'user-1',
          role: 'user',
          time: { created: 1_700_000_000_000 },
        },
        parts: [{ type: 'text', text: 'hi' }],
      },
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      status: 'inProgress',
      items: [{ kind: 'userMessage', text: 'hi' }],
    });
  });
});
