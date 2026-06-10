import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export class WorkspaceServiceError extends Error {
  constructor(
    public readonly code:
      | 'path_not_absolute'
      | 'path_not_relative'
      | 'path_already_exists'
      | 'path_not_found'
      | 'path_parent_not_found'
      | 'path_not_directory'
      | 'path_not_file'
      | 'path_not_readable'
      | 'path_outside_root'
      | 'path_symlink_forbidden'
      | 'invalid_root',
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export interface WorkspaceTreeNode {
  name: string;
  absPath: string;
  kind: 'file' | 'directory';
  hasChildren: boolean;
  isHidden: boolean;
}

export interface WorkspaceTreeResult {
  rootPath: string;
  currentPath: string;
  nodes: WorkspaceTreeNode[];
}

export interface WorkspaceFileResult {
  path: string;
  absPath: string;
  kind: 'file' | 'directory';
  size: number;
  updatedAt: string;
}

async function ensureReadableDirectory(absPath: string) {
  try {
    const stats = await fs.stat(absPath);
    if (!stats.isDirectory()) {
      throw new WorkspaceServiceError('path_not_directory', 'The provided path is not a directory.', {
        absPath
      });
    }
    await fs.access(absPath, fsConstants.R_OK);
  } catch (error) {
    if (error instanceof WorkspaceServiceError) {
      throw error;
    }

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceServiceError('path_not_found', 'The provided path does not exist.', {
        absPath
      });
    }

    throw new WorkspaceServiceError('path_not_readable', 'The provided path is not readable.', {
      absPath
    });
  }
}

export async function resolveExistingDirectory(absPath: string) {
  await ensureReadableDirectory(absPath);
  return fs.realpath(absPath);
}

async function resolveComparablePath(absPath: string) {
  try {
    return await fs.realpath(absPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    const parentPath = path.dirname(absPath);
    const resolvedParent = await fs.realpath(parentPath);
    return path.join(resolvedParent, path.basename(absPath));
  }
}

function normalizeRelativeWorkspacePath(relativePath: string) {
  if (!relativePath.trim()) {
    throw new WorkspaceServiceError('path_not_relative', 'Workspace file path is required.');
  }

  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    path.isAbsolute(normalized)
  ) {
    throw new WorkspaceServiceError(
      'path_not_relative',
      'Workspace file path must be a relative path inside the workspace.',
      { path: relativePath },
    );
  }

  return normalized;
}

async function resolveWorkspaceFilePath(workspacePath: string, relativePath: string) {
  const workspaceRoot = await fs.realpath(workspacePath);
  const normalized = normalizeRelativeWorkspacePath(relativePath);
  const absPath = path.resolve(workspaceRoot, normalized);
  const relativeToRoot = path.relative(workspaceRoot, absPath);
  if (
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new WorkspaceServiceError(
      'path_outside_root',
      'Workspace file path must stay within the workspace.',
      {
        rootPath: workspaceRoot,
        candidatePath: absPath,
      },
    );
  }

  return {
    workspaceRoot,
    relativePath: normalized,
    absPath,
  };
}

async function ensureParentDirectoryForFile(absPath: string, workspaceRoot: string) {
  const parentPath = path.dirname(absPath);
  const resolvedParent = await assertPathWithinRoot(workspaceRoot, parentPath);
  try {
    const parentStats = await fs.stat(resolvedParent);
    if (!parentStats.isDirectory()) {
      throw new WorkspaceServiceError(
        'path_parent_not_found',
        'Workspace file parent path is not a directory.',
        { parentPath: resolvedParent },
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceServiceError(
        'path_parent_not_found',
        'Workspace file parent directory does not exist.',
        { parentPath: resolvedParent },
      );
    }

    throw error;
  }
}

async function rejectSymlink(absPath: string) {
  try {
    const stats = await fs.lstat(absPath);
    if (stats.isSymbolicLink()) {
      throw new WorkspaceServiceError(
        'path_symlink_forbidden',
        'Workspace file operations do not follow symlinks.',
        { absPath },
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

function toWorkspaceFileResult(
  workspaceRoot: string,
  absPath: string,
  stats: { isDirectory: () => boolean; size: number; mtime: Date },
): WorkspaceFileResult {
  return {
    path: path.relative(workspaceRoot, absPath).split(path.sep).join('/'),
    absPath,
    kind: stats.isDirectory() ? 'directory' : 'file',
    size: stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
}

export async function assertPathWithinRoot(rootPath: string, candidatePath: string) {
  if (!path.isAbsolute(rootPath)) {
    throw new WorkspaceServiceError('invalid_root', 'Workspace root must be an absolute path.', {
      rootPath
    });
  }

  if (!path.isAbsolute(candidatePath)) {
    throw new WorkspaceServiceError('path_not_absolute', 'Workspace path must be absolute.', {
      candidatePath
    });
  }

  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    fs.realpath(rootPath),
    resolveComparablePath(candidatePath)
  ]);
  const normalizedRoot = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;

  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(normalizedRoot)) {
    throw new WorkspaceServiceError(
      'path_outside_root',
      'Workspace path must stay within the configured workspace root.',
      {
        rootPath: resolvedRoot,
        candidatePath: resolvedCandidate
      }
    );
  }

  return resolvedCandidate;
}

export async function validateExistingDirectoryPath(rootPath: string, candidatePath: string) {
  await ensureReadableDirectory(rootPath);
  await ensureReadableDirectory(candidatePath);
  const realPath = await assertPathWithinRoot(rootPath, candidatePath);

  return {
    absPath: realPath,
    label: path.basename(realPath)
  };
}

export async function validateWorkspacePath(
  rootPath: string,
  candidatePath: string,
  options: {
    devHome?: string;
    createMissingLeaf?: boolean;
  } = {}
) {
  await ensureReadableDirectory(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);

  try {
    await ensureReadableDirectory(resolvedCandidate);
  } catch (error) {
    if (
      !(error instanceof WorkspaceServiceError) ||
      error.code !== 'path_not_found' ||
      !options.createMissingLeaf ||
      !options.devHome
    ) {
      throw error;
    }

    const parentPath = path.dirname(resolvedCandidate);
    try {
      await ensureReadableDirectory(parentPath);
    } catch (parentError) {
      if (parentError instanceof WorkspaceServiceError && parentError.code === 'path_not_found') {
        throw new WorkspaceServiceError(
          'path_parent_not_found',
          'The parent directory for the workspace path does not exist.',
          {
            absPath: resolvedCandidate,
            parentPath
          }
        );
      }

      throw parentError;
    }

    const resolvedDevHome = await assertPathWithinRoot(rootPath, options.devHome);
    const resolvedTarget = await assertPathWithinRoot(rootPath, resolvedCandidate);
    const normalizedDevHome = resolvedDevHome.endsWith(path.sep)
      ? resolvedDevHome
      : `${resolvedDevHome}${path.sep}`;

    if (resolvedTarget !== resolvedDevHome && !resolvedTarget.startsWith(normalizedDevHome)) {
      throw new WorkspaceServiceError(
        'path_outside_root',
        'New workspace directories must be created inside the configured dev home.',
        {
          devHome: resolvedDevHome,
          candidatePath: resolvedTarget
        }
      );
    }

    await fs.mkdir(resolvedTarget);
  }

  const realPath = await assertPathWithinRoot(rootPath, resolvedCandidate);

  return {
    absPath: realPath,
    label: path.basename(realPath)
  };
}

async function directoryHasChildren(absPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(absPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function readWorkspaceTree(options: {
  rootPath: string;
  targetPath?: string;
  showHidden?: boolean;
}): Promise<WorkspaceTreeResult> {
  const rootPath = await fs.realpath(options.rootPath);
  const currentPath = options.targetPath ? await fs.realpath(options.targetPath) : rootPath;

  await ensureReadableDirectory(rootPath);
  await ensureReadableDirectory(currentPath);
  await assertPathWithinRoot(rootPath, currentPath);

  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  const visible = entries
    .filter((entry) => (options.showHidden ? true : !entry.name.startsWith('.')))
    .sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) {
        return -1;
      }
      if (!left.isDirectory() && right.isDirectory()) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });

  const nodes = await Promise.all(
    visible.map(async (entry) => {
      const absPath = path.join(currentPath, entry.name);
      return {
        name: entry.name,
        absPath,
        kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        hasChildren: entry.isDirectory() ? await directoryHasChildren(absPath) : false,
        isHidden: entry.name.startsWith('.')
      };
    })
  );

  return {
    rootPath,
    currentPath,
    nodes
  };
}

export async function writeWorkspaceFile(options: {
  workspacePath: string;
  relativePath: string;
  content: string | Buffer;
}): Promise<WorkspaceFileResult> {
  const { workspaceRoot, absPath } = await resolveWorkspaceFilePath(
    options.workspacePath,
    options.relativePath,
  );
  await ensureParentDirectoryForFile(absPath, workspaceRoot);
  await rejectSymlink(absPath);

  await fs.writeFile(absPath, options.content);
  const stats = await fs.stat(absPath);
  if (!stats.isFile()) {
    throw new WorkspaceServiceError('path_not_file', 'Workspace path is not a file.', {
      absPath,
    });
  }

  return toWorkspaceFileResult(workspaceRoot, absPath, stats);
}

export async function moveWorkspaceFile(options: {
  workspacePath: string;
  fromPath: string;
  toPath: string;
  overwrite?: boolean;
}): Promise<WorkspaceFileResult> {
  const source = await resolveWorkspaceFilePath(options.workspacePath, options.fromPath);
  const target = await resolveWorkspaceFilePath(options.workspacePath, options.toPath);
  await rejectSymlink(source.absPath);
  await rejectSymlink(target.absPath);
  await ensureParentDirectoryForFile(target.absPath, target.workspaceRoot);

  const sourceStats = await fs.stat(source.absPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceServiceError('path_not_found', 'Workspace source path does not exist.', {
        absPath: source.absPath,
      });
    }

    throw error;
  });
  if (!sourceStats.isFile()) {
    throw new WorkspaceServiceError('path_not_file', 'Workspace source path is not a file.', {
      absPath: source.absPath,
    });
  }

  if (!options.overwrite) {
    const targetExists = await fs.stat(target.absPath).then(
      () => true,
      (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return false;
        }
        throw error;
      },
    );
    if (targetExists) {
      throw new WorkspaceServiceError(
        'path_already_exists',
        'Workspace target path already exists.',
        { absPath: target.absPath },
      );
    }
  }

  await fs.rename(source.absPath, target.absPath);
  const targetStats = await fs.stat(target.absPath);
  return toWorkspaceFileResult(target.workspaceRoot, target.absPath, targetStats);
}

export async function deleteWorkspaceFile(options: {
  workspacePath: string;
  relativePath: string;
  recursive?: boolean;
}) {
  const resolved = await resolveWorkspaceFilePath(options.workspacePath, options.relativePath);
  await rejectSymlink(resolved.absPath);

  const stats = await fs.stat(resolved.absPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceServiceError('path_not_found', 'Workspace path does not exist.', {
        absPath: resolved.absPath,
      });
    }

    throw error;
  });
  if (stats.isDirectory() && !options.recursive) {
    throw new WorkspaceServiceError(
      'path_not_file',
      'Workspace directory deletes require recursive=true.',
      { absPath: resolved.absPath },
    );
  }

  await fs.rm(resolved.absPath, {
    recursive: stats.isDirectory() && options.recursive === true,
    force: false,
  });

  return {
    path: resolved.relativePath,
    absPath: resolved.absPath,
  };
}
