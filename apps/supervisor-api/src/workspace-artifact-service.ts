import fs from 'node:fs/promises';
import path from 'node:path';

import { HttpError } from './app';

export interface WorkspaceArtifactMetadata {
  id: string;
  workspaceId: string;
  name: string;
  mediaType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

type WorkspaceArtifactRecord = {
  id: string;
  absPath: string;
};

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

export function artifactIdFromName(name: string) {
  const base = path
    .basename(name)
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `${base || 'artifact'}-${Date.now().toString(36)}`;
}

export async function readWorkspaceArtifactMetadata(
  record: { absPath: string },
  artifactId: string,
) {
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

export async function listWorkspaceArtifacts(record: { absPath: string }) {
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
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(entry)) {
      continue;
    }
    try {
      artifacts.push(await readWorkspaceArtifactMetadata(record, entry));
    } catch (error) {
      if (!(error instanceof HttpError && error.statusCode === 404)) {
        throw error;
      }
    }
  }
  return artifacts.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createWorkspaceArtifact({
  record,
  artifactId,
  name,
  mediaType,
  content,
  metadata,
}: {
  record: WorkspaceArtifactRecord;
  artifactId: string;
  name: string;
  mediaType: string;
  content: Buffer;
  metadata?: Record<string, unknown>;
}) {
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
    name: safeArtifactFileName(name),
    mediaType,
    size: content.length,
    createdAt: now,
    updatedAt: now,
    metadata: metadata ?? {},
  };
  await fs.writeFile(artifactMetadataPath(record, artifactId), JSON.stringify(artifact, null, 2));
  return artifact;
}

export async function readWorkspaceArtifactContent(
  record: { absPath: string },
  artifactId: string,
) {
  try {
    return await fs.readFile(artifactFilePath(record, artifactId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace artifact content was not found.',
      });
    }
    throw error;
  }
}

export async function deleteWorkspaceArtifact(
  record: { absPath: string },
  artifactId: string,
) {
  const artifact = await readWorkspaceArtifactMetadata(record, artifactId);
  await fs.rm(path.dirname(artifactFilePath(record, artifactId)), {
    recursive: true,
    force: true,
  });
  return artifact;
}
