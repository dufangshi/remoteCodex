import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export class WorkspaceServiceError extends Error {
  constructor(
    public readonly code:
      | 'path_not_absolute'
      | 'path_not_found'
      | 'path_not_directory'
      | 'path_not_readable'
      | 'path_outside_root'
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
    fs.realpath(candidatePath)
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

export async function validateWorkspacePath(rootPath: string, candidatePath: string) {
  await ensureReadableDirectory(rootPath);
  await ensureReadableDirectory(candidatePath);
  const realPath = await assertPathWithinRoot(rootPath, candidatePath);

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
