import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setLocale } from '@remote-codex/thread-ui/i18n';
import type {
  NativeSubagentDto,
  NativeSubagentDetailDto,
  ThreadDetailDto,
} from '@remote-codex/shared';
import { request } from '../lib/api';
import { ThreadSubagentsControl } from './ThreadSubagentsControl';
vi.mock('../lib/api', () => ({ request: vi.fn() }));
const agent: NativeSubagentDto = {
  id: 'child-1',
  name: 'Review runtime',
  provider: 'codex',
  status: 'running',
  nativeSessionId: 'native-child',
  parentToolCallId: 'spawn-1',
  isBackground: true,
  startedAt: '2026-10-09T05:00:00Z',
  completedAt: null,
  updatedAt: '2026-10-09T05:01:00Z',
  latestActivity: 'cargo test passed',
  model: 'gpt-6.1-sol',
  prompt: 'Review changes and check regressions',
  activityCount: 2,
  detailsAvailable: true,
  tokenUsage: {
    total: {
      totalTokens: 12000,
      inputTokens: 10000,
      cachedInputTokens: 5000,
      outputTokens: 2000,
      reasoningOutputTokens: 500,
    },
    last: {
      totalTokens: 12000,
      inputTokens: 10000,
      cachedInputTokens: 5000,
      outputTokens: 2000,
      reasoningOutputTokens: 500,
    },
    modelContextWindow: null,
  },
  priceEstimate: {
    pricingModelKey: 'gpt-6.1-sol',
    pricingTierKey: 'standard',
    currency: 'USD',
    totalUsd: 0.12,
    inputUsd: 0.01,
    cachedInputUsd: 0.01,
    outputUsd: 0.1,
  },
};
const detail = {
  thread: { id: 'parent', provider: 'codex', status: 'running' },
  activeSubagents: [],
} as unknown as ThreadDetailDto;
let inspected: NativeSubagentDetailDto;
beforeEach(() => {
  setLocale('en');
  inspected = {
    agent: { ...agent },
    hasEarlierItems: false,
    items: [
      {
        id: 'tool',
        kind: 'toolCall',
        text: 'exec_command\ncargo test\n\nTests passed',
        status: 'completed',
        createdAt: '2026-10-09T05:00:30Z',
      },
    ],
  };
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (url) =>
      String(url).endsWith('/subagents') ? { agents: [agent] } : inspected,
    );
});
afterEach(cleanup);

it('opens native Codex details with tool progress, timestamp and its own usage', async () => {
  render(<ThreadSubagentsControl detail={detail} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Subagents (1)' }));
  const panel = screen.getByRole('dialog', { name: 'Native subagents' });
  fireEvent.click(
    within(panel).getByRole('button', { name: /Review runtime/ }),
  );
  await waitFor(() =>
    expect(within(panel).getByText(/exec_command\s+cargo test/)).toBeVisible(),
  );
  expect(within(panel).getByText('Tokens & estimated cost')).toBeVisible();
  expect(within(panel).getByText('Last update')).toBeVisible();
  expect(
    within(panel).getByText('Review changes and check regressions'),
  ).toBeVisible();
  expect(request).toHaveBeenCalledWith(
    '/api/threads/parent/subagents/child-1',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  fireEvent.click(
    within(panel).getByRole('button', { name: 'Back to subagents' }),
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(panel).getByRole('button', { name: /Review runtime/ }),
    ),
  );
});

it('keeps completed native details open and reports missing costs as unavailable', async () => {
  render(<ThreadSubagentsControl detail={detail} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Subagents (1)' }));
  const panel = screen.getByRole('dialog', { name: 'Native subagents' });
  fireEvent.click(
    within(panel).getByRole('button', { name: /Review runtime/ }),
  );
  await waitFor(() =>
    expect(within(panel).getByText('Last update')).toBeVisible(),
  );
  inspected = {
    ...inspected,
    agent: { ...agent, status: 'completed', priceEstimate: null },
  };
  fireEvent.click(within(panel).getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(within(panel).getByText('Cost unavailable')).toBeVisible(),
  );
  expect(panel).toBeVisible();
  expect(within(panel).getByText('2 activities')).toBeVisible();
});

it('retains legacy Claude discovery when an older Supervisor lacks native inspection', async () => {
  vi.mocked(request).mockRejectedValue(new Error('Route not found'));
  const legacy = {
    ...detail,
    thread: { ...detail.thread, provider: 'acp', agentId: 'claude' },
    activeSubagents: [{ ...agent, id: 'toolu-1', name: 'Claude review' }],
  } as ThreadDetailDto;
  render(<ThreadSubagentsControl detail={legacy} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Subagents (1)' }));
  const panel = screen.getByRole('dialog', { name: 'Native subagents' });
  fireEvent.click(within(panel).getByRole('button', { name: /Claude review/ }));
  await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
    'Route not found',
  );
  expect(within(panel).getByText('Tokens & estimated cost')).toBeVisible();
});

it('drops late native responses when the parent thread changes', async () => {
  let oldResolve!: (value: { agents: NativeSubagentDto[] }) => void;
  vi.mocked(request).mockImplementation(async (url) =>
    String(url).includes('/parent/')
      ? new Promise((resolve) => {
          oldResolve = resolve;
        })
      : { agents: [] },
  );
  const view = render(<ThreadSubagentsControl detail={detail} />);
  view.rerender(
    <ThreadSubagentsControl
      detail={{ ...detail, thread: { ...detail.thread, id: 'another' } }}
    />,
  );
  oldResolve({ agents: [agent] });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Subagents (1)' })).toBeNull(),
  );
  expect(screen.queryByRole('button', { name: 'Subagents (1)' })).toBeNull();
});

it('continues history discovery and child updates even when the parent is idle', async () => {
  vi.useFakeTimers();
  let calls = 0;
  vi.mocked(request).mockImplementation(async () => {
    calls++;
    return calls === 1
      ? { agents: [], refreshing: true }
      : {
          agents: [{ ...agent, status: calls === 2 ? 'running' : 'completed' }],
        };
  });
  try {
    await act(async () => {
      render(
        <ThreadSubagentsControl
          detail={{ ...detail, thread: { ...detail.thread, status: 'idle' } }}
        />,
      );
    });
    expect(calls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole('button', { name: 'Subagents (1)' })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole('button', { name: 'Subagents (0)' })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(calls).toBe(3);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
