import { useMemo, type Dispatch, type SetStateAction } from 'react';

import type { ThreadWorkspaceAdapter } from '@remote-codex/thread-ui';
import {
  ApiError,
  buildWorkspaceRawFileUrl,
  downloadWorkspaceFile,
  fetchWorkspaceFilePreview,
  fetchWorkspaceFileTree,
  uploadWorkspaceFile,
  writeWorkspaceFile,
} from '../lib/api';

interface UseThreadWorkspaceAdapterInput {
  setError: Dispatch<SetStateAction<string | null>>;
  workspaceId: string | null;
  access?: 'none' | 'read' | 'write';
}

export function useThreadWorkspaceAdapter({
  setError,
  workspaceId,
  access = 'write',
}: UseThreadWorkspaceAdapterInput): ThreadWorkspaceAdapter | null {
  return useMemo<ThreadWorkspaceAdapter | null>(() => {
    if (!workspaceId || access === 'none') {
      return null;
    }

    return {
      listTree: (input) =>
        fetchWorkspaceFileTree(workspaceId, { path: input.path ?? '' }),
      readFile: (input) =>
        fetchWorkspaceFilePreview(workspaceId, {
          path: input.path,
          ...(input.offset !== undefined ? { offset: input.offset } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        }),
      getRawFileUrl: (input) =>
        buildWorkspaceRawFileUrl(workspaceId, { path: input.path }),
      ...(access === 'write'
        ? {
            uploadFile: (input) =>
              uploadWorkspaceFile(workspaceId, { file: input.file }),
            writeFile: async (input) => {
              await writeWorkspaceFile(workspaceId, {
                path: input.path,
                content: input.content,
              });
            },
          }
        : {}),
      downloadNode: async (input) => {
        setError(null);
        try {
          const result = await downloadWorkspaceFile(workspaceId, {
            path: input.path,
          });
          const url = URL.createObjectURL(result.blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = result.filename;
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
        } catch (caught) {
          setError(
            caught instanceof ApiError
              ? caught.payload.message
              : caught instanceof Error
                ? caught.message
                : 'Workspace download failed.',
          );
        }
      },
    };
  }, [access, setError, workspaceId]);
}
