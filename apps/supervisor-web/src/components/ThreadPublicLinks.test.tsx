import { StrictMode } from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThreadPublicLinks } from './ThreadPublicLinks';
import { request, fetchThreadExportTurns } from '../lib/api';
import { loadExportSnapshot } from '../lib/transcriptExport';

vi.mock('../lib/api', () => ({ request: vi.fn(), fetchThreadExportTurns: vi.fn() }));
vi.mock('../lib/transcriptExport', () => ({ loadExportSnapshot: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchThreadExportTurns).mockResolvedValue({ totalTurnCount: 2, turns: [1, 2].map(n => ({ turnId: `turn-${n}`, turnNumber: n, status: 'completed', startedAt: null, userPromptPreview: `Prompt ${n}` })) }); });

it('waits for explicit creation and shares only selected turns', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.mocked(loadExportSnapshot).mockResolvedValue({ turns: [] } as never);
  let resolveList!: (value: unknown) => void;
  vi.mocked(request).mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') return { id: 'new-link', turnCount: 1, createdAt: '2026-09-19T12:00:00Z' };
    return new Promise((resolve) => { resolveList = resolve; });
  });
  render(<StrictMode><ThreadPublicLinks deviceId="mac" threadId="thread" /></StrictMode>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create & copy link' })).toBeEnabled());
  expect(loadExportSnapshot).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Choose turns'));
  fireEvent.click(screen.getByLabelText('Share turn 1'));
  fireEvent.click(screen.getByRole('button', { name: 'Create & copy link' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/s/new-link`));
  resolveList([]);
  await waitFor(() => expect(screen.getByLabelText('Public share URL')).toHaveValue(`${location.origin}/s/new-link`));
  expect(vi.mocked(request).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(loadExportSnapshot).toHaveBeenCalledWith('thread', { mode: 'selected', turnIds: ['turn-2'] });
  expect(screen.getByRole('status')).toHaveTextContent('Read-only link copied');
});

it('retains the created URL when clipboard access is unavailable', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  vi.mocked(loadExportSnapshot).mockResolvedValue({ turns: [] } as never);
  vi.mocked(request).mockImplementation(async (_url, init) => init?.method === 'POST'
    ? { id: 'manual-copy', turnCount: 1, createdAt: '2026-09-19T12:00:00Z' } : []);
  render(<ThreadPublicLinks deviceId="mac" threadId="thread" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create & copy link' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Create & copy link' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Link created'));
  expect(screen.getByLabelText('Public share URL')).toHaveValue(`${location.origin}/s/manual-copy`);
});

it('requires explicit live consent and configures the device before publishing its capability', async () => {
  vi.mocked(request).mockImplementation(async (url, init) => {
    if (String(url).endsWith('/publications')) return { token: 'capability', snapshot: { live: true, turns: [] } };
    if (init?.method === 'POST') return { id: 'live-link', live: true, turnCount: 2, createdAt: '2026-09-19T12:00:00Z' };
    return [];
  });
  render(<ThreadPublicLinks deviceId="mac" threadId="thread" />);
  const consent = screen.getByRole('checkbox', { name: /Keep updated/ });
  expect(consent).not.toBeChecked();
  fireEvent.click(consent);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create & copy link' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Create & copy link' }));
  await screen.findByLabelText('Public share URL');
  const posts = vi.mocked(request).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts[0]?.[0]).toBe('/api/threads/thread/publications');
  expect(JSON.parse(posts[0]![1]!.body as string).turnIds).toEqual(['turn-1', 'turn-2']);
  expect(JSON.parse(posts[1]![1]!.body as string).publicationToken).toBe('capability');
  expect(loadExportSnapshot).not.toHaveBeenCalled();
});
