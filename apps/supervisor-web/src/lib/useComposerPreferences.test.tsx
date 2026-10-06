import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchComposerPreferences,
  saveComposerPreferences,
} from './composerPreferences';
import { useComposerPreferences } from './useComposerPreferences';

vi.mock('./api', () => ({ relayModeActive: () => true }));
vi.mock('./composerPreferences', () => ({
  fetchComposerPreferences: vi.fn(),
  saveComposerPreferences: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

it('loads the account shortcut and refreshes it when returning from another browser', async () => {
  vi.mocked(fetchComposerPreferences)
    .mockResolvedValueOnce({ sendShortcut: 'enter' })
    .mockResolvedValue({ sendShortcut: 'ctrlEnter' });
  const hook = renderHook(useComposerPreferences);
  await waitFor(() => expect(hook.result.current.sendShortcut).toBe('enter'));
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() =>
    expect(hook.result.current.sendShortcut).toBe('ctrlEnter'),
  );
});

it('retains the saved shortcut and reports a failed account update', async () => {
  vi.mocked(fetchComposerPreferences).mockResolvedValue({
    sendShortcut: 'ctrlEnter',
  });
  vi.mocked(saveComposerPreferences).mockRejectedValue(
    new Error('Save failed'),
  );
  const hook = renderHook(useComposerPreferences);
  await waitFor(() =>
    expect(hook.result.current.sendShortcutLoading).toBe(false),
  );
  await act(() => hook.result.current.setSendShortcut!('enter'));
  expect(hook.result.current.sendShortcut).toBe('ctrlEnter');
  expect(hook.result.current.sendShortcutError).toBe('Save failed');
  expect(hook.result.current.sendShortcutSaving).toBe(false);
});

it('does not let a stale load overwrite a newer account save', async () => {
  let finish!: (value: { sendShortcut: 'ctrlEnter' }) => void;
  vi.mocked(fetchComposerPreferences)
    .mockResolvedValueOnce({ sendShortcut: 'ctrlEnter' })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  vi.mocked(saveComposerPreferences).mockResolvedValue({
    sendShortcut: 'enter',
  });
  const hook = renderHook(useComposerPreferences);
  await waitFor(() =>
    expect(hook.result.current.sendShortcutLoading).toBe(false),
  );
  act(() => window.dispatchEvent(new Event('focus')));
  await act(() => hook.result.current.setSendShortcut!('enter'));
  await act(async () => finish({ sendShortcut: 'ctrlEnter' }));
  expect(hook.result.current.sendShortcut).toBe('enter');
  expect(hook.result.current.sendShortcutLoading).toBe(false);
});
