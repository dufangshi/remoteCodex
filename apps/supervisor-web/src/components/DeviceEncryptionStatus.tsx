import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  LockKeyhole,
  ShieldAlert,
  LockKeyholeOpen,
  Wifi,
  WifiOff,
  LoaderCircle,
} from 'lucide-react';
import {
  getTransportStatus,
  probeDeviceEncryption,
  trustDeviceIdentity,
} from '../lib/relayTransport';
import { type TransportStatus } from '../lib/relayTransportCrypto';
import { ConfirmDialog } from './ConfirmDialog';
export function DeviceEncryptionStatus({
  deviceId,
  online,
  connection,
  hideHealthy = false,
}: {
  deviceId?: string | undefined;
  online?: boolean;
  hideHealthy?: boolean;
  connection?: {
    loaded: boolean;
    busy: boolean;
    state: string;
    label: string;
    onConnect: () => void;
  };
}) {
  const [status, setStatus] = useState<TransportStatus | undefined>(() =>
    deviceId ? getTransportStatus(deviceId) : undefined,
  );
  const [open, setOpen] = useState(false),
    [confirm, setConfirm] = useState<TransportStatus | null>(null);
  const [trustError, setTrustError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 12 });
  useEffect(() => {
    if (!open) return;
    const place = () => { const rect = trigger.current?.getBoundingClientRect(); if (rect) setPosition({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) }); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => {
    setStatus(deviceId ? getTransportStatus(deviceId) : undefined);
    const update = (event: Event) => {
      const next = (event as CustomEvent<TransportStatus>).detail;
      if (next.deviceId === deviceId) setStatus(next);
    };
    window.addEventListener('remote-codex-transport', update);
    return () => window.removeEventListener('remote-codex-transport', update);
  }, [deviceId]);
  useEffect(() => {
    if (deviceId && online) void probeDeviceEncryption(deviceId);
  }, [deviceId, online]);
  if (!deviceId && !connection) return null;
  const encrypted = status?.state === 'encrypted',
    changed = status?.state === 'identity-changed';
  if (hideHealthy && !changed && connection?.loaded && connection.state === 'connected') return null;
  const label = !deviceId ? 'Local device connection' : encrypted
    ? 'Device connection encrypted'
    : changed
      ? 'Device identity changed'
      : status?.state === 'legacy'
        ? 'Connection is not end-to-end encrypted'
        : 'Device encryption not verified';
  return (
    <span className="relative inline-flex">
      <button
        ref={trigger}
        aria-expanded={open}
        type="button"
        aria-label={
          connection
            ? !connection.loaded && !changed
              ? connection.busy
                ? 'Connecting thread'
                : 'Connect thread'
              : `${connection.label} · ${label}`
            : label
        }
        title={connection ? `${connection.label} · ${label}` : label}
        disabled={connection?.busy}
        data-connection={
          connection
            ? !connection.loaded
              ? 'detached'
              : connection.state
            : undefined
        }
        data-encryption={
          encrypted
            ? 'encrypted'
            : changed
              ? 'identity-changed'
              : (status?.state ?? 'unknown')
        }
        className={
          connection
            ? 'device-connection-button'
            : 'inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--theme-fg-muted)] hover:bg-[var(--theme-hover)]'
        }
        onClick={() =>
          connection && !connection.loaded && !changed
            ? connection.onConnect()
            : setOpen(!open)
        }
      >
        {connection ? (
          <>
            {connection.busy || connection.state === 'reconnecting' ? (
              <LoaderCircle size={19} className="animate-spin" />
            ) : connection.state === 'offline' ? (
              <WifiOff size={19} />
            ) : encrypted && connection.loaded && connection.state === 'connected' ? (
              <LockKeyhole size={19} />
            ) : (
              <Wifi size={19} />
            )}
            {deviceId && !(encrypted && connection.loaded && connection.state === 'connected') && (
              <span className="device-connection-security" aria-hidden="true">
                {encrypted ? (
                  <LockKeyhole size={10} />
                ) : changed ? (
                  <ShieldAlert size={11} />
                ) : (
                  <LockKeyholeOpen size={10} />
                )}
              </span>
            )}
          </>
        ) : encrypted ? (
          <LockKeyhole size={14} />
        ) : (
          <ShieldAlert size={16} />
        )}
      </button>
      {open && createPortal(
        <>
          <button
            aria-label="Close connection information"
            className="fixed inset-0 z-[99] cursor-default"
            onClick={() => setOpen(false)}
          />
          <span
            role="status"
            className="device-connection-popover fixed z-[100] block space-y-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 text-left text-sm shadow-xl"
            style={{ top: position.top, right: position.right, width: 'min(360px, calc(100vw - 24px))' }}
          >
            <strong className="block">{label}</strong>
            {connection && <span className="block device-connection-state">{connection.label}</span>}
            <span className="block text-[var(--theme-fg-muted)]">
              {encrypted
                ? 'Private content is encrypted between this browser and the device. Routing metadata remains visible to the relay.'
                : changed
                  ? 'This browser stopped the connection. Run remote-codex relay-fingerprint on the device and compare it before trusting a replacement identity.'
                  : !deviceId ? connection?.label
                    : status?.state === 'legacy' ? 'This device uses legacy relay transport. Update remote-codex on the device to encrypt private content through the relay.'
                    : 'Device encryption has not been verified. Reconnect to check the device identity and establish an encrypted connection.'}
            </span>
            {status?.fingerprint && (
              <code
                className="block break-all text-xs"
                aria-label="Device fingerprint"
              >
                SHA-256 {status.fingerprint}
              </code>
            )}
            {trustError && <span role="alert">{trustError}</span>}
            {changed && status?.identityKey && (
              <button
                className="relay-button-secondary px-3 py-2"
                onClick={() => {
                  setOpen(false);
                  setTrustError(null);
                  setConfirm(status);
                }}
              >
                Trust replacement identity…
              </button>
            )}
          </span>
        </>, document.body
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title="Trust the replacement device identity?"
        description={`Compare SHA-256 ${confirm?.fingerprint ?? ""} with remote-codex relay-fingerprint on your device. Only this exact identity will be trusted.`}
        confirmLabel="I verified the fingerprint"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            if (!deviceId || !confirm?.identityKey || !confirm.fingerprint) return;
            await trustDeviceIdentity(deviceId, confirm.identityKey, confirm.fingerprint);
            location.reload();
          } catch (error) {
            setTrustError(error instanceof Error ? error.message : 'Unable to save device identity.');
            setConfirm(null);
            setOpen(true);
          }
        }}
      />
    </span>
  );
}
