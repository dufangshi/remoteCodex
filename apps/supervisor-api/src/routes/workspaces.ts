import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { FastifyInstance, type FastifyRequest } from 'fastify';
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
  ThreadWorkspaceFilePreviewDto,
  ThreadWorkspaceUploadResultDto,
  UpdateWorkspaceInput,
  WriteWorkspaceFileInput,
  WorkspaceTreeDto
} from '../../../../packages/shared/src/index';
import {
  assertPathWithinRoot,
  deleteWorkspaceFile,
  moveWorkspaceFile,
  readWorkspaceTree,
  validateWorkspacePath,
  writeWorkspaceFile
} from '../../../../packages/workspace/src/index';
import { HttpError } from '../app';
import {
  artifactIdFromName,
  createWorkspaceArtifact,
  deleteWorkspaceArtifact,
  listWorkspaceArtifacts,
  readWorkspaceArtifactContent,
  readWorkspaceArtifactMetadata,
} from '../workspace-artifact-service';
import {
  PREVIEW_DEFAULT_LIMIT_BYTES,
  WORKSPACE_UPLOAD_MAX_BYTES,
  buildWorkspaceTreeNode,
  cleanupTemporaryZip,
  cloneRepository,
  contentTypeForPath,
  createFolderZipFile,
  inferGitRepoName,
  languageForPath,
  pathExists,
  relativeWorkspacePath,
  resolveWorkspaceItemPath,
  sanitizeUploadFilename,
  toWorkspaceDto,
  toWorkspaceFileDto,
} from '../workspace-file-service';
import { getWorkspaceSettings } from '../workspace-settings';

type MultipartUploadFile = {
  filename?: string;
  toBuffer: () => Promise<Buffer>;
};

type MultipartUploadRequest = FastifyRequest & {
  file: () => Promise<MultipartUploadFile | undefined>;
  parts: () => AsyncIterableIterator<
    | {
        type: 'file';
        fieldname: string;
        toBuffer: () => Promise<Buffer>;
      }
    | {
        type: 'field';
        fieldname: string;
        value: unknown;
      }
  >;
  isMultipart: () => boolean;
};

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

