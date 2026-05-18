import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMigrationsDir } from './migrate';

describe('migrations', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves migrations from the installed package root when provided', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-package-root-'));
    await fs.mkdir(path.join(tempDir, 'packages', 'db', 'migrations'), { recursive: true });
    vi.stubEnv('REMOTE_CODEX_PACKAGE_ROOT', tempDir);

    expect(getMigrationsDir()).toBe(path.join(tempDir, 'packages', 'db', 'migrations'));
  });
});
