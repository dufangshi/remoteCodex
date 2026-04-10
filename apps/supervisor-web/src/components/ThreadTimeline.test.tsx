import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ThreadTimeline } from './ThreadTimeline';

function makeTurn(index: number) {
  return {
    id: `019d70dd-068b-7${(index % 10).toString(16)}83-9c83-f4943e1f38${index
      .toString(16)
      .padStart(2, '0')}`,
    startedAt: new Date(Date.UTC(2026, 3, 9, 6, index, 0)).toISOString(),
    status: 'completed' as const,
    error: null,
    items: [
      {
        id: `item-${index}`,
        kind: 'userMessage' as const,
        text: `Prompt ${index}`,
      },
    ],
  };
}

describe('ThreadTimeline', () => {
  it('shows the latest ten turns first and can load more history progressively', () => {
    const turns = Array.from({ length: 35 }, (_, index) => makeTurn(index + 1));

    render(<ThreadTimeline turns={turns} liveOutput="" />);

    expect(screen.getByText('Showing 10 of 35 turns.')).toBeInTheDocument();
    expect(screen.queryByText('Turn 1')).not.toBeInTheDocument();
    expect(screen.getByText('Turn 26')).toBeInTheDocument();
    expect(screen.getByText('Turn 35')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load 10 earlier' }));

    expect(screen.getByText('Showing 20 of 35 turns.')).toBeInTheDocument();
    expect(screen.getByText('Turn 16')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Load full history' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load 10 earlier' }));

    expect(screen.getByText('Showing 30 of 35 turns.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Load full history' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load full history' }));

    expect(screen.getByText('Showing 35 of 35 turns.')).toBeInTheDocument();
    expect(screen.getByText('Turn 1')).toBeInTheDocument();
    expect(
      screen.queryByText(/019d70dd-068b-7783-9c83-f4943e1f38/i),
    ).not.toBeInTheDocument();
  });

  it('renders user and agent messages without separate title rows', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Please inspect the failing build.',
              },
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'I found the failure in the API startup path.',
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByText('Please inspect the failing build.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('I found the failure in the API startup path.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('User')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent')).not.toBeInTheDocument();
  });

  it('renders agent replies as markdown with headings, lists, and code blocks', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: [
                  '## Fix summary',
                  '',
                  '- first item',
                  '- second item',
                  '',
                  '```ts',
                  'const value = 42;',
                  '```',
                ].join('\n'),
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Fix summary' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('first item')).toBeInTheDocument();
    expect(screen.getByText('second item')).toBeInTheDocument();
    expect(screen.getByText('const value = 42;')).toBeInTheDocument();
  });

  it('collapses command output and opens the full text in a reusable dialog', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm test\nmiddle output line\nfinal status: success',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Open full command' }),
    ).toHaveTextContent('pnpm test');
    expect(
      screen.getByRole('button', { name: 'Open full command' }),
    ).toHaveTextContent('final status: success');
    expect(
      screen.getByRole('button', { name: 'Open full command' }),
    ).toHaveTextContent('...');
    expect(screen.queryByText('middle output line')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open full command' }));

    expect(
      screen.getByRole('dialog', { name: 'Command Output' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Command Output' }),
    ).toHaveTextContent('middle output line');

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));

    expect(
      screen.queryByRole('dialog', { name: 'Command Output' }),
    ).not.toBeInTheDocument();
  });

  it('can collapse and expand an entire turn', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Collapsed content should disappear.',
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByText('Collapsed content should disappear.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse turn 1' }));

    expect(
      screen.queryByText('Collapsed content should disappear.'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand turn 1' }));

    expect(
      screen.getByText('Collapsed content should disappear.'),
    ).toBeInTheDocument();
  });
});
