import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import type { Dirent } from 'node:fs';

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
  ThreadWorkspaceTreeNodeDto,
  ThreadWorkspaceUploadResultDto,
  UpdateWorkspaceInput,
  WorkspaceFileDto,
  WriteWorkspaceFileInput,
  WorkspaceDto,
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
import { requireWorkerScope } from '../worker-identity';
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

const PREVIEW_DEFAULT_LIMIT_BYTES = 50_000;
const WORKSPACE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const WORKSPACE_FOLDER_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
const WORKSPACE_FOLDER_DOWNLOAD_MAX_FILES = 300;
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

function artifactRoot(record: { absPath: string }) {
  return path.join(record.absPath, '.remote-codex', 'artifacts');
}

function artifactFilePath(record: { absPath: string }, artifactId: string) {
  return path.join(artifactRoot(record), artifactId, 'artifact.bin');
}

function artifactMetadataPath(record: { absPath: string }, artifactId: string) {
  return path.join(artifactRoot(record), artifactId, 'metadata.json');
}

function safeArtifactFileName(value: string) {
  return path.basename(value).replace(/[^a-zA-Z0-9_. -]/g, '_') || 'artifact.bin';
}

function artifactIdFromName(name: string) {
  const base = path
    .basename(name)
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `${base || 'artifact'}-${Date.now().toString(36)}`;
}

interface WorkspaceArtifactMetadata {
  id: string;
  workspaceId: string;
  name: string;
  mediaType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

async function readArtifactMetadata(record: { absPath: string }, artifactId: string) {
  try {
    const raw = await fs.readFile(artifactMetadataPath(record, artifactId), 'utf8');
    return JSON.parse(raw) as WorkspaceArtifactMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace artifact was not found.',
      });
    }
    throw error;
  }
}

