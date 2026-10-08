import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ThreadTurnDto } from '@remote-codex/shared';
import { ConversationSearch } from './ConversationSearch';
import { fetchThreadConversationPage, fetchThreadTurnDetail, searchThreadMessages, searchConversations } from '../lib/api';

vi.mock('../lib/api', () => ({
  searchConversations: vi.fn(), searchThreadMessages: vi.fn(), fetchThreadConversationPage: vi.fn(), fetchThreadTurnDetail: vi.fn(),
  ApiError: class extends Error { constructor(public statusCode: number) { super('not found'); } },
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const current = { id: 'live', hasDeferredItems: false, items: [{ id: 'live-msg', kind: 'agentMessage', text: 'Current cobalt reply' }] } as ThreadTurnDto;
const older = { id: 'old', hasDeferredItems: false, items: [{ id: 'old-msg', kind: 'agentMessage', text: 'Older cobalt decision' }] } as ThreadTurnDto;
function Harness({ onSelect = vi.fn(), onNavigate = vi.fn(), allowGlobal = false, turns = [current] }: {
  onSelect?: ReturnType<typeof vi.fn>; onNavigate?: ReturnType<typeof vi.fn>; allowGlobal?: boolean; turns?: ThreadTurnDto[];
}) {
  const [open, setOpen] = useState(false);
  return <ConversationSearch threadId="thread-1" workspaceId="workspace-1" deviceLabel="Local device" allowGlobal={allowGlobal} onNavigate={onNavigate} turns={turns} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onSelect={onSelect} />;
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
  fireEvent.change(screen.getByRole('combobox', { name: 'Search messages' }), { target: { value: 'cobalt' } });
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
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search messages' }), { key: 'Escape' });
  expect(screen.queryByRole('combobox', { name: 'Search messages' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Search conversation' })).toHaveFocus();
});

it('cancels stale queries and ignores a response even if transport cannot abort it', async () => {
  let resolveFirst!: (result: { matches: []; hasMore: false }) => void;
  vi.mocked(searchThreadMessages).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  vi.mocked(searchThreadMessages).mockResolvedValueOnce({ matches: [{ turnId: 'old', itemId: 'old-msg', role: 'Assistant', text: 'Newest keyword' }], hasMore: false });
  render(<Harness turns={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search conversation' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Search messages' }), { target: { value: 'first' } });
  await waitFor(() => expect(searchThreadMessages).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(searchThreadMessages).mock.calls[0]![2]!;
  fireEvent.change(screen.getByRole('combobox', { name: 'Search messages' }), { target: { value: 'keyword' } });
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
  fireEvent.change(screen.getByRole('combobox', { name: 'Search messages' }), { target: { value: 'cobalt' } });
  await screen.findByRole('option', { name: /Older cobalt decision/ });
  expect(fetchThreadConversationPage).toHaveBeenCalledTimes(1);
  expect(fetchThreadTurnDetail).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('combobox', { name: 'Search messages' })).not.toBeInTheDocument();
});

const globalMatch = {
  threadId: 'other-thread', threadTitle: 'Earlier decision', workspaceId: 'workspace-1', workspaceLabel: 'Project',
  workspacePath: '/project', turnId: 'old', itemId: 'old-msg', kind: 'message' as const,
  role: 'Assistant', text: 'Older cobalt decision', createdAt: '2030-01-01',
};
it('searches authorized scopes with pagination and keyboard navigation without scanning histories', async () => {
  vi.mocked(searchConversations).mockResolvedValueOnce({ matches: [globalMatch], hasMore: true, nextOffset: 50, scope: 'device' });
  vi.mocked(searchConversations).mockResolvedValueOnce({ matches: [{ ...globalMatch, text: 'Next cobalt page' }], hasMore: false, nextOffset: null, scope: 'device' });
  const onNavigate = vi.fn();
  render(<Harness allowGlobal onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search conversation' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Search scope' }), { target: { value: 'workspace' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Search messages' }), { target: { value: 'cobalt' } });
  await screen.findByRole('option', { name: /Earlier decision.*Older cobalt decision/ });
  expect(searchConversations).toHaveBeenCalledWith('cobalt', 'workspace-1', 0, expect.any(AbortSignal));
  expect(screen.queryByRole('option', { name: /Current cobalt reply/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next results' }));
  await screen.findByRole('option', { name: /Next cobalt page/ });
  expect(searchConversations).toHaveBeenLastCalledWith('cobalt', 'workspace-1', 50, expect.any(AbortSignal));
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search messages' }), { key: 'Enter' });
  expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'other-thread', itemId: 'old-msg' }));
  expect(fetchThreadConversationPage).not.toHaveBeenCalled();
  expect(fetchThreadTurnDetail).not.toHaveBeenCalled();
  expect(searchThreadMessages).not.toHaveBeenCalled();
});
it('cancels global queries on scope changes and reports failure without falling back to browser history scans', async () => {
  let resolveFirst!: (result: Awaited<ReturnType<typeof searchConversations>>) => void;
  vi.mocked(searchConversations).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  vi.mocked(searchConversations).mockRejectedValueOnce(new Error('Device unavailable'));
  render(<Harness allowGlobal turns={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search conversation' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Search scope' }), { target: { value: 'device' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Search messages' }), { target: { value: 'cobalt' } });
  await waitFor(() => expect(searchConversations).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(searchConversations).mock.calls[0]![3]!;
  fireEvent.change(screen.getByRole('combobox', { name: 'Search scope' }), { target: { value: 'workspace' } });
  expect(signal.aborted).toBe(true);
  await screen.findByRole('alert');
  resolveFirst({ matches: [globalMatch], hasMore: false, nextOffset: null, scope: 'device' });
  expect(screen.getByRole('alert')).toHaveTextContent('Device unavailable');
  expect(screen.queryByRole('option', { name: /Earlier decision/ })).not.toBeInTheDocument();
  expect(fetchThreadConversationPage).not.toHaveBeenCalled();
});
it('never offers global scopes for a thread-only share and closes an in-flight query', async () => {
  vi.mocked(searchThreadMessages).mockImplementation(() => new Promise(() => {}));
  render(<Harness turns={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search conversation' }));
  expect(screen.queryByRole('option', { name: 'This device' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'This workspace' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Search messages' }), { target: { value: 'query' } });
  await waitFor(() => expect(searchThreadMessages).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(searchThreadMessages).mock.calls[0]![2]!;
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search messages' }), { key: 'Escape' });
  expect(signal.aborted).toBe(true);
  expect(searchConversations).not.toHaveBeenCalled();
});
