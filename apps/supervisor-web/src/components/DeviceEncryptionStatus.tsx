import { useEffect, useState } from 'react';
import { LockKeyhole, ShieldAlert } from 'lucide-react';
import {
  getTransportStatus,
  forgetDeviceIdentity,
} from '../lib/relayTransport';
import { type TransportStatus } from '../lib/relayTransportCrypto';
import { ConfirmDialog } from './ConfirmDialog';
export function DeviceEncryptionStatus({ deviceId }: { deviceId: string }) {
  const [status, setStatus] = useState<TransportStatus | undefined>(() =>
    getTransportStatus(deviceId),
  );
  const [open, setOpen] = useState(false),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<TransportStatus>).detail;
      if (next.deviceId === deviceId) setStatus(next);
    };
    window.addEventListener('remote-codex-transport', update);
    return () => window.removeEventListener('remote-codex-transport', update);
  }, [deviceId]);
  if (!status) return null;
  const encrypted = status.state === 'encrypted',
    changed = status.state === 'identity-changed';
  const label = encrypted
    ? 'Device connection encrypted'
    : changed
      ? 'Device identity changed'
      : 'Update supervisor to enable device encryption';
  return (
    <span className="relative inline-flex">
      <button
        aria-label={label}
        title={label}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--theme-hover)] ${encrypted ? 'text-[var(--theme-fg-muted)]' : 'text-[var(--theme-accent-strong)]'}`}
        onClick={() => setOpen(!open)}
      >
        {encrypted ? <LockKeyhole size={14} /> : <ShieldAlert size={16} />}
      </button>
      {open && (
        <>
          <button
            aria-label="Close connection information"
            className="fixed inset-0 z-[99] cursor-default"
            onClick={() => setOpen(false)}
          />
          <span
            role="status"
            className="fixed left-4 right-4 top-24 z-[100] mx-auto block max-w-md space-y-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 text-left text-sm shadow-xl"
          >
            <strong className="block">{label}</strong>
            <span className="block text-[var(--theme-fg-muted)]">
              {encrypted
                ? 'Private content is encrypted between this browser and the device. Routing metadata remains visible to the relay.'
                : changed
                  ? 'This browser stopped the connection. Run remote-codex relay-fingerprint on the device and compare it before trusting a replacement identity.'
                  : 'This device uses legacy relay transport. Update remote-codex on the device to encrypt private content through the relay.'}
            </span>
            {status.fingerprint && (
              <code
                className="block break-all text-xs"
                aria-label="Device fingerprint"
              >
                SHA-256 {status.fingerprint}
              </code>
            )}
            {changed && (
              <button
                className="relay-button-secondary px-3 py-2"
                onClick={() => {
                  setOpen(false);
                  setConfirm(true);
                }}
              >
                Trust replacement identity…
              </button>
            )}
          </span>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        title="Trust the replacement device identity?"
        description="Only continue after checking this fingerprint on your device. An unexpected change could indicate interception. This resets the saved identity for this browser."
        confirmLabel="I verified the fingerprint"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await forgetDeviceIdentity(deviceId);
          location.reload();
        }}
      />
    </span>
  );
}