const deleteWorkspaceSchema = z.object({
  confirmWorkspaceId: z.string().uuid(),
  confirmLabel: z.string().min(1)
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
const workspaceArtifactIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const workspaceArtifactNameSchema = z.string().trim().min(1).max(255);
const createWorkspaceArtifactSchema = z.object({
  id: workspaceArtifactIdSchema.optional(),
  name: workspaceArtifactNameSchema,
  mediaType: z.string().trim().min(1).max(255).default('application/octet-stream'),
  contentBase64: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const treeQuerySchema = z.object({
  path: z.string().optional(),
  showHidden: z.coerce.boolean().optional()
});

const workspaceFileQuerySchema = z.object({
  path: z.string().optional().default('')
});

const workspacePreviewQuerySchema = z.object({
  path: z.string().min(1),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().max(250_000).optional()
});


function requireWorkspaceRecord(
  app: FastifyInstance,
  workspaceId: string,
) {
  const record = getWorkspaceRecordById(app.services.database.db, workspaceId);
  if (!record) {
    throw new HttpError(404, {
      code: 'not_found',
      message: 'Workspace was not found.'
    });
  }
  return record;
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

  app.get('/api/workspaces/:id/files/tree', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = workspaceFileQuerySchema.parse(request.query);
    const record = requireWorkspaceRecord(app, params.id);
    const rootPath = await fs.realpath(record.absPath);
    const targetPath = await resolveWorkspaceItemPath(rootPath, query.path);

    return buildWorkspaceTreeNode(rootPath, targetPath);
  });

  app.put('/api/workspaces/:id/files', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = writeWorkspaceFileSchema.parse(request.body) satisfies WriteWorkspaceFileInput;
    const record = requireWorkspaceRecord(app, params.id);

    const file = await writeWorkspaceFile({
      workspacePath: record.absPath,
      relativePath: body.path,
      content: body.content,
    });

    return toWorkspaceFileDto(file);
  });

  app.get('/api/workspaces/:id/files/preview', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = workspacePreviewQuerySchema.parse(request.query);
    const record = requireWorkspaceRecord(app, params.id);
    const rootPath = await fs.realpath(record.absPath);
    const filePath = await resolveWorkspaceItemPath(rootPath, query.path);
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Workspace preview path must point to a file.'
      });
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? PREVIEW_DEFAULT_LIMIT_BYTES;
    const handle = await fs.open(filePath, 'r');
    try {
      const length = Math.min(limit, Math.max(0, stats.size - offset));
      const buffer = Buffer.alloc(length);
      const read = await handle.read(buffer, 0, length, offset);
      const nextOffset = offset + read.bytesRead;
      return {
        path: relativeWorkspacePath(rootPath, filePath),
        name: path.basename(filePath),
        content: buffer.subarray(0, read.bytesRead).toString('utf8'),
        language: languageForPath(filePath),
        size: stats.size,
        truncated: nextOffset < stats.size,
        nextOffset
      } satisfies ThreadWorkspaceFilePreviewDto;
    } finally {
      await handle.close();
    }
  });

  app.get('/api/workspaces/:id/files/raw', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = workspacePreviewQuerySchema
      .pick({ path: true })
      .parse(request.query);
    const record = requireWorkspaceRecord(app, params.id);
    const rootPath = await fs.realpath(record.absPath);
    const filePath = await resolveWorkspaceItemPath(rootPath, query.path);
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Raw workspace path must point to a file.'
      });
    }

    reply.header('content-type', contentTypeForPath(filePath));
    return reply.send(Readable.from(await fs.readFile(filePath)));
  });

  app.get('/api/workspaces/:id/files/download', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = workspaceFileQuerySchema.parse(request.query);
    const record = requireWorkspaceRecord(app, params.id);
    const rootPath = await fs.realpath(record.absPath);
    const itemPath = await resolveWorkspaceItemPath(rootPath, query.path);
    const stats = await fs.stat(itemPath);

    if (stats.isDirectory()) {
      const { zipPath, tempDir } = await createFolderZipFile(rootPath, itemPath);
      const filename = `${path.basename(itemPath) || 'workspace-folder'}.zip`;
      const cleanup = cleanupTemporaryZip(zipPath, tempDir);
      reply.raw.once('finish', () => void cleanup());
      reply.raw.once('close', () => void cleanup());
      reply
        .header('content-type', 'application/zip')
        .header(
          'content-disposition',
          `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
        );
      return reply.send(createReadStream(zipPath));
    }

    if (!stats.isFile()) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Only file and folder downloads are supported from this endpoint.'
      });
    }

    const filename = path.basename(itemPath);
    reply
      .header('content-type', contentTypeForPath(itemPath))
      .header(
        'content-disposition',
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
    return reply.send(Readable.from(await fs.readFile(itemPath)));
  });

  app.post('/api/workspaces/:id/files/upload', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const record = requireWorkspaceRecord(app, params.id);
    const rootPath = await fs.realpath(record.absPath);
    const uploadRequest = request as MultipartUploadRequest;

    if (!uploadRequest.isMultipart()) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'File upload must use multipart/form-data.'
      });
    }

    let requestedPath: string | null = null;
    let fileBuffer: Buffer | null = null;
    let filename: string | undefined;
    for await (const part of uploadRequest.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') {
          throw new HttpError(400, {
            code: 'bad_request',
            message: `Unexpected multipart file field: ${part.fieldname}.`
          });
        }
        if (fileBuffer) {
          throw new HttpError(400, {
            code: 'bad_request',
            message: 'Only one file can be uploaded at a time.'
          });
        }
        fileBuffer = await part.toBuffer();
        filename =
          'filename' in part && typeof part.filename === 'string'
            ? part.filename
            : undefined;
        continue;
      }

      if (part.fieldname === 'path') {
        requestedPath = String(part.value ?? '').trim();
      }
    }

    if (!fileBuffer) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'A file field is required.'
      });
    }

    if (fileBuffer.byteLength > WORKSPACE_UPLOAD_MAX_BYTES) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Workspace uploads must be 50 MB or smaller.'
      });
    }

    const relativePath = requestedPath || sanitizeUploadFilename(filename);
    const file = await writeWorkspaceFile({
      workspacePath: rootPath,
      relativePath,
      content: fileBuffer,
    });

    return {
      kind: 'file',
      file: {
        path: file.path,
        name: path.basename(file.path),
        size: file.size
      }
    } satisfies ThreadWorkspaceUploadResultDto;
  });

  app.patch('/api/workspaces/:id/files/move', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = moveWorkspaceFileSchema.parse(request.body);
    const record = requireWorkspaceRecord(app, params.id);

    const file = await moveWorkspaceFile({
      workspacePath: record.absPath,
      fromPath: body.fromPath,
      toPath: body.toPath,
      ...(body.overwrite !== undefined ? { overwrite: body.overwrite } : {}),
    });

    return toWorkspaceFileDto(file);
  });

  app.delete('/api/workspaces/:id/files', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = deleteWorkspaceFileSchema.parse(request.body);
    const record = requireWorkspaceRecord(app, params.id);

    return deleteWorkspaceFile({
      workspacePath: record.absPath,
      relativePath: body.path,
      ...(body.recursive !== undefined ? { recursive: body.recursive } : {}),
    });
  });

  app.post('/api/workspaces/:id/artifacts', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = createWorkspaceArtifactSchema.parse(request.body);
    const record = requireWorkspaceRecord(app, params.id);
    const artifactId = body.id ?? artifactIdFromName(body.name);
    const content = Buffer.from(body.contentBase64, 'base64');
    const artifact = await createWorkspaceArtifact({
      record,
      artifactId,
      name: body.name,
      mediaType: body.mediaType,
      content,
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    });
    return { artifact };
  });

  app.get('/api/workspaces/:id/artifacts', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const record = requireWorkspaceRecord(app, params.id);
    return { artifacts: await listWorkspaceArtifacts(record) };
  });

  app.get('/api/workspaces/:id/artifacts/:artifactId', async (request) => {
    const params = z
      .object({ id: z.string().uuid(), artifactId: workspaceArtifactIdSchema })
      .parse(request.params);
    const record = requireWorkspaceRecord(app, params.id);
    return { artifact: await readWorkspaceArtifactMetadata(record, params.artifactId) };
  });

  app.get('/api/workspaces/:id/artifacts/:artifactId/download', async (request, reply) => {
    const params = z
      .object({ id: z.string().uuid(), artifactId: workspaceArtifactIdSchema })
      .parse(request.params);
    const record = requireWorkspaceRecord(app, params.id);
    const artifact = await readWorkspaceArtifactMetadata(record, params.artifactId);
    const content = await readWorkspaceArtifactContent(record, params.artifactId);
    reply
      .header('content-type', artifact.mediaType)
      .header('content-length', String(content.length))
      .header('content-disposition', `attachment; filename="${artifact.name.replace(/"/g, '')}"`);
    return reply.send(content);
  });

  app.delete('/api/workspaces/:id/artifacts/:artifactId', async (request) => {
    const params = z
      .object({ id: z.string().uuid(), artifactId: workspaceArtifactIdSchema })
      .parse(request.params);
    const record = requireWorkspaceRecord(app, params.id);
    const artifact = await deleteWorkspaceArtifact(record, params.artifactId);
    return { deleted: true, artifact };
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
      const requestedPath = body.absPath.trim();
      const isWorkspaceName =
        !path.isAbsolute(requestedPath) &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(requestedPath) &&
        requestedPath !== '.' &&
        requestedPath !== '..';
      if (!path.isAbsolute(requestedPath) && !isWorkspaceName) {
        throw new HttpError(400, {
          code: 'bad_request',
          message: 'Use a simple directory name, an absolute path, or a Git URL.'
        });
      }
      const targetPath = isWorkspaceName
        ? path.join(settings.devHome, requestedPath)
        : requestedPath;
      validated = await validateWorkspacePath(app.services.config.workspaceRoot, targetPath, {
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

    const confirmation = deleteWorkspaceSchema.safeParse(request.body ?? {});
    if (
      !confirmation.success ||
      confirmation.data.confirmWorkspaceId !== params.id ||
      confirmation.data.confirmLabel.trim() !== record.label
    ) {
      throw new HttpError(400, {
        code: 'confirmation_required',
        message: 'Workspace deletion requires confirmation.'
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
