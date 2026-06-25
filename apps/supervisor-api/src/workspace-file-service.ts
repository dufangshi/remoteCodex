import { spawn } from 'node:child_process';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  ThreadWorkspaceTreeNodeDto,
  WorkspaceDto,
  WorkspaceFileDto,
} from '../../../packages/shared/src/index';
import { assertPathWithinRoot } from '../../../packages/workspace/src/index';
import { HttpError } from './app';

const PREVIEW_DEFAULT_LIMIT_BYTES = 50_000;
const WORKSPACE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const WORKSPACE_FOLDER_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
const WORKSPACE_FOLDER_DOWNLOAD_MAX_FILES = 300;
const WORKSPACE_TREE_DIRECTORY_ENTRY_LIMIT = 400;
const WORKSPACE_TREE_DIRECTORY_SCAN_LIMIT = 2_000;
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
    childrenLoaded: true,
    children: []
  };

  const visible: Dirent<string>[] = [];
  try {
    const directory = await fs.opendir(absPath);
    let scanned = 0;
    for await (const entry of directory) {
      scanned += 1;
      if (scanned > WORKSPACE_TREE_DIRECTORY_SCAN_LIMIT) {
        node.truncated = true;
        break;
      }
      if (entry.name.startsWith('.') || WORKSPACE_TREE_IGNORED_NAMES.has(entry.name)) {
        continue;
      }
      if (!entry.isDirectory() && !entry.isFile()) {
        continue;
      }
      if (visible.length >= WORKSPACE_TREE_DIRECTORY_ENTRY_LIMIT) {
        node.truncated = true;
        break;
      }
      visible.push(entry);
    }
  } catch {
    return node;
  }

  node.hasChildren = visible.length > 0;

  visible.sort((left, right) => {
    if (left.isDirectory() && !right.isDirectory()) {
      return -1;
    }
    if (!left.isDirectory() && right.isDirectory()) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });

  node.children = (
    await Promise.all(
      visible.map(async (entry): Promise<ThreadWorkspaceTreeNodeDto | null> => {
        const childPath = path.join(absPath, entry.name);
        try {
          const childRelativePath = relativeWorkspacePath(rootPath, childPath);
          if (entry.isDirectory()) {
            return {
              name: entry.name,
              path: childRelativePath,
              kind: 'directory' as const,
              hasChildren: true,
              childrenLoaded: false,
            };
          }
          const childStats = await fs.stat(childPath);
          return {
            name: entry.name,
            path: childRelativePath,
            kind: 'file' as const,
            size: childStats.size,
          };
        } catch {
          return null;
        }
      })
    )
  ).filter((child): child is ThreadWorkspaceTreeNodeDto => child !== null);

  return node;
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

export {
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
};
