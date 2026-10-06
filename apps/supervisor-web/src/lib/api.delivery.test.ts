import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { steerPendingPrompt, steerSubmittedPrompt } from './api';

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

it('steers only the receipt belonging to the submitted message', async () => {
  const queued = { ...detail, thread: { id: 'thread', status: 'running', activeTurnId: 'turn' }, pendingSteers: [
    { id: 'other', clientRequestId: 'someone-else', delivery: 'continuation' },
    { id: 'mine', clientRequestId: 'request-1', delivery: 'continuation' },
  ] };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(queued)).mockResolvedValueOnce(Response.json(detail));
  vi.stubGlobal('fetch', fetch);
  await steerSubmittedPrompt('thread', 'request-1', 'turn');
  expect(fetch.mock.calls[1]?.[0]).toContain('/pending-steers/mine/steer');
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it('keeps a saved continuation when its original turn has finished', async () => {
  const newer = { ...detail, thread: { id: 'thread', status: 'running', activeTurnId: 'new-turn' } };
  const fetch = vi.fn().mockResolvedValue(Response.json(newer));
  vi.stubGlobal('fetch', fetch);
  expect(await steerSubmittedPrompt('thread', 'request-1', 'old-turn')).toEqual(newer);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not steer another queued message if the submitted receipt is missing', async () => {
  const queued = { ...detail, thread: { id: 'thread', status: 'running', activeTurnId: 'turn' }, pendingSteers: [
    { id: 'other', clientRequestId: 'someone-else', delivery: 'continuation' },
  ] };
  const fetch = vi.fn().mockResolvedValue(Response.json(queued));
  vi.stubGlobal('fetch', fetch);
  await expect(steerSubmittedPrompt('thread', 'request-1', 'turn')).rejects.toThrow('saved message');
  expect(fetch).toHaveBeenCalledTimes(1);
});
