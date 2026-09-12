import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchThreadDetail, request, steerPendingPrompt } from './api';

const detail = {
  thread: { id: 'thread' },
  workspace: {},
  turns: [],
  pendingSteers: [],
  pendingRequests: [],
};
const timeout = () =>
  new Response('<!doctype html><html>Cloudflare gateway timed out</html>', {
    status: 504,
    headers: { 'content-type': 'text/html' },
  });
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('confirms a timed out steer from its durable receipt without resubmitting', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(timeout())
    .mockResolvedValueOnce(
      Response.json({ ...detail, acceptedSteerIds: ['queued-1'] }),
    );
  vi.stubGlobal('fetch', fetch);
  const result = await steerPendingPrompt('thread', 'queued-1');
  expect(result.turns).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
  expect(fetch.mock.calls[1]?.[0]).toContain('view=delivery');
});

it('does not mistake a missing queue entry for a successful steer', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? timeout() : Response.json(detail),
    );
  vi.stubGlobal('fetch', fetch);
  const result = steerPendingPrompt('thread', 'queued-1');
  const assertion = expect(result).rejects.toThrow('not yet confirmed');
  await vi.runAllTimersAsync();
  await assertion;
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
});
