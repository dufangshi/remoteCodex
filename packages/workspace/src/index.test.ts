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

  it('normalizes a trailing slash workspace path', async () => {
    const result = await validateWorkspacePath(rootDir, `${path.join(rootDir, 'project')}/`);
    const expectedPath = await fs.realpath(path.join(rootDir, 'project'));

    expect(result.absPath).toBe(expectedPath);
    expect(result.label).toBe('project');
  });

  it('creates one missing leaf directory inside dev home', async () => {
    const result = await validateWorkspacePath(rootDir, path.join(rootDir, 'new-project'), {
      devHome: rootDir,
      createMissingLeaf: true,
    });

    expect(result.absPath).toBe(await fs.realpath(path.join(rootDir, 'new-project')));
    await expect(fs.stat(path.join(rootDir, 'new-project'))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });

  it('rejects missing parents when creating a workspace leaf', async () => {
    await expect(
      validateWorkspacePath(rootDir, path.join(rootDir, 'missing-parent', 'project'), {
        devHome: rootDir,
        createMissingLeaf: true,
      }),
    ).rejects.toMatchObject({
      code: 'path_parent_not_found',
    } satisfies Partial<WorkspaceServiceError>);
  });

  it('rejects missing leaf creation outside dev home', async () => {
    const devHome = path.join(rootDir, 'project');

    await expect(
      validateWorkspacePath(rootDir, path.join(rootDir, 'outside-dev-home'), {
        devHome,
        createMissingLeaf: true,
      }),
    ).rejects.toMatchObject({
      code: 'path_outside_root',
    } satisfies Partial<WorkspaceServiceError>);
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
