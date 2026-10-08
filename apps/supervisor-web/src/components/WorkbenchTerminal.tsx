import { useMemo } from 'react';
import {
  ThreadShellPanel,
  type ThreadShellAdapter,
} from '@remote-codex/thread-ui';
import { translate as t, useI18n } from '@remote-codex/thread-ui/i18n';
import type { ThreadDetailDto } from '@remote-codex/shared';
import {
  connectShellSocket,
  createThreadShell,
  fetchThreadShellState,
  terminateShell,
  updateShell,
} from '../lib/api';

/** Shell IDs are local to a device. Capture the full target for HTTP and WS. */
export function WorkbenchTerminal({
  deviceId,
  detail,
  canControl,
  onClose,
  effectiveTheme,
}: {
  deviceId: string;
  detail: ThreadDetailDto | null;
  canControl: boolean;
  onClose: () => void;
  effectiveTheme: 'light' | 'dark';
}) {
  useI18n();
  const threadId = detail?.thread.id ?? null;
  const adapter = useMemo<ThreadShellAdapter>(
    () => ({
      fetchState: (id) => fetchThreadShellState(id, deviceId),
      createShell: (id, input) => createThreadShell(id, input, deviceId),
      terminateShell: (id) =>
        terminateShell(id, deviceId, threadId ?? undefined),
      updateShell: (id, input) =>
        updateShell(id, input, deviceId, threadId ?? undefined),
      connectSocket: (handlers) =>
        connectShellSocket(handlers, {
          deviceId: deviceId === 'local' ? null : deviceId,
          threadId,
        }),
    }),
    [deviceId, threadId],
  );
  if (!detail)
    return (
      <p role="status" className="workbench-reference-status">
        {t('workbench.loadingThreadDetail')}
      </p>
    );
  if (!canControl)
    return (
      <p role="status" className="workbench-reference-status">
        {t('workbench.thisSharedSessionIsViewOnly')}
      </p>
    );
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="workbench-terminal-target"
      data-device={deviceId}
      data-thread={detail.thread.id}
    >
      <ThreadShellPanel
        key={`${deviceId}:${detail.thread.id}`}
        threadId={detail.thread.id}
        shellAdapter={adapter}
        effectiveTheme={effectiveTheme}
        isVisible
        showHeader
        showFloatingToolbox
        onBackToChat={onClose}
      />
    </div>
  );
}
