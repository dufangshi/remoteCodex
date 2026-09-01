import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveAcpWorkspacePath } from './workspace-boundary';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('ACP workspace boundary', () => {
  it('allows missing descendants while rejecting symlink escapes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-acp-boundary-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-acp-outside-'));
    directories.push(root, outside);
    const realRoot = await fs.realpath(root);
    expect(await resolveAcpWorkspacePath(
      root,
      path.join(root, 'new', 'file.txt'),
    )).toBe(path.join(realRoot, 'new', 'file.txt'));
    await fs.symlink(outside, path.join(root, 'escape'));
    await expect(resolveAcpWorkspacePath(
      root,
      path.join(root, 'escape', 'file.txt'),
    )).rejects.toThrow(/resolves outside/);
  });
});
