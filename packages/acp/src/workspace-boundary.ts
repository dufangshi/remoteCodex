import fs from 'node:fs/promises';
import path from 'node:path';

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function resolveAcpWorkspacePath(
  workspacePath: string,
  candidatePath: string,
) {
  if (!path.isAbsolute(candidatePath)) {
    throw new Error('ACP workspace paths must be absolute.');
  }
  const rootPath = path.resolve(workspacePath);
  const requestedPath = path.resolve(candidatePath);
  if (!isInside(rootPath, requestedPath)) {
    throw new Error('ACP path must stay inside the session workspace.');
  }
  const rootRealPath = await fs.realpath(rootPath);
  let existingPath = requestedPath;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const existingRealPath = await fs.realpath(existingPath);
      if (!isInside(rootRealPath, existingRealPath)) {
        throw new Error('ACP path resolves outside the session workspace.');
      }
      return path.join(existingRealPath, ...missingSegments);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      const parent = path.dirname(existingPath);
      if (parent === existingPath) {
        throw new Error('ACP workspace path has no existing parent.');
      }
      missingSegments.unshift(path.basename(existingPath));
      existingPath = parent;
    }
  }
}
