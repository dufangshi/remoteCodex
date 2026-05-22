import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  DatabaseClient,
} from '../../../packages/db/src/index';
import {
  getThreadRecordById,
  getWorkspaceRecordById,
} from '../../../packages/db/src/index';
import type {
  PromptAttachmentManifestEntryDto,
  SendThreadPromptInput,
} from '../../../packages/shared/src/index';
import { HttpError } from './app';

export interface UploadedPromptAttachment {
  manifest: PromptAttachmentManifestEntryDto;
  buffer: Buffer;
}

async function pathExists(absPath: string) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeAttachmentFileName(originalName: string) {
  const basename = path.basename(originalName).trim() || 'attachment';
  const extension = path.extname(basename).replace(/[^a-zA-Z0-9.]/g, '');
  const rawStem = extension ? basename.slice(0, -extension.length) : basename;
  const sanitizedStem = rawStem
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  const stem = sanitizedStem || 'attachment';
  const normalizedExtension = extension.slice(0, 16);
  return `${stem}-${randomUUID().slice(0, 8)}${normalizedExtension}`;
}

function threadTempDirectoryPath(workspacePath: string, localThreadId: string) {
  return path.join(workspacePath, '.temp', 'threads', localThreadId);
}

export class ThreadAttachmentCoordinator {
  constructor(private readonly db: DatabaseClient) {}

  async preparePromptAttachments(
    localThreadId: string,
    input: SendThreadPromptInput,
    attachments: UploadedPromptAttachment[],
  ): Promise<SendThreadPromptInput> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    if (!(await pathExists(workspace.absPath))) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Workspace path is missing on this machine.',
      });
    }

    const tempDirectory = threadTempDirectoryPath(workspace.absPath, localThreadId);
    await fs.mkdir(tempDirectory, { recursive: true });

    let rewrittenPrompt = input.prompt;

    for (const attachment of attachments) {
      if (!rewrittenPrompt.includes(attachment.manifest.placeholder)) {
        throw new HttpError(400, {
          code: 'bad_request',
          message: `Prompt is missing attachment placeholder ${attachment.manifest.placeholder}.`,
        });
      }

      const savedFileName = sanitizeAttachmentFileName(
        attachment.manifest.originalName,
      );
      await fs.writeFile(path.join(tempDirectory, savedFileName), attachment.buffer);

      const relativePath = `./.temp/threads/${localThreadId}/${savedFileName}`;
      const replacementToken =
        attachment.manifest.kind === 'photo'
          ? `[PHOTO ${relativePath}]`
          : `[FILE ${relativePath}]`;
      rewrittenPrompt = rewrittenPrompt
        .split(attachment.manifest.placeholder)
        .join(replacementToken);
    }

    return {
      ...input,
      prompt: rewrittenPrompt,
    };
  }
}
