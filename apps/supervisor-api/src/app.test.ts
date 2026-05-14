import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app';
import { JsonRpcClientError } from '../../../packages/codex/src/index';
import { FakeCodexManager } from './test/fakeCodexManager';

describe('supervisor api', () => {
  let tempDir = '';
  let codexHome = '';
  let app: ReturnType<typeof buildApp>;
  let fakeCodexManager: FakeCodexManager;
  let launchBuildRestartCalls = 0;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-api-'));
    codexHome = path.join(tempDir, 'codex-home');
    await fs.mkdir(path.join(tempDir, 'workspace'));
    await fs.writeFile(path.join(tempDir, 'workspace', 'README.md'), '# hello');
    await fs.mkdir(codexHome, { recursive: true });
    fakeCodexManager = new FakeCodexManager();
    launchBuildRestartCalls = 0;

    app = buildApp({
      env: {
        NODE_ENV: 'test',
        APP_NAME: 'Test Supervisor',
        APP_VERSION: '0.1.0-test',
        DATABASE_URL: path.join(tempDir, 'test.sqlite'),
        WORKSPACE_ROOT: tempDir,
        CODEX_HOME: codexHome
      },
      codexManager: fakeCodexManager as any,
      serviceLifecycle: {
        async launchBuildRestart() {
          launchBuildRestartCalls += 1;
          return { pid: 12345 };
        },
      },
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createLocalCodexFixture(options: {
    sessionId: string;
    cwd: string;
    title?: string | null;
    model?: string;
    includeStateRow?: boolean;
    prompt?: string;
  }) {
    const sessionsDir = path.join(codexHome, 'sessions', '2026', '04', '10');
    await fs.mkdir(sessionsDir, { recursive: true });
    const transcriptPath = path.join(
      sessionsDir,
      `rollout-2026-04-10T00-00-00-${options.sessionId}.jsonl`
    );

    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-10T00:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: options.sessionId,
            cwd: options.cwd
          }
        }),
        JSON.stringify({
          timestamp: '2026-04-10T00:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'task_started',
            turn_id: 'turn-imported-1'
          }
        }),
        JSON.stringify({
          timestamp: '2026-04-10T00:00:02.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: options.prompt ?? 'imported prompt'
          }
        }),
        JSON.stringify({
          timestamp: '2026-04-10T00:00:03.000Z',
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            message: 'imported reply',
            phase: 'final_answer'
          }
        }),
        JSON.stringify({
          timestamp: '2026-04-10T00:00:04.000Z',
          type: 'event_msg',
          payload: {
            type: 'task_complete',
            turn_id: 'turn-imported-1',
            last_agent_message: 'imported reply'
          }
        })
      ].join('\n')
    );

    if (options.includeStateRow !== false) {
      const sqlite = new Database(path.join(codexHome, 'state_1.sqlite'));
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS threads (
          id TEXT PRIMARY KEY,
          cwd TEXT NOT NULL,
          title TEXT,
          rollout_path TEXT,
          model TEXT
        );
      `);
      sqlite
        .prepare(
          `
            INSERT INTO threads (id, cwd, title, rollout_path, model)
            VALUES (?, ?, ?, ?, ?)
          `
        )
        .run(
          options.sessionId,
          options.cwd,
          options.title === undefined ? 'Imported local session' : options.title,
          transcriptPath,
          options.model ?? 'gpt-5.4'
        );
      sqlite.close();
    }
  }

  function buildMultipartPayload(options: {
    fields: Record<string, string>;
    files?: Array<{ fieldName: string; fileName: string; contentType: string; content: Buffer }>;
  }) {
    const boundary = `----remote-codex-${Date.now()}`;
    const chunks: Buffer[] = [];

    for (const [fieldName, value] of Object.entries(options.fields)) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${value}\r\n`
        )
      );
    }

    for (const file of options.files ?? []) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
        )
      );
      chunks.push(file.content);
      chunks.push(Buffer.from('\r\n'));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));

    return {
      payload: Buffer.concat(chunks),
      boundary
    };
  }

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

  it('restarts the codex app-server on demand', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/codex/restart',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: 'ready',
      transport: 'stdio',
    });
  });

  it('launches detached service build and restart on demand', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/codex/build-restart',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'launched',
      pid: 12345,
      message: 'Build and restart launched.',
    });
    expect(launchBuildRestartCalls).toBe(1);
  });

  it('reads editable codex host files from CODEX_HOME', async () => {
    await fs.writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');

    const response = await app.inject({
      method: 'GET',
      url: '/api/config/codex-files/config.toml',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'config.toml',
      exists: true,
      content: 'model = "gpt-5.4"\n',
    });
  });

  it('returns empty content for missing editable codex host files', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/config/codex-files/auth.json',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'auth.json',
      exists: false,
      content: '',
    });
  });

  it('writes editable codex host files under CODEX_HOME', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/codex-files/auth.json',
      payload: {
        content: '{\n  "token": "secret"\n}\n',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'auth.json',
      exists: true,
      content: '{\n  "token": "secret"\n}\n',
    });
    await expect(fs.readFile(path.join(codexHome, 'auth.json'), 'utf8')).resolves.toBe(
      '{\n  "token": "secret"\n}\n',
    );
  });

  it('creates and lists codex host config archives', async () => {
    await fs.writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/config/codex-archives',
      payload: {
        label: 'Known good config',
      },
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      label: 'Known good config',
      files: {
        'config.toml': { name: 'config.toml', exists: true },
        'auth.json': { name: 'auth.json', exists: false },
      },
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/config/codex-archives',
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toHaveLength(1);
    expect(listResponse.json()[0]).toMatchObject({
      label: 'Known good config',
    });
  });

  it('renames codex host config archives', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/config/codex-archives',
      payload: {
        label: 'Before',
      },
    });
    const archiveId = createResponse.json().id;

    const renameResponse = await app.inject({
      method: 'PATCH',
      url: `/api/config/codex-archives/${archiveId}`,
      payload: {
        label: 'After',
      },
    });

    expect(renameResponse.statusCode).toBe(200);
    expect(renameResponse.json()).toMatchObject({
      id: archiveId,
      label: 'After',
    });
  });

  it('applies codex host config archives and restarts the app-server', async () => {
    await fs.writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');
    await fs.writeFile(path.join(codexHome, 'auth.json'), '{"token":"old"}\n', 'utf8');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/config/codex-archives',
      payload: {
        label: 'Snapshot',
      },
    });
    const archiveId = createResponse.json().id;

    await fs.writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.5"\n', 'utf8');
    await fs.rm(path.join(codexHome, 'auth.json'), { force: true });
    const stopCallsBeforeApply = fakeCodexManager.stopCalls;
    const startCallsBeforeApply = fakeCodexManager.startCalls;

    const applyResponse = await app.inject({
      method: 'POST',
      url: `/api/config/codex-archives/${archiveId}/apply`,
    });

    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json()).toMatchObject({
      archive: {
        id: archiveId,
        label: 'Snapshot',
      },
      status: {
        state: 'ready',
      },
    });
    await expect(fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')).resolves.toBe(
      'model = "gpt-5.4"\n',
    );
    await expect(fs.readFile(path.join(codexHome, 'auth.json'), 'utf8')).resolves.toBe(
      '{"token":"old"}\n',
    );
    expect(fakeCodexManager.stopCalls).toBe(stopCallsBeforeApply + 1);
    expect(fakeCodexManager.startCalls).toBe(startCallsBeforeApply + 1);
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

  it('updates a workspace label', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = createResponse.json();
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.id}`,
      payload: {
        label: 'Renamed Workspace'
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: workspace.id,
      label: 'Renamed Workspace'
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

  it('creates and lists threads', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Integration Thread'
      }
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      title: 'Integration Thread',
      model: 'gpt-5'
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/threads'
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toHaveLength(1);
  });

  it('returns empty detail for a newly created thread before the first prompt', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Bootstrap Thread'
      }
    });

    const createdThread = createResponse.json();
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        title: 'Bootstrap Thread'
      },
      totalTurnCount: 0,
      turns: []
    });
  });

  it('returns only the latest turn page by default and can page earlier turns', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Paged Thread'
      }
    });

    const createdThread = createResponse.json();
    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    expect(remoteThread).toBeTruthy();
    remoteThread!.status = { type: 'idle' };
    remoteThread!.turns = Array.from({ length: 15 }, (_, index) => ({
      id: `turn-${index + 1}`,
      status: 'completed',
      error: null,
      items: [
        {
          id: `item-${index + 1}`,
          type: 'userMessage',
          content: [{ type: 'text', text: `Prompt ${index + 1}` }]
        }
      ]
    })) as any;

    const latestDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(latestDetailResponse.statusCode).toBe(200);
    expect(latestDetailResponse.json()).toMatchObject({
      totalTurnCount: 15,
    });
    expect(latestDetailResponse.json().turns).toHaveLength(10);
    expect(latestDetailResponse.json().turns[0].id).toBe('turn-6');
    expect(latestDetailResponse.json().turns.at(-1).id).toBe('turn-15');

    const earlierDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}?limit=10&beforeTurnId=turn-6`
    });

    expect(earlierDetailResponse.statusCode).toBe(200);
    expect(earlierDetailResponse.json()).toMatchObject({
      totalTurnCount: 15,
    });
    expect(earlierDetailResponse.json().turns).toHaveLength(5);
    expect(earlierDetailResponse.json().turns[0].id).toBe('turn-1');
    expect(earlierDetailResponse.json().turns.at(-1).id).toBe('turn-5');
  });

  it('reuses cached thread detail slices and invalidates the cache when turn history changes', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Cached Detail Thread'
      }
    });

    const createdThread = createResponse.json();
    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    expect(remoteThread).toBeTruthy();
    remoteThread!.status = { type: 'idle' };
    remoteThread!.turns = Array.from({ length: 12 }, (_, index) => ({
      id: `turn-${index + 1}`,
      status: 'completed',
      error: null,
      items: [
        {
          id: `item-${index + 1}`,
          type: 'userMessage',
          content: [{ type: 'text', text: `Prompt ${index + 1}` }]
        }
      ]
    })) as any;

    const latestDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });
    const earlierDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}?limit=10&beforeTurnId=turn-3`
    });

    expect(latestDetailResponse.statusCode).toBe(200);
    expect(earlierDetailResponse.statusCode).toBe(200);
    expect(fakeCodexManager.readThreadCallCount.get(createdThread.codexThreadId)).toBe(1);

    remoteThread!.status = { type: 'active', activeFlags: [] };
    remoteThread!.turns = [
      ...remoteThread!.turns,
      {
        id: 'turn-13',
        status: 'inProgress',
        error: null,
        items: [
          {
            id: 'item-13',
            type: 'userMessage',
            content: [{ type: 'text', text: 'Prompt 13' }]
          }
        ]
      } as any,
    ];
    fakeCodexManager.emit('notification', {
      method: 'turn/started',
      params: {
        threadId: createdThread.codexThreadId,
        turn: remoteThread!.turns.at(-1),
      }
    });

    const refreshedDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(refreshedDetailResponse.statusCode).toBe(200);
    expect(fakeCodexManager.readThreadCallCount.get(createdThread.codexThreadId)).toBe(2);
    expect(refreshedDetailResponse.json().turns.at(-1).id).toBe('turn-13');
  });

  it('preserves multiline content from raw text items', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Text Item Thread'
      }
    });

    const createdThread = createResponse.json();
    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    expect(remoteThread).toBeTruthy();
    remoteThread!.status = { type: 'idle' };
    remoteThread!.turns = [
      {
        id: 'turn-text-1',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'raw-text-1',
            type: 'text',
            text: '.├── README.md├── pyproject.toml',
            content: [
              {
                type: 'text',
                text: ['.', '├── README.md', '├── pyproject.toml'].join('\n'),
              },
            ],
          },
        ],
      } as any,
    ];

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().turns[0].items[0]).toMatchObject({
      kind: 'agentMessage',
      text: ['.', '├── README.md', '├── pyproject.toml'].join('\n'),
    });
  });

  it('returns deferred command details separately from the thread detail payload', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Deferred Command Thread'
      }
    });

    const createdThread = createResponse.json();
    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    expect(remoteThread).toBeTruthy();
    remoteThread!.status = { type: 'idle' };
    remoteThread!.turns = [
      {
        id: 'turn-1',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'command-1',
            type: 'commandExecution',
            command: 'pnpm test',
            aggregatedOutput: 'middle output line\nfinal status: success',
            status: 'completed',
          },
        ],
      } as any,
    ];

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    const commandItem = detailResponse
      .json()
      .turns.at(-1)
      .items.find((item: any) => item.kind === 'commandExecution');

    expect(commandItem).toMatchObject({
      id: 'command-1',
      kind: 'commandExecution',
      text: 'pnpm test',
      detailText: null,
      hasDeferredDetail: true,
      status: 'completed',
    });

    const commandDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/items/command-1/detail`
    });

    expect(commandDetailResponse.statusCode).toBe(200);
    expect(commandDetailResponse.json()).toMatchObject({
      id: 'command-1',
      kind: 'commandExecution',
      title: 'Command Output',
    });
    expect(commandDetailResponse.json().text).toContain('middle output line');
    expect(commandDetailResponse.json().text).toContain('final status: success');
  });

  it('treats an empty rollout read error as a bootstrap transient after the first prompt', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Empty Rollout Thread'
      }
    });

    const createdThread = createResponse.json();
    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'test plan mode'
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const promptedThread = promptResponse.json();
    fakeCodexManager.readThreadErrors.set(
      promptedThread.codexThreadId,
      new JsonRpcClientError(
        `failed to load rollout \`/Users/fonsh/.codex/sessions/2026/04/10/rollout-2026-04-10T15-50-02-${promptedThread.codexThreadId}.jsonl\` for thread ${promptedThread.codexThreadId}: rollout at /Users/fonsh/.codex/sessions/2026/04/10/rollout-2026-04-10T15-50-02-${promptedThread.codexThreadId}.jsonl is empty`,
        'remote_error',
        { code: -32600 }
      )
    );

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        status: 'running',
        summaryText: 'test plan mode'
      },
      turns: []
    });
  });

  it('returns per-turn model metadata for turns started through the supervisor', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Turn Metadata Thread'
      }
    });

    const createdThread = createResponse.json();
    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Record the turn metadata.'
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    expect(remoteThread).toBeTruthy();
    remoteThread!.status = { type: 'idle' };
    remoteThread!.turns = remoteThread!.turns.map((turn) => ({
      ...turn,
      status: 'completed' as const,
    }));

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().turns.at(-1)).toMatchObject({
      model: 'gpt-5',
      reasoningEffort: 'medium',
      reasoningEffortAvailable: true,
    });
  });

  it('forks a thread from a selected turn and returns fork turn options', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Fork Source Thread',
      },
    });

    const createdThread = createResponse.json();
    const sourceThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    expect(sourceThread).toBeTruthy();
    sourceThread!.turns = [
      {
        id: 'turn-1',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'user-1',
            type: 'userMessage',
            content: [{ type: 'text', text: 'First turn' }],
          },
        ],
      },
      {
        id: 'turn-2',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'user-2',
            type: 'userMessage',
            content: [{ type: 'text', text: 'Second turn' }],
          },
        ],
      },
    ];

    const forkTurnsResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/fork-turns`,
    });

    expect(forkTurnsResponse.statusCode).toBe(200);
    expect(forkTurnsResponse.json()).toMatchObject([
      {
        turnIndex: 1,
      },
      {
        turnIndex: 2,
      },
    ]);

    const targetTurnId = forkTurnsResponse.json()[0].turnId;
    const forkResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/fork`,
      payload: {
        mode: 'turn',
        turnId: targetTurnId,
      },
    });

    expect(forkResponse.statusCode).toBe(200);
    expect(fakeCodexManager.forkThreadCalls).toEqual([
      createdThread.codexThreadId,
    ]);
    expect(fakeCodexManager.rollbackThreadCalls).toMatchObject([
      {
        count: 1,
      },
    ]);
    expect(forkResponse.json()).toMatchObject({
      sourceThreadId: createdThread.id,
      sourceTurnId: targetTurnId,
      sourceTurnIndex: 1,
      thread: {
        thread: {
          title: 'Fork Source Thread / fork',
        },
        turns: [
          {
            items: [
              {
                text: 'First turn',
              },
            ],
          },
        ],
      },
    });

    const sourceDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });
    expect(sourceDetailResponse.statusCode).toBe(200);
    expect(sourceDetailResponse.json().activityNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'forkCreated',
          linkedThreadTitle: 'Fork Source Thread / fork',
          turnIndex: 1,
        }),
      ]),
    );
  });

  it('uses the app-server cumulative total minus the turn baseline for per-turn token usage', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5.4',
        approvalMode: 'yolo',
        title: 'Turn Token Usage Thread',
      },
    });

    const createdThread = createResponse.json();
    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Track my token usage.',
      },
    });

    expect(promptResponse.statusCode).toBe(200);

    const initialDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(initialDetailResponse.statusCode).toBe(200);
    const turnId = initialDetailResponse.json().turns.at(-1)?.id;
    expect(typeof turnId).toBe('string');

    fakeCodexManager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId,
        tokenUsage: {
          total: {
            totalTokens: 18240,
            inputTokens: 12000,
            cachedInputTokens: 2000,
            outputTokens: 4240,
            reasoningOutputTokens: 1240,
          },
          last: {
            totalTokens: 2400,
            inputTokens: 1600,
            cachedInputTokens: 200,
            outputTokens: 800,
            reasoningOutputTokens: 320,
          },
          modelContextWindow: 272000,
        },
      },
    });

    fakeCodexManager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId,
        tokenUsage: {
          total: {
            totalTokens: 20540,
            inputTokens: 13600,
            cachedInputTokens: 2200,
            outputTokens: 4940,
            reasoningOutputTokens: 420,
          },
          last: {
            totalTokens: 2300,
            inputTokens: 1600,
            cachedInputTokens: 200,
            outputTokens: 700,
            reasoningOutputTokens: 100,
          },
          modelContextWindow: 272000,
        },
      },
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    const turn = detailResponse.json().turns.at(-1);
    expect(turn).toMatchObject({
      id: turnId,
      tokenUsage: {
        total: {
          totalTokens: 20540,
          inputTokens: 13600,
          cachedInputTokens: 2200,
          outputTokens: 4940,
          reasoningOutputTokens: 420,
        },
        last: {
          totalTokens: 2300,
          inputTokens: 1600,
          cachedInputTokens: 200,
          outputTokens: 700,
          reasoningOutputTokens: 100,
        },
        modelContextWindow: 272000,
      },
      priceEstimate: {
        pricingModelKey: 'gpt-5.4',
        pricingTierKey: 'standard',
        currency: 'USD',
        inputUsd: 0.0285,
        cachedInputUsd: 0.00055,
        outputUsd: 0.0741,
      },
    });
    expect(turn?.priceEstimate?.totalUsd).toBeCloseTo(0.10315, 10);
  });

  it('replaces prior totals when cumulative token usage updates arrive for the same request', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5.4',
        approvalMode: 'yolo',
        title: 'Turn Token Delta Thread',
      },
    });

    const createdThread = createResponse.json();
    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Track my token usage carefully.',
      },
    });

    expect(promptResponse.statusCode).toBe(200);

    const initialDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(initialDetailResponse.statusCode).toBe(200);
    const turnId = initialDetailResponse.json().turns.at(-1)?.id;
    expect(typeof turnId).toBe('string');

    fakeCodexManager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId,
        tokenUsage: {
          total: {
            totalTokens: 12000,
            inputTokens: 10000,
            cachedInputTokens: 8000,
            outputTokens: 2000,
            reasoningOutputTokens: 500,
          },
          last: {
            totalTokens: 1200,
            inputTokens: 1000,
            cachedInputTokens: 800,
            outputTokens: 200,
            reasoningOutputTokens: 50,
          },
          modelContextWindow: 272000,
        },
      },
    });

    fakeCodexManager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId,
        tokenUsage: {
          total: {
            totalTokens: 12800,
            inputTokens: 10600,
            cachedInputTokens: 8400,
            outputTokens: 2200,
            reasoningOutputTokens: 540,
          },
          last: {
            totalTokens: 1600,
            inputTokens: 1300,
            cachedInputTokens: 1000,
            outputTokens: 300,
            reasoningOutputTokens: 80,
          },
          modelContextWindow: 272000,
        },
      },
    });

    fakeCodexManager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId,
        tokenUsage: {
          total: {
            totalTokens: 18000,
            inputTokens: 15000,
            cachedInputTokens: 12000,
            outputTokens: 3000,
            reasoningOutputTokens: 900,
          },
          last: {
            totalTokens: 900,
            inputTokens: 700,
            cachedInputTokens: 500,
            outputTokens: 200,
            reasoningOutputTokens: 30,
          },
          modelContextWindow: 272000,
        },
      },
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    const turn = detailResponse.json().turns.at(-1);
    expect(turn).toMatchObject({
      id: turnId,
      tokenUsage: {
        total: {
          totalTokens: 18000,
          inputTokens: 15000,
          cachedInputTokens: 12000,
          outputTokens: 3000,
          reasoningOutputTokens: 900,
        },
        last: {
          totalTokens: 900,
          inputTokens: 700,
          cachedInputTokens: 500,
          outputTokens: 200,
          reasoningOutputTokens: 30,
        },
        modelContextWindow: 272000,
      },
      priceEstimate: {
        pricingModelKey: 'gpt-5.4',
        pricingTierKey: 'standard',
        currency: 'USD',
        inputUsd: 0.0075,
        cachedInputUsd: 0.003,
        outputUsd: 0.045,
      },
    });
    expect(turn?.priceEstimate?.totalUsd).toBeCloseTo(0.0555, 10);
  });

  it('subtracts the previous turn cumulative total as the new turn baseline', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5.4',
        approvalMode: 'yolo',
        title: 'Turn Token Baseline Thread',
      },
    });

    const createdThread = createResponse.json();

    const firstPromptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'First turn.',
      },
    });

    expect(firstPromptResponse.statusCode).toBe(200);

    let detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });
    const firstTurnId = detailResponse.json().turns.at(-1)?.id;
    expect(typeof firstTurnId).toBe('string');

    fakeCodexManager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: firstTurnId,
        tokenUsage: {
          total: {
            totalTokens: 12000,
            inputTokens: 10000,
            cachedInputTokens: 8000,
            outputTokens: 2000,
            reasoningOutputTokens: 500,
          },
          last: {
            totalTokens: 12000,
            inputTokens: 10000,
            cachedInputTokens: 8000,
            outputTokens: 2000,
            reasoningOutputTokens: 500,
          },
          modelContextWindow: 272000,
        },
      },
    });

    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: createdThread.codexThreadId,
        turn: {
          id: firstTurnId,
          status: 'completed',
          error: null,
          items: [],
        },
      },
    });

    const secondPromptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Second turn.',
      },
    });

    expect(secondPromptResponse.statusCode).toBe(200);

    detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });
    const secondTurnId = detailResponse.json().turns.at(-1)?.id;
    expect(typeof secondTurnId).toBe('string');
    expect(secondTurnId).not.toBe(firstTurnId);

    fakeCodexManager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: secondTurnId,
        tokenUsage: {
          total: {
            totalTokens: 18240,
            inputTokens: 12000,
            cachedInputTokens: 8200,
            outputTokens: 6240,
            reasoningOutputTokens: 1240,
          },
          last: {
            totalTokens: 2400,
            inputTokens: 1600,
            cachedInputTokens: 200,
            outputTokens: 800,
            reasoningOutputTokens: 320,
          },
          modelContextWindow: 272000,
        },
      },
    });

    detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    const secondTurn = detailResponse.json().turns.at(-1);
    expect(secondTurn).toMatchObject({
      id: secondTurnId,
      tokenUsage: {
        total: {
          totalTokens: 6240,
          inputTokens: 2000,
          cachedInputTokens: 200,
          outputTokens: 4240,
          reasoningOutputTokens: 740,
        },
        last: {
          totalTokens: 2400,
          inputTokens: 1600,
          cachedInputTokens: 200,
          outputTokens: 800,
          reasoningOutputTokens: 320,
        },
        modelContextWindow: 272000,
      },
    });
  });

  it('surfaces CLI-aligned context remaining estimates from token usage notifications', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Context Thread',
      },
    });

    const createdThread = createResponse.json();

    const initialDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(initialDetailResponse.statusCode).toBe(200);
    expect(initialDetailResponse.json().thread.contextUsage).toMatchObject({
      availability: 'unavailable',
      remainingPercent: null,
      tokensInContextWindow: null,
      modelContextWindow: null,
    });

    fakeCodexManager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: 'turn-context-1',
        tokenUsage: {
          total: {
            totalTokens: 165200,
            inputTokens: 140000,
            cachedInputTokens: 0,
            outputTokens: 25200,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 165200,
            inputTokens: 140000,
            cachedInputTokens: 0,
            outputTokens: 25200,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 258400,
        },
      },
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().thread.contextUsage).toMatchObject({
      availability: 'available',
      remainingPercent: 38,
      tokensInContextWindow: 165200,
      modelContextWindow: 258400,
    });
  });

  it('stores prompt attachments in the workspace temp directory and rewrites the prompt path', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Attachment Thread'
      }
    });
    const createdThread = createResponse.json();

    const manifest = [
      {
        clientId: 'attachment-1',
        kind: 'file',
        originalName: 'notes.txt',
        placeholder: '[FILE notes.txt]'
      }
    ];
    const multipart = buildMultipartPayload({
      fields: {
        prompt: 'Please inspect [FILE notes.txt]',
        attachmentManifest: JSON.stringify(manifest)
      },
      files: [
        {
          fieldName: 'attachments',
          fileName: 'notes.txt',
          contentType: 'text/plain',
          content: Buffer.from('hello from attachment')
        }
      ]
    });

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: multipart.payload,
      headers: {
        'content-type': `multipart/form-data; boundary=${multipart.boundary}`
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    const latestPrompt =
      (remoteThread?.turns.at(-1) as any)?.items?.[0]?.content?.[0]?.text ?? '';
    expect(latestPrompt).toContain('[FILE ./.temp/threads/');
    expect(latestPrompt).toContain('/notes-');
    expect(latestPrompt).toContain('.txt]');

    const attachmentDir = path.join(tempDir, 'workspace', '.temp', 'threads', createdThread.id);
    const savedFiles = await fs.readdir(attachmentDir);
    expect(savedFiles).toHaveLength(1);
    expect(savedFiles[0]).toMatch(/^notes-[a-z0-9]{8}\.txt$/);
  });

  it('accepts mobile photo uploads even when the browser sends an empty original file name', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Mobile Photo Thread'
      }
    });
    const createdThread = createResponse.json();

    const manifest = [
      {
        clientId: 'attachment-1',
        kind: 'photo',
        originalName: '',
        placeholder: '[PHOTO mobile-photo]'
      }
    ];
    const multipart = buildMultipartPayload({
      fields: {
        prompt: 'Please inspect [PHOTO mobile-photo]',
        attachmentManifest: JSON.stringify(manifest)
      },
      files: [
        {
          fieldName: 'attachments',
          fileName: '',
          contentType: 'image/heic',
          content: Buffer.from('fake-heic')
        }
      ]
    });

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: multipart.payload,
      headers: {
        'content-type': `multipart/form-data; boundary=${multipart.boundary}`
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    const latestPrompt =
      (remoteThread?.turns.at(-1) as any)?.items?.[0]?.content?.[0]?.text ?? '';
    expect(latestPrompt).toContain('[PHOTO ./.temp/threads/');
    expect(latestPrompt).toContain('/photo-');
  });

  it('accepts prompt attachments larger than 1 MB when still under the configured 25 MB limit', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Large Attachment Thread'
      }
    });
    const createdThread = createResponse.json();

    const manifest = [
      {
        clientId: 'attachment-1',
        kind: 'photo',
        originalName: 'camera.jpg',
        placeholder: '[PHOTO camera.jpg]'
      }
    ];
    const multipart = buildMultipartPayload({
      fields: {
        prompt: 'Please inspect [PHOTO camera.jpg]',
        attachmentManifest: JSON.stringify(manifest)
      },
      files: [
        {
          fieldName: 'attachments',
          fileName: 'camera.jpg',
          contentType: 'image/jpeg',
          content: Buffer.alloc(2 * 1024 * 1024, 1)
        }
      ]
    });

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: multipart.payload,
      headers: {
        'content-type': `multipart/form-data; boundary=${multipart.boundary}`
      }
    });

    expect(promptResponse.statusCode).toBe(200);
  });

  it('maps image view history items and serves relative image assets for a thread', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Image History Thread'
      }
    });
    const createdThread = createResponse.json();

    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sot4qkAAAAASUVORK5CYII=',
      'base64'
    );
    const relativeImagePath = `./.temp/threads/${createdThread.id}/preview.png`;
    const absoluteImagePath = path.join(
      tempDir,
      'workspace',
      '.temp',
      'threads',
      createdThread.id,
      'preview.png'
    );
    await fs.mkdir(path.dirname(absoluteImagePath), { recursive: true });
    await fs.writeFile(absoluteImagePath, imageBytes);

    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    expect(remoteThread).toBeTruthy();
    remoteThread!.status = { type: 'idle' };
    remoteThread!.turns = [
      {
        id: 'turn-image-1',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'image-item-1',
            type: 'view_image',
            text: 'Generated preview',
            path: relativeImagePath
          }
        ]
      } as any
    ];

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      turns: [
        {
          items: [
            {
              kind: 'image',
              text: 'Generated preview',
              assetPath: relativeImagePath
            }
          ]
        }
      ]
    });

    const imageResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/assets/image?path=${encodeURIComponent(relativeImagePath)}`
    });

    expect(imageResponse.statusCode).toBe(200);
    expect(imageResponse.headers['content-type']).toContain('image/png');
    expect(Buffer.compare(imageResponse.rawPayload, imageBytes)).toBe(0);
  });

  it('updates a thread title', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Rename Me'
      }
    });

    const createdThread = createResponse.json();
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}`,
      payload: {
        title: 'Renamed Thread'
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: createdThread.id,
      title: 'Renamed Thread'
    });
  });

  it('deletes a thread and removes it from the supervisor registry', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Delete Me'
      }
    });

    const createdThread = createResponse.json();
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/threads/${createdThread.id}`
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      id: createdThread.id
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/threads'
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toHaveLength(0);
  });

  it('deletes a thread temp directory together with supervisor metadata', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Delete Attachment Thread'
      }
    });

    const createdThread = createResponse.json();
    const attachmentDir = path.join(tempDir, 'workspace', '.temp', 'threads', createdThread.id);
    await fs.mkdir(attachmentDir, { recursive: true });
    await fs.writeFile(path.join(attachmentDir, 'notes.txt'), 'hello');

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/threads/${createdThread.id}`
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(await fs.stat(attachmentDir).catch(() => null)).toBeNull();
  });

  it('deletes a workspace and removes its threads from the supervisor registry', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Workspace Thread'
      }
    });

    expect(createResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.id}`
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      id: workspace.id
    });

    const listWorkspacesResponse = await app.inject({
      method: 'GET',
      url: '/api/workspaces'
    });
    const listThreadsResponse = await app.inject({
      method: 'GET',
      url: '/api/threads'
    });

    expect(listWorkspacesResponse.statusCode).toBe(200);
    expect(listWorkspacesResponse.json()).toHaveLength(0);
    expect(listThreadsResponse.statusCode).toBe(200);
    expect(listThreadsResponse.json()).toHaveLength(0);
  });

  it('deletes workspace-scoped temp attachment directories when removing a workspace', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Workspace Attachment Thread'
      }
    });

    const createdThread = createResponse.json();
    const attachmentDir = path.join(tempDir, 'workspace', '.temp', 'threads', createdThread.id);
    await fs.mkdir(attachmentDir, { recursive: true });
    await fs.writeFile(path.join(attachmentDir, 'notes.txt'), 'hello');

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.id}`
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(await fs.stat(attachmentDir).catch(() => null)).toBeNull();
  });

  it('keeps the originally selected model after resume', async () => {
    fakeCodexManager.resumeModel = 'gpt-5.4';

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5.3-codex',
        approvalMode: 'yolo',
        title: 'Resume Model Thread'
      }
    });

    const createdThread = createResponse.json();

    await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'hello'
      }
    });

    const resumeResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/resume`
    });

    expect(resumeResponse.statusCode).toBe(200);
    expect(resumeResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        model: 'gpt-5.3-codex',
        source: 'supervisor'
      }
    });
  });

  it('uses turn steer instead of rejecting prompts while a turn is already running', async () => {
    fakeCodexManager.materializeSteersImmediately = false;

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Steer Thread',
      },
    });

    const createdThread = createResponse.json();
    const firstPromptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Initial request',
      },
    });

    expect(firstPromptResponse.statusCode).toBe(200);

    const steerPromptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Follow up while still running',
        clientRequestId: 'client-steer-1',
      },
    });

    expect(steerPromptResponse.statusCode).toBe(200);
    expect(fakeCodexManager.steerTurnCalls).toEqual([
      expect.objectContaining({
        threadId: createdThread.codexThreadId,
        turnId: firstPromptResponse.json().activeTurnId,
        prompt: 'Follow up while still running',
      }),
    ]);

    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    expect(remoteThread?.turns).toHaveLength(1);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        activeTurnId: firstPromptResponse.json().activeTurnId,
        status: 'running',
      },
      pendingSteers: [
        {
          clientRequestId: 'client-steer-1',
          turnId: firstPromptResponse.json().activeTurnId,
          prompt: 'Follow up while still running',
        },
      ],
    });
  });

  it('disconnects a thread and marks it as not loaded', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5.3-codex',
        approvalMode: 'yolo',
        title: 'Disconnect Thread'
      }
    });

    const createdThread = createResponse.json();

    const disconnectResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/disconnect`
    });

    expect(disconnectResponse.statusCode).toBe(200);
    expect(disconnectResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        isLoaded: false
      }
    });
  });

  it('preserves a saved reasoning effort when a disconnected thread is resumed', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5.3-codex',
        approvalMode: 'yolo',
        title: 'Resume Keeps Reasoning'
      }
    });

    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'hello'
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const remoteThread = fakeCodexManager.threads.get(createdThread.codexThreadId);
    expect(remoteThread).toBeTruthy();
    remoteThread!.status = { type: 'idle' };
    remoteThread!.turns = remoteThread!.turns.map((turn) => ({
      ...turn,
      status: 'completed' as const,
    }));

    const disconnectResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/disconnect`
    });

    expect(disconnectResponse.statusCode).toBe(200);
    expect(disconnectResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        isLoaded: false,
      }
    });

    const settingsResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/settings`,
      payload: {
        reasoningEffort: 'high',
      }
    });

    expect(settingsResponse.statusCode).toBe(200);
    expect(settingsResponse.json()).toMatchObject({
      id: createdThread.id,
      reasoningEffort: 'high',
    });

    fakeCodexManager.resumeReasoningEffort = 'medium';
    const resumeResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/resume`,
      payload: {}
    });

    expect(resumeResponse.statusCode).toBe(200);
    expect(resumeResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        isLoaded: true,
        reasoningEffort: 'high',
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        reasoningEffort: 'high',
      }
    });
  });

  it('imports a local Codex session and reuses transcript history before resume', async () => {
    const importedWorkspace = path.join(tempDir, 'imported-project');
    await fs.mkdir(importedWorkspace);
    const expectedWorkspacePath = await fs.realpath(importedWorkspace);
    await createLocalCodexFixture({
      sessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
      cwd: importedWorkspace,
      title: 'Imported writer session'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/threads/import',
      payload: {
        sessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      thread: {
        codexThreadId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
        source: 'local_codex_import',
        title: 'Imported writer...',
        isLoaded: false
      },
      workspace: {
        absPath: expectedWorkspacePath,
        label: 'imported-project'
      },
      workspacePathStatus: 'present',
      turns: [
        {
          id: 'turn-imported-1',
          status: 'completed',
          items: [
            {
              kind: 'userMessage',
              text: 'imported prompt'
            },
            {
              kind: 'agentMessage',
              text: 'imported reply'
            }
          ]
        }
      ]
    });
  });

  it('persists fast mode via config service_tier and records a timeline activity note', async () => {
    fakeCodexManager.models = [
      {
        ...fakeCodexManager.models[0]!,
        model: 'gpt-5',
        displayName: 'GPT-5',
        description: 'Default model',
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium', description: 'Balanced' },
          { reasoningEffort: 'high', description: 'Deep' },
        ],
        defaultReasoningEffort: 'medium',
      },
      {
        ...fakeCodexManager.models[0]!,
        id: 'model-2',
        model: 'gpt-5-mini',
        displayName: 'GPT-5 Mini',
        description: 'Fast model',
        hidden: false,
        isDefault: false,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fastest' },
          { reasoningEffort: 'medium', description: 'Balanced' },
        ],
        defaultReasoningEffort: 'low',
      },
    ];

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });
    const workspace = workspaceResponse.json();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5.4',
        approvalMode: 'yolo',
        title: 'Fast Mode Thread',
      },
    });
    const createdThread = createResponse.json();
    const baselineStopCalls = fakeCodexManager.stopCalls;
    const baselineStartCalls = fakeCodexManager.startCalls;

    const settingsResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/settings`,
      payload: {
        fastMode: true,
      },
    });

    expect(settingsResponse.statusCode).toBe(200);
    expect(settingsResponse.json()).toMatchObject({
      id: createdThread.id,
      fastMode: true,
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    });
    await expect(fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')).resolves.toContain(
      'service_tier = "fast"',
    );
    expect(fakeCodexManager.stopCalls).toBe(baselineStopCalls);
    expect(fakeCodexManager.startCalls).toBe(baselineStartCalls);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        fastMode: true,
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
      activityNotes: expect.arrayContaining([
        expect.objectContaining({
          kind: 'fastMode',
          text: 'Fast mode on',
        }),
      ]),
    });
    expect(detailResponse.json().activityNotes[0].anchorTurnId).toBeNull();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'fast turn',
      },
    });

    expect(promptResponse.statusCode).toBe(200);
    expect(fakeCodexManager.startTurnCalls.at(-1)).toMatchObject({
      prompt: 'fast turn',
      serviceTier: 'fast',
    });

    const interruptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/interrupt`,
    });

    expect(interruptResponse.statusCode).toBe(200);

    const disableResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/settings`,
      payload: {
        fastMode: false,
      },
    });

    expect(disableResponse.statusCode).toBe(200);
    await expect(fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')).resolves.not.toContain(
      'service_tier = "fast"',
    );

    const detailAfterDisableResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });
    expect(detailAfterDisableResponse.statusCode).toBe(200);
    expect(detailAfterDisableResponse.json().activityNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fastMode',
          text: 'Fast mode off',
          anchorTurnId: promptResponse.json().activeTurnId,
        }),
      ]),
    );

    const secondPromptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'standard turn',
      },
    });

    expect(secondPromptResponse.statusCode).toBe(200);
    expect(fakeCodexManager.startTurnCalls.at(-1)).toMatchObject({
      prompt: 'standard turn',
      serviceTier: null,
    });
  });

  it('rejects enabling fast mode for an unsupported model', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });
    const workspace = workspaceResponse.json();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Unsupported Fast Thread',
      },
    });
    const createdThread = createResponse.json();

    const settingsResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/settings`,
      payload: {
        fastMode: true,
      },
    });

    expect(settingsResponse.statusCode).toBe(400);
    expect(settingsResponse.json()).toMatchObject({
      code: 'bad_request',
      message: 'Current model does not support fast mode.',
    });
  });

  it('calls the codex manager compact action from the compact endpoint', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });
    const workspace = workspaceResponse.json();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Compact Thread',
      },
    });
    const createdThread = createResponse.json();

    const compactResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/compact`,
    });

    expect(compactResponse.statusCode).toBe(200);
    expect(fakeCodexManager.compactThreadCalls).toEqual([
      createdThread.codexThreadId,
    ]);
  });

  it('lists thread skills from the codex manager for the thread workspace', async () => {
    fakeCodexManager.skillsEntries = [
      {
        cwd: path.join(tempDir, 'workspace'),
        skills: [
          {
            name: 'skill-creator',
            description: 'Create or update a Codex skill',
            shortDescription: 'Create or update a Codex skill',
            interface: {
              displayName: 'Skill Creator',
              shortDescription: 'Create or update a Codex skill',
              brandColor: '#111111',
              defaultPrompt: 'Add a new skill.',
            },
            path: path.join(tempDir, 'workspace/.codex/skills/skill-creator/SKILL.md'),
            scope: 'repo',
            enabled: true,
          },
        ],
        errors: [],
      },
    ];

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });
    const workspace = workspaceResponse.json();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Skills Thread',
      },
    });
    const createdThread = createResponse.json();

    const skillsResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/skills`,
    });

    expect(skillsResponse.statusCode).toBe(200);
    expect(skillsResponse.json()).toMatchObject({
      cwd: path.join(tempDir, 'workspace'),
      skills: [
        {
          name: 'skill-creator',
          description: 'Create or update a Codex skill',
          path: path.join(tempDir, 'workspace/.codex/skills/skill-creator/SKILL.md'),
          scope: 'repo',
          enabled: true,
          interface: {
            displayName: 'Skill Creator',
          },
        },
      ],
      errors: [],
    });
  });

  it('lists thread mcp servers from the codex manager', async () => {
    fakeCodexManager.mcpServers = [
      {
        name: 'github',
        authStatus: 'oAuth',
        tools: [
          {
            name: 'search_issues',
            title: 'Search Issues',
            description: 'Find issues',
          },
        ],
        resourceCount: 2,
        resourceTemplateCount: 1,
      },
    ];

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace'),
      },
    });
    const workspace = workspaceResponse.json();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'MCP Thread',
      },
    });
    const createdThread = createResponse.json();

    const mcpResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/mcp-servers`,
    });

    expect(mcpResponse.statusCode).toBe(200);
    expect(mcpResponse.json()).toEqual({
      servers: [
        {
          name: 'github',
          authStatus: 'oAuth',
          tools: [
            {
              name: 'search_issues',
              title: 'Search Issues',
              description: 'Find issues',
            },
          ],
          resourceCount: 2,
          resourceTemplateCount: 1,
        },
      ],
    });
  });

  it('truncates imported auto-derived thread titles to the first fifteen characters', async () => {
    const importedWorkspace = path.join(tempDir, 'imported-project');
    await fs.mkdir(importedWorkspace);
    await createLocalCodexFixture({
      sessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d5',
      cwd: importedWorkspace,
      includeStateRow: false,
      prompt: '12345678901234567890 imported prompt'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/threads/import',
      payload: {
        sessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d5'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      thread: {
        title: '123456789012345...'
      }
    });
  });

  it('prevents duplicate imports of the same local Codex session', async () => {
    const importedWorkspace = path.join(tempDir, 'duplicate-project');
    await fs.mkdir(importedWorkspace);
    await createLocalCodexFixture({
      sessionId: '019d7000-0000-7000-a000-000000000001',
      cwd: importedWorkspace
    });

    const firstImport = await app.inject({
      method: 'POST',
      url: '/api/threads/import',
      payload: {
        sessionId: '019d7000-0000-7000-a000-000000000001'
      }
    });
    const secondImport = await app.inject({
      method: 'POST',
      url: '/api/threads/import',
      payload: {
        sessionId: '019d7000-0000-7000-a000-000000000001'
      }
    });

    expect(secondImport.statusCode).toBe(200);
    expect(secondImport.json().thread.id).toBe(firstImport.json().thread.id);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/threads'
    });

    expect(listResponse.json()).toHaveLength(1);
  });

  it('requires imported threads to resume before accepting a new prompt', async () => {
    const importedWorkspace = path.join(tempDir, 'resume-required-project');
    await fs.mkdir(importedWorkspace);
    const sessionId = '019d7000-0000-7000-a000-000000000002';
    await createLocalCodexFixture({
      sessionId,
      cwd: importedWorkspace
    });

    const importResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/import',
      payload: {
        sessionId
      }
    });

    const importedThread = importResponse.json().thread;
    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${importedThread.id}/prompt`,
      payload: {
        prompt: 'continue'
      }
    });

    expect(promptResponse.statusCode).toBe(409);
    expect(promptResponse.json()).toMatchObject({
      code: 'conflict'
    });
  });

  it('truncates automatic thread titles from the first prompt to the first fifteen characters', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5.4',
        approvalMode: 'yolo'
      }
    });

    const createdThread = createResponse.json();
    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: '12345678901234567890 please keep this short'
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    expect(promptResponse.json()).toMatchObject({
      id: createdThread.id,
      title: '123456789012345...'
    });
  });

  it('falls back to transcript discovery when the local Codex state sqlite is unavailable', async () => {
    const importedWorkspace = path.join(tempDir, 'transcript-only-project');
    await fs.mkdir(importedWorkspace);
    const expectedWorkspacePath = await fs.realpath(importedWorkspace);
    await createLocalCodexFixture({
      sessionId: '019d7000-0000-7000-a000-000000000003',
      cwd: importedWorkspace,
      includeStateRow: false
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/threads/import',
      payload: {
        sessionId: '019d7000-0000-7000-a000-000000000003'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      thread: {
        source: 'local_codex_import'
      },
      workspace: {
        absPath: expectedWorkspacePath
      }
    });
  });

  it('creates a plan decision request after a plan-mode turn completes and can implement it', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Plan Mode Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Plan the next change.',
        collaborationMode: 'plan'
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.codexThreadId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'plan-item-1',
          type: 'plan',
          text: '# Plan\n\n- Inspect the implementation.\n- Apply one focused fix.\n- Verify the result.'
        }
      ]
    };

    fakeCodexManager.threads.set(startedThread.codexThreadId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.codexThreadId,
        turn: completedTurn
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        collaborationMode: 'plan',
        status: 'idle'
      },
      pendingRequests: [
        {
          kind: 'planDecision',
          title: 'Plan ready',
          questions: [
            {
              options: [
                { label: 'Implement' },
                { label: 'Stay in plan mode' }
              ]
            }
          ]
        }
      ]
    });

    const planRequestId = detailResponse.json().pendingRequests[0].id;
    const implementResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/requests/${encodeURIComponent(planRequestId)}/respond`,
      payload: {
        answers: {
          'plan-decision': {
            answers: ['Implement']
          }
        }
      }
    });

    expect(implementResponse.statusCode).toBe(200);
    expect(implementResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        collaborationMode: 'default',
        status: 'running',
        summaryText: 'Implement the approved plan.'
      },
      pendingRequests: []
    });
    expect(implementResponse.json().turns.at(-1)).toMatchObject({
      status: 'inProgress',
      items: [
        {
          kind: 'userMessage',
          text: 'Implement the approved plan.'
        }
      ]
    });
  });

  it('keeps a dismissed plan decision hidden while staying in plan mode', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Plan Mode Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Plan the next change.',
        collaborationMode: 'plan'
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.codexThreadId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'plan-item-1',
          type: 'plan',
          text: '# Plan\n\n- Inspect the implementation.\n- Apply one focused fix.\n- Verify the result.'
        }
      ]
    };

    fakeCodexManager.threads.set(startedThread.codexThreadId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.codexThreadId,
        turn: completedTurn
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });
    const planRequestId = detailResponse.json().pendingRequests[0].id;

    const stayResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/requests/${encodeURIComponent(planRequestId)}/respond`,
      payload: {
        answers: {
          'plan-decision': {
            answers: ['Stay in plan mode']
          }
        }
      }
    });

    expect(stayResponse.statusCode).toBe(200);
    expect(stayResponse.json()).toMatchObject({
      thread: {
        id: createdThread.id,
        collaborationMode: 'plan',
        status: 'idle'
      },
      pendingRequests: []
    });

    const refreshedDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(refreshedDetailResponse.statusCode).toBe(200);
    expect(refreshedDetailResponse.json()).toMatchObject({
      pendingRequests: []
    });
  });

  it('persists the latest live plan in thread detail for refreshes', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Live Plan Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Work through this carefully.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.codexThreadId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    fakeCodexManager.emit('notification', {
      method: 'turn/plan/updated',
      params: {
        threadId: startedThread.codexThreadId,
        turnId: activeTurn!.id,
        explanation: 'Working plan',
        plan: [
          { step: 'Inspect current state', status: 'completed' },
          { step: 'Patch persistence bug', status: 'in_progress' },
        ],
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      livePlan: {
        turnId: activeTurn!.id,
        explanation: 'Working plan',
        plan: [
          { step: 'Inspect current state', status: 'completed' },
          { step: 'Patch persistence bug', status: 'in_progress' },
        ],
      },
    });
  });

  it('persists running command items in thread detail for refreshes', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Live Command Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Run sleep 20.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.codexThreadId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    fakeCodexManager.emit('notification', {
      method: 'item/started',
      params: {
        threadId: startedThread.codexThreadId,
        turnId: activeTurn!.id,
        item: {
          id: 'command-live-1',
          type: 'commandExecution',
          command: '/bin/bash -lc sleep 20',
        },
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      liveItems: {
        turnId: activeTurn!.id,
        items: [
          {
            id: 'command-live-1',
            kind: 'commandExecution',
            text: '/bin/bash -lc sleep 20',
            status: 'running',
          },
        ],
      },
    });
  });

  it('persists answered request notes in thread detail for refreshes', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Plan Mode Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Plan the next change.',
        collaborationMode: 'plan'
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.codexThreadId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'plan-item-1',
          type: 'plan',
          text: '# Plan\n\n- Inspect the implementation.\n- Apply one focused fix.\n- Verify the result.'
        }
      ]
    };

    fakeCodexManager.threads.set(startedThread.codexThreadId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.codexThreadId,
        turn: completedTurn
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });
    const planRequestId = detailResponse.json().pendingRequests[0].id;

    const stayResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/requests/${encodeURIComponent(planRequestId)}/respond`,
      payload: {
        answers: {
          'plan-decision': {
            answers: ['Stay in plan mode']
          }
        }
      }
    });

    expect(stayResponse.statusCode).toBe(200);
    expect(stayResponse.json()).toMatchObject({
      answeredRequestNotes: [
        {
          id: planRequestId,
          turnId: completedTurn.id,
          title: 'Plan ready',
          summaryLines: ['Next step: Stay in plan mode'],
        },
      ],
    });

    const refreshedDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(refreshedDetailResponse.statusCode).toBe(200);
    expect(refreshedDetailResponse.json()).toMatchObject({
      pendingRequests: [],
      answeredRequestNotes: [
        {
          id: planRequestId,
          turnId: completedTurn.id,
          title: 'Plan ready',
          summaryLines: ['Next step: Stay in plan mode'],
        },
      ],
    });
  });

  it('auto-approves allow or deny style tool input requests for yolo threads', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Auto Approval Thread'
      }
    });
    const createdThread = createResponse.json();

    fakeCodexManager.emit('request', {
      id: 77,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: 'turn-1',
        itemId: 'mcp-1',
        questions: [
          {
            id: 'approval',
            header: 'MCP Approval',
            question: 'Allow openaiDeveloperDocs to run?',
            isOther: false,
            isSecret: false,
            options: [
              { label: 'Allow', description: 'Permit this tool call.' },
              { label: 'Deny', description: 'Reject this tool call.' },
            ],
          },
        ],
      },
    });

    expect(fakeCodexManager.serverRequestResponses).toEqual([
      {
        id: 77,
        result: {
          answers: {
            approval: {
              answers: ['Allow'],
            },
          },
        },
      },
    ]);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      pendingRequests: [],
    });
  });

  it('auto-approves command execution approval requests for yolo threads', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Command Approval Thread'
      }
    });
    const createdThread = createResponse.json();

    fakeCodexManager.emit('request', {
      id: 80,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: 'turn-1',
        itemId: 'command-1',
        reason: 'Command requires approval by policy.',
        command: 'rm -rf ./cache',
        cwd: path.join(tempDir, 'workspace'),
      },
    });

    expect(fakeCodexManager.serverRequestResponses).toContainEqual({
      id: 80,
      result: {
        decision: 'accept',
      },
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      pendingRequests: [],
    });
  });

  it('surfaces command execution approval requests for guarded threads', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'guarded',
        title: 'Guarded Command Approval Thread'
      }
    });
    const createdThread = createResponse.json();

    fakeCodexManager.emit('request', {
      id: 81,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: 'turn-1',
        itemId: 'command-1',
        reason: 'Command requires approval by policy.',
        command: 'rm -rf ./cache',
        cwd: path.join(tempDir, 'workspace'),
      },
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      pendingRequests: [
        {
          id: '81',
          title: 'Command approval required',
          description: expect.stringContaining('rm -rf ./cache'),
        },
      ],
    });

    const approvalResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/requests/81/respond`,
      payload: {
        answers: {
          approval: {
            answers: ['Allow'],
          },
        },
      },
    });

    expect(approvalResponse.statusCode).toBe(200);
    expect(fakeCodexManager.serverRequestResponses).toContainEqual({
      id: 81,
      result: {
        decision: 'accept',
      },
    });
  });

  it('auto-approves broader positive MCP authorization prompts for yolo threads', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Broader Auto Approval Thread'
      }
    });
    const createdThread = createResponse.json();

    fakeCodexManager.emit('request', {
      id: 78,
      method: 'item/mcp/requestAuthorization',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: 'turn-1',
        itemId: 'mcp-2',
        questions: [
          {
            id: 'approval',
            header: 'Authorization required',
            question: 'Do you want to let openaiDeveloperDocs access this MCP tool?',
            isOther: false,
            isSecret: false,
            options: [
              { label: 'Yes, once', description: 'Allow this invocation once.' },
              { label: 'No', description: 'Reject this invocation.' },
            ],
          },
        ],
      },
    });

    expect(fakeCodexManager.serverRequestResponses).toContainEqual({
      id: 78,
      result: {
        answers: {
          approval: {
            answers: ['Yes, once'],
          },
        },
      },
    });
  });

  it('auto-approves MCP elicitation approval requests for yolo threads', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'MCP Elicitation Thread'
      }
    });
    const createdThread = createResponse.json();

    fakeCodexManager.emit('request', {
      id: 79,
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: 'turn-1',
        serverName: 'openaiDeveloperDocs',
        mode: 'form',
        message: 'Allow the openaiDeveloperDocs MCP server to run tool "list_api_endpoints"?',
        requestedSchema: {
          type: 'object',
          properties: {},
        },
        _meta: {
          codex_approval_kind: 'mcp_tool_call',
          tool_title: 'List API Endpoints',
          tool_description: 'List all OpenAI API endpoint URLs available in the OpenAPI spec.',
        },
      },
    });

    expect(fakeCodexManager.serverRequestResponses).toContainEqual({
      id: 79,
      result: {
        action: 'accept',
        content: {},
      },
    });
  });

  it('maps web search turn items into dedicated history entries', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Web Search Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Search for the latest release notes.'
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.codexThreadId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'search-item-1',
          type: 'web_search',
          query: 'remote codex release notes',
          action: {
            sources: [
              {
                title: 'Release notes',
                url: 'https://example.com/releases'
              }
            ]
          },
          status: 'completed'
        }
      ]
    };

    fakeCodexManager.threads.set(startedThread.codexThreadId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().turns.at(-1)).toMatchObject({
      status: 'completed',
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: 'webSearch',
          text: 'remote codex release notes',
          previewText: 'remote codex release notes',
          status: 'completed'
        })
      ])
    });
    expect(
      detailResponse
        .json()
        .turns.at(-1)
        .items.find((item: any) => item.kind === 'webSearch').detailText
    ).toContain('https://example.com/releases');
  });

  it('maps file change turn items into compact stats and detail lines', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'File Change Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Apply the requested patch.'
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.codexThreadId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'file-change-1',
          type: 'fileChange',
          status: 'completed',
          changes: [
            {
              diff: ['--- a/src/app.ts', '+++ b/src/app.ts', '@@', '-old', '+new', '+more'].join(
                '\n',
              )
            },
            {
              diff: ['--- a/src/routes.ts', '+++ b/src/routes.ts', '@@', '-a', '-b', '-c', '+d', '+e', '+f', '+g'].join(
                '\n',
              )
            },
            {
              diff: ['--- a/src/ui.tsx', '+++ b/src/ui.tsx', '@@', '+alpha', '+beta', '+gamma'].join(
                '\n',
              )
            }
          ]
        }
      ]
    };

    fakeCodexManager.threads.set(startedThread.codexThreadId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    const fileChangeItem = detailResponse
      .json()
      .turns.at(-1)
      .items.find((item: any) => item.kind === 'fileChange');

    expect(fileChangeItem).toMatchObject({
      kind: 'fileChange',
      previewText: '3 files changed · +9 · -4',
      text: 'src/app.ts, +2 more',
      status: 'completed',
      changedFiles: 3,
      addedLines: 9,
      removedLines: 4
    });
    expect(fileChangeItem.detailText).toContain('src/app.ts (+2 -1)');
    expect(fileChangeItem.detailText).toContain('src/ui.tsx (+3)');
  });

  it('maps context compaction turn items into dedicated history entries', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Context Compaction Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Continue working until context compaction occurs.'
      }
    });

    expect(promptResponse.statusCode).toBe(200);

    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.codexThreadId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'context-item-1',
          type: 'context_compaction',
          text: 'Compressed older tool results into a shorter summary.',
          status: 'completed'
        }
      ]
    };

    fakeCodexManager.threads.set(startedThread.codexThreadId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().turns.at(-1)).toMatchObject({
      status: 'completed',
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: 'contextCompaction',
          text: 'Context compacted',
          detailText: 'Compressed older tool results into a shorter summary.',
          status: 'completed'
        })
      ])
    });
  });

  it('sets, reads, and clears a Codex thread goal', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Goal Thread'
      }
    });
    const createdThread = createResponse.json();

    const setResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/goal`,
      payload: {
        objective: 'Finish the migration and keep tests green.',
        status: 'active',
        tokenBudget: 12000,
      }
    });

    expect(setResponse.statusCode).toBe(200);
    expect(setResponse.json().goal).toMatchObject({
      objective: 'Finish the migration and keep tests green.',
      status: 'active',
      tokenBudget: 12000,
    });
    expect(setResponse.json().goal.createdAt).toMatch(/^20\d\d-/);
    expect(fakeCodexManager.stopCalls).toBeGreaterThan(0);
    expect(fakeCodexManager.startCalls).toBeGreaterThan(0);
    await expect(fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')).resolves.toContain(
      'goals = true',
    );
    expect(fakeCodexManager.goalSetCalls.at(-1)).toMatchObject({
      threadId: createdThread.codexThreadId,
      objective: 'Finish the migration and keep tests green.',
      status: 'active',
      tokenBudget: 12000,
    });

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/goal`
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().goal).toMatchObject({
      objective: 'Finish the migration and keep tests green.',
    });
    const detailWithGoalResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });
    expect(detailWithGoalResponse.json().goalHistory).toEqual([
      expect.objectContaining({
        objective: 'Finish the migration and keep tests green.',
        status: 'active',
        tokenBudget: 12000,
      })
    ]);

    const clearResponse = await app.inject({
      method: 'DELETE',
      url: `/api/threads/${createdThread.id}/goal`
    });

    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.json()).toMatchObject({
      cleared: true,
      goalHistory: [
        expect.objectContaining({
          objective: 'Finish the migration and keep tests green.',
          status: 'terminated',
        })
      ],
    });
    expect(fakeCodexManager.goalClearCalls).toContain(createdThread.codexThreadId);
    const detailAfterClearResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });
    expect(detailAfterClearResponse.json().goalHistory).toEqual([
      expect.objectContaining({
        objective: 'Finish the migration and keep tests green.',
        status: 'terminated',
      })
    ]);
  });

  it('does not mark a goal complete while a turn is still running or duplicate terminal history', async () => {
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });

    const workspace = workspaceResponse.json();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Running Goal Thread'
      }
    });
    const createdThread = createResponse.json();

    const setResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/goal`,
      payload: {
        objective: 'Keep working until all checklist items are done.',
        status: 'active',
      }
    });
    expect(setResponse.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Start a long task.',
      }
    });

    const runningRecord = fakeCodexManager.threads.get(createdThread.codexThreadId);
    const activeTurnId = runningRecord?.turns.at(-1)?.id;
    if (!activeTurnId) {
      throw new Error('Expected fake Codex manager to start a turn.');
    }
    const activeGoal = fakeCodexManager.goals.get(createdThread.codexThreadId)!;
    fakeCodexManager.emitServerEvent({
      method: 'thread/goal/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: activeTurnId,
        goal: {
          ...activeGoal,
          status: 'complete',
          updatedAt: Date.now(),
        },
      },
    });

    const runningDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });
    expect(runningDetailResponse.json().goal).toMatchObject({
      objective: 'Keep working until all checklist items are done.',
      status: 'active',
    });
    expect(runningDetailResponse.json().goalHistory).toEqual([
      expect.objectContaining({
        objective: 'Keep working until all checklist items are done.',
        status: 'active',
        completedAt: null,
      })
    ]);

    fakeCodexManager.completeTurn(createdThread.codexThreadId, activeTurnId, 'completed');
    fakeCodexManager.goals.set(createdThread.codexThreadId, {
      ...activeGoal,
      status: 'complete',
      updatedAt: Date.now(),
    });

    const completeGoalResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/goal`,
      payload: {
        status: 'complete',
      }
    });
    expect(completeGoalResponse.statusCode).toBe(200);
    const completedCreatedAt = completeGoalResponse.json().goal.createdAt;

    const duplicateCompleteGoal = {
      ...fakeCodexManager.goals.get(createdThread.codexThreadId)!,
      status: 'complete',
      createdAt: Date.parse(completedCreatedAt),
      updatedAt: Date.now(),
    };
    fakeCodexManager.emitServerEvent({
      method: 'thread/goal/updated',
      params: {
        threadId: createdThread.codexThreadId,
        turnId: null,
        goal: duplicateCompleteGoal,
      },
    });

    const completedDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });
    expect(completedDetailResponse.json().goalHistory).toEqual([
      expect.objectContaining({
        objective: 'Keep working until all checklist items are done.',
        status: 'complete',
      })
    ]);
    expect(completedDetailResponse.json().goalHistory[0].completedAt).toMatch(/^20\d\d-/);
  });
});
