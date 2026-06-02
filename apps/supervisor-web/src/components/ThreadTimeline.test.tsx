import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreadTimeline } from './ThreadTimeline';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  private readonly observed = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    public readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }

  takeRecords() {
    return [];
  }

  triggerAll(isIntersecting = true) {
    const entries = Array.from(this.observed).map((target) => ({
      isIntersecting,
      target,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRatio: isIntersecting ? 1 : 0,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      time: 0,
    })) as IntersectionObserverEntry[];

    if (entries.length > 0) {
      this.callback(entries, this as unknown as IntersectionObserver);
    }
  }

  static triggerAll(isIntersecting = true) {
    FakeIntersectionObserver.instances.forEach((instance) =>
      instance.triggerAll(isIntersecting),
    );
  }

  static reset() {
    FakeIntersectionObserver.instances = [];
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  private readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }

  trigger(target?: Element) {
    const targets = target ? [target] : Array.from(this.observed);
    if (targets.length === 0) {
      return;
    }

    const entries = targets.map((entryTarget) => ({
      target: entryTarget,
      contentRect: entryTarget.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    })) as ResizeObserverEntry[];

    this.callback(entries, this as unknown as ResizeObserver);
  }

  static triggerAll(target?: Element) {
    FakeResizeObserver.instances.forEach((instance) => instance.trigger(target));
  }

  static reset() {
    FakeResizeObserver.instances = [];
  }
}

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

