import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WorkspaceServiceError,
  deleteWorkspaceFile,
  isPathInside,
  moveWorkspaceFile,
  readWorkspaceTree,
  validateWorkspacePath,
  writeWorkspaceFile
} from './index';

describe('isPathInside', () => {
  it('uses case-insensitive drive semantics on Windows', () => {
    expect(isPathInside('C:\\Dev\\Repo', 'c:\\dev\\repo\\src\\index.ts', 'win32')).toBe(true);
  });

  it('rejects sibling prefixes and different Windows drives', () => {
    expect(isPathInside('C:\\dev\\app', 'C:\\dev\\application\\index.ts', 'win32')).toBe(false);
    expect(isPathInside('C:\\dev\\repo', 'D:\\dev\\repo\\index.ts', 'win32')).toBe(false);
  });

  it('supports spaces, unicode, and mixed Windows separators', () => {
    expect(
      isPathInside(
        'C:\\Users\\Test User\\开发项目',
        'c:/users/test user/开发项目/应用/src/a.ts',
        'win32',
      ),
    ).toBe(true);
  });

  it('rejects parent traversal on POSIX', () => {
    expect(isPathInside('/srv/workspaces/app', '/srv/workspaces/other', 'linux')).toBe(false);
  });
});

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

  it('writes, moves, and deletes files inside a workspace', async () => {
    const workspacePath = path.join(rootDir, 'project');

    const written = await writeWorkspaceFile({
      workspacePath,
      relativePath: 'src/new.ts',
      content: 'export const value = 1;',
    });
    expect(written).toMatchObject({
      path: 'src/new.ts',
      kind: 'file',
    });
    await expect(fs.readFile(path.join(workspacePath, 'src', 'new.ts'), 'utf8')).resolves.toBe(
      'export const value = 1;',
    );

    const moved = await moveWorkspaceFile({
      workspacePath,
      fromPath: 'src/new.ts',
      toPath: 'src/moved.ts',
    });
    expect(moved.path).toBe('src/moved.ts');
    await expect(fs.readFile(path.join(workspacePath, 'src', 'moved.ts'), 'utf8')).resolves.toBe(
      'export const value = 1;',
    );

    const deleted = await deleteWorkspaceFile({
      workspacePath,
      relativePath: 'src/moved.ts',
    });
    expect(deleted.path).toBe('src/moved.ts');
    await expect(fs.stat(path.join(workspacePath, 'src', 'moved.ts'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects workspace file operations outside the workspace', async () => {
    const workspacePath = path.join(rootDir, 'project');

    await expect(
      writeWorkspaceFile({
        workspacePath,
        relativePath: '../escape.txt',
        content: 'nope',
      }),
    ).rejects.toMatchObject({
      code: 'path_not_relative',
    } satisfies Partial<WorkspaceServiceError>);

    await expect(
      moveWorkspaceFile({
        workspacePath,
        fromPath: 'src/index.ts',
        toPath: '../escape.ts',
      }),
    ).rejects.toMatchObject({
      code: 'path_not_relative',
    } satisfies Partial<WorkspaceServiceError>);

    await expect(
      deleteWorkspaceFile({
        workspacePath,
        relativePath: '../escape.ts',
      }),
    ).rejects.toMatchObject({
      code: 'path_not_relative',
    } satisfies Partial<WorkspaceServiceError>);
  });

  it('rejects workspace file operations through symlinks', async () => {
    const workspacePath = path.join(rootDir, 'project');
    const outsideDir = path.join(rootDir, 'outside');
    const outsideFile = path.join(outsideDir, 'outside.txt');
    const linkPath = path.join(workspacePath, 'src', 'linked');
    await fs.mkdir(outsideDir);
    await fs.writeFile(outsideFile, 'outside');
    await fs.symlink(
      outsideDir,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      writeWorkspaceFile({
        workspacePath,
        relativePath: 'src/linked/outside.txt',
        content: 'changed',
      }),
    ).rejects.toMatchObject({
      code: 'path_outside_root',
    } satisfies Partial<WorkspaceServiceError>);
    await expect(fs.readFile(outsideFile, 'utf8')).resolves.toBe('outside');
  });
});
