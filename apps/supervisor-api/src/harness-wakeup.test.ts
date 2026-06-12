import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeRegistry } from '../../../packages/agent-runtime/src/index';
import {
  CodexManagementService,
  CodexRuntimeAdapter,
  LocalCodexSessionStore,
} from '../../../packages/codex/src/index';
import { loadRuntimeConfig } from '../../../packages/config/src/index';
import { createDatabase, type DatabaseContext } from '../../../packages/db/src/client';
import { runMigrations } from '../../../packages/db/src/migrate';
import {
  createThreadRecord,
  createWorkspaceRecord,
  getHarnessJobWatchByJobId,
  getHarnessNotifyRegistration,
  updateThreadRecord,
  upsertHarnessNotifyRegistration,
} from '../../../packages/db/src/repositories';
import { buildApp, HttpError } from './app';
import { FakeCodexManager } from './test/fakeCodexManager';
import { HarnessWakeupService } from './harness-wakeup-service';
import type { ThreadService } from './thread-service';
import {
  parseTomlBlocks,
  parseTomlLines,
  type WorkerHarnessClient,
} from './worker-harness-client';

const CALLBACK_BASE_URL = 'https://router.example/api/sandboxes/sbx-1/hooks';

function testLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function testConfig(env: Record<string, string> = {}) {
  return loadRuntimeConfig({
    NODE_ENV: 'test',
    ELAGENTE_HARNESS_BASE_URL: 'https://harness.example',
    INACT_X_APP_KEY: 'harness-key',
    REMOTE_CODEX_HARNESS_WAKEUP_CALLBACK_BASE_URL: CALLBACK_BASE_URL,
    ...env,
  });
}

function fakeHarnessClient(overrides: Record<string, unknown> = {}) {
  return {
    configured: vi.fn(() => ({ keyPresent: true })),
    whoami: vi.fn(async () => ({ agentId: '42' })),
    registerNotifyCallback: vi.fn(async () => ({ text: 'OK' })),
    getComputeJob: vi.fn(async () => ({
      jobId: 'job-1',
      status: 'done',
      terminal: true,
      title: null,
      reason: null,
      raw: {},
    })),
    listUnreadNotifications: vi.fn(async () => []),
    markNotificationRead: vi.fn(async () => ({ text: 'OK' })),
    ...overrides,
  } as unknown as WorkerHarnessClient;
}

function fakeThreadService(overrides: Record<string, unknown> = {}) {
  return {
    sendPrompt: vi.fn(async () => ({})),
    resumeThread: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as ThreadService;
}

describe('harness TOML parsing', () => {
  it('parses key-value lines with quoted strings', () => {
    const record = parseTomlLines(
      'id           = job-7\nstatus       = "running"\ntitle        = "ORCA \\"opt\\""\n',
    );
    expect(record.id).toBe('job-7');
    expect(record.status).toBe('running');
    expect(record.title).toBe('ORCA "opt"');
  });

  it('parses [[notifications]] blocks', () => {
    const text = [
      '# Notifications (agent 42)',
      '',
      '[[notifications]]',
      'id        = 7',
      'from      = "jobs"',
      'message   = "Job \\"t\\" finished — status: done\\nid: job-9\\nGET /compute/jobs/job-9 for full details"',
      'read      = false',
      '',
      '[[notifications]]',
      'id        = 8',
      'from      = "tasks"',
      'message   = "hello"',
      '',
    ].join('\n');
    const blocks = parseTomlBlocks(text, 'notifications');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.id).toBe('7');
    expect(blocks[0]!.from).toBe('jobs');
    expect(blocks[0]!.message).toContain('id: job-9');
    expect(blocks[1]!.id).toBe('8');
  });
});

