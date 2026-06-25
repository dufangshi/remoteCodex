import type { ReactNode } from 'react';

export function ControlPlaneAlerts({
  error,
  message,
  gatewayUnavailable,
  quotaExceeded,
  disabledAccount,
  expiredSession,
  adminUsersForbidden,
  workerConnectionState,
  sandboxOffline,
  sandboxNotice,
}: {
  error: string | null;
  message: string | null;
  gatewayUnavailable: string | null;
  quotaExceeded: string | null;
  disabledAccount: string | null;
  expiredSession: string | null;
  adminUsersForbidden: string | null;
  workerConnectionState: 'idle' | 'connecting' | 'ready' | 'reconnecting';
  sandboxOffline: string | null;
  sandboxNotice: { tone: string; text: ReactNode } | null;
}) {
  return (
    <>
      {error ? <div className="control-alert danger">{error}</div> : null}
      {message ? <div className="control-alert success">{message}</div> : null}
      {gatewayUnavailable ? <div className="control-alert warning">LLM gateway unavailable: {gatewayUnavailable}</div> : null}
      {quotaExceeded ? <div className="control-alert danger">LLM quota exceeded: {quotaExceeded}</div> : null}
      {disabledAccount ? <div className="control-alert danger">Account disabled: {disabledAccount}</div> : null}
      {expiredSession ? <div className="control-alert warning">Session expired: {expiredSession}</div> : null}
      {adminUsersForbidden ? <div className="control-alert warning">Admin access denied: {adminUsersForbidden}</div> : null}
      {workerConnectionState === 'reconnecting' ? <div className="control-alert warning">Reconnecting sandbox route.</div> : null}
      {workerConnectionState === 'connecting' ? <div className="control-alert neutral">Connecting sandbox route.</div> : null}
      {sandboxOffline ? <div className="control-alert danger">Sandbox offline: {sandboxOffline}</div> : null}
      {sandboxNotice ? <div className={`control-alert ${sandboxNotice.tone}`}>{sandboxNotice.text}</div> : null}
    </>
  );
}
