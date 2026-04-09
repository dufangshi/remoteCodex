import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app';

describe('supervisor api', () => {
  let tempDir = '';
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-api-'));
    await fs.mkdir(path.join(tempDir, 'workspace'));
    await fs.writeFile(path.join(tempDir, 'workspace', 'README.md'), '# hello');

    app = buildApp({
      env: {
        NODE_ENV: 'test',
        APP_NAME: 'Test Supervisor',
        APP_VERSION: '0.1.0-test',
        DATABASE_URL: path.join(tempDir, 'test.sqlite'),
        WORKSPACE_ROOT: tempDir
      }
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns health status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok'
    });
  });

  it('creates and lists workspaces', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      label: 'workspace'
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/workspaces'
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toHaveLength(1);
  });

  it('reads a workspace tree', async () => {
    const expectedPath = await fs.realpath(path.join(tempDir, 'workspace'));
    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/tree?path=${encodeURIComponent(path.join(tempDir, 'workspace'))}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      currentPath: expectedPath
    });
  });

  it('rejects paths outside workspace root', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-outside-'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: outsideDir
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'forbidden'
    });

    await fs.rm(outsideDir, { recursive: true, force: true });
  });
});
