import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMigrationsDir } from './migrate';

describe('migrations', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers the active workspace migrations over an installed package root', async () => {
    const installedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-installed-root-'));
    await fs.mkdir(path.join(installedRoot, 'packages', 'db', 'migrations'), { recursive: true });
    vi.stubEnv('REMOTE_CODEX_PACKAGE_ROOT', installedRoot);

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-workspace-root-'));
    await fs.writeFile(path.join(workspaceDir, 'pnpm-workspace.yaml'), 'packages: []\n');
    await fs.mkdir(path.join(workspaceDir, 'packages', 'db', 'migrations'), { recursive: true });

    expect(getMigrationsDir(workspaceDir)).toBe(
      path.join(workspaceDir, 'packages', 'db', 'migrations'),
    );
  });

  it('resolves migrations from the installed package root outside a workspace', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-package-root-'));
    await fs.mkdir(path.join(tempDir, 'packages', 'db', 'migrations'), { recursive: true });
    const outsideWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-no-workspace-'));
    vi.stubEnv('REMOTE_CODEX_PACKAGE_ROOT', tempDir);

    expect(getMigrationsDir(outsideWorkspace)).toBe(path.join(tempDir, 'packages', 'db', 'migrations'));
  });
});
