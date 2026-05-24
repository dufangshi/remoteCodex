import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDatabase,
  createThreadRecord,
  createWorkspaceRecord,
  runMigrations,
  seedDefaults,
} from '../../../../packages/db/src/index';
import { SupervisorEventBus } from '../event-bus';
import type {
  ShellBackend,
  ShellBackendAttachOptions,
  ShellBackendCreateInput,
  ShellBackendSession,
} from './shell-backend';
import { ShellServiceError, ShellSessionService } from './shell-session-service';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('ShellSessionService', () => {
  let tempDir = '';
  let databasePath = '';
  let context: ReturnType<typeof createDatabase>;
  let workspacePath = '';
  let service: ShellSessionService;
  let sessionNames: Set<string>;
  let sentInputs: string[];
  let clearHistoryCalls: string[];
  let paneSnapshot = '';
  let resizeCalls: Array<{ sessionName: string; cols: number; rows: number }>;
  let detachCalls = 0;
  let threadId = '';

  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-shell-'));
    databasePath = path.join(tempDir, 'test.sqlite');
    workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });
    vi.stubEnv('REMOTE_CODEX_PACKAGE_ROOT', repoRoot);

    runMigrations(databasePath);
    context = createDatabase(databasePath);
    seedDefaults(context.db);
    sessionNames = new Set<string>();
    sentInputs = [];
    clearHistoryCalls = [];
    paneSnapshot = '$ ';
    resizeCalls = [];
    detachCalls = 0;

    const workspace = createWorkspaceRecord(context.db, {
      absPath: workspacePath,
      label: 'workspace',
    });
    const thread = createThreadRecord(context.db, {
      workspaceId: workspace.id,
      title: 'Shell thread',
      provider: 'codex',
      providerSessionId: 'codex-shell-thread',
      model: 'gpt-5',
      approvalMode: 'yolo',
    });
    threadId = thread.id;

    service = new ShellSessionService(
      context.db,
      new SupervisorEventBus(),
      {
        kind: 'test',
        sessionNameForThread(id: string) {
          return `rcx-${id.slice(0, 8)}`;
        },
        async listSessionNames() {
          return [...sessionNames];
        },
        async hasSession(sessionName: string) {
          return sessionNames.has(sessionName);
        },
        async createSession(input: ShellBackendCreateInput) {
          sessionNames.add(input.sessionId);
        },
        async attach(sessionName: string, options: ShellBackendAttachOptions) {
          resizeCalls.push({
            sessionName,
            cols: options.cols,
            rows: options.rows,
          });
          return {
            session: makeBackendSession(sessionName),
            attachment: {
              dispose() {
                detachCalls += 1;
              },
            },
          };
        },
        async resize(sessionName: string, cols: number, rows: number) {
          resizeCalls.push({ sessionName, cols, rows });
        },
        async sendInput(_sessionName: string, data: string) {
          sentInputs.push(data);
          if (data === '\u000c') {
            paneSnapshot = '$ ';
          }
        },
        async killSession(sessionName: string) {
          sessionNames.delete(sessionName);
        },
        async clear(sessionName: string) {
          clearHistoryCalls.push('clear');
          paneSnapshot = '$ ';
          return makeBackendSession(sessionName);
        },
        async snapshot(sessionName: string) {
          return makeBackendSession(sessionName);
        },
      } satisfies ShellBackend,
    );
  });

  function makeBackendSession(sessionName: string): ShellBackendSession {
    return {
      id: sessionName,
      cwd: workspacePath,
      cols: 120,
      rows: 36,
      snapshot: paneSnapshot,
      runtime: {
        cursorX: 2,
        cursorY: 0,
        panePid: 42,
        currentCommand: 'zsh',
        currentPath: workspacePath,
        paneWidth: 120,
        paneHeight: 36,
        envPrefix: '(base)',
        isCommandRunning: false,
      },
    };
  }

  afterEach(async () => {
    await service.stop();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    context.sqlite.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates a shell explicitly and exposes it as detached', async () => {
    const state = await service.createShellForThread(threadId, {
      cols: 100,
      rows: 30,
      label: 'server',
    });

    expect(state.state).toBe('detached');
    expect(state.shell).toMatchObject({
      threadId,
      label: 'server',
      cwd: workspacePath,
      status: 'detached',
      backend: 'test',
    });
    expect(sessionNames.size).toBe(1);
    expect(sentInputs).toEqual([]);
  });

  it('renames a shell and clears empty labels', async () => {
    const created = await service.createShellForThread(threadId);

    const renamed = await service.updateShell(created.shell!.id, {
      label: 'server',
    });
    expect(renamed.label).toBe('server');

    const state = await service.getThreadShellState(threadId);
    expect(state.shells[0]?.label).toBe('server');

    const cleared = await service.updateShell(created.shell!.id, {
      label: '   ',
    });
    expect(cleared.label).toBeNull();
  });

  it('lets a new viewer take over the shell attachment and keeps the shell alive after detach', async () => {
    const created = await service.createShellForThread(threadId);
    const shellId = created.shell?.id;
    expect(shellId).toBeTruthy();

    const firstAttachment = await service.attachShell(shellId!, {
      cols: 120,
      rows: 36,
      onData: () => {},
    });

    const secondAttachment = await service.attachShell(shellId!, {
      cols: 120,
      rows: 36,
      onData: () => {},
    });

    expect(secondAttachment.viewerId).not.toBe(firstAttachment.viewerId);
    expect(detachCalls).toBe(1);

    await expect(
      service.sendInput(shellId!, firstAttachment.viewerId, 'pwd\n'),
    ).rejects.toMatchObject({
      code: 'invalid_viewer',
    } satisfies Partial<ShellServiceError>);

    await service.sendInput(shellId!, secondAttachment.viewerId, 'pwd\n');
    expect(sentInputs).toContain('pwd\n');
    expect(resizeCalls).toContainEqual({
      sessionName: expect.stringContaining('rcx-'),
      cols: 120,
      rows: 36,
    });

    await service.detachShell(shellId!, secondAttachment.viewerId);
    const stateAfterDetach = await service.getThreadShellState(threadId);

    expect(stateAfterDetach.state).toBe('detached');
    expect(sessionNames.size).toBe(1);
  });

  it('creates another shell for the same thread after one exits', async () => {
    const created = await service.createShellForThread(threadId);
    const shellId = created.shell?.id;
    expect(shellId).toBeTruthy();

    await service.terminateShell(shellId!);
    expect(sessionNames.size).toBe(0);

    const revived = await service.createShellForThread(threadId, {
      cols: 90,
      rows: 28,
    });

    expect(revived.shell?.id).not.toBe(shellId);
    expect(revived.state).toBe('detached');
    expect(sessionNames.size).toBe(1);
    expect(revived.shells).toHaveLength(2);
  });

  it('allows multiple live shells for the same thread', async () => {
    const first = await service.createShellForThread(threadId);
    const second = await service.createShellForThread(threadId);

    expect(first.shell?.id).toBeTruthy();
    expect(second.shell?.id).toBeTruthy();
    expect(second.shell?.id).not.toBe(first.shell?.id);
    expect(second.shells).toHaveLength(2);
    expect(sessionNames.size).toBe(2);
  });

  it('includes cwd, env prefix, and running-state metadata in shell output', async () => {
    const outputSpy = vi.fn();
    const created = await service.createShellForThread(threadId);

    await service.attachShell(created.shell!.id, {
      cols: 120,
      rows: 36,
      onData: outputSpy,
    });

    expect(outputSpy).toHaveBeenCalledWith(
      '$ ',
      expect.objectContaining({
        replace: true,
        cursorX: 2,
        cursorY: 0,
        paneHeight: 36,
        cwdBaseName: path.basename(workspacePath),
        envPrefix: '(base)',
        isCommandRunning: false,
      }),
    );
  });

  it('does not clear shell history when a viewer reattaches', async () => {
    const created = await service.createShellForThread(threadId);
    sentInputs.length = 0;

    await service.attachShell(created.shell!.id, {
      cols: 120,
      rows: 36,
      onData: () => {},
    });

    expect(sentInputs).toEqual([]);
  });

  it('clears shell history and redraws the screen for the attached viewer', async () => {
    const outputSpy = vi.fn();
    const created = await service.createShellForThread(threadId);
    sentInputs.length = 0;
    clearHistoryCalls.length = 0;
    paneSnapshot = '1\n2\n3\n$ ';

    const attachment = await service.attachShell(created.shell!.id, {
      cols: 120,
      rows: 36,
      onData: outputSpy,
    });

    outputSpy.mockClear();
    await service.clearShell(created.shell!.id, attachment.viewerId);

    expect(clearHistoryCalls).toHaveLength(1);
    expect(outputSpy).toHaveBeenCalledWith(
      '$ ',
      expect.objectContaining({ replace: true }),
    );
  });
});
