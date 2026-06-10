import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadRelayServerConfig } from './config';

const originalCwd = process.cwd();
const tempDirs: string[] = [];

describe('relay server config', () => {
  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it('uses packaged supervisor web dist by default when it exists', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-relay-config-'));
    tempDirs.push(tempDir);
    const distDir = path.join(tempDir, 'apps', 'supervisor-web', 'dist');
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, 'index.html'), '<html></html>', 'utf8');
    process.chdir(tempDir);

    const config = loadRelayServerConfig({
      REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN: 'supervisor-token',
      REMOTE_CODEX_ADMIN_USERNAME: 'admin',
      REMOTE_CODEX_ADMIN_PASSWORD: 'password123',
    } as any);

    expect(config.webDistDir).toBe(distDir);
  });

  it('lets REMOTE_CODEX_RELAY_WEB_DIST_DIR override the default web dist', () => {
    const configuredDist = `/tmp/relay-web-${crypto.randomUUID()}`;

    const config = loadRelayServerConfig({
      REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN: 'supervisor-token',
      REMOTE_CODEX_ADMIN_USERNAME: 'admin',
      REMOTE_CODEX_ADMIN_PASSWORD: 'password123',
      REMOTE_CODEX_RELAY_WEB_DIST_DIR: configuredDist,
    } as any);

    expect(config.webDistDir).toBe(configuredDist);
  });
});
