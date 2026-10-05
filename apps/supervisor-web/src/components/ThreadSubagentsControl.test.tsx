import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ThreadDetailDto } from '@remote-codex/shared';
import { ThreadSubagentsControl } from './ThreadSubagentsControl';

function detail(activeSubagents: ThreadDetailDto['activeSubagents']): ThreadDetailDto {
  return {
    thread: { id: 'thread-1' } as ThreadDetailDto['thread'],
    workspace: {} as ThreadDetailDto['workspace'],
    workspacePathStatus: 'present',
    turns: [],
    pendingRequests: [],
    pendingSteers: [],
    activeSubagents: activeSubagents ?? [],
  };
}

describe('ThreadSubagentsControl', () => {
  it('shows the running native subagent count and details', () => {
    render(
      <ThreadSubagentsControl
        detail={detail([
          {
            id: 'agent-1',
            name: 'Task',
            status: 'running',
            startedAt: null,
            completedAt: null,
            parentToolCallId: null,
          },
          {
            id: 'agent-2',
            name: 'Completed task',
            status: 'completed',
            startedAt: null,
            completedAt: null,
            parentToolCallId: null,
          },
        ])}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Subagents (1)' });
    expect(trigger).toHaveTextContent('1');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Native subagents' })).toHaveTextContent(
      'Task',
    );
    expect(screen.getByText('1 currently running')).toBeVisible();
  });

  it('hides itself when no native subagent is running', () => {
    const { container } = render(
      <ThreadSubagentsControl detail={detail([])} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
