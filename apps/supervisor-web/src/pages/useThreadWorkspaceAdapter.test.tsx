import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
const source = vi.hoisted(() => ({ key: 'owner:device-a' }));
vi.mock('../lib/api', () => ({
  ApiError: class extends Error {
    statusCode = 404;
  },
  workspaceResourceScope: () => source.key,
  fetchWorkspaceDocument: vi.fn(),
  saveWorkspaceDocument: vi.fn(),
  fetchWorkspaceSaveOperation: vi.fn(),
  fetchLinkedFile: vi.fn(),
  fetchLinkedFilePreview: vi.fn(),
  buildLinkedFileUrl: vi.fn(),
  buildWorkspaceRawFileUrl: vi.fn(),
  downloadWorkspaceFile: vi.fn(),
  downloadLinkedFile: vi.fn(),
  fetchWorkspaceFilePreview: vi.fn(),
  fetchWorkspaceFileTree: vi.fn(),
  uploadWorkspaceFile: vi.fn(),
  renameWorkspaceNode: vi.fn(),
  deleteWorkspaceNode: vi.fn(),
  createWorkspaceFile: vi.fn(),
}));
import { useThreadWorkspaceAdapter } from './useThreadWorkspaceAdapter';
import * as api from '../lib/api';
describe('workspace adapter source identity', () => {
  it('creates only in the workspace bound to the writable adapter', async () => {
    vi.mocked(api.createWorkspaceFile).mockResolvedValue({ path: 'docs/new.md' });
    const { result } = renderHook(() => useThreadWorkspaceAdapter({ setError: vi.fn(), workspaceId: 'bound-workspace' }));
    await result.current?.createFile?.({ threadId: 'thread', workspaceId: 'untrusted-workspace', path: 'docs/new.md' });
    expect(api.createWorkspaceFile).toHaveBeenCalledWith('bound-workspace', 'docs/new.md');
  });
  it('changes source when the device changes even if workspace IDs are identical', () => {
    const setError = vi.fn();
    const { result, rerender } = renderHook(() =>
      useThreadWorkspaceAdapter({ setError, workspaceId: 'same-workspace' }),
    );
    const first = result.current;
    expect(first?.resourceScopeKey).toBe('owner:device-a');
    source.key = 'owner:device-b';
    rerender();
    expect(result.current?.resourceScopeKey).toBe('owner:device-b');
    expect(result.current).not.toBe(first);
  });
  it('offers safe reads but no write or receipt methods to a read-only grant', () => {
    const { result } = renderHook(() =>
      useThreadWorkspaceAdapter({
        setError: vi.fn(),
        workspaceId: 'same-workspace',
        access: 'read',
      }),
    );
    expect(result.current?.readDocument).toBeTypeOf('function');
    expect(result.current?.saveDocument).toBeUndefined();
    expect(result.current?.getSaveOperation).toBeUndefined();
    expect(result.current?.writeFile).toBeUndefined();
    expect(result.current?.createFile).toBeUndefined();
    expect(result.current?.textRangeRead).toBe(false);
  });
});
