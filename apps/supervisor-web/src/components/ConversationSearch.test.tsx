import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ThreadTurnDto } from '@remote-codex/shared';
import { ConversationSearch } from './ConversationSearch';
import { fetchThreadConversationPage, fetchThreadTurnDetail, searchThreadMessages } from '../lib/api';

vi.mock('../lib/api', () => ({
  searchThreadMessages: vi.fn(), fetchThreadConversationPage: vi.fn(), fetchThreadTurnDetail: vi.fn(),
  ApiError: class extends Error { constructor(public statusCode: number) { super('not found'); } },
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const current = { id: 'live', hasDeferredItems: false, items: [{ id: 'live-msg', kind: 'agentMessage', text: 'Current cobalt reply' }] } as ThreadTurnDto;
const older = { id: 'old', hasDeferredItems: false, items: [{ id: 'old-msg', kind: 'agentMessage', text: 'Older cobalt decision' }] } as ThreadTurnDto;
function Harness({ onSelect = vi.fn(), turns = [current] }: { onSelect?: ReturnType<typeof vi.fn>; turns?: ThreadTurnDto[] }) {
  const [open, setOpen] = useState(false);
  return <ConversationSearch threadId="thread-1" turns={turns} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onSelect={onSelect} />;
}

it('opens without loading history, searches live text immediately, and fetches only a selected older turn', async () => {
  vi.mocked(searchThreadMessages).mockResolvedValue({ matches: [{ turnId: 'old', itemId: 'old-msg', role: 'Assistant', text: 'Older cobalt decision' }], hasMore: false });
  vi.mocked(fetchThreadTurnDetail).mockResolvedValue(older);
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search conversation' }));
  expect(screen.getByRole('combobox', { name: 'Search messages' })).toHaveFocus();
  expect(searchThreadMessages).not.toHaveBeenCalled();
  expect(fetchThreadConversationPage).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cobalt' } });
  expect(screen.getByRole('option', { name: /Current cobalt reply/ })).toBeVisible();
  await screen.findByRole('option', { name: /Older cobalt decision/ });
  expect(fetchThreadTurnDetail).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('option', { name: /Older cobalt decision/ }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith([older], 'old', 'old-msg'));
  expect(fetchThreadTurnDetail).toHaveBeenCalledExactlyOnceWith('thread-1', 'old');
  expect(fetchThreadConversationPage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Search conversation' }));
  await screen.findByRole('option', { name: /Older cobalt decision/ });
  expect(searchThreadMessages).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Search conversation' })).toHaveFocus();
});

it('cancels stale queries and ignores a response even if transport cannot abort it', async () => {
  let resolveFirst!: (result: { matches: []; hasMore: false }) => void;
  vi.mocked(searchThreadMessages).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  vi.mocked(searchThreadMessages).mockResolvedValueOnce({ matches: [{ turnId: 'old', itemId: 'old-msg', role: 'Assistant', text: 'Newest keyword' }], hasMore: false });
  render(<Harness turns={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search conversation' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'first' } });
  await waitFor(() => expect(searchThreadMessages).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(searchThreadMessages).mock.calls[0]![2]!;
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'keyword' } });
  expect(signal.aborted).toBe(true);
  await screen.findByRole('option', { name: /Newest keyword/ });
  resolveFirst({ matches: [], hasMore: false });
  await waitFor(() => expect(screen.getByRole('option', { name: /Newest keyword/ })).toBeVisible());
});

it('uses full pages on old Supervisors without per-turn hydration, and cancels outside clicks', async () => {
  const { ApiError } = await import('../lib/api');
  vi.mocked(searchThreadMessages).mockRejectedValue(new ApiError(404, {} as never));
  vi.mocked(fetchThreadConversationPage).mockResolvedValue({ turns: [older, current], totalTurnCount: 2 } as never);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Search conversation' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cobalt' } });
  await screen.findByRole('option', { name: /Older cobalt decision/ });
  expect(fetchThreadConversationPage).toHaveBeenCalledTimes(1);
  expect(fetchThreadTurnDetail).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
