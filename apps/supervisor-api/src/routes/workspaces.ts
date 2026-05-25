import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createWorkspaceRecord,
  deleteShellSessionRecord,
  deleteViewerSessionsByShellId,
  deleteWorkspaceRecord,
  getWorkspaceRecordById,
  getWorkspaceRecordByPath,
  listShellSessionRecordsByWorkspaceId,
  listWorkspaceRecords,
  listThreadRecordsByWorkspaceId,
  touchWorkspaceOpenedAt,
  updateWorkspaceLabel,
  updateWorkspaceFavorite
} from '../../../../packages/db/src/index';
import {
  UpdateWorkspaceInput,
  WorkspaceFileDto,
  WriteWorkspaceFileInput,
  WorkspaceDto,
  WorkspaceTreeDto
} from '../../../../packages/shared/src/index';
import {
  deleteWorkspaceFile,
  moveWorkspaceFile,
  readWorkspaceTree,
  validateWorkspacePath,
  writeWorkspaceFile
} from '../../../../packages/workspace/src/index';
import { HttpError } from '../app';
import { requireWorkerScope } from '../worker-identity';
import { getWorkspaceSettings } from '../workspace-settings';

const createWorkspaceSchema = z.union([
  z.object({
    absPath: z.string().min(1),
    label: z.string().min(1).optional()
  }),
  z.object({
    gitUrl: z.string().min(1),
    label: z.string().min(1).optional()
  })
]);

const updateFavoriteSchema = z.object({
  isFavorite: z.boolean()
});

const updateWorkspaceSchema = z.object({
  label: z.string().min(1)
});

const workspaceFilePathSchema = z.string().trim().min(1).max(4096);
const writeWorkspaceFileSchema = z.object({
  path: workspaceFilePathSchema,
  content: z.string()
});
const moveWorkspaceFileSchema = z.object({
  fromPath: workspaceFilePathSchema,
  toPath: workspaceFilePathSchema,
  overwrite: z.boolean().optional()
});
const deleteWorkspaceFileSchema = z.object({
  path: workspaceFilePathSchema,
  recursive: z.boolean().optional()
});

const treeQuerySchema = z.object({
  path: z.string().optional(),
  showHidden: z.coerce.boolean().optional()
});

function toWorkspaceDto(record: {
  id: string;
  hostId: string;
  label: string;
  absPath: string;
  isFavorite: boolean;
  createdAt: string;
  lastOpenedAt: string | null;
}): WorkspaceDto {
  return {
    id: record.id,
    hostId: record.hostId,
    label: record.label,
    absPath: record.absPath,
    isFavorite: record.isFavorite,
    createdAt: record.createdAt,
    lastOpenedAt: record.lastOpenedAt
  };
}

function toWorkspaceFileDto(file: {
  path: string;
  absPath: string;
  kind: 'file' | 'directory';
  size: number;
  updatedAt: string;
}): WorkspaceFileDto {
  return {
    path: file.path,
    absPath: file.absPath,
    kind: file.kind,
    size: file.size,
    updatedAt: file.updatedAt,
  };
}

function getWorkspaceOrThrow(app: FastifyInstance, id: string) {
  const record = getWorkspaceRecordById(app.services.database.db, id);

  if (!record) {
    throw new HttpError(404, {
      code: 'not_found',
      message: 'Workspace was not found.'
    });
  }

  return record;
}

function inferGitRepoName(gitUrl: string) {
  const trimmed = gitUrl.trim();
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const normalized = withoutQuery.replace(/[\\/]+$/, '');
  const rawName = normalized.split(/[/:]/).filter(Boolean).at(-1) ?? '';
  const repoName = rawName.endsWith('.git') ? rawName.slice(0, -4) : rawName;

  if (!repoName || repoName === '.' || repoName === '..' || repoName.includes(path.sep)) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Unable to infer a target directory from the Git URL.'
    });
  }

  return repoName;
}

