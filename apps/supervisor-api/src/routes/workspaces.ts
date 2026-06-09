import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import type { Dirent } from 'node:fs';

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
  ThreadWorkspaceFilePreviewDto,
  ThreadWorkspaceTreeNodeDto,
  ThreadWorkspaceUploadResultDto,
  UpdateWorkspaceInput,
  WorkspaceDto,
  WorkspaceTreeDto
} from '../../../../packages/shared/src/index';
import {
  assertPathWithinRoot,
  readWorkspaceTree,
  validateWorkspacePath
} from '../../../../packages/workspace/src/index';
import { HttpError } from '../app';
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

const PREVIEW_DEFAULT_LIMIT_BYTES = 50_000;
const WORKSPACE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const WORKSPACE_TREE_IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build'
]);

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

function languageForPath(filePath: string) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  switch (extension) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return extension;
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'yml':
      return 'yaml';
    case 'sh':
    case 'bash':
      return 'bash';
    case 'py':
      return 'python';
    case 'rb':
      return 'ruby';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'c':
    case 'h':
      return 'c';
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'hpp':
      return 'cpp';
    case 'html':
    case 'css':
    case 'json':
    case 'jsonl':
    case 'toml':
    case 'xml':
    case 'sql':
    case 'txt':
      return extension;
    default:
      return extension || 'text';
  }
}

function relativeWorkspacePath(rootPath: string, absPath: string) {
  const relative = path.relative(rootPath, absPath);
  return relative === '' ? '' : relative.split(path.sep).join('/');
}

async function resolveWorkspaceItemPath(rootPath: string, relativePath = '') {
  const candidate = path.resolve(rootPath, relativePath || '.');
  const comparable = await assertPathWithinRoot(rootPath, candidate);
  return comparable;
}

async function buildWorkspaceTreeNode(
  rootPath: string,
  absPath: string,
  depth = 0,
): Promise<ThreadWorkspaceTreeNodeDto> {
  const stats = await fs.stat(absPath);
  const relativePath = relativeWorkspacePath(rootPath, absPath);
  const name = relativePath ? path.basename(absPath) : path.basename(rootPath);

  if (!stats.isDirectory()) {
    return {
      name,
      path: relativePath,
      kind: 'file',
      size: stats.size
    };
  }

  const node: ThreadWorkspaceTreeNodeDto = {
    name,
    path: relativePath,
    kind: 'directory',
    children: []
  };

  if (depth >= 6) {
    return node;
  }

  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true });
  } catch {
    return node;
  }

  const visible = entries
    .filter((entry) => !entry.name.startsWith('.'))
    .filter((entry) => !WORKSPACE_TREE_IGNORED_NAMES.has(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) {
        return -1;
      }
      if (!left.isDirectory() && right.isDirectory()) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, 400);

  node.children = (
    await Promise.all(
      visible.map(async (entry) => {
        const childPath = path.join(absPath, entry.name);
        try {
          if (!entry.isDirectory() && !entry.isFile()) {
            return null;
          }
          return await buildWorkspaceTreeNode(rootPath, childPath, depth + 1);
        } catch {
          return null;
        }
      })
    )
  ).filter((child): child is ThreadWorkspaceTreeNodeDto => child !== null);

  return node;
}

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

function contentTypeForPath(filePath: string) {
  switch (path.extname(filePath).slice(1).toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'html':
      return 'text/html; charset=utf-8';
    case 'css':
      return 'text/css; charset=utf-8';
    case 'js':
    case 'mjs':
    case 'ts':
    case 'tsx':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function sanitizeUploadFilename(filename: string | undefined) {
  const baseName = path.basename(filename?.trim() || 'upload');
  if (!baseName || baseName === '.' || baseName === '..') {
    return 'upload';
  }
  return baseName;
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

  app.get('/api/workspaces/:id/files/tree', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = workspaceFileQuerySchema.parse(request.query);
    const record = requireWorkspaceRecord(app, params.id);
    const rootPath = await fs.realpath(record.absPath);
    const targetPath = await resolveWorkspaceItemPath(rootPath, query.path);

    return buildWorkspaceTreeNode(rootPath, targetPath);
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

    if (!stats.isFile()) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Only file downloads are supported from this endpoint.'
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
    const part = await request.file();

    if (!part) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'A file field is required.'
      });
    }

    const buffer = await part.toBuffer();
    if (buffer.byteLength > WORKSPACE_UPLOAD_MAX_BYTES) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Workspace uploads must be 50 MB or smaller.'
      });
    }

    const filename = sanitizeUploadFilename(part.filename);
    const destination = await resolveWorkspaceItemPath(rootPath, filename);
    await fs.writeFile(destination, buffer);

    return {
      kind: 'file',
      file: {
        path: relativeWorkspacePath(rootPath, destination),
        name: filename,
        size: buffer.byteLength
      }
    } satisfies ThreadWorkspaceUploadResultDto;
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
