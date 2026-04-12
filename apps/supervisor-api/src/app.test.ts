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

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-api-'));
    codexHome = path.join(tempDir, 'codex-home');
    await fs.mkdir(path.join(tempDir, 'workspace'));
    await fs.writeFile(path.join(tempDir, 'workspace', 'README.md'), '# hello');
    await fs.mkdir(codexHome, { recursive: true });
    fakeCodexManager = new FakeCodexManager();

    app = buildApp({
      env: {
        NODE_ENV: 'test',
        APP_NAME: 'Test Supervisor',
        APP_VERSION: '0.1.0-test',
        DATABASE_URL: path.join(tempDir, 'test.sqlite'),
        WORKSPACE_ROOT: tempDir,
        CODEX_HOME: codexHome
      },
      codexManager: fakeCodexManager as any
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
});