async function listWorkspaceArtifacts(record: { absPath: string }) {
  let entries: string[];
  try {
    entries = await fs.readdir(artifactRoot(record));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const artifacts: WorkspaceArtifactMetadata[] = [];
  for (const entry of entries) {
    if (!workspaceArtifactIdSchema.safeParse(entry).success) {
      continue;
    }
    try {
      artifacts.push(await readArtifactMetadata(record, entry));
    } catch (error) {
      if (!(error instanceof HttpError && error.statusCode === 404)) {
        throw error;
      }
    }
  }
  return artifacts.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

interface WorkspaceFolderZipEntry {
  absPath: string;
  archivePath: string;
  size: number;
  updatedAt: Date;
}

async function collectFolderZipEntries(rootPath: string, folderPath: string) {
  const folderName = path.basename(folderPath) || 'workspace-folder';
  const entries: WorkspaceFolderZipEntry[] = [];
  let totalBytes = 0;
  const pending = [folderPath];

  while (pending.length > 0) {
    const current = pending.pop()!;
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children) {
      const childPath = await resolveWorkspaceItemPath(rootPath, path.relative(rootPath, path.join(current, child.name)));
      if (child.isDirectory()) {
        pending.push(childPath);
        continue;
      }
      if (!child.isFile()) {
        continue;
      }

      const stats = await fs.stat(childPath);
      totalBytes += stats.size;
      entries.push({
        absPath: childPath,
        archivePath: `${folderName}/${relativeWorkspacePath(folderPath, childPath)}`,
        size: stats.size,
        updatedAt: stats.mtime,
      });

      if (entries.length >= WORKSPACE_FOLDER_DOWNLOAD_MAX_FILES) {
        throw new HttpError(400, {
          code: 'bad_request',
          message: 'Folder downloads must contain fewer than 300 files.',
        });
      }

      if (totalBytes >= WORKSPACE_FOLDER_DOWNLOAD_MAX_BYTES) {
        throw new HttpError(400, {
          code: 'bad_request',
          message: 'Folder downloads must be smaller than 100 MB.',
        });
      }
    }
  }

  return entries.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

const crc32Table = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  crc32Table[index] = value >>> 0;
}

function crc32(buffer: Buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crc32Table[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(updatedAt: Date) {
  const year = Math.max(1980, updatedAt.getFullYear());
  const dosTime =
    (updatedAt.getHours() << 11) |
    (updatedAt.getMinutes() << 5) |
    Math.floor(updatedAt.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((updatedAt.getMonth() + 1) << 5) |
    updatedAt.getDate();
  return { dosDate, dosTime };
}

async function createFolderZipFile(rootPath: string, folderPath: string) {
  const entries = await collectFolderZipEntries(rootPath, folderPath);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await fs.readFile(entry.absPath);
    const name = Buffer.from(entry.archivePath.split(path.sep).join('/'), 'utf8');
    const checksum = crc32(data);
    const { dosDate, dosTime } = zipDosDateTime(entry.updatedAt);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-folder-download-'));
  const zipPath = path.join(tempDir, `${path.basename(folderPath) || 'workspace-folder'}.zip`);
  await fs.writeFile(zipPath, Buffer.concat([...localParts, ...centralParts, endRecord]));
  return { zipPath, tempDir };
}

function cleanupTemporaryZip(zipPath: string, tempDir: string) {
  return async () => {
    await fs.rm(zipPath, { force: true }).catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  };
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

  app.put('/api/workspaces/:id/files', async (request) => {
    requireWorkerScope(request, 'file:write');
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
    requireWorkerScope(request, 'file:write');
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
    requireWorkerScope(request, 'file:write');
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
    requireWorkerScope(request, 'file:write');
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
    requireWorkerScope(request, 'artifact:write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = createWorkspaceArtifactSchema.parse(request.body);
    const record = requireWorkspaceRecord(app, params.id);
    const artifactId = body.id ?? artifactIdFromName(body.name);
    const content = Buffer.from(body.contentBase64, 'base64');
    if (content.length === 0) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Artifact content must not be empty.',
      });
    }

    const dir = path.dirname(artifactFilePath(record, artifactId));
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const filePath = artifactFilePath(record, artifactId);
    await fs.writeFile(filePath, content, { flag: 'wx' }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'Workspace artifact already exists.',
        });
      }
      throw error;
    });

    const now = new Date().toISOString();
    const artifact: WorkspaceArtifactMetadata = {
      id: artifactId,
      workspaceId: record.id,
      name: safeArtifactFileName(body.name),
      mediaType: body.mediaType,
      size: content.length,
      createdAt: now,
      updatedAt: now,
      metadata: body.metadata ?? {},
    };
    await fs.writeFile(artifactMetadataPath(record, artifactId), JSON.stringify(artifact, null, 2));
    return { artifact };
  });

  app.get('/api/workspaces/:id/artifacts', async (request) => {
    requireWorkerScope(request, 'artifact:read');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const record = requireWorkspaceRecord(app, params.id);
    return { artifacts: await listWorkspaceArtifacts(record) };
  });

  app.get('/api/workspaces/:id/artifacts/:artifactId', async (request) => {
    requireWorkerScope(request, 'artifact:read');
    const params = z
      .object({ id: z.string().uuid(), artifactId: workspaceArtifactIdSchema })
      .parse(request.params);
    const record = requireWorkspaceRecord(app, params.id);
    return { artifact: await readArtifactMetadata(record, params.artifactId) };
  });

  app.get('/api/workspaces/:id/artifacts/:artifactId/download', async (request, reply) => {
    requireWorkerScope(request, 'artifact:read');
    const params = z
      .object({ id: z.string().uuid(), artifactId: workspaceArtifactIdSchema })
      .parse(request.params);
    const record = requireWorkspaceRecord(app, params.id);
    const artifact = await readArtifactMetadata(record, params.artifactId);
    let content: Buffer;
    try {
      content = await fs.readFile(artifactFilePath(record, params.artifactId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new HttpError(404, {
          code: 'not_found',
          message: 'Workspace artifact content was not found.',
        });
      }
      throw error;
    }
    reply
      .header('content-type', artifact.mediaType)
      .header('content-length', String(content.length))
      .header('content-disposition', `attachment; filename="${artifact.name.replace(/"/g, '')}"`);
    return reply.send(content);
  });

  app.delete('/api/workspaces/:id/artifacts/:artifactId', async (request) => {
    requireWorkerScope(request, 'artifact:write');
    const params = z
      .object({ id: z.string().uuid(), artifactId: workspaceArtifactIdSchema })
      .parse(request.params);
    const record = requireWorkspaceRecord(app, params.id);
    const artifact = await readArtifactMetadata(record, params.artifactId);
    await fs.rm(path.dirname(artifactFilePath(record, params.artifactId)), {
      recursive: true,
      force: true,
    });
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
