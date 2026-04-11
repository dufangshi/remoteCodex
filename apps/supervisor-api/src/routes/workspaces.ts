import path from 'node:path';

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
  WorkspaceDto,
  WorkspaceTreeDto
} from '../../../../packages/shared/src/index';
import {
  readWorkspaceTree,
  validateWorkspacePath
} from '../../../../packages/workspace/src/index';
import { HttpError } from '../app';

const createWorkspaceSchema = z.object({
  absPath: z.string().min(1),
  label: z.string().min(1).optional()
});

const updateFavoriteSchema = z.object({
  isFavorite: z.boolean()
});

const updateWorkspaceSchema = z.object({
  label: z.string().min(1)
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
    const validated = await validateWorkspacePath(app.services.config.workspaceRoot, body.absPath);

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
