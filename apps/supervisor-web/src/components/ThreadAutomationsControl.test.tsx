import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { setLocale } from '@remote-codex/thread-ui/i18n';
import type { AutomationDto, ThreadDto } from '@remote-codex/shared';
import { request } from '../lib/api';
import { automationTotals } from './ThreadAutomationsControl';
import { ThreadWatchesControl, type NativeWatch } from './ThreadWatchesControl';

vi.mock('../lib/api', () => ({ request: vi.fn() }));
const thread = { id: 'target', provider: 'claude' } as ThreadDto;
const tokens = {
  totalTokens: 12345,
  inputTokens: 12000,
  cachedInputTokens: 1000,
  cacheWriteInputTokens: 200,
  outputTokens: 345,
  reasoningOutputTokens: 45,
};
const price = {
  totalUsd: 1.25,
  inputUsd: 1,
  cachedInputUsd: 0.05,
  cacheWriteInputUsd: 0.05,
  outputUsd: 0.15,
};
function rule(overrides: Partial<AutomationDto> = {}): AutomationDto {
  return {
    id: 'hourly',
    threadId: 'target',
    sourceKind: 'supervisor',
    definition: {
      name: 'Hourly prompt',
      trigger: { kind: 'interval', everySeconds: 3600 },
      action: { kind: 'prompt', text: 'Read inbox' },
    },
    state: 'enabled',
    nextRunAt: '2030-01-01T01:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    pendingCount: 1,
    missedCount: 4,
    error: null,
    statistics: {
      triggerCount: 505,
      runCount: 501,
      executedActionCount: 500,
      runningActionCount: 1,
      promptTurnCount: 500,
      ambiguousTurnCount: 2,
      missingTurnCount: 1,
      unattributedRunCount: 1,
      usageTurnCount: 497,
      pricedTurnCount: 490,
      tokenUsage: tokens,
      priceEstimate: price,
    },
    ...overrides,
  };
}
const native = {
  id: 'native',
  cron: '*/20 * * * *',
  schedule: 'Every 20 minutes',
  prompt: 'Native prompt',
  recurring: true,
  createdAt: '2026-01-01T00:00:00Z',
  lastTriggeredAt: null,
  expiresAt: null,
  status: 'active',
  triggerCount: 7,
  usageTriggerCount: 7,
  pricedTriggerCount: 7,
  tokenUsage: tokens,
  priceEstimate: price,
} satisfies NativeWatch;
function mockSnapshot(items = [rule()], watches: NativeWatch[] = [native]) {
  vi.mocked(request).mockImplementation(async (url) =>
    String(url).endsWith('/watches')
      ? { watches }
      : String(url).endsWith('/runs')
        ? { runs: [] }
        : { automations: items },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  setLocale('en', false);
});

it('consolidates native watches and lifetime supervisor statistics into one read-only panel', async () => {
  mockSnapshot();
  render(<ThreadWatchesControl thread={thread} />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Automation' }));
  const dialog = await screen.findByRole('dialog', { name: 'Automation' });
  await within(dialog).findByText('Hourly prompt');
  expect(within(dialog).getByText('Every 20 minutes')).toBeVisible();
  const totals = within(dialog).getByRole('region', {
    name: 'Lifetime totals',
  });
  expect(
    within(totals).getByRole('group', { name: 'Triggers' }),
  ).toHaveTextContent('512');
  expect(
    within(totals)
      .getByRole('group', { name: 'Tokens' })
      .querySelector('strong'),
  ).toHaveAttribute('title', '24,690');
  expect(totals).toHaveTextContent('$2.5');
  fireEvent.click(within(dialog).getByText('Details', { exact: true }));
  expect(dialog).toHaveTextContent(
    'Tokens available for 497 of 500 associated turns; USD priced for 490 of 500.',
  );
  expect(dialog).toHaveTextContent(
    'Excluded: 2 ambiguous turns, 1 missing turns; 1 started runs have no turn attribution.',
  );
  expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole('button', {
      name: /create|preview|register|pause|resume|cancel|edit/i,
    }),
  ).not.toBeInTheDocument();
  // Lifetime totals arrive with the list, independently of the 100-row history page.
  expect(
    vi
      .mocked(request)
      .mock.calls.some(([url]) => String(url).endsWith('/runs')),
  ).toBe(false);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Execution history' }),
  );
  await within(dialog).findByText('No executions yet.');
  expect(dialog).toHaveTextContent(
    'Latest 100 execution records. Totals above include all historical runs.',
  );
  expect(
    within(totals).getByRole('group', { name: 'Triggers' }),
  ).toHaveTextContent('512');
  expect(
    vi
      .mocked(request)
      .mock.calls.every(([, init]) => !init?.method || init.method === 'GET'),
  ).toBe(true);
});

