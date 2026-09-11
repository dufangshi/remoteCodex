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
describe('device-scoped runtime settings', () => {
  it('does not load or expose runtime controls outside a device', () => {
    mount('/relay-devices');
    expect(screen.getByText(/Open a device to view/)).toBeVisible();
    expect(screen.queryByText('Check updates')).not.toBeInTheDocument();
    expect(api.request).not.toHaveBeenCalled();
  });
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
  it('keeps local mode bound to the local Supervisor', async () => {
    api.relay = false;
    mount('/workspaces');
    expect(await screen.findByText('Running A-version')).toBeVisible();
    expect(api.request).toHaveBeenCalledWith('/api/management/supervisor', expect.anything());
  });
});

it('shows uptime and explicitly restarts only the route device', async () => {
  api.request.mockImplementation(async (path: string) => path.endsWith('/harnesses') ? [] : {
    runningVersion:'0.12.30',canUpdate:true,canRestart:true,
    startedAt:new Date(Date.now()-90061000).toISOString(),
  });
  mount('/devices/a/workspaces');
  expect(await screen.findByText(/Uptime 1d 1h 1m/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Restart Supervisor'}));
  expect(screen.getByText(/queued messages will be preserved/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Restart'}));
  await waitFor(()=>expect(api.request).toHaveBeenCalledWith('/relay/devices/a/api/management/supervisor/restart',expect.objectContaining({method:'POST'})));
});
it('shared device access exposes no restart or update controls', async () => {
  const { ApiError } = await import('../lib/api');
  api.request.mockRejectedValue(new ApiError(403,{code:'forbidden',message:'Owner only'}));
  mount('/devices/a/threads/shared');
  expect(await screen.findByText(/Only the device owner/)).toBeVisible();
  expect(screen.queryByRole('button',{name:/Restart|Check updates|Update/})).not.toBeInTheDocument();
  expect(api.request.mock.calls.every(([,options])=>options.method!=='POST')).toBe(true);
});
