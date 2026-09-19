import { expect, it, vi } from 'vitest';
import { loadExportSnapshot } from './transcriptExport';
import { downloadThreadImage, fetchThreadDetail, fetchThreadTurnDetail } from './api';

vi.mock('./api', () => ({ downloadThreadImage: vi.fn(), fetchThreadDetail: vi.fn(), fetchThreadTurnDetail: vi.fn() }));

it('hydrates deferred messages and embeds each attachment through the authenticated download API', async () => {
  vi.mocked(fetchThreadDetail).mockResolvedValue({ thread: { title: 'Photo review' }, totalTurnCount: 1,
    turns: [{ id: 'turn', hasDeferredItems: true, items: [] }] } as never);
  vi.mocked(fetchThreadTurnDetail).mockResolvedValue({ id: 'turn', status: 'completed', items: [
    { id: 'prompt', kind: 'userMessage', text: '[PHOTO ./photo.png] [PHOTO ./photo.png]' },
    { id: 'reply', kind: 'agentMessage', text: 'The image looks good.' },
  ] } as never);
  vi.mocked(downloadThreadImage).mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  const snapshot = await loadExportSnapshot('thread', { format: 'html', mode: 'latest', limit: 10 });
  expect(fetchThreadTurnDetail).toHaveBeenCalledWith('thread', 'turn');
  expect(downloadThreadImage).toHaveBeenCalledExactlyOnceWith('thread', './photo.png');
  expect(snapshot.images?.['./photo.png']).toBe('data:image/png;base64,aW1hZ2U=');
  expect(snapshot.turns[0]?.messages.map(m => m.text)).toContain('The image looks good.');
});