it('shows inactive history and distinguishes free inbox delivery from unmeasured script models in Chinese', async () => {
  setLocale('zh-CN', false);
  const script = rule({
    id: 'script',
    state: 'cancelled',
    definition: {
      name: 'Script history',
      trigger: { kind: 'at', at: '2026-01-01T00:00:00Z' },
      action: { kind: 'runScript', argv: ['true'], cwd: '.' },
    },
  });
  const inbox = rule({
    id: 'inbox',
    definition: {
      name: 'Inbox delivery',
      trigger: { kind: 'interval', everySeconds: 60 },
      action: { kind: 'notifyInbox', subject: 'Ready', text: 'Result' },
    },
  });
  mockSnapshot([script, inbox], []);
  render(<ThreadWatchesControl thread={thread} />);
  fireEvent.click(screen.getByRole('button', { name: '自动化' }));
  const dialog = await screen.findByRole('dialog', { name: '自动化' });
  await within(dialog).findByText('Inbox delivery');
  const inboxCard = within(dialog)
    .getByText('Inbox delivery')
    .closest('article')!;
  fireEvent.click(within(inboxCard).getByText('详情', { exact: true }));
  expect(dialog).toHaveTextContent('被动收件箱投递不产生模型 token 费用。');
  fireEvent.click(within(dialog).getByText('历史与非活跃自动化 (1)'));
  expect(within(dialog).getByText('Script history')).toBeVisible();
  fireEvent.click(
    within(
      within(dialog).getByText('Script history').closest('article')!,
    ).getByText('详情', { exact: true }),
  );
  expect(dialog).toHaveTextContent('脚本独立调用模型的消耗不在此统计');
  expect(dialog).not.toHaveTextContent('automation.');
});

