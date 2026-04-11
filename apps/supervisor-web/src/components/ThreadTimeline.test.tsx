import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  beforeEach(() => {
    FakeIntersectionObserver.reset();
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver as unknown as typeof IntersectionObserver);
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

  it('renders web search items with a query preview and expandable details', () => {
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

    expect(
      screen.getByRole('button', { name: 'Open full web search' }),
    ).toHaveTextContent('latest remote codex release notes');

    fireEvent.click(screen.getByRole('button', { name: 'Open full web search' }));

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

  it('renders streaming agent output inside the same agent message surface', async () => {
    render(
      <ThreadTimeline
        liveOutput="## Streaming reply in progress"
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
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Show me the fix.')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Streaming reply in progress' }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('Streaming output')).not.toBeInTheDocument();
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

    const { rerender } = render(
      <ThreadTimeline turns={turns} liveOutput="" followTail />,
    );

    const scrollContainer = screen.getByTestId('thread-scroll-container');
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

    fireEvent.scroll(scrollContainer);

    rerender(<ThreadTimeline turns={turns} liveOutput="next token" followTail />);

    expect(scrollTop).toBe(1000);

    scrollTop = 100;
    fireEvent.scroll(scrollContainer);

    rerender(<ThreadTimeline turns={turns} liveOutput="next token + more" followTail />);

    expect(scrollTop).toBe(100);
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

    fireEvent.click(screen.getByRole('button', { name: 'Implement' }));

    expect(onRespond).toHaveBeenCalledWith('plan-decision-1', {
      answers: {
        'plan-decision': {
          answers: ['Implement'],
        },
      },
    });
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
});
