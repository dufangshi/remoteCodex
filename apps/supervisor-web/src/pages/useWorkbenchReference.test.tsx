import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkbenchReference } from './useWorkbenchReference';
import * as api from '../lib/api';
vi.mock('../lib/api', () => ({
  relayModeActive: vi.fn(() => true), fetchRelayAccess: vi.fn(),
  fetchThreadCapabilitySnapshot: vi.fn(async () => ({ effectiveCapabilities: null })),
  fetchThreadModels: vi.fn(async () => []), fetchThreadDetail: vi.fn(),
  sendThreadPrompt: vi.fn(), resumeThread: vi.fn(), interruptThread: vi.fn(),
  cancelPendingSteer: vi.fn(), steerPendingPrompt: vi.fn(), steerSubmittedPrompt: vi.fn(),
  respondToThreadRequest: vi.fn(), updateThreadSettings: vi.fn(),
}));
const detail = (id: string) => ({ thread: { id, isLoaded: true, status: 'idle', collaborationMode: 'default' }, turns: [], pendingRequests: [] });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchThreadDetail).mockImplementation(async id => detail(id) as never);
});
it('checks the secondary thread ACL independently and fails closed while unresolved, read only, or failed', async () => {
  let resolve!: (value: never) => void;
  vi.mocked(api.fetchRelayAccess).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { result, rerender } = renderHook(({ id }) => useWorkbenchReference('device', id), { initialProps: { id: 'reader' } });
  expect(result.current.canControl).toBe(false);
  await act(async () => { expect(await result.current.send({ prompt: 'blocked' })).toBe(false); });
  await act(async () => { resolve({ kind: 'shared', threadAccess: 'read' } as never); });
  await waitFor(() => expect(result.current.detail?.thread.id).toBe('reader'));
  expect(api.fetchRelayAccess).toHaveBeenCalledWith({ deviceId: 'device', threadId: 'reader' });
  expect(result.current.canControl).toBe(false);
  await act(async () => {
    await result.current.send({ prompt: 'blocked' });
    await result.current.interrupt();
    await result.current.cancelQueued('queue-reader');
    await result.current.steerQueued('queue-reader');
    await result.current.respond('request-reader', { answers: {} });
    await result.current.updateSettings({ model: 'blocked' });
  });
  for (const mutation of [api.sendThreadPrompt, api.interruptThread, api.cancelPendingSteer, api.steerPendingPrompt, api.respondToThreadRequest, api.updateThreadSettings]) expect(mutation).not.toHaveBeenCalled();
  vi.mocked(api.fetchRelayAccess).mockRejectedValueOnce(new Error('ACL unavailable'));
  rerender({ id: 'unknown' });
  await waitFor(() => expect(result.current.error).toBe('ACL unavailable'));
  expect(result.current.canControl).toBe(false);
});
it('binds each mutation and an in-flight upload to the selected ID and ignores a departed controller', async () => {
  vi.mocked(api.fetchRelayAccess).mockResolvedValue({ kind: 'shared', threadAccess: 'control' } as never);
  const { result, rerender } = renderHook(({ id }) => useWorkbenchReference('device', id), { initialProps: { id: 'b' } });
  await waitFor(() => expect(result.current.canControl && result.current.detail?.thread.id === 'b').toBe(true));
  const old = result.current;
  let finish!: () => void;
  vi.mocked(api.sendThreadPrompt).mockImplementationOnce(() => new Promise(done => { finish = () => done({ id: 'b' } as never); }));
  const attachment = { file: new File(['b'], 'b.txt'), clientId: 'b-file', originalName: 'b.txt', kind: 'file' as const, placeholder: '[FILE b.txt]' };
  let sent!: Promise<boolean>;
  act(() => { sent = old.send({ prompt: 'B upload', attachments: [attachment] }); });
  await waitFor(() => expect(api.sendThreadPrompt).toHaveBeenCalledWith('b', expect.objectContaining({ attachments: [attachment] })));
  rerender({ id: 'c' });
  await waitFor(() => expect(result.current.detail?.thread.id).toBe('c'));
  await act(async () => { finish(); await sent; });
  expect(result.current.detail?.thread.id).toBe('c');
  expect(result.current.busy).toBe(false);
  await act(async () => {
    expect(await old.send({ prompt: 'late B' })).toBe(false);
    await result.current.interrupt();
    await result.current.cancelQueued('queue-c');
    await result.current.steerQueued('queue-c');
    await result.current.respond('request-c', { answers: {} });
  });
  expect(api.sendThreadPrompt).toHaveBeenCalledTimes(1);
  expect(api.interruptThread).toHaveBeenCalledWith('c');
  expect(api.cancelPendingSteer).toHaveBeenCalledWith('c', 'queue-c');
  expect(api.steerPendingPrompt).toHaveBeenCalledWith('c', 'queue-c');
  expect(api.respondToThreadRequest).toHaveBeenCalledWith('c', 'request-c', { answers: {} });
});
it('keeps a successful prompt accepted if its follow-up summary fetch fails', async () => {
  vi.mocked(api.relayModeActive).mockReturnValue(false);
  vi.mocked(api.sendThreadPrompt).mockResolvedValue({ id: 'accepted' } as never);
  const { result } = renderHook(() => useWorkbenchReference('local', 'accepted'));
  await waitFor(() => expect(result.current.detail?.thread.id).toBe('accepted'));
  vi.mocked(api.fetchThreadDetail).mockRejectedValueOnce(new Error('Summary temporarily offline'));
  await act(async () => { expect(await result.current.send({ prompt: 'persisted once' })).toBe(true); });
  expect(api.sendThreadPrompt).toHaveBeenCalledTimes(1);
  expect(result.current.error).toBe('Summary temporarily offline');
});
