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
    title?: string;
    model?: string;
    includeStateRow?: boolean;
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
            message: 'imported prompt'
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
          options.title ?? 'Imported local session',
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
      turns: []
    });
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
        title: 'Imported writer session',
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
});
