import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useThreadDrafts } from './useThreadDrafts';
it('keeps drafts by device and thread and ignores a departed composer callback', () => {
  const { result, rerender } = renderHook(
    ({ source }) => useThreadDrafts(source),
    { initialProps: { source: 'device:a' } },
  );
  act(() => result.current[1]({ prompt: 'A only', attachments: [] }));
  const stale = result.current[1];
  rerender({ source: 'device:b' });
  expect(result.current[0].prompt).toBe('');
  act(() => {
    stale({ prompt: 'late A', attachments: [] });
    result.current[1]({ prompt: 'B only', attachments: [] });
  });
  rerender({ source: 'device:a' });
  expect(result.current[0].prompt).toBe('late A');
  act(() => stale({ prompt: 'older A callback', attachments: [] }));
  expect(result.current[0].prompt).toBe('late A');
  rerender({ source: 'other-device:a' });
  expect(result.current[0].prompt).toBe('');
});