it('reports legacy and unavailable native coverage as unknown rather than a complete zero', async () => {
  const legacy = rule();
  delete legacy.statistics;
  const legacyNative: NativeWatch = { ...native };
  delete legacyNative.triggerCount;
  delete legacyNative.tokenUsage;
  delete legacyNative.priceEstimate;
  mockSnapshot([legacy], [legacyNative]);
  render(<ThreadWatchesControl thread={thread} />);
  fireEvent.click(screen.getByRole('button', { name: 'Automation' }));
  const dialog = await screen.findByRole('dialog', { name: 'Automation' });
  await within(dialog).findByText(
    'Lifetime statistics unavailable on this Supervisor.',
  );
  expect(
    within(dialog).getByRole('region', { name: 'Lifetime totals' }),
  ).toHaveTextContent('Partial');
  expect(
    within(dialog)
      .getByRole('group', { name: 'Tokens' })
      .querySelector('strong'),
  ).toHaveTextContent('—');
  expect(
    within(dialog)
      .getByRole('group', { name: 'Est. cost · USD' })
      .querySelector('strong'),
  ).toHaveTextContent('—');
  vi.mocked(request).mockImplementation(async (url) => {
    if (String(url).endsWith('/watches')) throw Error('Offline');
    return { automations: [legacy] };
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Refresh' }));
  await within(dialog).findByText('Automation data is temporarily unavailable');
});

it('discards late snapshots when switching threads', async () => {
  let resolve!: (v: unknown) => void;
  vi.mocked(request).mockImplementation(async (url) =>
    String(url).includes('/target/')
      ? new Promise((r) => {
          resolve = r;
        })
      : { automations: [] },
  );
  const { rerender } = render(
    <ThreadWatchesControl thread={{ ...thread, provider: 'codex' }} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Automation' }));
  await waitFor(() => expect(resolve).toBeDefined());
  rerender(
    <ThreadWatchesControl
      thread={{ ...thread, id: 'second', provider: 'codex' }}
    />,
  );
  await act(async () => {
    resolve({ automations: [rule()] });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Automation' }));
  await screen.findByText('No automations yet');
  expect(screen.queryByText('Hourly prompt')).not.toBeInTheDocument();
});

it('keeps unknown usage distinct from zero and sums only supplied attributed amounts', () => {
  const known = rule();
  const unknown = rule({
    id: 'unknown',
    statistics: {
      ...known.statistics!,
      triggerCount: 3,
      tokenUsage: null,
      priceEstimate: null,
    },
  });
  expect(automationTotals([known, unknown], [])).toMatchObject({
    triggers: 508,
    unknownCounts: 0,
    usage: tokens,
    price,
  });
  expect(automationTotals([unknown], [])).toMatchObject({
    triggers: 3,
    usage: null,
    price: null,
  });
  expect(
    automationTotals(
      [],
      [{ ...native, triggerCount: 0, ambiguousTriggerCount: 2 }],
    ),
  ).toMatchObject({ triggers: 0, unknownCounts: 1 });
  expect(automationTotals([], [])).toMatchObject({
    triggers: 0,
    usage: { totalTokens: 0 },
    price: { totalUsd: 0 },
  });
});

it('does not display known zero tokens or USD when both history endpoints fail', async () => {
  vi.mocked(request).mockRejectedValue(new Error('History unavailable'));
  render(<ThreadWatchesControl thread={thread} />);
  fireEvent.click(screen.getByRole('button', { name: 'Automation' }));
  const dialog = await screen.findByRole('dialog', { name: 'Automation' });
  await within(dialog).findByRole('alert');
  const totals = within(dialog).getByRole('region', {
    name: 'Lifetime totals',
  });
  expect(
    within(totals)
      .getByRole('group', { name: 'Triggers' })
      .querySelector('strong'),
  ).toHaveTextContent('—');
  expect(
    within(totals)
      .getByRole('group', { name: 'Tokens' })
      .querySelector('strong'),
  ).toHaveTextContent('—');
  expect(
    within(totals)
      .getByRole('group', { name: 'Est. cost · USD' })
      .querySelector('strong'),
  ).toHaveTextContent('—');
  expect(
    within(dialog).queryByText('No recorded automations.'),
  ).not.toBeInTheDocument();
});

it('presents an unsupported endpoint as a quiet device status and keeps raw diagnostics collapsed', async () => {
  vi.mocked(request).mockRejectedValue(
    Object.assign(new Error('Route not found'), { statusCode: 404 }),
  );
  render(<ThreadWatchesControl thread={{ ...thread, provider: 'codex' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Automation' }));
  const dialog = await screen.findByRole('dialog', { name: 'Automation' });
  await within(dialog).findByText('Update this device to view automations');
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  expect(within(dialog).getByText('Route not found')).not.toBeVisible();
  expect(
    within(dialog)
      .getByRole('group', { name: 'Triggers' })
      .querySelector('strong'),
  ).toHaveTextContent('—');
  fireEvent.click(within(dialog).getByLabelText('Connection details'));
  expect(within(dialog).getByText('Route not found')).toBeVisible();
});
