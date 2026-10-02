// @vitest-environment jsdom
import { StrictMode, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSubscriptionUsageDto } from '../../../../packages/shared/src/index';
import { fetchAgentSubscriptionUsage } from '../lib/api';
import { useSubscriptionUsage } from './useSubscriptionUsage';

vi.mock('../lib/api', () => ({ fetchAgentSubscriptionUsage: vi.fn() }));
const FIVE_MINUTES = 300_000;
let deviceNumber = 0;
function props() {
  return { deviceId: `device-${++deviceNumber}`, threadId: 'parent', provider: 'claude' as const, agentId: null };
}
function usage(): AgentSubscriptionUsageDto {
  return {
    provider: 'claude', authKind: 'subscription', observedAt: new Date().toISOString(), stale: false,
    windows: [{ id: 'five_hour', label: '5h', durationMinutes: 300, usedPercent: 40, resetsAt: new Date(Date.now() + 3_600_000).toISOString() }],
  };
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }

describe('subscription usage caching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    vi.mocked(fetchAgentSubscriptionUsage).mockReset().mockResolvedValue({ usage: usage() });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('reads on open, shares the parent/child cache, and polls only after five minutes', async () => {
    const initialProps = props();
    const { result, rerender } = renderHook(useSubscriptionUsage, { initialProps });
    await settle();
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(1);
    expect(result.current?.windows[0]?.label).toBe('5h');
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    rerender({ ...initialProps, threadId: 'child' });
    await settle();
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES - 60_000 - 1));
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(2);
  });

  it('deduplicates StrictMode and simultaneous thread viewers', async () => {
    const initialProps = props();
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const first = renderHook(useSubscriptionUsage, { initialProps, wrapper });
    const second = renderHook(useSubscriptionUsage, { initialProps: { ...initialProps, threadId: 'child' } });
    await settle();
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(1);
    expect(first.result.current).toEqual(second.result.current);
  });

  it('keeps last known data on old-runtime null responses and network errors, backing off then recovering', async () => {
    const { result } = renderHook(useSubscriptionUsage, { initialProps: props() });
    await settle();
    const observedAt = result.current?.observedAt;
    vi.mocked(fetchAgentSubscriptionUsage).mockResolvedValueOnce({ usage: null }).mockRejectedValueOnce(new Error('offline'));
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(result.current?.stale).toBe(true);
    expect(result.current?.observedAt).toBe(observedAt);
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(3);
    vi.mocked(fetchAgentSubscriptionUsage).mockResolvedValue({ usage: usage() });
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(4);
    expect(result.current?.stale).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(5);
  });

  it('expires last known data at thirty minutes without querying during backoff', async () => {
    const { result } = renderHook(useSubscriptionUsage, { initialProps: props() });
    await settle();
    vi.mocked(fetchAgentSubscriptionUsage).mockResolvedValue({ usage: null });
    await act(() => vi.advanceTimersByTimeAsync(30 * 60_000 - 1));
    expect(result.current?.stale).toBe(true);
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(4);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current).toBeNull();
    expect(fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(4);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(vi.getTimerCount()).toBe(1);
  });

  it('clears stale quota on an explicit unavailable/auth response', async () => {
    const { result } = renderHook(useSubscriptionUsage, { initialProps: props() });
    await settle();
    vi.mocked(fetchAgentSubscriptionUsage).mockResolvedValue({ usage: null, unavailable: true });
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(result.current).toBeNull();
  });

  it('never renders another device cache or accepts its late response', async () => {
    const initialProps = props();
    let resolve!: (value: { usage: AgentSubscriptionUsageDto | null }) => void;
    vi.mocked(fetchAgentSubscriptionUsage).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(useSubscriptionUsage, { initialProps });
    await settle();
    vi.mocked(fetchAgentSubscriptionUsage).mockResolvedValue({ usage: null, unavailable: true });
    rerender({ ...initialProps, deviceId: 'different-device' });
    expect(result.current).toBeNull();
    await settle();
    await act(async () => { resolve({ usage: usage() }); });
    expect(result.current).toBeNull();
  });
});
