import { StrictMode } from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadPublicLinks } from './ThreadPublicLinks';
import { request } from '../lib/api';
import { loadExportSnapshot } from '../lib/transcriptExport';

vi.mock('../lib/api', () => ({ request: vi.fn() }));
vi.mock('../lib/transcriptExport', () => ({ loadExportSnapshot: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('creates one snapshot and copies its URL on opening, even with StrictMode effects', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.mocked(loadExportSnapshot).mockResolvedValue({ turns: [] } as never);
  let resolveList!: (value: unknown) => void;
  vi.mocked(request).mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') return { id: 'new-link', turnCount: 1, createdAt: '2026-09-19T12:00:00Z' };
    return new Promise((resolve) => { resolveList = resolve; });
  });
  render(<StrictMode><ThreadPublicLinks deviceId="mac" threadId="thread" createOnOpen /></StrictMode>);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/s/new-link`));
  resolveList([]);
  await waitFor(() => expect(screen.getByLabelText('Public share URL')).toHaveValue(`${location.origin}/s/new-link`));
  expect(vi.mocked(request).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Read-only link copied');
});

it('retains the created URL when clipboard access is unavailable', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  vi.mocked(loadExportSnapshot).mockResolvedValue({ turns: [] } as never);
  vi.mocked(request).mockImplementation(async (_url, init) => init?.method === 'POST'
    ? { id: 'manual-copy', turnCount: 1, createdAt: '2026-09-19T12:00:00Z' } : []);
  render(<ThreadPublicLinks deviceId="mac" threadId="thread" createOnOpen />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Link created'));
  expect(screen.getByLabelText('Public share URL')).toHaveValue(`${location.origin}/s/manual-copy`);
});
