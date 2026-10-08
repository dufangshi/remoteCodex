import { translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { useMemo, type Dispatch, type SetStateAction } from 'react';

import type { ThreadWorkspaceAdapter } from '@remote-codex/thread-ui';
import {
  ApiError,
  fetchLinkedFile,
  fetchLinkedFilePreview,
  buildLinkedFileUrl,
  buildWorkspaceRawFileUrl,
  downloadWorkspaceFile,
  downloadLinkedFile,
  fetchWorkspaceFilePreview,
  fetchWorkspaceFileTree,
  uploadWorkspaceFile,
  writeWorkspaceFile,
  renameWorkspaceNode,
  deleteWorkspaceNode,
} from '../lib/api';

interface UseThreadWorkspaceAdapterInput {
  setError: Dispatch<SetStateAction<string | null>>;
  workspaceId: string | null;
  allowLinkedFiles?: boolean;
  access?: 'none' | 'read' | 'write';
}

export function useThreadWorkspaceAdapter({
  setError,
  workspaceId,
  access = 'write',
  allowLinkedFiles = false,
}: UseThreadWorkspaceAdapterInput): ThreadWorkspaceAdapter | null {
  const { locale: i18nLocale } = useI18n();
  return useMemo<ThreadWorkspaceAdapter | null>(() => {
    if (!workspaceId || access === 'none') {
      return null;
    }

    const isLinked = (path: string) => path.startsWith('/') || /^[a-z]:[\\/]/i.test(path);
    return {
      ...(allowLinkedFiles ? {statLinkedFile: (input: {threadId: string; path: string}) => fetchLinkedFile(input.threadId, input.path)} : {}),
      listTree: (input) =>
        fetchWorkspaceFileTree(workspaceId, { path: input.path ?? '' }),
      readFile: async (input) => {
        // Draw.io XML must be complete; older Supervisors cap text previews at
        // 64 KiB and ignore pagination. Reuse the authenticated/encrypted binary
        // download path so this also works immediately with existing devices.
        if (/\.(drawio|dio)$/i.test(input.path)) {
          const { blob } = isLinked(input.path) && allowLinkedFiles
            ? await downloadLinkedFile(input.threadId, input.path)
            : await downloadWorkspaceFile(workspaceId, { path: input.path });
          if (blob.size > 8 * 1024 * 1024) throw new Error(translate("files.diagramPreviewSupportsFilesUpTo8"));
          return { path: input.path, name: input.path.replace(/\\/g, '/').split('/').pop() ?? input.path,
            content: await blob.text(), language: 'xml', size: blob.size, truncated: false, nextOffset: blob.size };
        }
        return isLinked(input.path) && allowLinkedFiles ? fetchLinkedFilePreview(input.threadId, input) : fetchWorkspaceFilePreview(workspaceId, {
          path: input.path,
          ...(input.offset !== undefined ? { offset: input.offset } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
      },
      getRawFileUrl: (input) =>
        isLinked(input.path) && allowLinkedFiles ? buildLinkedFileUrl(input.threadId, input.path) : buildWorkspaceRawFileUrl(workspaceId, { path: input.path }),
      ...(access === 'write'
        ? {
            uploadFile: (input) =>
              uploadWorkspaceFile(workspaceId, { file: input.file }),
            renameNode: async (input) => { await renameWorkspaceNode(workspaceId, input); },
            deleteNode: async (input) => { await deleteWorkspaceNode(workspaceId, input.path); },
            writeFile: async (input) => {
              if (isLinked(input.path)) throw new Error(translate("files.linkedFilesAreReadOnlyPreviews"));
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
          if (isLinked(input.path) && !allowLinkedFiles) throw new Error(translate("files.linkedFileAccessIsUnavailable"));
          const result = isLinked(input.path)
            ? await downloadLinkedFile(input.threadId, input.path)
            : await downloadWorkspaceFile(workspaceId, { path: input.path });
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
                : translate("files.workspaceDownloadFailed"),
          );
        }
      },
    };
  }, [access, allowLinkedFiles, setError, workspaceId, i18nLocale]);
}
