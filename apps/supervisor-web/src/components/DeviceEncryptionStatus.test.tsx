import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeviceEncryptionStatus } from './DeviceEncryptionStatus';

vi.mock('../lib/relayTransport', () => ({
  getTransportStatus: () => undefined,
  forgetDeviceIdentity: vi.fn(),
}));

function report(state: string, fingerprint?: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent('remote-codex-transport', {
      detail: { deviceId: 'device-1', state, fingerprint },
    }));
  });
}

describe('combined device connection indicator', () => {
  it('shows encrypted identity details and warns about plaintext transport', () => {
    render(<DeviceEncryptionStatus deviceId="device-1" connection={{
      loaded: true, busy: false, state: 'connected', label: 'Connected', onConnect: vi.fn(),
    }} />);
    report('encrypted', 'verified-fingerprint');
    const button = screen.getByRole('button', { name: /Device connection encrypted/ });
    expect(button).toHaveAttribute('data-encryption', 'encrypted');
    fireEvent.click(button);
    expect(screen.getByLabelText('Device fingerprint')).toHaveTextContent('verified-fingerprint');
    fireEvent.click(screen.getByRole('button', { name: 'Close connection information' }));
    report('legacy');
    expect(button).toHaveAttribute('data-encryption', 'legacy');
    expect(button).toHaveAccessibleName(/not end-to-end encrypted/);
  });

  it('connects a detached thread, but lets a blocked identity be inspected first', () => {
    const onConnect = vi.fn();
    render(<DeviceEncryptionStatus deviceId="device-1" connection={{
      loaded: false, busy: false, state: 'offline', label: 'Offline', onConnect,
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect thread' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    report('identity-changed', 'replacement-fingerprint');
    fireEvent.click(screen.getByRole('button', { name: /Device identity changed/ }));
    expect(screen.getByLabelText('Device fingerprint')).toHaveTextContent('replacement-fingerprint');
    expect(screen.getByRole('button', { name: 'Trust replacement identity…' })).toBeVisible();
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
