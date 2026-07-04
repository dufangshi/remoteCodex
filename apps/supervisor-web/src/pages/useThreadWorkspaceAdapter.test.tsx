import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThreadWorkspaceAdapter } from '@remote-codex/thread-ui';
import { useThreadWorkspaceAdapter } from './useThreadWorkspaceAdapter';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
}

function renderAdapter(input: {
  workspaceId: string | null;
  access?: 'none' | 'read' | 'write';
}) {
  let adapter: ThreadWorkspaceAdapter | null = null;
  function Harness() {
    adapter = useThreadWorkspaceAdapter({
      setError: vi.fn(),
      ...input,
    });
    return null;
  }
  render(<Harness />);
  return () => adapter;
}

describe('useThreadWorkspaceAdapter', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('hides the workspace adapter when access is none', () => {
    const getAdapter = renderAdapter({
      workspaceId: 'workspace-1',
      access: 'none',
    });

    expect(getAdapter()).toBeNull();
  });

  it('keeps read-only workspace access from exposing write controls', () => {
    const getAdapter = renderAdapter({
      workspaceId: 'workspace-1',
      access: 'read',
    });

    expect(getAdapter()).toMatchObject({
      listTree: expect.any(Function),
      readFile: expect.any(Function),
      downloadNode: expect.any(Function),
    });
    expect(getAdapter()?.writeFile).toBeUndefined();
    expect(getAdapter()?.uploadFile).toBeUndefined();
  });

  it('exposes upload and save operations for write access', () => {
    const getAdapter = renderAdapter({
      workspaceId: 'workspace-1',
      access: 'write',
    });

    expect(getAdapter()?.writeFile).toEqual(expect.any(Function));
    expect(getAdapter()?.uploadFile).toEqual(expect.any(Function));
  });
});
