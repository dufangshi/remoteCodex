import { useMemo, useRef } from 'react';
import {
  ThreadShellPanel,
  type ThreadShellAdapter,
  type WorkbenchToolPanelControls,
} from '@pockymoe/thread-ui';
import { translate as t, useI18n } from '@pockymoe/thread-ui/i18n';
import type { ThreadDetailDto } from '@pockymoe/shared';
import {
  connectShellSocket,
  createThreadShell,
  fetchThreadShellState,
  terminateShell,
  updateShell,
} from '../lib/api';

/** An explicit open of the terminal for one device/conversation target. */
export interface TerminalOpenRequest {
  token: number;
  target: string;
}

interface CachedTarget {
  key: string;
  deviceId: string;
  detail: ThreadDetailDto;
  canControl: boolean;
  label: string;
  usedAt: number;
}

/** Recently focused targets stay mounted, so a focus change never drops a running terminal. */
const CACHED_TARGETS = 4;

export function terminalTargetKey(deviceId: string, threadId: string) {
  return `${deviceId}:${threadId}`;
}

function TerminalTarget({
  target,
  current,
  visible,
  controls,
  effectiveTheme,
  openRequest,
  onLastTerminalClosed,
}: {
  target: CachedTarget;
  /** The focused conversation's target (shown when the panel is open). */
  current: boolean;
  visible: boolean;
  controls: WorkbenchToolPanelControls | undefined;
  effectiveTheme: 'light' | 'dark';
  openRequest: number;
  onLastTerminalClosed: () => void;
}) {
  const { deviceId } = target;
  const threadId = target.detail.thread.id;
  // Shell IDs are local to a device. Capture the full target for HTTP and WS.
  const adapter = useMemo<ThreadShellAdapter>(
    () => ({
      fetchState: (id) => fetchThreadShellState(id, deviceId),
      createShell: (id, input) => createThreadShell(id, input, deviceId),
      terminateShell: (id) => terminateShell(id, deviceId, threadId),
      updateShell: (id, input) => updateShell(id, input, deviceId, threadId),
      connectSocket: (handlers) =>
        connectShellSocket(handlers, {
          deviceId: deviceId === 'local' ? null : deviceId,
          threadId,
        }),
    }),
    [deviceId, threadId],
  );
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      hidden={!current}
      data-testid={current ? 'workbench-terminal-target' : 'workbench-terminal-cached'}
      data-device={deviceId}
      data-thread={threadId}
    >
      {target.canControl ? (
        <ThreadShellPanel
          threadId={threadId}
          shellAdapter={adapter}
          effectiveTheme={effectiveTheme}
          isVisible={visible}
          targetLabel={target.label}
          layoutStorageKey={`pockymoe:terminal-layout:${deviceId}:${threadId}`}
          {...(current && controls ? { panelControls: controls } : {})}
          openRequest={openRequest}
          {...(current ? { onLastTerminalClosed } : {})}
        />
      ) : (
        <p role="status" className="workbench-reference-status">
          {t('workbench.thisSharedSessionIsViewOnly')}
        </p>
      )}
    </div>
  );
}

/** The bottom terminal follows the last focused conversation's device and workspace. */
export function WorkbenchTerminal({
  deviceId,
  detail,
  canControl,
  open,
  controls,
  onClose,
  effectiveTheme,
  targetLabel,
  openRequest,
}: {
  deviceId: string;
  detail: ThreadDetailDto | null;
  canControl: boolean;
  /** The panel stays mounted while hidden; hidden terminals neither attach nor focus. */
  open: boolean;
  controls?: WorkbenchToolPanelControls;
  onClose: () => void;
  effectiveTheme: 'light' | 'dark';
  targetLabel: string;
  openRequest: TerminalOpenRequest | null;
}) {
  useI18n();
  const key = detail ? terminalTargetKey(deviceId, detail.thread.id) : null;
  const cache = useRef<CachedTarget[]>([]);
  const targets = useMemo(() => {
    if (!key || !detail) return cache.current;
    const current = { key, deviceId, detail, canControl, label: targetLabel, usedAt: Date.now() };
    // Keep mount order stable: moving xterm hosts would steal focus.
    let next = cache.current.some(target => target.key === key)
      ? cache.current.map(target => (target.key === key ? current : target))
      : [...cache.current, current];
    if (next.length > CACHED_TARGETS) {
      const evict = next.filter(target => target.key !== key).sort((left, right) => left.usedAt - right.usedAt)[0];
      next = next.filter(target => target !== evict);
    }
    cache.current = next;
    return next;
  }, [canControl, detail, deviceId, key, targetLabel]);
  if (!detail || !key)
    return (
      <p role="status" className="workbench-reference-status">
        {t('workbench.loadingThreadDetail')}
      </p>
    );
  return (
    <>
      {targets.map(target => (
        <TerminalTarget
          key={target.key}
          target={target}
          current={target.key === key}
          visible={open && target.key === key}
          controls={controls}
          effectiveTheme={effectiveTheme}
          openRequest={openRequest?.target === target.key ? openRequest.token : 0}
          onLastTerminalClosed={onClose}
        />
      ))}
    </>
  );
}