describe('HarnessWakeupService', () => {
  let tempDir = '';
  let database: DatabaseContext;
  let workspaceId = '';
  let threadId = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-wakeup-'));
    const databaseUrl = path.join(tempDir, 'test.sqlite');
    runMigrations(databaseUrl);
    database = createDatabase(databaseUrl);
    const workspace = createWorkspaceRecord(database.db, {
      absPath: tempDir,
      label: 'workspace',
    });
    workspaceId = workspace.id;
    const thread = createThreadRecord(database.db, {
      workspaceId,
      title: 'thread',
      providerSessionId: 'provider-session-1',
      approvalMode: 'yolo',
    });
    threadId = thread.id;
  });

  afterEach(async () => {
    database.sqlite.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function makeService(input: {
    client?: WorkerHarnessClient;
    threadService?: ThreadService;
    env?: Record<string, string>;
  } = {}) {
    return new HarnessWakeupService(
      testConfig(input.env),
      database.db,
      input.client ?? fakeHarnessClient(),
      input.threadService ?? fakeThreadService(),
      testLogger(),
    );
  }

  it('reports disabled when the callback base URL is missing', () => {
    const service = new HarnessWakeupService(
      loadRuntimeConfig({
        NODE_ENV: 'test',
        ELAGENTE_HARNESS_BASE_URL: 'https://harness.example',
        INACT_X_APP_KEY: 'harness-key',
      }),
      database.db,
      fakeHarnessClient(),
      fakeThreadService(),
      testLogger(),
    );
    expect(service.enabled()).toBe(false);
  });

  it('registers the notify callback once and persists it', async () => {
    const client = fakeHarnessClient();
    const service = makeService({ client });

    const first = await service.ensureRegistration();
    expect(first.agentId).toBe('42');
    expect(first.callbackUrl).toBe(`${CALLBACK_BASE_URL}/harness-notify/${first.hookToken}`);
    expect(client.registerNotifyCallback).toHaveBeenCalledTimes(1);
    expect(client.registerNotifyCallback).toHaveBeenCalledWith({
      agentId: '42',
      callback: first.callbackUrl,
      secret: first.secret,
    });

    const second = await service.ensureRegistration();
    expect(second.hookToken).toBe(first.hookToken);
    expect(client.registerNotifyCallback).toHaveBeenCalledTimes(1);
  });

  it('includes the user id in the callback URL when configured', async () => {
    const service = makeService({
      env: { REMOTE_CODEX_USER_ID: 'user-1' },
    });
    const registration = await service.ensureRegistration();
    expect(registration.callbackUrl).toBe(
      `${CALLBACK_BASE_URL}/harness-notify/${registration.hookToken}?u=user-1`,
    );
  });

  it('creates a watch for an explicit thread id', async () => {
    const service = makeService();
    const result = await service.watchJob({ jobId: 'job-1', threadId });
    expect(result.notifyTo).toBe('42');
    expect(result.watch.threadId).toBe(threadId);
    expect(getHarnessJobWatchByJobId(database.db, 'job-1')?.status).toBe('pending');
  });

  it('infers the thread id from a single running thread', async () => {
    updateThreadRecord(database.db, threadId, { status: 'running' });
    const service = makeService();
    const result = await service.watchJob({ jobId: 'job-2' });
    expect(result.watch.threadId).toBe(threadId);
  });

  it('rejects a watch when the thread cannot be inferred', async () => {
    const service = makeService();
    await expect(service.watchJob({ jobId: 'job-3' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects callbacks with an unknown hook token', async () => {
    const service = makeService();
    await service.ensureRegistration();
    expect(() =>
      service.handleCallback({
        hookToken: 'wrong-token',
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      }),
    ).toThrowError(HttpError);
  });

  it('rejects callbacks with a bad signature', async () => {
    const service = makeService();
    const registration = await service.ensureRegistration();
    try {
      service.handleCallback({
        hookToken: registration.hookToken,
        rawBody: Buffer.from('{}'),
        signature: 'deadbeef',
      });
      expect.unreachable('expected signature rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(403);
    }
  });

  it('wakes the thread when a watched job reaches a terminal status', async () => {
    const threadService = fakeThreadService();
    const client = fakeHarnessClient({
      getComputeJob: vi.fn(async () => ({
        jobId: 'job-1',
        status: 'done',
        terminal: true,
        title: 'water opt',
        reason: null,
        raw: {},
      })),
    });
    const service = makeService({ client, threadService });
    await service.watchJob({ jobId: 'job-1', threadId });

    const registration = getHarnessNotifyRegistration(database.db)!;
    const body = Buffer.from(
      JSON.stringify({ type: 'notification', id: 7, from: 'jobs', message: 'id: job-1' }),
    );
    const signature = crypto
      .createHmac('sha256', registration.secret)
      .update(body)
      .digest('hex');
    const result = service.handleCallback({
      hookToken: registration.hookToken,
      rawBody: body,
      signature,
    });
    expect(result.accepted).toBe(true);
    await service.waitForReconcile();

    expect(threadService.sendPrompt).toHaveBeenCalledTimes(1);
    const [calledThreadId, promptInput] = (threadService.sendPrompt as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(calledThreadId).toBe(threadId);
    expect(promptInput.prompt).toContain('job-1');
    expect(promptInput.prompt).toContain('done');
    expect(threadService.resumeThread).not.toHaveBeenCalled();
    expect(getHarnessJobWatchByJobId(database.db, 'job-1')?.status).toBe('delivered');
  });

  it('leaves non-terminal jobs pending', async () => {
    const threadService = fakeThreadService();
    const client = fakeHarnessClient({
      getComputeJob: vi.fn(async () => ({
        jobId: 'job-1',
        status: 'running',
        terminal: false,
        title: null,
        reason: null,
        raw: {},
      })),
    });
    const service = makeService({ client, threadService });
    await service.watchJob({ jobId: 'job-1', threadId });

    await service.reconcile();

    expect(threadService.sendPrompt).not.toHaveBeenCalled();
    const watch = getHarnessJobWatchByJobId(database.db, 'job-1');
    expect(watch?.status).toBe('pending');
    expect(watch?.lastJobStatus).toBe('running');
  });

  it('resumes a disconnected thread before waking it', async () => {
    updateThreadRecord(database.db, threadId, { isConnected: false });
    const threadService = fakeThreadService();
    const service = makeService({ threadService });
    await service.watchJob({ jobId: 'job-1', threadId });

    await service.reconcile();

    expect(threadService.resumeThread).toHaveBeenCalledWith(threadId);
    expect(threadService.sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('keeps the watch pending when prompt delivery fails', async () => {
    const threadService = fakeThreadService({
      sendPrompt: vi.fn(async () => {
        throw new HttpError(409, { code: 'conflict', message: 'busy' });
      }),
    });
    const service = makeService({ threadService });
    await service.watchJob({ jobId: 'job-1', threadId });

    await service.reconcile();

    const watch = getHarnessJobWatchByJobId(database.db, 'job-1');
    expect(watch?.status).toBe('pending');
    expect(watch?.lastError).toContain('busy');
  });

  it('acknowledges notifications only for non-pending watches', async () => {
    const client = fakeHarnessClient({
      getComputeJob: vi.fn(async (jobId: string) => ({
        jobId,
        status: jobId === 'job-done' ? 'done' : 'running',
        terminal: jobId === 'job-done',
        title: null,
        reason: null,
        raw: {},
      })),
      listUnreadNotifications: vi.fn(async () => [
        {
          id: '7',
          from: 'jobs',
          message: 'Job "a" finished — status: done\nid: job-done\nGET /compute/jobs/job-done',
        },
        {
          id: '8',
          from: 'jobs',
          message: 'Job "b" finished — status: done\nid: job-running\nGET /compute/jobs/job-running',
        },
        { id: '9', from: 'tasks', message: 'unrelated' },
      ]),
    });
    const service = makeService({ client });
    await service.watchJob({ jobId: 'job-done', threadId });
    await service.watchJob({ jobId: 'job-running', threadId });

    await service.reconcile();

    const markRead = client.markNotificationRead as ReturnType<typeof vi.fn>;
    const readIds = markRead.mock.calls.map((call) => call[0]);
    expect(readIds).toContain('7');
    expect(readIds).not.toContain('8');
    expect(readIds).not.toContain('9');
  });
});

describe('harness wakeup routes (worker mode)', () => {
  let tempDir = '';
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-wakeup-routes-'));
    const codexHome = path.join(tempDir, 'codex-home');
    await fs.mkdir(codexHome, { recursive: true });
    app = buildApp({
      env: {
        NODE_ENV: 'test',
        REMOTE_CODEX_RUNTIME_ROLE: 'worker',
        REMOTE_CODEX_WORKER_AUTH_TOKEN: 'router-secret',
        DATABASE_URL: path.join(tempDir, 'test.sqlite'),
        WORKSPACE_ROOT: tempDir,
        CODEX_HOME: codexHome,
        ELAGENTE_HARNESS_BASE_URL: 'https://harness.example',
        INACT_X_APP_KEY: 'harness-key',
        REMOTE_CODEX_HARNESS_WAKEUP_CALLBACK_BASE_URL: CALLBACK_BASE_URL,
      },
      runtimeBootstrap: {
        agentRuntimes: new AgentRuntimeRegistry([
          new CodexRuntimeAdapter(new FakeCodexManager() as never),
        ]),
        localCodexSessionStore: new LocalCodexSessionStore(codexHome),
        codexManagement: new CodexManagementService(codexHome),
        providerHostHomes: { codex: codexHome },
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function seedRegistration() {
    return upsertHarnessNotifyRegistration(app.services.database.db, {
      agentId: '42',
      hookToken: 'hook-token-1',
      secret: 'hook-secret-1',
      callbackUrl: `${CALLBACK_BASE_URL}/harness-notify/hook-token-1`,
    });
  }

  it('rejects hook callbacks with an unknown token without worker auth', async () => {
    seedRegistration();
    const response = await app.inject({
      method: 'POST',
      url: '/api/hooks/harness-notify/unknown-token',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(response.statusCode).toBe(404);
  });

  it('accepts hook callbacks signed over the raw body bytes', async () => {
    seedRegistration();
    const scheduleReconcile = vi
      .spyOn(app.services.harnessWakeupService, 'scheduleReconcile')
      .mockImplementation(() => undefined);
    // Python json.dumps formatting differs from JSON.stringify output; the
    // signature must verify against these exact bytes, not a re-serialization.
    const rawBody = '{"type": "notification", "id": 7, "from": "jobs", "message": "id: job-1"}';
    const signature = crypto
      .createHmac('sha256', 'hook-secret-1')
      .update(Buffer.from(rawBody))
      .digest('hex');

    const response = await app.inject({
      method: 'POST',
      url: '/api/hooks/harness-notify/hook-token-1',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': signature,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true, type: 'notification' });
    expect(scheduleReconcile).toHaveBeenCalledTimes(1);
  });

  it('rejects hook callbacks with a bad signature', async () => {
    seedRegistration();
    const response = await app.inject({
      method: 'POST',
      url: '/api/hooks/harness-notify/hook-token-1',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'deadbeef',
      },
      payload: '{}',
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows loopback agents to use wakeup routes without a worker token', async () => {
    vi.spyOn(app.services.harnessWakeupService, 'getWakeupInfo').mockResolvedValue({
      enabled: true,
      notifyTo: '42',
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/harness/wakeup',
      remoteAddress: '127.0.0.1',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true, notifyTo: '42' });
  });

  it('rejects non-loopback wakeup route access without a worker token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/harness/wakeup',
      remoteAddress: '10.0.0.5',
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts job watch registrations with a worker token', async () => {
    const watchJob = vi
      .spyOn(app.services.harnessWakeupService, 'watchJob')
      .mockResolvedValue({
        watch: {
          id: 'watch-1',
          jobId: 'job-1',
          threadId: 'thread-1',
          title: null,
          status: 'pending',
          lastJobStatus: null,
          lastError: null,
          createdAt: 'now',
          updatedAt: 'now',
          deliveredAt: null,
        },
        notifyTo: '42',
      });
    const response = await app.inject({
      method: 'POST',
      url: '/api/harness/job-watches',
      remoteAddress: '10.0.0.5',
      headers: {
        'x-remote-codex-worker-token': 'router-secret',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jobId: 'job-1', threadId: 'thread-1' }),
    });
    expect(response.statusCode).toBe(201);
    expect(watchJob).toHaveBeenCalledWith({
      jobId: 'job-1',
      threadId: 'thread-1',
      title: null,
    });
  });
});
