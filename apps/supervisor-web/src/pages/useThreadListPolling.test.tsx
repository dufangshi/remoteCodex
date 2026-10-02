import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchThreads } from '../lib/api';
import { useThreadListPolling } from './useThreadListPolling';

vi.mock('../lib/api', () => ({ fetchThreads: vi.fn() }));

describe('thread group polling', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps agent threads in repeated detail-page snapshots, but leaves root-only listings unchanged', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchThreads).mockResolvedValue([]);
    const setThreads = vi.fn();
    const { rerender, unmount } = renderHook(({ includeAgentThreads }) =>
      useThreadListPolling({ enabled: true, setThreads, intervalMs: 1000, includeAgentThreads }),
      { initialProps: { includeAgentThreads: true } });
    try {
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(vi.mocked(fetchThreads).mock.calls).toEqual([[true], [true]]);
      expect(setThreads).toHaveBeenCalledTimes(2);
      rerender({ includeAgentThreads: false });
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(fetchThreads).toHaveBeenLastCalledWith(false);
    } finally { unmount(); }
  });
});