async function pathExists(absPath: string) {
  try {
    await fs.stat(absPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function cloneRepository(gitUrl: string, targetPath: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['clone', gitUrl, targetPath], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new HttpError(503, {
            code: 'service_unavailable',
            message: '`git` is not available on this host.'
          })
        );
        return;
      }

      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new HttpError(400, {
          code: 'bad_request',
          message: 'Git clone failed.',
          details: {
            stderr: stderr.trim().slice(0, 2000)
          }
        })
      );
    });
  });
}

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  app.get('/api/workspaces', async () => {
    const records = listWorkspaceRecords(app.services.database.db);
    return records.map(toWorkspaceDto);
  });

  app.get('/api/workspaces/tree', async (request) => {
    const query = treeQuerySchema.parse(request.query);
    const requestedPath = query.path
      ? path.resolve(query.path)
      : app.services.config.workspaceRoot;
    const tree = await readWorkspaceTree({
      rootPath: app.services.config.workspaceRoot,
      targetPath: requestedPath,
      showHidden: query.showHidden ?? false
    });

    return {
      rootPath: tree.rootPath,
      currentPath: tree.currentPath,
      nodes: tree.nodes
    } satisfies WorkspaceTreeDto;
  });

  app.get('/api/workspaces/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const record = getWorkspaceRecordById(app.services.database.db, params.id);

    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found.'
      });
    }

    return toWorkspaceDto(record);
  });

  app.post('/api/workspaces', async (request) => {
    const body = createWorkspaceSchema.parse(request.body);
    const settings = await getWorkspaceSettings(
      app.services.database.db,
      app.services.config.workspaceRoot,
    );
    let validated: { absPath: string; label: string };

    if ('gitUrl' in body) {
      const repoName = inferGitRepoName(body.gitUrl);
      const targetPath = path.join(settings.devHome, repoName);

      if (await pathExists(targetPath)) {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'The Git clone target directory already exists.',
          details: {
            absPath: targetPath
          }
        });
      }

      await cloneRepository(body.gitUrl.trim(), targetPath);
      validated = await validateWorkspacePath(app.services.config.workspaceRoot, targetPath);
    } else {
      validated = await validateWorkspacePath(app.services.config.workspaceRoot, body.absPath, {
        devHome: settings.devHome,
        createMissingLeaf: true
      });
    }

    const existing = getWorkspaceRecordByPath(app.services.database.db, validated.absPath);

    if (existing) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This workspace has already been added.',
        details: {
          absPath: validated.absPath
        }
      });
    }

    const created = createWorkspaceRecord(app.services.database.db, {
      absPath: validated.absPath,
      label: body.label?.trim() || validated.label
    });

    return toWorkspaceDto(created);
  });

  app.put('/api/workspaces/:id/files', async (request) => {
    requireWorkerScope(request, 'file:write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = writeWorkspaceFileSchema.parse(request.body) satisfies WriteWorkspaceFileInput;
    const record = getWorkspaceOrThrow(app, params.id);

    const file = await writeWorkspaceFile({
      workspacePath: record.absPath,
      relativePath: body.path,
      content: body.content,
    });

    return toWorkspaceFileDto(file);
  });

  app.post('/api/workspaces/:id/files/upload', async (request) => {
    requireWorkerScope(request, 'file:write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const record = getWorkspaceOrThrow(app, params.id);

    if (!request.isMultipart()) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'File upload must use multipart/form-data.',
      });
    }

    let relativePath: string | null = null;
    let fileBuffer: Buffer | null = null;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') {
          throw new HttpError(400, {
            code: 'bad_request',
            message: `Unexpected multipart file field: ${part.fieldname}.`,
          });
        }
        if (fileBuffer) {
          throw new HttpError(400, {
            code: 'bad_request',
            message: 'Only one file can be uploaded at a time.',
          });
        }
        fileBuffer = await part.toBuffer();
        continue;
      }

      if (part.fieldname === 'path') {
        relativePath = String(part.value ?? '').trim();
      }
    }

    if (!relativePath || !fileBuffer) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'File upload requires path and file fields.',
      });
    }

    const file = await writeWorkspaceFile({
      workspacePath: record.absPath,
      relativePath,
      content: fileBuffer,
    });

    return toWorkspaceFileDto(file);
  });

  app.patch('/api/workspaces/:id/files/move', async (request) => {
    requireWorkerScope(request, 'file:write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = moveWorkspaceFileSchema.parse(request.body);
    const record = getWorkspaceOrThrow(app, params.id);

    const file = await moveWorkspaceFile({
      workspacePath: record.absPath,
      fromPath: body.fromPath,
      toPath: body.toPath,
      ...(body.overwrite !== undefined ? { overwrite: body.overwrite } : {}),
    });

    return toWorkspaceFileDto(file);
  });

  app.delete('/api/workspaces/:id/files', async (request) => {
    requireWorkerScope(request, 'file:write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = deleteWorkspaceFileSchema.parse(request.body);
    const record = getWorkspaceOrThrow(app, params.id);

    return deleteWorkspaceFile({
      workspacePath: record.absPath,
      relativePath: body.path,
      ...(body.recursive !== undefined ? { recursive: body.recursive } : {}),
    });
  });

  app.patch('/api/workspaces/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateWorkspaceSchema.parse(request.body) satisfies UpdateWorkspaceInput;
    const record = getWorkspaceRecordById(app.services.database.db, params.id);

    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found.'
      });
    }

    const normalizedLabel = body.label.trim();
    if (!normalizedLabel) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Workspace label cannot be empty.'
      });
    }

    updateWorkspaceLabel(app.services.database.db, params.id, normalizedLabel);
    const updated = getWorkspaceRecordById(app.services.database.db, params.id);

    return toWorkspaceDto(updated!);
  });

  app.delete('/api/workspaces/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const record = getWorkspaceRecordById(app.services.database.db, params.id);

    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found.'
      });
    }

    const shells = listShellSessionRecordsByWorkspaceId(app.services.database.db, params.id);
    for (const shell of shells) {
      if (shell.status !== 'exited' && shell.status !== 'not_found') {
        await app.services.shellService.terminateShell(shell.id);
      }
      deleteViewerSessionsByShellId(app.services.database.db, shell.id);
      deleteShellSessionRecord(app.services.database.db, shell.id);
    }

    const threadRecords = listThreadRecordsByWorkspaceId(app.services.database.db, params.id);
    for (const thread of threadRecords) {
      await app.services.threadService.deleteThread(thread.id);
    }

    deleteWorkspaceRecord(app.services.database.db, params.id);
    return { id: params.id };
  });

  app.post('/api/workspaces/:id/favorite', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateFavoriteSchema.parse(request.body);
    const record = getWorkspaceRecordById(app.services.database.db, params.id);

    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found.'
      });
    }

    updateWorkspaceFavorite(app.services.database.db, params.id, body.isFavorite);
    const updated = getWorkspaceRecordById(app.services.database.db, params.id);

    return toWorkspaceDto(updated!);
  });

  app.post('/api/workspaces/:id/open', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const record = getWorkspaceRecordById(app.services.database.db, params.id);

    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found.'
      });
    }

    touchWorkspaceOpenedAt(app.services.database.db, params.id);
    const updated = getWorkspaceRecordById(app.services.database.db, params.id);

    return toWorkspaceDto(updated!);
  });
}
