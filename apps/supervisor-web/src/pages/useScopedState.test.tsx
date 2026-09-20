import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useScopedState } from './useScopedState';

it('invalidates data synchronously on a device change even for the same thread ID and rejects late writes', () => {
  const { result, rerender } = renderHook(({ scope }) => useScopedState<string | null>(scope, null), { initialProps: { scope: 'mac:same-thread' } });
  const writeMac = result.current[1];
  act(() => writeMac('Mac transcript'));
  expect(result.current[0]).toBe('Mac transcript');
  rerender({ scope: 'wsl:same-thread' });
  expect(result.current[0]).toBeNull();
  act(() => result.current[1]('WSL transcript'));
  act(() => writeMac('Late Mac response'));
  expect(result.current[0]).toBe('WSL transcript');
  rerender({ scope: 'mac:same-thread' });
  act(() => writeMac('Late response from the first Mac visit'));
  expect(result.current[0]).toBeNull();
});
