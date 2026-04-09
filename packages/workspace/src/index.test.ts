import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WorkspaceServiceError,
  readWorkspaceTree,
  validateWorkspacePath
} from './index';

describe('workspace service', () => {
  let rootDir = '';

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-workspace-'));
    await fs.mkdir(path.join(rootDir, 'project'));
    await fs.mkdir(path.join(rootDir, 'project', 'src'));
    await fs.writeFile(path.join(rootDir, 'project', 'src', 'index.ts'), 'export {};');
    await fs.writeFile(path.join(rootDir, '.hidden'), 'secret');
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('validates a workspace path inside the root', async () => {
    const result = await validateWorkspacePath(rootDir, path.join(rootDir, 'project'));
    const expectedPath = await fs.realpath(path.join(rootDir, 'project'));

    expect(result.absPath).toBe(expectedPath);
    expect(result.label).toBe('project');
  });

  it('rejects paths outside the root', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));

    await expect(validateWorkspacePath(rootDir, outsideDir)).rejects.toMatchObject({
      code: 'path_outside_root'
    } satisfies Partial<WorkspaceServiceError>);

    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('reads the tree and hides dotfiles by default', async () => {
    const result = await readWorkspaceTree({
      rootPath: rootDir
    });
    const expectedRoot = await fs.realpath(rootDir);

    expect(result.currentPath).toBe(expectedRoot);
    expect(result.nodes.map((node) => node.name)).toEqual(['project']);
  });

  it('shows hidden files when requested', async () => {
    const result = await readWorkspaceTree({
      rootPath: rootDir,
      showHidden: true
    });

    expect(result.nodes.map((node) => node.name)).toEqual(['project', '.hidden']);
  });
});
