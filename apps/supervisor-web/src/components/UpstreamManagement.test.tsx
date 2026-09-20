import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { it, expect, vi, beforeEach } from 'vitest';
import { UpstreamManagement } from './UpstreamManagement';
import { request } from '../lib/api';
vi.mock('../lib/api', () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());
it('pins configuration to the selected device and never reuses secrets in duplicated profiles', async () => {
  vi.mocked(request).mockResolvedValue({
    profiles: [
      {
        id: 'p',
        name: 'Work',
        harness: 'codex',
        baseUrl: 'https://example.test/v1',
        model: 'test',
        apiType: 'responses',
        contextWindow: 100000,
        hasApiKey: true,
      },
    ],
    active: { codex: 'p' },
    backups: [],
  });
  render(<UpstreamManagement apiRoot="/relay/devices/device-a/api" />);
  expect(await screen.findByText('Work')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Use upstream' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate Work' }));
  expect(screen.getByLabelText('API key')).toHaveValue('');
  expect(screen.getByLabelText('API key')).toBeRequired();
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'new-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save upstream' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/relay/devices/device-a/api/management/upstreams',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('new-secret'),
      }),
    ),
  );
});
it('previews a template without mutation and applies only on the second action', async () => {
  vi.mocked(request).mockImplementation(async (path, options) =>
    String(path).endsWith('upstreams')
      ? { profiles: [], active: {}, backups: [] }
      : { harnesses: ['codex'], profiles: [] },
  );
  render(<UpstreamManagement apiRoot="/api" />);
  await screen.findByText(/Add an API provider/);
  fireEvent.click(screen.getByRole('button', { name: 'Import template' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview template' }));
  await screen.findByText('Install if missing: codex');
  expect(
    vi
      .mocked(request)
      .mock.calls.filter(([p]) => String(p).endsWith('templates'))
      .map(([, o]) => JSON.parse(String(o?.body)).apply),
  ).toEqual([false]);
  fireEvent.click(screen.getByRole('button', { name: 'Apply template' }));
  await waitFor(() =>
    expect(
      vi
        .mocked(request)
        .mock.calls.filter(([p]) => String(p).endsWith('templates'))
        .map(([, o]) => JSON.parse(String(o?.body)).apply),
    ).toEqual([false, true]),
  );
});
