import {
  ThreadShellPanel as SharedThreadShellPanel,
  type ThreadShellAdapter,
  type ThreadShellControlState,
  type ThreadShellPanelHandle,
} from '@remote-codex/thread-ui';
import { forwardRef, type ComponentProps } from 'react';

import { useAppShellNav } from './AppShellNavContext';
import {
  connectShellSocket,
  createThreadShell,
  fetchThreadShellState,
  terminateShell,
  updateShell,
} from '../lib/api';

type ThreadShellPanelProps = Omit<
  ComponentProps<typeof SharedThreadShellPanel>,
  'shellAdapter'
> & {
  shellAdapter?: ThreadShellAdapter;
};

const localShellAdapter: ThreadShellAdapter = {
  fetchState: fetchThreadShellState,
  createShell: createThreadShell,
  terminateShell,
  updateShell,
  connectSocket: connectShellSocket,
};

function shellLayoutStorageKey(threadId: string) {
  return `remote-codex:shell-layout:${threadId}`;
}

function loadSplitRatio(threadId: string) {
  if (typeof window === 'undefined') {
    return null;
  }
  const storedRatio = window.localStorage.getItem(shellLayoutStorageKey(threadId));
  return storedRatio ? Number.parseFloat(storedRatio) : null;
}

function saveSplitRatio(threadId: string, ratio: number) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(shellLayoutStorageKey(threadId), String(ratio));
}

export type { ThreadShellControlState, ThreadShellPanelHandle };

export const ThreadShellPanel = forwardRef<
  ThreadShellPanelHandle,
  ThreadShellPanelProps
>(function ThreadShellPanel(
  { shellAdapter = localShellAdapter, effectiveTheme, ...props },
  ref,
) {
  const shellNav = useAppShellNav();

  return (
    <SharedThreadShellPanel
      {...props}
      ref={ref}
      shellAdapter={shellAdapter}
      effectiveTheme={effectiveTheme ?? shellNav?.effectiveTheme ?? 'dark'}
      loadSplitRatio={loadSplitRatio}
      saveSplitRatio={saveSplitRatio}
    />
  );
});
