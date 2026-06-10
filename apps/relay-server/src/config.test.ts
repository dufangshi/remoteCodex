import crypto from 'node:crypto';
import fsSync from 'node:fs';
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
      REMOTE_CODEX_ADMIN_USERNAME: 'admin',
      REMOTE_CODEX_ADMIN_PASSWORD: 'password123',
    } as any);

    expect(config.webDistDir).toBe(distDir);
    expect(config.supervisorToken).toBeNull();
  });

  it('lets REMOTE_CODEX_RELAY_WEB_DIST_DIR override the default web dist', () => {
    const configuredDist = `/tmp/relay-web-${crypto.randomUUID()}`;

    const config = loadRelayServerConfig({
      REMOTE_CODEX_ADMIN_USERNAME: 'admin',
      REMOTE_CODEX_ADMIN_PASSWORD: 'password123',
      REMOTE_CODEX_RELAY_WEB_DIST_DIR: configuredDist,
    } as any);

    expect(config.webDistDir).toBe(configuredDist);
  });

  it('treats blank optional environment variables as unset', () => {
    const config = loadRelayServerConfig({
      HOST: '',
      PORT: '',
      REMOTE_CODEX_ADMIN_USERNAME: 'admin',
      REMOTE_CODEX_ADMIN_PASSWORD: 'password123',
      REMOTE_CODEX_ADMIN_EMAIL: '',
      REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN: '',
      REMOTE_CODEX_RELAY_CLIENT_TOKEN: '',
      REMOTE_CODEX_RELAY_DATA_DIR: '',
      REMOTE_CODEX_RELAY_SESSION_SECRET: '',
      REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: '',
      REMOTE_CODEX_RELAY_WEB_DIST_DIR: '',
    } as any);

    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8788);
    expect(config.supervisorToken).toBeNull();
    expect(config.clientToken).toBeNull();
    expect(config.adminEmail).toBe('admin@relay.local');
    expect(config.dataDir).toBe('.local/relay-server');
    expect(config.sessionSecret).toBe('password123');
    expect(config.registrationEnabled).toBe(true);
  });

  it('finds the repo web dist when the relay cwd is the relay package', () => {
    const config = loadRelayServerConfig({
      REMOTE_CODEX_ADMIN_USERNAME: 'admin',
      REMOTE_CODEX_ADMIN_PASSWORD: 'password123',
    } as any);

    const repoDistDir = path.resolve(originalCwd, '../supervisor-web/dist');
    const expectedDistDir =
      fsSyncExists(path.join(repoDistDir, 'index.html')) ? repoDistDir : null;
    expect(config.webDistDir).toBe(expectedDistDir);
  });
});

function fsSyncExists(filePath: string) {
  return fsSync.existsSync(filePath);
}
