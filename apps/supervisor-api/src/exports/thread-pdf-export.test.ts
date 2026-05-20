import { describe, expect, it } from 'vitest';

import {
  renderThreadExportHtml,
  renderThreadExportStandaloneHtml,
  ThreadPdfExportSnapshot,
} from './thread-pdf-export';

function snapshot(): ThreadPdfExportSnapshot {
  const turn = {
    id: 'turn-1',
    startedAt: '2026-05-18T03:35:34.000Z',
    status: 'completed' as const,
    error: null,
    items: [
      {
        id: 'user-1',
        kind: 'userMessage' as const,
        text: '请检查 /home/u/dev/remoteCodex/apps/supervisor-api/src/routes/threads.ts',
      },
      {
        id: 'plan-1',
        kind: 'plan' as const,
        text: '- inspect export\n- patch rendering',
      },
      {
        id: 'command-1',
        kind: 'commandExecution' as const,
        text: 'pnpm test\n\nRAW_OUTPUT_SHOULD_NOT_EXPORT',
        status: 'completed',
      },
      {
        id: 'command-2',
        kind: 'commandExecution' as const,
        text: 'pnpm typecheck\n\nRAW_OUTPUT_SHOULD_NOT_EXPORT',
        status: 'completed',
      },
      {
        id: 'file-1',
        kind: 'fileChange' as const,
        text: 'apps/supervisor-api/src/exports/thread-pdf-export.ts',
        changedFiles: 1,
        addedLines: 12,
        removedLines: 3,
      },
      {
        id: 'assistant-1',
        kind: 'agentMessage' as const,
        text: '## Result\n\n- Preserved `/home/u/dev/remoteCodex`\n- Rendered **Markdown** clearly',
      },
      {
        id: 'tool-1',
        kind: 'toolCall' as const,
        text: 'goal update',
      },
    ],
  };

  return {
    thread: {
      id: 'thread-1',
      workspaceId: 'workspace-1',
      provider: 'codex',
      providerSessionId: 'codex-1',
      source: 'supervisor',
      title: 'Workspace Improve',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      collaborationMode: 'default',
      approvalMode: 'yolo',
      status: 'idle',
      summaryText: null,
      lastError: null,
      activeTurnId: null,
      isLoaded: true,
      isPinned: false,
      createdAt: '2026-05-18T03:30:00.000Z',
      updatedAt: '2026-05-18T03:35:34.000Z',
      lastTurnStartedAt: null,
      lastTurnCompletedAt: null,
    },
    workspace: {
      id: 'workspace-1',
      hostId: 'local-host',
      label: 'remoteCodex',
      absPath: '/home/u/dev/remoteCodex',
      isFavorite: false,
      createdAt: '2026-05-18T03:30:00.000Z',
      lastOpenedAt: null,
    },
    exportedAt: '2026-05-18T03:40:00.000Z',
    totalTurnCount: 1,
    selectedTurnNumbers: new Map([['turn-1', 1]]),
    turns: [turn],
    profile: 'review',
    options: {
      includeTokenAndPrice: true,
      includeCommandOutput: false,
      includeAbsolutePaths: false,
    },
  };
}

describe('thread PDF export rendering', () => {
  it('renders review exports as readable message bubbles with Markdown and without tool noise', () => {
    const html = renderThreadExportHtml(snapshot());

    expect(html).toContain('message-user');
    expect(html).toContain('message-agent');
    expect(html).toContain('/home/u/dev/remoteCodex/apps/supervisor-api/src/routes/threads.ts');
    expect(html).toContain('<h2>Result</h2>');
    expect(html).toContain('<strong>Markdown</strong>');
    expect(html).not.toContain('{workspace}');
    expect(html).not.toContain('redacted');
    expect(html).not.toContain('item-commandExecution');
    expect(html).not.toContain('item-fileChange');
    expect(html).not.toContain('item-plan');
    expect(html).not.toContain('item-toolCall');
  });

  it('renders standalone HTML as a shareable timeline without raw command output', () => {
    const html = renderThreadExportStandaloneHtml({
      ...snapshot(),
      profile: 'technical',
    });

    expect(html).toContain('<main class="share-shell">');
    expect(html).toContain('message-user');
    expect(html).toContain('message-agent');
    expect(html).toContain('<h2>Result</h2>');
    expect(html).toContain('Command');
    expect(html).toContain('<details class="event event-batch">');
    expect(html).not.toContain('<details class="event event-batch" open>');
    expect(html).toContain('Raw command output is intentionally omitted');
    expect(html).not.toContain('RAW_OUTPUT_SHOULD_NOT_EXPORT');
    expect(html).not.toContain('Thread list');
    expect(html).not.toContain('Ask Codex');
  });
});