function mockRect({
  top,
  height,
  width = 640,
}: {
  top: number;
  height: number;
  width?: number;
}) {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    width,
    height,
    right: width,
    bottom: top + height,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

describe('ThreadTimeline', () => {
  beforeEach(() => {
    FakeIntersectionObserver.reset();
    FakeResizeObserver.reset();
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver as unknown as typeof IntersectionObserver);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });
  });

  it('shows the latest ten turns first and can load more history progressively', () => {
    const turns = Array.from({ length: 35 }, (_, index) => makeTurn(index + 1));

    render(<ThreadTimeline turns={turns} liveOutput="" />);

    expect(screen.getByText(/Showing 10 of 35 turns/)).toBeInTheDocument();
    expect(screen.queryByText('Turn 1')).not.toBeInTheDocument();
    expect(screen.getByText('Turn 26')).toBeInTheDocument();
    expect(screen.getByText('Turn 35')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load 10 earlier' }));

    expect(screen.getByText(/Showing 20 of 35 turns/)).toBeInTheDocument();
    expect(screen.getByText('Turn 16')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Load full history' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load 10 earlier' }));

    expect(screen.getByText(/Showing 30 of 35 turns/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Load full history' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load full history' }));

    expect(screen.getByText(/Showing 35 of 35 turns/)).toBeInTheDocument();
    expect(screen.getByText('Turn 1')).toBeInTheDocument();
    expect(
      screen.queryByText(/019d70dd-068b-7783-9c83-f4943e1f38/i),
    ).not.toBeInTheDocument();
  });

  it('requests earlier turns from the server when history is paged remotely', () => {
    const onLoadEarlier = vi.fn();
    const latestTurns = Array.from({ length: 10 }, (_, index) => makeTurn(index + 26));
    const earlierTurns = Array.from({ length: 10 }, (_, index) => makeTurn(index + 16));
    const { rerender } = render(
      <ThreadTimeline
        turns={latestTurns}
        totalTurnCount={35}
        liveOutput=""
        onLoadEarlier={onLoadEarlier}
      />,
    );

    expect(screen.getByText(/Showing 10 of 35 turns/)).toBeInTheDocument();
    expect(screen.getByText('Turn 26')).toBeInTheDocument();
    expect(screen.getByText('Turn 35')).toBeInTheDocument();
    expect(screen.queryByText('Turn 25')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load 10 earlier' }));

    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Showing 10 of 35 turns/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Load full history' }),
    ).not.toBeInTheDocument();

    rerender(
      <ThreadTimeline
        turns={[...earlierTurns, ...latestTurns]}
        totalTurnCount={35}
        liveOutput=""
        onLoadEarlier={onLoadEarlier}
      />,
    );

    expect(screen.getByText(/Showing 10 of 35 turns/)).toBeInTheDocument();
    expect(screen.getByText('Turn 26')).toBeInTheDocument();
    expect(screen.getByText('Turn 35')).toBeInTheDocument();
    expect(screen.queryByText('Turn 16')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load 10 earlier' }));

    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Showing 20 of 35 turns/)).toBeInTheDocument();
    expect(screen.getByText('Turn 16')).toBeInTheDocument();
    expect(screen.queryByText('Turn 15')).not.toBeInTheDocument();
  });

  it('renders user and agent messages without separate title rows', async () => {
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

    FakeIntersectionObserver.triggerAll();

    await waitFor(() => {
      expect(
        screen.getByText('I found the failure in the API startup path.'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText('Please inspect the failing build.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('User')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent')).not.toBeInTheDocument();
  });

  it('collapses large completed messages behind an explicit full-message toggle', () => {
    const longMessage = `${'A'.repeat(4_050)}TAIL-CONTENT`;

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
                text: longMessage,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText(/\.\.\./)).toBeInTheDocument();
    expect(screen.queryByText(/TAIL-CONTENT/)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: `Show full message (${longMessage.length.toLocaleString()} chars)`,
      }),
    );

    expect(screen.getByText(/TAIL-CONTENT/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('attaches reasoning to the following agent message behind an expander', async () => {
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
                id: 'reasoning-1',
                kind: 'reasoning',
                text: 'I should inspect the failing command first.',
              },
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'The failing command is npm test.',
              },
            ],
          },
        ]}
      />,
    );

    FakeIntersectionObserver.triggerAll();

    await screen.findByText('The failing command is npm test.');
    expect(screen.queryByText('Reasoning', { selector: '.timeline-meta-text' })).not.toBeInTheDocument();
    expect(screen.queryByText('I should inspect the failing command first.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Thinking/i }));

    expect(screen.getByText('I should inspect the failing command first.')).toBeInTheDocument();
  });

  it('attaches trailing live reasoning to a completed agent message before the turn ends', async () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'agent-1',
              kind: 'agentMessage',
              text: 'The direct answer is ready.',
              status: 'completed',
            },
            {
              id: 'reasoning-1',
              kind: 'reasoning',
              text: 'I checked the context and selected the concise answer.',
              status: 'completed',
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Answer briefly.',
              },
            ],
          },
        ]}
      />,
    );

    FakeIntersectionObserver.triggerAll();

    await screen.findByText('The direct answer is ready.');
    expect(screen.queryByText('I checked the context and selected the concise answer.')).not.toBeInTheDocument();
    expect(screen.queryByText('Reasoning', { selector: '.timeline-meta-text' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Thinking/i }));

    expect(screen.getByText('I checked the context and selected the concise answer.')).toBeInTheDocument();
  });

  it('attaches Claude reasoning to the eventual agent message even when tool items intervene', async () => {
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
                id: 'reasoning-1',
                kind: 'reasoning',
                text: 'I should produce a plan and avoid code edits.',
              },
              {
                id: 'file-1',
                kind: 'fileChange',
                text: '/home/u/.claude/plans/example.md',
                previewText: 'Plan file',
                changedFiles: 1,
              },
              {
                id: 'plan-1',
                kind: 'plan',
                text: '# Plan\n\n- Inspect files.',
              },
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Here is the plan.',
              },
            ],
          },
        ]}
      />,
    );

    FakeIntersectionObserver.triggerAll();

    await screen.findByText('Here is the plan.');
    expect(screen.queryByText('I should produce a plan and avoid code edits.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Thinking/i }));

    expect(screen.getByText('I should produce a plan and avoid code edits.')).toBeInTheDocument();
    expect(screen.queryByText('Reasoning')).not.toBeInTheDocument();
  });

  it('renders pending live reasoning before Claude emits assistant text', async () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'reasoning-1',
              kind: 'reasoning',
              text: 'I am checking the image contents.',
              status: 'running',
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: '图中数字是多少？',
              },
            ],
          },
        ]}
      />,
    );

    FakeIntersectionObserver.triggerAll();

    await screen.findByText('I am checking the image contents.');
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.queryByText('Agent')).not.toBeInTheDocument();
  });

  it('renders inline photo and file attachments inside user messages', () => {
    render(
      <ThreadTimeline
        threadId="thread-1"
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
                text: 'Please inspect [PHOTO ./.temp/threads/thread-1/camera.png] and [FILE ./.temp/threads/thread-1/notes.txt] today.',
              },
            ],
          },
        ]}
      />,
    );

    const image = screen.getByAltText('camera.png');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute(
      'src',
      '/api/threads/thread-1/assets/image?path=.%2F.temp%2Fthreads%2Fthread-1%2Fcamera.png',
    );
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText(/Please inspect/)).toBeInTheDocument();
    expect(screen.getByText(/today\./)).toBeInTheDocument();
  });

  it('keeps plain text agent replies as plain text even after viewport activation', async () => {
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
                text: 'A plain response without markdown syntax.',
              },
            ],
          },
        ]}
      />,
    );

    FakeIntersectionObserver.triggerAll();

    await waitFor(() => {
      expect(
        screen.getByText('A plain response without markdown syntax.'),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('highlights plain links in agent text without requiring markdown syntax', async () => {
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
                text: 'See https://example.com/docs for details.',
              },
            ],
          },
        ]}
      />,
    );

    FakeIntersectionObserver.triggerAll();

    const link = await screen.findByRole('link', { name: 'https://example.com/docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveClass('thread-inline-link');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders agent replies as markdown once they enter the viewport', async () => {
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

    expect(screen.queryByRole('heading', { name: 'Fix summary' })).not.toBeInTheDocument();
    expect(screen.getByText(/## Fix summary/)).toBeInTheDocument();

    FakeIntersectionObserver.triggerAll();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Fix summary' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('first item')).toBeInTheDocument();
    expect(screen.getByText('second item')).toBeInTheDocument();
    expect(screen.getByText('const value = 42;')).toBeInTheDocument();
  });

  it('keeps JSON code blocks readable with preserved line breaks', async () => {
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
                  '```json',
                  '{',
                  '  "name": "remoteCodex",',
                  '  "scripts": {',
                  '    "build": "vite build"',
                  '  }',
                  '}',
                  '```',
                ].join('\n'),
              },
            ],
          },
        ]}
      />,
    );

    FakeIntersectionObserver.triggerAll();

    await waitFor(() => {
      expect(screen.getByText(/"name": "remoteCodex"/)).toBeInTheDocument();
    });

    const pre = screen.getByText(/"name": "remoteCodex"/).closest('pre');
    expect(pre).toHaveTextContent(/"scripts": \{\s+"build": "vite build"\s+\}/);
    const code = pre?.querySelector('code');
    expect(code?.children.length).toBeGreaterThan(1);
  });

  it('renders markdown soft line breaks as visible line breaks', async () => {
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
                  '**Repository tree**',
                  '.',
                  '├── README.md',
                  '├── pyproject.toml',
                ].join('\n'),
              },
            ],
          },
        ]}
      />,
    );

    FakeIntersectionObserver.triggerAll();

    await waitFor(() => {
      expect(screen.getByText('Repository tree')).toBeInTheDocument();
    });

    const paragraph = screen.getByText('Repository tree').closest('p');
    expect(paragraph?.querySelectorAll('br')).toHaveLength(3);
    expect(paragraph).toHaveTextContent('Repository tree');
    expect(paragraph).toHaveTextContent('├── README.md');
    expect(paragraph).toHaveTextContent('├── pyproject.toml');
  });

  it('copies the full agent reply from the floating copy button', async () => {
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
                text: 'Full agent reply with\nmultiple lines.',
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy agent reply' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'Full agent reply with\nmultiple lines.',
      );
    });
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
    ).toHaveTextContent('...');
    expect(
      screen.getByRole('button', { name: 'Open full command' }),
    ).not.toHaveTextContent('final status: success');
    const statusButton = screen.getByRole('button', {
      name: 'Command status: completed',
    });
    expect(statusButton).toHaveClass('timeline-command-status-complete');
    expect(statusButton).not.toHaveTextContent('completed');
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

  it('prefers command preview text over legacy tool labels', () => {
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
                text: 'Tool: bash',
                previewText: 'pnpm --filter @remote-codex/opencode test',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Open full command' }),
    ).toHaveTextContent('pnpm --filter @remote-codex/opencode test');
    expect(
      screen.getByRole('button', { name: 'Open full command' }),
    ).not.toHaveTextContent('Tool: bash');
  });

  it('renders unfinished command status as a compact pending icon only', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm test --watch',
                status: 'running',
              },
            ],
          },
        ]}
      />,
    );

    const statusButton = screen.getByRole('button', {
      name: 'Command status: running',
    });
    expect(statusButton).toHaveClass('timeline-command-status-pending');
    expect(statusButton).not.toHaveTextContent('running');
  });

  it('renders hook output as a compact bubble summary', () => {
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
                id: 'hook-1',
                kind: 'hook',
                text: 'Stop hook',
                status: 'Completed',
                hookEventName: 'stop',
                hookEventLabel: 'Stop',
                hookHandlerType: 'command',
                hookScope: 'turn',
                hookSource: 'project',
                hookStatusMessage: 'Stop hook',
                hookOutputEntries: [
                  {
                    kind: 'context',
                    text: 'Hook printed stop details.',
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Hook · Stop')).toBeInTheDocument();
    expect(screen.getByText('Stop hook')).toBeInTheDocument();
    expect(screen.getByText('Hook printed stop details.')).toBeInTheDocument();
    expect(screen.queryByText('...')).not.toBeInTheDocument();
    expect(screen.queryByText('command')).not.toBeInTheDocument();
    expect(screen.queryByText('turn')).not.toBeInTheDocument();
    expect(screen.queryByText('project')).not.toBeInTheDocument();
  });

  it('renders live hook prompt output as a hook bubble', () => {
    render(
      <ThreadTimeline
        liveOutput='<hook_prompt hook_run_id="stop:0:/tmp/demo/.codex/hooks.json">remote-codex hook ran</hook_prompt>'
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [],
          },
        ]}
      />,
    );

    expect(screen.getByText('Hook · Stop')).toBeInTheDocument();
    expect(screen.getByText('Stop hook')).toBeInTheDocument();
    expect(screen.getByText('remote-codex hook ran')).toBeInTheDocument();
    expect(screen.queryByText(/hook_prompt/)).not.toBeInTheDocument();
  });

  it('keeps hook identity visible when the hook has no recorded output', () => {
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
                id: 'hook-1',
                kind: 'hook',
                text: 'Stop hook',
                previewText: 'Running hook',
                status: 'Completed',
                hookEventName: 'stop',
                hookEventLabel: 'Stop',
                hookStatusMessage: 'Running hook',
                hookOutputEntries: [],
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Hook · Stop')).toBeInTheDocument();
    expect(screen.getByText('Stop hook · Running hook')).toBeInTheDocument();
  });

  it('loads deferred command details on demand before opening the dialog', async () => {
    const loadDetail = vi.fn(async () => ({
      id: 'command-1',
      kind: 'commandExecution' as const,
      title: 'Command Output',
      text: 'pnpm test\nmiddle output line\nfinal status: success',
    }));

    render(
      <ThreadTimeline
        liveOutput=""
        onLoadHistoryItemDetail={loadDetail}
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
                text: 'pnpm test',
                detailText: null,
                hasDeferredDetail: true,
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open full command' }));

    expect(loadDetail).toHaveBeenCalledWith('command-1');
    expect(
      screen.getByRole('dialog', { name: 'Command Output' }),
    ).toHaveTextContent('Loading full command output...');

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Command Output' }),
      ).toHaveTextContent('middle output line');
    });
  });

  it('loads deferred tool call details on demand before opening the dialog', async () => {
    const loadDetail = vi.fn(async () => ({
      id: 'tool-1',
      kind: 'toolCall' as const,
      title: 'Tool Call Details',
      text: 'openaiDeveloperDocs/list_api_endpoints\n\nArguments\n{\n  "limit": 5\n}\n\nResult\n{\n  "count": 123\n}',
    }));

    render(
      <ThreadTimeline
        liveOutput=""
        onLoadHistoryItemDetail={loadDetail}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'tool-1',
                kind: 'toolCall',
                text: 'openaiDeveloperDocs/list_api_endpoints',
                detailText: null,
                hasDeferredDetail: true,
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open full tool call' }));

    expect(loadDetail).toHaveBeenCalledWith('tool-1');
    expect(
      screen.getByRole('dialog', { name: 'Tool Call Details' }),
    ).toHaveTextContent('Loading full tool call details...');

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Tool Call Details' }),
      ).toHaveTextContent('"count": 123');
    });
  });

  it('groups consecutive command outputs into a single collapsible bubble', () => {
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
                text: 'pnpm test\nok',
                status: 'completed',
              },
              {
                id: 'command-2',
                kind: 'commandExecution',
                text: 'pnpm lint\nok',
                status: 'completed',
              },
              {
                id: 'command-3',
                kind: 'commandExecution',
                text: 'pnpm typecheck\nok',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Batch')).toBeInTheDocument();
    expect(screen.getByText('3 commands')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand 3 command entries' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Collapsed execution block')).not.toBeInTheDocument();
    expect(screen.queryByText('Show steps')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open full command' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand 3 command entries' }));

    expect(
      screen.getByRole('button', { name: 'Collapse 3 command entries' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open grouped command 1' })).toHaveTextContent(
      'pnpm test',
    );
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open grouped command 2' })).toHaveTextContent(
      'pnpm lint',
    );
    expect(screen.getByRole('button', { name: 'Open grouped command 3' })).toHaveTextContent(
      'pnpm typecheck',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collapse 3 command entries' }));

    expect(
      screen.queryByRole('button', { name: 'Open grouped command 1' }),
    ).not.toBeInTheDocument();
  });

  it('does not group commands across an intervening agent message', () => {
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
                text: 'pnpm lint\nok',
                status: 'completed',
              },
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Lint passed, now testing.',
              },
              {
                id: 'command-2',
                kind: 'commandExecution',
                text: 'pnpm test\nok',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByText('2 commands')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open full command' })).toHaveLength(2);
    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(timelineText.indexOf('pnpm lint')).toBeLessThan(
      timelineText.indexOf('Lint passed, now testing.'),
    );
    expect(timelineText.indexOf('Lint passed, now testing.')).toBeLessThan(
      timelineText.indexOf('pnpm test'),
    );
  });

  it('renders file change items with compact stats and expandable details', () => {
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
                id: 'file-change-1',
                kind: 'fileChange',
                text: 'workspace/project/src/features/release/important/app.ts, +2 more',
                previewText: '3 files changed · +19 · -4',
                detailText: [
                  '- src/app.ts (+12 -1)',
                  '- src/routes.ts (+4 -3)',
                  '- src/ui.tsx (+3)',
                ].join('\n'),
                changedFiles: 3,
                addedLines: 19,
                removedLines: 4,
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('3 files')).toBeInTheDocument();
    expect(screen.getByText(/\.\.\.\/features\/release\/important\/app\.ts, \+2 more/)).toBeInTheDocument();
    expect(screen.getByText('+19')).toBeInTheDocument();
    expect(screen.getByText('-4')).toBeInTheDocument();
    expect(screen.getByText('+19')).toHaveClass('text-emerald-300');
    expect(screen.getByText('-4')).toHaveClass('text-rose-300');
    expect(screen.queryByText('completed')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open file change details' }));

    expect(
      screen.getByRole('dialog', { name: 'File Change Details' }),
    ).toHaveTextContent('src/ui.tsx (+3)');
  });

  it('groups consecutive file change items into a collapsible batch', () => {
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
                id: 'file-change-1',
                kind: 'fileChange',
                text: 'src/app.ts',
                previewText: '1 file changed · +12 · -1',
                detailText: '- src/app.ts (+12 -1)',
                changedFiles: 1,
                addedLines: 12,
                removedLines: 1,
                status: 'completed',
              },
              {
                id: 'file-change-2',
                kind: 'fileChange',
                text: 'src/routes.ts',
                previewText: '1 file changed · +4 · -3',
                detailText: '- src/routes.ts (+4 -3)',
                changedFiles: 1,
                addedLines: 4,
                removedLines: 3,
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('2 file changes')).toBeInTheDocument();
    expect(screen.getByText('2 files')).toBeInTheDocument();
    expect(screen.getByText('+16')).toBeInTheDocument();
    expect(screen.getByText('-4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand 2 file change entries' }));

    expect(screen.getByRole('button', { name: 'Open grouped file change 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open grouped file change 2' })).toBeInTheDocument();
    expect(screen.getByText('src/routes.ts')).toBeInTheDocument();
  });

  it('does not group file changes across an intervening agent message', () => {
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
                id: 'file-change-1',
                kind: 'fileChange',
                text: 'src/app.ts',
                previewText: '1 file changed · +12 · -1',
                detailText: '- src/app.ts (+12 -1)',
                changedFiles: 1,
                addedLines: 12,
                removedLines: 1,
                status: 'completed',
              },
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'I updated the app entry, now adjusting routes.',
              },
              {
                id: 'file-change-2',
                kind: 'fileChange',
                text: 'src/routes.ts',
                previewText: '1 file changed · +4 · -3',
                detailText: '- src/routes.ts (+4 -3)',
                changedFiles: 1,
                addedLines: 4,
                removedLines: 3,
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByText('2 file changes')).not.toBeInTheDocument();
    expect(
      screen.getByText('I updated the app entry, now adjusting routes.'),
    ).toBeInTheDocument();
    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(timelineText.indexOf('src/app.ts')).toBeLessThan(
      timelineText.indexOf('I updated the app entry, now adjusting routes.'),
    );
    expect(
      timelineText.indexOf('I updated the app entry, now adjusting routes.'),
    ).toBeLessThan(timelineText.indexOf('src/routes.ts'));
  });

  it('does not pull file changes across unsequenced agent messages when batching', () => {
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
                id: 'file-change-1',
                kind: 'fileChange',
                text: 'src/app.ts',
                previewText: '1 file changed · +12 · -1',
                detailText: '- src/app.ts (+12 -1)',
                changedFiles: 1,
                addedLines: 12,
                removedLines: 1,
                status: 'completed',
                sequence: 1,
              },
              {
                id: 'file-change-2',
                kind: 'fileChange',
                text: 'src/routes.ts',
                previewText: '1 file changed · +4 · -3',
                detailText: '- src/routes.ts (+4 -3)',
                changedFiles: 1,
                addedLines: 4,
                removedLines: 3,
                status: 'completed',
                sequence: 2,
              },
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'App and routes are updated. I will adjust UI next.',
              },
              {
                id: 'file-change-3',
                kind: 'fileChange',
                text: 'src/ui.tsx',
                previewText: '1 file changed · +3',
                detailText: '- src/ui.tsx (+3)',
                changedFiles: 1,
                addedLines: 3,
                removedLines: 0,
                status: 'completed',
                sequence: 4,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('2 file changes')).toBeInTheDocument();
    expect(screen.queryByText('3 file changes')).not.toBeInTheDocument();
    expect(
      screen.getByText('App and routes are updated. I will adjust UI next.'),
    ).toBeInTheDocument();
    expect(screen.getByText('src/ui.tsx')).toBeInTheDocument();
    expect(timelineText.indexOf('2 file changes')).toBeLessThan(
      timelineText.indexOf('App and routes are updated. I will adjust UI next.'),
    );
    expect(
      timelineText.indexOf('App and routes are updated. I will adjust UI next.'),
    ).toBeLessThan(timelineText.indexOf('src/ui.tsx'));
  });

  it('groups unattached live file change items into a collapsible batch', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'runtime-turn-not-loaded',
          items: [
            {
              id: 'file-change-live-1',
              kind: 'fileChange',
              text: 'src/app.ts',
              previewText: '1 file changed · +12 · -1',
              detailText: '- src/app.ts (+12 -1)',
              changedFiles: 1,
              addedLines: 12,
              removedLines: 1,
              status: 'completed',
            },
            {
              id: 'file-change-live-2',
              kind: 'fileChange',
              text: 'src/routes.ts',
              previewText: '1 file changed · +4 · -3',
              detailText: '- src/routes.ts (+4 -3)',
              changedFiles: 1,
              addedLines: 4,
              removedLines: 3,
              status: 'completed',
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [],
          },
        ]}
      />,
    );

    expect(screen.getByText('2 file changes')).toBeInTheDocument();
    expect(screen.getByText('+16')).toBeInTheDocument();
    expect(screen.getByText('-4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open full file change' })).not.toBeInTheDocument();
  });

  it('renders plan history items as markdown once they enter the viewport', async () => {
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
                id: 'plan-1',
                kind: 'plan',
                text: ['## Execution plan', '', '- wire the API', '- verify the UI'].join(
                  '\n',
                ),
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Execution plan' })).not.toBeInTheDocument();
    expect(screen.getByText(/## Execution plan/)).toBeInTheDocument();

    FakeIntersectionObserver.triggerAll();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Execution plan' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('wire the API')).toBeInTheDocument();
    expect(screen.getByText('verify the UI')).toBeInTheDocument();
  });

  it('renders web search items as a compact one-line preview with expandable details', () => {
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
                id: 'search-1',
                kind: 'webSearch',
                text: ['latest remote codex release notes', 'site:example.com', '2026'].join(
                  '\n',
                ),
                previewText: ['latest remote codex release notes', 'site:example.com'].join(
                  '\n',
                ),
                detailText: [
                  'Search query',
                  '',
                  '- latest remote codex release notes',
                  '',
                  'Sources',
                  '',
                  '- Release notes',
                  '  https://example.com/releases',
                ].join('\n'),
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    const openButton = screen.getByRole('button', { name: 'Open full web search' });
    expect(openButton).toHaveTextContent('latest remote codex release notes');
    expect(openButton).toHaveTextContent('...');
    expect(openButton).not.toHaveTextContent('site:example.com');

    fireEvent.click(openButton);

    expect(
      screen.getByRole('dialog', { name: 'Web Search Details' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Web Search Details' }),
    ).toHaveTextContent('Release notes');
    expect(
      screen.getByRole('dialog', { name: 'Web Search Details' }),
    ).toHaveTextContent('https://example.com/releases');
  });

  it('groups consecutive web search items into a collapsible batch', () => {
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
                id: 'search-1',
                kind: 'webSearch',
                text: 'latest remote codex release notes',
                previewText: 'latest remote codex release notes',
                detailText: 'Search query: latest remote codex release notes',
                status: 'completed',
              },
              {
                id: 'search-2',
                kind: 'webSearch',
                text: ['pnpm workspace filters', 'monorepo search tips'].join('\n'),
                previewText: ['pnpm workspace filters', 'monorepo search tips'].join('\n'),
                detailText: 'Search query: pnpm workspace filters\nmonorepo search tips',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('2 searches')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand 2 web search entries' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open full web search' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand 2 web search entries' }));

    expect(screen.getByRole('button', { name: 'Open grouped web search 1' })).toHaveTextContent(
      'latest remote codex release notes',
    );
    expect(screen.getByRole('button', { name: 'Open grouped web search 2' })).toHaveTextContent(
      'pnpm workspace filters',
    );
    expect(screen.getByRole('button', { name: 'Open grouped web search 2' })).toHaveTextContent(
      '...',
    );
    expect(
      screen.queryByText('monorepo search tips'),
    ).not.toBeInTheDocument();
  });

  it('renders Claude file inspection items separately from web search', () => {
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
                id: 'read-1',
                kind: 'fileRead',
                text: 'Search files: AgentRuntime in apps/supervisor-api/src',
                previewText: 'Search files: AgentRuntime in apps/supervisor-api/src',
                detailText: 'Tool: Grep\n\nInput:\n{"pattern":"AgentRuntime"}',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Open full web search' }),
    ).not.toBeInTheDocument();

    const openButton = screen.getByRole('button', { name: 'Open full file read' });
    expect(openButton).toHaveTextContent('Search files: AgentRuntime');
    expect(openButton).not.toHaveTextContent('completed');

    fireEvent.click(openButton);

    expect(
      screen.getByRole('dialog', { name: 'File Read Details' }),
    ).toHaveTextContent('Tool: Grep');
  });

  it('does not pull file reads across unsequenced agent messages when batching', () => {
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
                id: 'read-1',
                kind: 'fileRead',
                text: 'src/tokenUsage.ts',
                previewText: 'src/tokenUsage.ts',
                detailText: 'Tool: read\nsrc/tokenUsage.ts',
                status: 'completed',
                sequence: 1,
              },
              {
                id: 'read-2',
                kind: 'fileRead',
                text: 'src/threadUsage.ts',
                previewText: 'src/threadUsage.ts',
                detailText: 'Tool: read\nsrc/threadUsage.ts',
                status: 'completed',
                sequence: 2,
              },
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Usage files are clear. I will inspect the timeline next.',
              },
              {
                id: 'read-3',
                kind: 'fileRead',
                text: 'src/components/ThreadTimeline.tsx',
                previewText: 'src/components/ThreadTimeline.tsx',
                detailText: 'Tool: read\nsrc/components/ThreadTimeline.tsx',
                status: 'completed',
                sequence: 4,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('2 file reads')).toBeInTheDocument();
    expect(screen.queryByText('3 file reads')).not.toBeInTheDocument();
    expect(
      screen.getByText('Usage files are clear. I will inspect the timeline next.'),
    ).toBeInTheDocument();
    expect(screen.getByText('src/components/ThreadTimeline.tsx')).toBeInTheDocument();
    expect(timelineText.indexOf('2 file reads')).toBeLessThan(
      timelineText.indexOf('Usage files are clear. I will inspect the timeline next.'),
    );
    expect(
      timelineText.indexOf('Usage files are clear. I will inspect the timeline next.'),
    ).toBeLessThan(timelineText.indexOf('src/components/ThreadTimeline.tsx'));
  });

  it('groups unattached live file read items into a collapsible batch', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'runtime-turn-not-loaded',
          items: [
            {
              id: 'read-live-1',
              kind: 'fileRead',
              text: 'src/tokenUsage.ts',
              previewText: 'src/tokenUsage.ts',
              detailText: 'Tool: read\nsrc/tokenUsage.ts',
              status: 'completed',
            },
            {
              id: 'read-live-2',
              kind: 'fileRead',
              text: 'src/threadUsage.ts',
              previewText: 'src/threadUsage.ts',
              detailText: 'Tool: read\nsrc/threadUsage.ts',
              status: 'completed',
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [],
          },
        ]}
      />,
    );

    expect(screen.getByText('2 file reads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand 2 file read entries' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open full file read' })).not.toBeInTheDocument();
  });

  it('renders Claude agent tool calls as dedicated agent bubbles', () => {
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
                id: 'agent-tool-1',
                kind: 'agentToolCall',
                text: 'Agent: Inspect backend runtime boundaries',
                previewText: 'Agent',
                detailText: 'Tool: Agent\n\nInput:\n{"description":"Inspect backend runtime boundaries"}',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Open full tool call' }),
    ).not.toBeInTheDocument();

    const openButton = screen.getByRole('button', { name: 'Open agent details' });
    expect(openButton).toHaveTextContent('Agent: Inspect backend runtime boundaries');

    fireEvent.click(openButton);

    expect(
      screen.getByRole('dialog', { name: 'Agent Details' }),
    ).toHaveTextContent('Tool: Agent');
  });

  it('renders Claude skill tool calls as dedicated skill bubbles', () => {
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
                id: 'skill-tool-1',
                kind: 'skillToolCall',
                text: 'Skill: update-config',
                previewText: 'update-config',
                detailText: 'Tool: Skill\n\nInput:\n{"skill":"update-config"}',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Open full tool call' }),
    ).not.toBeInTheDocument();

    const openButton = screen.getByRole('button', { name: 'Open skill details' });
    expect(openButton).toHaveTextContent('Skill: update-config');

    fireEvent.click(openButton);

    expect(
      screen.getByRole('dialog', { name: 'Skill Details' }),
    ).toHaveTextContent('Tool: Skill');
  });

  it('renders context compaction items as compact dedicated cards', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'context-1',
                kind: 'contextCompaction',
                text: 'Compacting context',
                detailText: 'Compressed older tool results into a shorter summary.',
                status: 'running',
              },
            ],
          },
          {
            id: 'turn-2',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'context-2',
                kind: 'contextCompaction',
                text: 'Context compacted',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Compacting context')).toBeInTheDocument();
    expect(
      screen.getByText('Compressed older tool results into a shorter summary.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Context compacted')).toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('renders streaming agent output from live items inside the same agent message surface', async () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'agent-live-1',
              kind: 'agentMessage',
              text: 'Streaming reply in progress',
              sequence: 1,
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Show me the fix.',
                sequence: 0,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Show me the fix.')).toBeInTheDocument();
    expect(screen.getByText('Streaming reply in progress')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Running')).toHaveLength(2);
    expect(screen.queryByText('Streaming output')).not.toBeInTheDocument();
  });

  it('renders queued steer bubbles after the materialized turn content', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        pendingSteers={[
          {
            id: 'pending-steer-1',
            clientRequestId: 'client-steer-1',
            turnId: 'turn-1',
            prompt: 'Accepted steer prompt',
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
          },
        ]}
        optimisticSteers={[
          {
            id: 'optimistic-steer-1',
            clientRequestId: 'client-steer-2',
            turnId: 'turn-1',
            prompt: 'Still steering prompt',
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 5)).toISOString(),
            status: 'steering',
          },
        ]}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Original running prompt',
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'sleep 20',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(timelineText.indexOf('sleep 20')).toBeGreaterThanOrEqual(0);
    expect(screen.getByText('Accepted steer prompt')).toBeInTheDocument();
    expect(screen.getByText('Still steering prompt')).toBeInTheDocument();
    expect(screen.getByText('Steering')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(timelineText.indexOf('sleep 20')).toBeLessThan(
      timelineText.indexOf('Accepted steer prompt'),
    );
    expect(timelineText.indexOf('Accepted steer prompt')).toBeLessThan(
      timelineText.indexOf('Still steering prompt'),
    );
  });

  it('renders live command items before queued steer bubbles in the active turn', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'command-live-1',
              kind: 'commandExecution',
              text: '/bin/bash -lc sleep 20',
              status: 'running',
            },
          ],
        }}
        pendingSteers={[
          {
            id: 'pending-steer-1',
            clientRequestId: 'client-steer-1',
            turnId: 'turn-1',
            prompt: 'Steer after sleep.',
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
          },
        ]}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Run sleep 20.',
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('/bin/bash -lc sleep 20')).toBeInTheDocument();
    expect(screen.getByText('Steer after sleep.')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(timelineText.indexOf('/bin/bash -lc sleep 20')).toBeLessThan(
      timelineText.indexOf('Steer after sleep.'),
    );
  });

  it('advances live plan display when concrete execution results already appeared', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        livePlan={{
          turnId: 'turn-1',
          explanation: 'Ship the fix in three steps.',
          plan: [
            {
              step: 'Inspect current state',
              status: 'in_progress',
            },
            {
              step: 'Patch the UI',
              status: 'pending',
            },
            {
              step: 'Verify the result',
              status: 'pending',
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Fix the timeline.',
              },
              {
                id: 'file-1',
                kind: 'fileChange',
                text: 'src/components/ThreadTimeline.tsx',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByLabelText('Plan step status: Completed'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Plan step status: In progress'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Plan step status: Pending'),
    ).toBeInTheDocument();
    expect(screen.queryByText('INPROGRESS')).not.toBeInTheDocument();
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument();
  });

  it('renders optimistic steer bubbles under an optimistic running turn', () => {
    render(
      <ThreadTimeline
        turns={[]}
        liveOutput=""
        optimisticTurn={{
          id: 'turn-running-1',
          startedAt: new Date(Date.UTC(2026, 3, 9, 6, 3, 0)).toISOString(),
          status: 'inProgress',
          error: null,
          model: 'gpt-5',
          reasoningEffort: 'medium',
          reasoningEffortAvailable: true,
          items: [
            {
              id: 'optimistic-user-1',
              kind: 'userMessage',
              text: 'Original running prompt',
            },
          ],
        }}
        optimisticSteers={[
          {
            id: 'optimistic-steer-1',
            clientRequestId: 'client-steer-1',
            turnId: 'turn-running-1',
            prompt: 'Steer prompt still sending',
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 3, 5)).toISOString(),
            status: 'steering',
          },
        ]}
      />,
    );

    expect(screen.getByText('Steer prompt still sending')).toBeInTheDocument();
    expect(screen.getByText('Steering')).toBeInTheDocument();
  });

  it('reorders materialized steer messages after preceding command results while still queued', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Run sleep 20.',
              },
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Running sleep now.',
              },
              {
                id: 'steer-1',
                kind: 'userMessage',
                text: 'This is a steer probe',
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'sleep 20',
                status: 'completed',
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('This is a steer probe')).toBeInTheDocument();
    expect(screen.getByText('Awaiting response')).toBeInTheDocument();
    expect(timelineText.indexOf('sleep 20')).toBeLessThan(
      timelineText.indexOf('This is a steer probe'),
    );
  });

  it('renders streaming agent progress from live items rather than live output text', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'agent-2',
              kind: 'agentMessage',
              text: 'Beta is still streaming.',
              sequence: 3,
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Alpha is done.',
                sequence: 1,
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm test\nok',
                status: 'completed',
                sequence: 2,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Alpha is done.')).toBeInTheDocument();
    expect(screen.getByText('Beta is still streaming.')).toBeInTheDocument();
    expect(
      screen.queryByText('Alpha is done.Beta is still streaming.'),
    ).not.toBeInTheDocument();
  });

  it('inserts sequenced live command items around materialized agent messages', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'command-before-agent',
              kind: 'commandExecution',
              text: 'pnpm lint',
              status: 'completed',
              sequence: 1,
            },
            {
              id: 'command-after-agent',
              kind: 'commandExecution',
              text: 'pnpm build',
              status: 'completed',
              sequence: 3,
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Run checks.',
                sequence: 0,
              },
              {
                id: 'agent-mid',
                kind: 'agentMessage',
                text: 'Lint passed, now building.',
                sequence: 2,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('pnpm lint')).toBeInTheDocument();
    expect(screen.getByText('Lint passed, now building.')).toBeInTheDocument();
    expect(screen.getByText('pnpm build')).toBeInTheDocument();
    expect(timelineText.indexOf('pnpm lint')).toBeLessThan(
      timelineText.indexOf('Lint passed, now building.'),
    );
    expect(timelineText.indexOf('Lint passed, now building.')).toBeLessThan(
      timelineText.indexOf('pnpm build'),
    );
  });

  it('keeps live command groups interleaved with live agent messages', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'agent-before',
              kind: 'agentMessage',
              text: 'I will run the first batch.',
              sequence: 1,
            },
            {
              id: 'command-1',
              kind: 'commandExecution',
              text: 'pnpm lint',
              status: 'completed',
              sequence: 2,
            },
            {
              id: 'command-2',
              kind: 'commandExecution',
              text: 'pnpm test',
              status: 'completed',
              sequence: 3,
            },
            {
              id: 'agent-between',
              kind: 'agentMessage',
              text: 'The first batch passed. I will build next.',
              sequence: 4,
            },
            {
              id: 'command-3',
              kind: 'commandExecution',
              text: 'pnpm build',
              status: 'completed',
              sequence: 5,
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Run the full check sequence.',
                sequence: 0,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('I will run the first batch.')).toBeInTheDocument();
    expect(screen.getByText('2 commands')).toBeInTheDocument();
    expect(
      screen.getByText('The first batch passed. I will build next.'),
    ).toBeInTheDocument();
    expect(screen.getByText('pnpm build')).toBeInTheDocument();
    expect(timelineText.indexOf('I will run the first batch.')).toBeLessThan(
      timelineText.indexOf('2 commands'),
    );
    expect(timelineText.indexOf('2 commands')).toBeLessThan(
      timelineText.indexOf('The first batch passed. I will build next.'),
    );
    expect(
      timelineText.indexOf('The first batch passed. I will build next.'),
    ).toBeLessThan(timelineText.indexOf('pnpm build'));
  });

  it('does not pull commands across unsequenced agent messages when batching', () => {
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
                text: 'Run the checks.',
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm lint',
                status: 'completed',
                sequence: 1,
              },
              {
                id: 'command-2',
                kind: 'commandExecution',
                text: 'pnpm test',
                status: 'completed',
                sequence: 2,
              },
              {
                id: 'agent-between',
                kind: 'agentMessage',
                text: 'Tests passed. I will build next.',
              },
              {
                id: 'command-3',
                kind: 'commandExecution',
                text: 'pnpm build',
                status: 'completed',
                sequence: 4,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('2 commands')).toBeInTheDocument();
    expect(screen.queryByText('3 commands')).not.toBeInTheDocument();
    expect(screen.getByText('Tests passed. I will build next.')).toBeInTheDocument();
    expect(screen.getByText('pnpm build')).toBeInTheDocument();
    expect(timelineText.indexOf('2 commands')).toBeLessThan(
      timelineText.indexOf('Tests passed. I will build next.'),
    );
    expect(timelineText.indexOf('Tests passed. I will build next.')).toBeLessThan(
      timelineText.indexOf('pnpm build'),
    );
  });

  it('keeps later command batches separate after an unsequenced agent message', () => {
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
                text: 'Run the checks.',
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm lint',
                status: 'completed',
                sequence: 1,
              },
              {
                id: 'command-2',
                kind: 'commandExecution',
                text: 'pnpm typecheck',
                status: 'completed',
                sequence: 2,
              },
              {
                id: 'agent-between',
                kind: 'agentMessage',
                text: 'The first batch passed. I will run the next checks.',
              },
              {
                id: 'command-3',
                kind: 'commandExecution',
                text: 'pnpm test',
                status: 'completed',
                sequence: 4,
              },
              {
                id: 'command-4',
                kind: 'commandExecution',
                text: 'pnpm build',
                status: 'completed',
                sequence: 5,
              },
              {
                id: 'command-5',
                kind: 'commandExecution',
                text: 'pnpm package',
                status: 'completed',
                sequence: 6,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('2 commands')).toBeInTheDocument();
    expect(screen.getByText('3 commands')).toBeInTheDocument();
    expect(screen.queryByText('5 commands')).not.toBeInTheDocument();
    expect(
      screen.getByText('The first batch passed. I will run the next checks.'),
    ).toBeInTheDocument();
    expect(timelineText.indexOf('2 commands')).toBeLessThan(
      timelineText.indexOf('The first batch passed. I will run the next checks.'),
    );
    expect(
      timelineText.indexOf('The first batch passed. I will run the next checks.'),
    ).toBeLessThan(timelineText.indexOf('3 commands'));
  });

  it('uses sequence over transcript order when splitting command batches', () => {
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
                text: 'Run the checks.',
                transcriptOrder: 0,
              },
              {
                id: 'agent-between',
                kind: 'agentMessage',
                text: 'The first batch passed. I will run the next checks.',
                sequence: 3,
                transcriptOrder: 1,
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm lint',
                status: 'completed',
                sequence: 1,
                transcriptOrder: 2,
              },
              {
                id: 'command-2',
                kind: 'commandExecution',
                text: 'pnpm typecheck',
                status: 'completed',
                sequence: 2,
                transcriptOrder: 3,
              },
              {
                id: 'command-3',
                kind: 'commandExecution',
                text: 'pnpm test',
                status: 'completed',
                sequence: 4,
                transcriptOrder: 4,
              },
              {
                id: 'command-4',
                kind: 'commandExecution',
                text: 'pnpm build',
                status: 'completed',
                sequence: 5,
                transcriptOrder: 5,
              },
              {
                id: 'command-5',
                kind: 'commandExecution',
                text: 'pnpm package',
                status: 'completed',
                sequence: 6,
                transcriptOrder: 6,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('2 commands')).toBeInTheDocument();
    expect(screen.getByText('3 commands')).toBeInTheDocument();
    expect(screen.queryByText('5 commands')).not.toBeInTheDocument();
    expect(
      screen.getByText('The first batch passed. I will run the next checks.'),
    ).toBeInTheDocument();
    expect(timelineText.indexOf('2 commands')).toBeLessThan(
      timelineText.indexOf('The first batch passed. I will run the next checks.'),
    );
    expect(
      timelineText.indexOf('The first batch passed. I will run the next checks.'),
    ).toBeLessThan(timelineText.indexOf('3 commands'));
  });

  it('uses structured live agent output to split materialized command batches', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'agent-between',
              kind: 'agentMessage',
              text: 'The first batch passed. I will run the next checks.',
              sequence: 3,
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm lint',
                status: 'completed',
                sequence: 1,
              },
              {
                id: 'command-2',
                kind: 'commandExecution',
                text: 'pnpm typecheck',
                status: 'completed',
                sequence: 2,
              },
              {
                id: 'command-3',
                kind: 'commandExecution',
                text: 'pnpm test',
                status: 'completed',
                sequence: 4,
              },
              {
                id: 'command-4',
                kind: 'commandExecution',
                text: 'pnpm build',
                status: 'completed',
                sequence: 5,
              },
              {
                id: 'command-5',
                kind: 'commandExecution',
                text: 'pnpm package',
                status: 'completed',
                sequence: 6,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('2 commands')).toBeInTheDocument();
    expect(screen.getByText('3 commands')).toBeInTheDocument();
    expect(screen.queryByText('5 commands')).not.toBeInTheDocument();
    expect(
      screen.getByText('The first batch passed. I will run the next checks.'),
    ).toBeInTheDocument();
    expect(timelineText.indexOf('2 commands')).toBeLessThan(
      timelineText.indexOf('The first batch passed. I will run the next checks.'),
    );
    expect(
      timelineText.indexOf('The first batch passed. I will run the next checks.'),
    ).toBeLessThan(timelineText.indexOf('3 commands'));
  });

  it('attaches unstructured live agent output to the running turn instead of loose tail output', () => {
    render(
      <ThreadTimeline
        activeTurnId="turn-1"
        threadRunning
        liveOutput="The first batch passed. I will run the next checks."
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Run the checks.',
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm lint',
                status: 'completed',
                sequence: 1,
              },
              {
                id: 'command-2',
                kind: 'commandExecution',
                text: 'pnpm typecheck',
                status: 'completed',
                sequence: 2,
              },
              {
                id: 'command-3',
                kind: 'commandExecution',
                text: 'pnpm test',
                status: 'completed',
                sequence: 4,
              },
              {
                id: 'command-4',
                kind: 'commandExecution',
                text: 'pnpm build',
                status: 'completed',
                sequence: 5,
              },
              {
                id: 'command-5',
                kind: 'commandExecution',
                text: 'pnpm package',
                status: 'completed',
                sequence: 6,
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByText('The first batch passed. I will run the next checks.'),
    ).toBeInTheDocument();
    expect(screen.getByText('5 commands')).toBeInTheDocument();
    expect(
      screen.getByText('The first batch passed. I will run the next checks.').closest('article'),
    ).toHaveTextContent('Turn 1');
  });

  it('keeps a single unsequenced agent message between two commands as a batch boundary', () => {
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
                id: 'command-before-text',
                kind: 'commandExecution',
                text: 'pnpm lint',
                status: 'completed',
                sequence: 1,
              },
              {
                id: 'agent-between',
                kind: 'agentMessage',
                text: 'Lint passed. I will build next.',
              },
              {
                id: 'command-after-text',
                kind: 'commandExecution',
                text: 'pnpm build',
                status: 'completed',
                sequence: 3,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.queryByText('2 commands')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open full command' })).toHaveLength(2);
    expect(timelineText.indexOf('pnpm lint')).toBeLessThan(
      timelineText.indexOf('Lint passed. I will build next.'),
    );
    expect(timelineText.indexOf('Lint passed. I will build next.')).toBeLessThan(
      timelineText.indexOf('pnpm build'),
    );
  });

  it('uses live item sequence when refreshed turn items already contain the same command ids', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'command-1',
              kind: 'commandExecution',
              text: 'pnpm lint',
              status: 'completed',
              sequence: 1,
            },
            {
              id: 'command-2',
              kind: 'commandExecution',
              text: 'pnpm test',
              status: 'completed',
              sequence: 2,
            },
            {
              id: 'agent-between',
              kind: 'agentMessage',
              text: 'The first batch passed. I will build next.',
              sequence: 3,
            },
            {
              id: 'command-3',
              kind: 'commandExecution',
              text: 'pnpm build',
              status: 'completed',
              sequence: 4,
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Run the full check sequence.',
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm lint',
                status: 'completed',
              },
              {
                id: 'command-2',
                kind: 'commandExecution',
                text: 'pnpm test',
                status: 'completed',
              },
              {
                id: 'command-3',
                kind: 'commandExecution',
                text: 'pnpm build',
                status: 'completed',
              },
              {
                id: 'agent-between',
                kind: 'agentMessage',
                text: 'The first batch passed. I will build next.',
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('2 commands')).toBeInTheDocument();
    expect(
      screen.getByText('The first batch passed. I will build next.'),
    ).toBeInTheDocument();
    expect(screen.getByText('pnpm build')).toBeInTheDocument();
    expect(timelineText.indexOf('2 commands')).toBeLessThan(
      timelineText.indexOf('The first batch passed. I will build next.'),
    );
    expect(
      timelineText.indexOf('The first batch passed. I will build next.'),
    ).toBeLessThan(timelineText.indexOf('pnpm build'));
  });

  it('keeps same-id live item updates in recorded order', () => {
    const { rerender } = render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'command-1',
              kind: 'commandExecution',
              text: 'pnpm lint',
              status: 'running',
              sequence: 1,
            },
            {
              id: 'agent-between',
              kind: 'agentMessage',
              text: 'Lint is running before tests.',
              sequence: 2,
            },
            {
              id: 'command-2',
              kind: 'commandExecution',
              text: 'pnpm test',
              status: 'completed',
              sequence: 3,
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Run checks.',
                sequence: 0,
              },
            ],
          },
        ]}
      />,
    );

    rerender(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'command-1',
              kind: 'commandExecution',
              text: 'pnpm lint\nlint ok',
              status: 'completed',
              sequence: 1,
            },
            {
              id: 'agent-between',
              kind: 'agentMessage',
              text: 'Lint is running before tests.',
              sequence: 2,
            },
            {
              id: 'command-2',
              kind: 'commandExecution',
              text: 'pnpm test',
              status: 'completed',
              sequence: 3,
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Run checks.',
                sequence: 0,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('pnpm lint')).toBeInTheDocument();
    expect(screen.getByText('Lint is running before tests.')).toBeInTheDocument();
    expect(screen.getByText('pnpm test')).toBeInTheDocument();
    expect(timelineText.indexOf('pnpm lint')).toBeLessThan(
      timelineText.indexOf('Lint is running before tests.'),
    );
    expect(timelineText.indexOf('Lint is running before tests.')).toBeLessThan(
      timelineText.indexOf('pnpm test'),
    );
  });

  it('sorts completed turn items by recorded sequence without live items', () => {
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
                text: 'Run the full check sequence.',
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm lint',
                status: 'completed',
                sequence: 1,
              },
              {
                id: 'command-2',
                kind: 'commandExecution',
                text: 'pnpm test',
                status: 'completed',
                sequence: 2,
              },
              {
                id: 'command-3',
                kind: 'commandExecution',
                text: 'pnpm build',
                status: 'completed',
                sequence: 4,
              },
              {
                id: 'agent-between',
                kind: 'agentMessage',
                text: 'The first batch passed. I will build next.',
                sequence: 3,
              },
              {
                id: 'agent-after',
                kind: 'agentMessage',
                text: 'All checks passed.',
                sequence: 5,
              },
            ],
          },
        ]}
      />,
    );

    const timelineText =
      screen.getByTestId('thread-scroll-container').textContent ?? '';
    expect(screen.getByText('2 commands')).toBeInTheDocument();
    expect(
      screen.getByText('The first batch passed. I will build next.'),
    ).toBeInTheDocument();
    expect(screen.getByText('pnpm build')).toBeInTheDocument();
    expect(timelineText.indexOf('2 commands')).toBeLessThan(
      timelineText.indexOf('The first batch passed. I will build next.'),
    );
    expect(
      timelineText.indexOf('The first batch passed. I will build next.'),
    ).toBeLessThan(timelineText.indexOf('pnpm build'));
  });

  it('keeps live agent messages interleaved without reading a duplicate live output string', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'agent-live-3',
              kind: 'agentMessage',
              text: 'Running the next verification step now.',
              sequence: 4,
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Root cause is clear.',
                sequence: 1,
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'apply patch',
                status: 'completed',
                sequence: 2,
              },
              {
                id: 'agent-2',
                kind: 'agentMessage',
                text: 'I updated the composer sync logic.',
                sequence: 3,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Root cause is clear.')).toBeInTheDocument();
    expect(screen.getByText('I updated the composer sync logic.')).toBeInTheDocument();
    expect(screen.getByText('Running the next verification step now.')).toBeInTheDocument();
    expect(
      screen.queryByText(/Root cause is clear\..*Running the next verification step now\./s),
    ).not.toBeInTheDocument();
  });

  it('renders materialized agent messages without requiring live output text', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Alpha is done.',
              },
              {
                id: 'command-1',
                kind: 'commandExecution',
                text: 'pnpm test\nok',
                status: 'completed',
              },
              {
                id: 'agent-2',
                kind: 'agentMessage',
                text: 'Beta is done.',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getAllByLabelText('Copy agent reply')).toHaveLength(2);
    expect(screen.getByText('Alpha is done.')).toBeInTheDocument();
    expect(screen.getByText('Beta is done.')).toBeInTheDocument();
  });

  it('uses trailing live output only as an unstructured fallback', () => {
    render(
      <ThreadTimeline
        liveOutput="Unstructured streaming fallback."
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            items: [],
          },
        ]}
      />,
    );

    expect(screen.getByText('Unstructured streaming fallback.')).toBeInTheDocument();
  });

  it('renders an optimistic sending turn before the server materializes it', () => {
    render(
      <ThreadTimeline
        turns={[]}
        liveOutput="streaming draft"
        optimisticTurn={{
          id: 'optimistic-turn-1',
          startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
          status: 'sending',
          error: null,
          items: [
            {
              id: 'optimistic-turn-1-user',
              kind: 'userMessage',
              text: 'Ship this optimistic turn.',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Turn 1')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Sending')).toHaveLength(2);
    expect(screen.getByText('Ship this optimistic turn.')).toBeInTheDocument();
    expect(screen.getByText('streaming draft')).toBeInTheDocument();
  });

  it('uses matching live items instead of live output on an optimistic turn', () => {
    render(
      <ThreadTimeline
        turns={[]}
        liveOutput="legacy fallback draft"
        liveItems={{
          turnId: 'server-turn-1',
          items: [
            {
              id: 'assistant-live-1',
              kind: 'agentMessage',
              text: 'Structured live draft.',
              sequence: 1,
            },
          ],
        }}
        optimisticTurn={{
          id: 'server-turn-1',
          startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
          status: 'inProgress',
          error: null,
          items: [
            {
              id: 'optimistic-turn-1-user',
              kind: 'userMessage',
              text: 'Ship this optimistic turn.',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Structured live draft.')).toBeInTheDocument();
    expect(screen.queryByText('legacy fallback draft')).not.toBeInTheDocument();
  });

  it('shows per-turn model metadata plus price in the turn header', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            reasoningEffortAvailable: true,
            tokenUsage: {
              total: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              last: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: {
              pricingModelKey: 'gpt-5.4',
              pricingTierKey: 'standard',
              currency: 'USD',
              inputUsd: 0.025,
              cachedInputUsd: 0.0005,
              outputUsd: 0.0636,
              totalUsd: 0.0891,
            },
            items: [
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Done.',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('gpt-5.4 · high')).toBeInTheDocument();
    expect(screen.getAllByText('$0.089').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Completed')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('shows price plus token breakdown badges in the running footer bubble', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            reasoningEffortAvailable: true,
            tokenUsage: {
              total: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              last: {
                totalTokens: 2400,
                inputTokens: 1600,
                cachedInputTokens: 200,
                outputTokens: 800,
                reasoningOutputTokens: 320,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: {
              pricingModelKey: 'gpt-5.4',
              pricingTierKey: 'standard',
              currency: 'USD',
              inputUsd: 0.025,
              cachedInputUsd: 0.0005,
              outputUsd: 0.0636,
              totalUsd: 0.0891,
            },
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Keep going.',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getAllByText('10k').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2k').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3k').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.2k').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.089').length).toBeGreaterThan(0);
  });

  it('shows the running footer bubble for a completed turn that still has live opencode items', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        liveItems={{
          turnId: 'turn-1',
          items: [
            {
              id: 'cmd-1',
              kind: 'commandExecution',
              text: 'pnpm test',
              status: 'running',
            },
          ],
        }}
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            model: 'gpt-5.4',
            reasoningEffort: 'low',
            reasoningEffortAvailable: true,
            tokenUsage: {
              total: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              last: {
                totalTokens: 2400,
                inputTokens: 1600,
                cachedInputTokens: 200,
                outputTokens: 800,
                reasoningOutputTokens: 320,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: {
              pricingModelKey: 'gpt-5.4',
              pricingTierKey: 'standard',
              currency: 'USD',
              inputUsd: 0.025,
              cachedInputUsd: 0.0005,
              outputUsd: 0.0636,
              totalUsd: 0.0891,
            },
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Keep working.',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('Running')).toBeInTheDocument();
    expect(screen.getAllByText('$0.089').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10k').length).toBeGreaterThan(0);
  });

  it('keeps the running footer bubble visible when the thread active turn is still running', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        activeTurnId="turn-1"
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            model: 'gpt-5.4',
            reasoningEffort: 'low',
            reasoningEffortAvailable: true,
            tokenUsage: {
              total: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              last: {
                totalTokens: 2400,
                inputTokens: 1600,
                cachedInputTokens: 200,
                outputTokens: 800,
                reasoningOutputTokens: 320,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: {
              pricingModelKey: 'gpt-5.4',
              pricingTierKey: 'standard',
              currency: 'USD',
              inputUsd: 0.025,
              cachedInputUsd: 0.0005,
              outputUsd: 0.0636,
              totalUsd: 0.0891,
            },
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Keep working.',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('Running')).toBeInTheDocument();
    expect(screen.getAllByText('$0.089').length).toBeGreaterThan(0);
  });

  it('keeps the running footer visible on the latest visible turn when opencode active turn ids do not match', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        activeTurnId="runtime-turn-raw"
        threadRunning
        turns={[
          {
            id: 'display-turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            model: 'gpt-5.4',
            reasoningEffort: 'low',
            reasoningEffortAvailable: true,
            tokenUsage: {
              total: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              last: {
                totalTokens: 2400,
                inputTokens: 1600,
                cachedInputTokens: 200,
                outputTokens: 800,
                reasoningOutputTokens: 320,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: {
              pricingModelKey: 'gpt-5.4',
              pricingTierKey: 'standard',
              currency: 'USD',
              inputUsd: 0.025,
              cachedInputUsd: 0.0005,
              outputUsd: 0.0636,
              totalUsd: 0.0891,
            },
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Keep working.',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('Running')).toBeInTheDocument();
    expect(screen.getAllByText('$0.089').length).toBeGreaterThan(0);
  });

  it('keeps distinct footer token badges when multiple categories share the same compact label', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'inProgress',
            error: null,
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            reasoningEffortAvailable: true,
            tokenUsage: {
              total: {
                totalTokens: 16000,
                inputTokens: 8000,
                cachedInputTokens: 0,
                outputTokens: 8000,
                reasoningOutputTokens: 4000,
              },
              last: {
                totalTokens: 1600,
                inputTokens: 800,
                cachedInputTokens: 0,
                outputTokens: 800,
                reasoningOutputTokens: 400,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: {
              pricingModelKey: 'gpt-5.4',
              pricingTierKey: 'standard',
              currency: 'USD',
              inputUsd: 0.02,
              cachedInputUsd: 0,
              outputUsd: 0.06,
              totalUsd: 0.08,
            },
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Keep going.',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByTitle('Input: 8000 tokens')).toBeInTheDocument();
    expect(screen.getByTitle('Output: 4000 tokens')).toBeInTheDocument();
    expect(screen.getByTitle('Reasoning: 4000 tokens')).toBeInTheDocument();
  });

  it('opens the mobile token and price popover when the price badge is clicked', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            reasoningEffortAvailable: true,
            tokenUsage: {
              total: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              last: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: {
              pricingModelKey: 'gpt-5.4',
              pricingTierKey: 'standard',
              currency: 'USD',
              inputUsd: 0.025,
              cachedInputUsd: 0.0005,
              outputUsd: 0.0636,
              totalUsd: 0.0891,
            },
            items: [
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Done.',
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Show token and price details' }).at(-1)!,
    );

    expect(screen.getAllByText('$0.0250').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10k').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.0005').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.0450').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3k').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.0186').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.2k').length).toBeGreaterThan(0);
  });

  it('shifts the mobile token and price popover away from the viewport edge', () => {
    const originalInnerWidth = window.innerWidth;
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 375,
    });
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const className = String(this.getAttribute('class') ?? '');
      if (className.includes('md:hidden')) {
        return {
          bottom: 24,
          height: 20,
          left: 340,
          right: 376,
          top: 4,
          width: 36,
          x: 340,
          y: 4,
          toJSON: () => ({}),
        };
      }
      if (className.includes('absolute left-1/2 top-full')) {
        return {
          bottom: 150,
          height: 120,
          left: 0,
          right: 192,
          top: 30,
          width: 192,
          x: 0,
          y: 30,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      render(
        <ThreadTimeline
          liveOutput=""
          turns={[
            {
              id: 'turn-1',
              startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
              status: 'completed',
              error: null,
              model: 'gpt-5.4',
              reasoningEffort: 'high',
              reasoningEffortAvailable: true,
              tokenUsage: {
                total: {
                  totalTokens: 18240,
                  inputTokens: 12000,
                  cachedInputTokens: 2000,
                  outputTokens: 4240,
                  reasoningOutputTokens: 1240,
                },
                last: {
                  totalTokens: 18240,
                  inputTokens: 12000,
                  cachedInputTokens: 2000,
                  outputTokens: 4240,
                  reasoningOutputTokens: 1240,
                },
                modelContextWindow: 272000,
              },
              priceEstimate: {
                pricingModelKey: 'gpt-5.4',
                pricingTierKey: 'standard',
                currency: 'USD',
                inputUsd: 0.025,
                cachedInputUsd: 0.0005,
                outputUsd: 0.0636,
                totalUsd: 0.0891,
              },
              items: [
                {
                  id: 'agent-1',
                  kind: 'agentMessage',
                  text: 'Done.',
                },
              ],
            },
          ]}
        />,
      );

      fireEvent.click(
        screen.getAllByRole('button', { name: 'Show token and price details' }).at(-1)!,
      );

      const popoverShell = document.querySelector('.thread-token-popover')?.parentElement;
      expect(popoverShell).toHaveStyle({ transform: 'translateX(-91px) translateX(-50%)' });
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it('opens the desktop token and price popover on hover over the price badge', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            reasoningEffortAvailable: true,
            tokenUsage: {
              total: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              last: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: {
              pricingModelKey: 'gpt-5.4',
              pricingTierKey: 'standard',
              currency: 'USD',
              inputUsd: 0.025,
              cachedInputUsd: 0.0005,
              outputUsd: 0.0636,
              totalUsd: 0.0891,
            },
            items: [
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'Done.',
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.mouseEnter(screen.getAllByRole('button', { name: 'Show token and price details' })[0]!);

    expect(screen.getAllByText('$0.0250').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10k').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.0450').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3k').length).toBeGreaterThan(0);
  });

  it('shows -- for token price when the turn model has no local pricing entry', () => {
    render(
      <ThreadTimeline
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            model: 'gpt-5-mini',
            reasoningEffort: null,
            reasoningEffortAvailable: false,
            tokenUsage: {
              total: {
                totalTokens: 4200,
                inputTokens: 3000,
                cachedInputTokens: 0,
                outputTokens: 1200,
                reasoningOutputTokens: 0,
              },
              last: {
                totalTokens: 4200,
                inputTokens: 3000,
                cachedInputTokens: 0,
                outputTokens: 1200,
                reasoningOutputTokens: 0,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: null,
            items: [
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'No pricing entry.',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });

  it('shows -- for legacy turns and - for fixed-effort models', () => {
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
                text: 'Legacy turn.',
              },
            ],
          },
          {
            id: 'turn-2',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
            status: 'completed',
            error: null,
            model: 'gpt-5-mini',
            reasoningEffort: null,
            reasoningEffortAvailable: false,
            items: [
              {
                id: 'agent-2',
                kind: 'agentMessage',
                text: 'Fixed effort turn.',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('-- · --')).toBeInTheDocument();
    expect(screen.getByText('gpt-5-mini · -')).toBeInTheDocument();
  });

  it('auto-scrolls only while pinned near the bottom', async () => {
    const turns = [
      {
        id: 'turn-1',
        startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
        status: 'inProgress' as const,
        error: null,
        items: [
          {
            id: 'user-1',
            kind: 'userMessage' as const,
            text: 'Keep streaming.',
          },
        ],
      },
    ];

    const { rerender } = render(<ThreadTimeline turns={turns} liveOutput="" />);

    const scrollContainer = screen.getByTestId('thread-scroll-container');
    const tailSentinel = scrollContainer.lastElementChild as HTMLElement | null;
    expect(tailSentinel).toBeTruthy();
    let scrollTop = 560;
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    });
    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => mockRect({ top: 0, height: 400 }),
    });
    Object.defineProperty(tailSentinel!, 'getBoundingClientRect', {
      configurable: true,
      value: () => mockRect({ top: 390, height: 1 }),
    });

    fireEvent.scroll(scrollContainer);

    rerender(<ThreadTimeline turns={turns} liveOutput="next token" />);

    expect(scrollTop).toBe(1000);

    scrollTop = 100;
    Object.defineProperty(tailSentinel!, 'getBoundingClientRect', {
      configurable: true,
      value: () => mockRect({ top: 430, height: 1 }),
    });
    fireEvent.scroll(scrollContainer);

    rerender(<ThreadTimeline turns={turns} liveOutput="next token + more" />);

    expect(scrollTop).toBe(100);
  });

  it('keeps following the tail when rendered height grows while pinned', () => {
    const turns = [makeTurn(1)];

    render(<ThreadTimeline turns={turns} liveOutput="" />);

    const scrollContainer = screen.getByTestId('thread-scroll-container');
    const content = scrollContainer.firstElementChild as HTMLElement | null;
    expect(content).toBeTruthy();
    const tailSentinel = content?.lastElementChild as HTMLElement | null;
    expect(tailSentinel).toBeTruthy();

    let scrollHeight = 1000;
    let scrollTop = 600;
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    });
    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => mockRect({ top: 0, height: 400 }),
    });

    let tailTop = 380;
    Object.defineProperty(tailSentinel!, 'getBoundingClientRect', {
      configurable: true,
      value: () => mockRect({ top: tailTop, height: 1 }),
    });

    fireEvent.scroll(scrollContainer);

    scrollHeight = 1260;
    tailTop = 640;
    FakeResizeObserver.triggerAll(content!);

    expect(scrollTop).toBe(1260);

    scrollTop = 120;
    tailTop = 720;
    fireEvent.scroll(scrollContainer);

    scrollHeight = 1480;
    tailTop = 900;
    FakeResizeObserver.triggerAll(content!);

    expect(scrollTop).toBe(120);
  });

  it('honors one-shot jump requests even when the latest turn is offscreen', () => {
    const turns = [
      {
        id: 'turn-1',
        startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
        status: 'inProgress' as const,
        error: null,
        items: [
          {
            id: 'user-1',
            kind: 'userMessage' as const,
            text: 'Keep streaming.',
          },
        ],
      },
    ];

    const { rerender } = render(
      <ThreadTimeline turns={turns} liveOutput="" scrollRequestKey={0} />,
    );

    const scrollContainer = screen.getByTestId('thread-scroll-container');
    const lastTurn = screen.getByText('Turn 1').closest('article');
    expect(lastTurn).toBeTruthy();
    let scrollTop = 100;
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    });
    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => mockRect({ top: 0, height: 400 }),
    });
    Object.defineProperty(lastTurn!, 'getBoundingClientRect', {
      configurable: true,
      value: () => mockRect({ top: 470, height: 120 }),
    });

    fireEvent.scroll(scrollContainer);

    rerender(<ThreadTimeline turns={turns} liveOutput="next token" scrollRequestKey={1} />);

    expect(scrollTop).toBe(1000);
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

  it('renders plan decisions as direct implement or stay actions', () => {
    const onRespond = vi.fn();

    render(
      <ThreadTimeline
        turns={[]}
        liveOutput=""
        pendingRequests={[
          {
            id: 'plan-decision-1',
            kind: 'planDecision',
            title: 'Plan ready',
            description: 'Review the plan and choose the next step.',
            turnId: 'turn-1',
            itemId: null,
            createdAt: new Date().toISOString(),
            questions: [
              {
                id: 'plan-decision',
                header: 'Next step',
                question: 'Choose whether to implement the plan now.',
                isOther: false,
                isSecret: false,
                options: [
                  {
                    label: 'Implement',
                    description: 'Exit plan mode and continue immediately.',
                  },
                  {
                    label: 'Stay in plan mode',
                    description: 'Keep refining the plan.',
                  },
                ],
              },
            ],
          },
        ]}
        onRespondToRequest={onRespond}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Submit' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Plan', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Action')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Review the plan and choose the next step.'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Implement' }));

    expect(onRespond).toHaveBeenCalledWith('plan-decision-1', {
      answers: {
        'plan-decision': {
          answers: ['Implement'],
        },
      },
    });
  });

  it('renders compact local answered request notes without treating them as thread messages', () => {
    render(
      <ThreadTimeline
        turns={[]}
        liveOutput=""
        answeredRequestNotes={[
          {
            id: 'request-1',
            title: 'Planning Preferences',
            summaryLines: ['Plan object: foundation', 'Detail level: medium'],
          },
        ]}
      />,
    );

    expect(screen.getByText('Planning Preferences')).toBeInTheDocument();
    expect(screen.getByText('You selected Plan object: foundation')).toBeInTheDocument();
    expect(screen.getByText('You selected Detail level: medium')).toBeInTheDocument();
    expect(screen.queryByText('User')).not.toBeInTheDocument();
  });

  it('renders fast mode activity notes as small system cards', () => {
    render(
      <ThreadTimeline
        turns={[]}
        liveOutput=""
        activityNotes={[
          {
            id: 'activity-1',
            kind: 'fastMode',
            text: 'Fast mode on',
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
          },
        ]}
      />,
    );

    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Fast mode on')).toBeInTheDocument();
  });

  it('renders fast mode activity notes before newer turns instead of pinning them to the bottom', () => {
    render(
      <ThreadTimeline
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
                text: 'First turn',
              },
            ],
          },
          {
            id: 'turn-2',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 3, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'user-2',
                kind: 'userMessage',
                text: 'Second turn',
              },
            ],
          },
        ]}
        liveOutput=""
        activityNotes={[
          {
            id: 'activity-1',
            kind: 'fastMode',
            text: 'Fast mode on',
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
          },
        ]}
      />,
    );

    const firstTurn = screen.getByText('First turn');
    const activity = screen.getByText('Fast mode on');
    const secondTurn = screen.getByText('Second turn');

    expect(
      firstTurn.compareDocumentPosition(activity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      activity.compareDocumentPosition(secondTurn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders anchored fast mode activity notes above loaded turns when the anchor turn is paged out', () => {
    render(
      <ThreadTimeline
        turns={[
          {
            id: 'turn-newer',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 3, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'user-newer',
                kind: 'userMessage',
                text: 'Newer loaded turn',
              },
            ],
          },
        ]}
        liveOutput=""
        activityNotes={[
          {
            id: 'activity-1',
            kind: 'fastMode',
            text: 'Fast mode on',
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
            anchorTurnId: 'turn-paged-out',
          },
        ]}
      />,
    );

    const activity = screen.getByText('Fast mode on');
    const newerTurn = screen.getByText('Newer loaded turn');

    expect(
      activity.compareDocumentPosition(newerTurn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders old unanchored fast mode activity notes above the loaded page instead of trailing', () => {
    render(
      <ThreadTimeline
        turns={[
          {
            id: 'turn-newer',
            startedAt: new Date(Date.UTC(2026, 4, 8, 6, 3, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'user-newer',
                kind: 'userMessage',
                text: 'Loaded May turn',
              },
            ],
          },
        ]}
        liveOutput=""
        activityNotes={[
          {
            id: 'activity-1',
            kind: 'fastMode',
            text: 'Fast mode off',
            createdAt: new Date(Date.UTC(2026, 3, 13, 6, 2, 0)).toISOString(),
            anchorTurnId: null,
          },
        ]}
      />,
    );

    const activity = screen.getByText('Fast mode off');
    const newerTurn = screen.getByText('Loaded May turn');

    expect(
      activity.compareDocumentPosition(newerTurn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders unanchored answered request notes by timestamp instead of pinning them to the bottom', () => {
    render(
      <ThreadTimeline
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
                text: 'First turn',
              },
            ],
          },
          {
            id: 'turn-2',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 3, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'user-2',
                kind: 'userMessage',
                text: 'Second turn',
              },
            ],
          },
        ]}
        liveOutput=""
        answeredRequestNotes={[
          {
            id: 'request-1',
            turnId: null,
            title: 'Planning Preferences',
            summaryLines: ['Plan object: foundation'],
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
          },
        ]}
      />,
    );

    const firstTurn = screen.getByText('First turn');
    const note = screen.getByText('You selected Plan object: foundation');
    const secondTurn = screen.getByText('Second turn');

    expect(
      firstTurn.compareDocumentPosition(note) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      note.compareDocumentPosition(secondTurn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders fork source notes as leading cards with navigation affordance', () => {
    const onOpenThread = vi.fn();

    render(
      <ThreadTimeline
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 3, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Second turn',
              },
            ],
          },
        ]}
        liveOutput=""
        activityNotes={[
          {
            id: 'fork-source-1',
            kind: 'forkSource',
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
            anchorTurnId: '__leading__',
            linkedThreadId: 'thread-source',
            linkedThreadTitle: 'Original thread',
            turnIndex: 1,
          },
        ]}
        adapter={{ onOpenLinkedThread: onOpenThread }}
        onOpenThread={onOpenThread}
      />,
    );

    expect(screen.getByText('Fork source')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back to source/i }));
    expect(onOpenThread).toHaveBeenCalledWith('thread-source');
  });

  it('renders fork created notes after the anchored turn', () => {
    render(
      <MemoryRouter>
        <ThreadTimeline
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
                  text: 'First turn',
                },
              ],
            },
            {
              id: 'turn-2',
              startedAt: new Date(Date.UTC(2026, 3, 9, 6, 3, 0)).toISOString(),
              status: 'completed',
              error: null,
              items: [
                {
                  id: 'user-2',
                  kind: 'userMessage',
                  text: 'Second turn',
                },
              ],
            },
          ]}
          liveOutput=""
          activityNotes={[
            {
              id: 'fork-created-1',
              kind: 'forkCreated',
              createdAt: new Date(Date.UTC(2026, 3, 9, 6, 2, 0)).toISOString(),
              anchorTurnId: 'turn-1',
              linkedThreadId: 'thread-fork',
              linkedThreadTitle: 'Forked thread',
              turnIndex: 1,
            },
          ]}
        />
      </MemoryRouter>,
    );

    const firstTurn = screen.getByText('First turn');
    const activity = screen.getByText('Thread forked from Turn 1');
    const secondTurn = screen.getByText('Second turn');

    expect(
      firstTurn.compareDocumentPosition(activity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      activity.compareDocumentPosition(secondTurn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders answered request notes before newer pending requests within the same turn', () => {
    render(
      <ThreadTimeline
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
                text: 'Plan the next step.',
              },
            ],
          },
        ]}
        liveOutput=""
        answeredRequestNotes={[
          {
            id: 'request-note-1',
            turnId: 'turn-1',
            title: 'Plan choice',
            summaryLines: ['Mode: Stay in plan mode'],
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 5)).toISOString(),
          },
        ]}
        pendingRequests={[
          {
            id: 'request-1',
            kind: 'requestUserInput',
            title: 'Language',
            description: 'Pick a language.',
            turnId: 'turn-1',
            itemId: 'item-1',
            createdAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 10)).toISOString(),
            questions: [
              {
                id: 'language',
                header: 'Language',
                question: 'Which language do you want?',
                isOther: false,
                isSecret: false,
                options: [
                  {
                    label: 'English',
                    description: 'Use English.',
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    const turn = screen.getByText('Turn 1').closest('article');
    expect(turn).not.toBeNull();

    const timelineText = turn?.parentElement?.textContent ?? '';
    expect(timelineText.indexOf('Plan choice')).toBeGreaterThanOrEqual(0);
    expect(timelineText.indexOf('Language')).toBeGreaterThanOrEqual(0);
    expect(timelineText.indexOf('Plan choice')).toBeLessThan(
      timelineText.indexOf('Language'),
    );
  });

  it('supports requestUserInput custom answers through Not from above', () => {
    const onRespond = vi.fn();

    render(
      <ThreadTimeline
        turns={[]}
        liveOutput=""
        pendingRequests={[
          {
            id: 'user-input-1',
            kind: 'requestUserInput',
            title: 'Language',
            description: 'Pick a language.',
            turnId: 'turn-1',
            itemId: 'item-1',
            createdAt: new Date().toISOString(),
            questions: [
              {
                id: 'language',
                header: 'Language',
                question: 'Which language do you want?',
                isOther: true,
                isSecret: false,
                options: [
                  {
                    label: 'English',
                    description: 'Use English.',
                  },
                  {
                    label: 'Chinese',
                    description: 'Use Chinese.',
                  },
                ],
              },
            ],
          },
        ]}
        onRespondToRequest={onRespond}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not from above' }));
    fireEvent.change(screen.getByLabelText('Language custom answer'), {
      target: { value: 'Japanese' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onRespond).toHaveBeenCalledWith('user-input-1', {
      answers: {
        language: {
          answers: ['Japanese'],
        },
      },
    });
  });

  it('supports requestUserInput multi-select answers', () => {
    const onRespond = vi.fn();

    render(
      <ThreadTimeline
        turns={[]}
        liveOutput=""
        pendingRequests={[
          {
            id: 'user-input-1',
            kind: 'requestUserInput',
            title: 'Features',
            description: 'Pick features.',
            turnId: 'turn-1',
            itemId: 'item-1',
            createdAt: new Date().toISOString(),
            questions: [
              {
                id: 'features',
                header: 'Features',
                question: 'Which features do you want?',
                multiSelect: true,
                isOther: false,
                isSecret: false,
                options: [
                  {
                    label: 'Calculation history',
                    description: 'Show previous calculations.',
                  },
                  {
                    label: 'Keyboard support',
                    description: 'Allow keyboard input.',
                  },
                ],
              },
            ],
          },
        ]}
        onRespondToRequest={onRespond}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Calculation history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard support' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onRespond).toHaveBeenCalledWith('user-input-1', {
      answers: {
        features: {
          answers: ['Calculation history', 'Keyboard support'],
        },
      },
    });
  });

  it('renders image history items through the thread image proxy route', () => {
    render(
      <ThreadTimeline
        threadId="thread-123"
        liveOutput=""
        turns={[
          {
            id: 'turn-1',
            startedAt: new Date(Date.UTC(2026, 3, 9, 6, 1, 0)).toISOString(),
            status: 'completed',
            error: null,
            items: [
              {
                id: 'image-1',
                kind: 'image',
                text: 'Screenshot preview',
                assetPath: './.temp/threads/thread-123/screenshot.png',
              },
            ],
          },
        ]}
      />,
    );

    const image = screen.getByRole('img', { name: 'Screenshot preview' });
    expect(image).toHaveAttribute(
      'src',
      '/api/threads/thread-123/assets/image?path=.%2F.temp%2Fthreads%2Fthread-123%2Fscreenshot.png',
    );
  });
});
