import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeManagement } from './RuntimeManagement';

const api = vi.hoisted(() => ({ request: vi.fn(), relay: true }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  request: api.request,
  relayModeActive: () => api.relay,
}));
function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}>
    <Link to="/devices/b/workspaces">Device B</Link>
    <Link to="/relay-devices">Devices</Link>
    <RuntimeManagement />
  </MemoryRouter>);
}
beforeEach(() => {
  api.relay = true;
  api.request.mockReset();
  localStorage.setItem('remote-codex-relay-device-id', 'remembered-device');
  api.request.mockImplementation(async (path: string) => path.endsWith('/harnesses') ? [] : {
    runningVersion: path.includes('/devices/b/') ? 'B-version' : 'A-version', canUpdate: true,
  });
});

it('offers repair when npm is old but the running process already matches latest', async () => {
  api.request.mockImplementation(async (path: string) => path.endsWith('/harnesses') ? [] : {
    runningVersion: '0.12.32', installedVersion: '0.12.30', latestVersion: '0.12.32', canUpdate: true,
  });
  mount('/devices/a/workspaces');
  expect(await screen.findByText(/Installed 0.12.30; running 0.12.32/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledWith('/relay/devices/a/api/management/supervisor/update', expect.objectContaining({method:'POST'})));
});
describe('device-scoped runtime settings', () => {
  it('pins requests to the route and discards old device state and late responses', async () => {
    let resolveOld!: (value: unknown) => void;
    api.request.mockImplementation((path: string) => {
      if (path === '/relay/devices/a/api/management/supervisor') return new Promise(resolve => { resolveOld = resolve; });
      return Promise.resolve(path.endsWith('/harnesses') ? [] : {runningVersion:'B-version', canUpdate:true});
    });
    mount('/devices/a/threads/thread-a');
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/relay/devices/a/api/management/harnesses', expect.anything()));
    fireEvent.click(screen.getByRole('link', {name:'Device B'}));
    expect(await screen.findByText('Running B-version')).toBeVisible();
    await act(async () => resolveOld({runningVersion:'OLD-A-version',canUpdate:true}));
    expect(screen.queryByText(/OLD-A-version/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'Check updates'}));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/relay/devices/b/api/management/supervisor/check', expect.objectContaining({method:'POST'})));
    fireEvent.click(screen.getByRole('link', {name:'Devices'}));
    expect(screen.getByText(/Open a device to view/)).toBeVisible();
    expect(screen.queryByText('Running B-version')).not.toBeInTheDocument();
    expect(api.request.mock.calls.every(([path]) => String(path).startsWith('/relay/devices/a/') || String(path).startsWith('/relay/devices/b/'))).toBe(true);
  });
});
it('shared device access exposes no restart or update controls', async () => {
  const { ApiError } = await import('../lib/api');
  api.request.mockRejectedValue(new ApiError(403,{code:'forbidden',message:'Owner only'}));
  mount('/devices/a/threads/shared');
  expect(await screen.findByText(/Only the device owner/)).toBeVisible();
  expect(screen.queryByRole('button',{name:/Restart|Check updates|Update/})).not.toBeInTheDocument();
  expect(api.request.mock.calls.every(([,options])=>options.method!=='POST')).toBe(true);
});
