import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app';
import {
  AgentRuntime,
  AgentRuntimeEvent,
  AgentHistoryItem,
  AgentRuntimeRegistry,
} from '../../../packages/agent-runtime/src/index';
import { CodexRuntimeAdapter, JsonRpcClientError } from '../../../packages/codex/src/index';
import { CodexManagementService } from './codex/codex-management-service';
import { LocalCodexSessionStore } from './codex/local-session-store';
import { FakeCodexManager } from './test/fakeCodexManager';

vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(),
  },
}));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

class FakeClaudeRuntime extends EventEmitter implements AgentRuntime {
  readonly provider = 'claude' as const;
  readonly displayName = 'Claude';
  readonly description = 'Fake Claude runtime';
  readonly capabilities: AgentRuntime['capabilities'] = {
    sessions: { list: true, read: true, resume: true, importLocal: false },
    turns: { start: true, streamInput: false, steer: false, interrupt: true, compact: false },
    branching: { fork: false, hardRollback: false, resumeAt: false, rewindFiles: false },
    controls: {
      planMode: false,
      permissionRequests: false,
      sandboxMode: false,
      performanceMode: false,
      goals: false,
    },
    management: {
      models: true,
      mcpStatus: true,
      skills: false,
      hooks: false,
      hookTrust: false,
      hostConfigFiles: false,
      providerSettings: false,
    },
    usage: { contextWindow: false, tokenUsage: false, costUsd: false },
  };
  readonly managementSchema: AgentRuntime['managementSchema'] = {
    hostConfigFiles: [],
    toolboxItems: [{ action: 'mcp', command: '/mcp', label: 'MCP', panel: 'mcp' }],
    hookCommandTemplates: [],
    providerConfigFormat: 'none',
    mcpConfigFormat: 'none',
    configArchives: false,
    buildRestart: false,
  };
  sessions = new Map<string, any>();
  activeTurnId: string | null = null;

  getStatus(): AgentRuntime['getStatus'] extends () => infer T ? T : never {
    return {
      state: 'ready',
      transport: 'sdk',
      lastStartedAt: new Date().toISOString(),
      lastError: null,
      restartCount: 0,
    };
  }
  async start() {}
  async stop() {}
  async listModels() {
    return [
      {
        id: 'sonnet',
        model: 'sonnet',
        displayName: 'Claude Sonnet',
        description: 'Fake Claude Sonnet',
        isDefault: true,
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Low' },
          { reasoningEffort: 'medium', description: 'Medium' },
          { reasoningEffort: 'high', description: 'High' },
        ],
        defaultReasoningEffort: 'medium',
      },
    ];
  }
  async listSessions() {
    return [...this.sessions.values()].map((session) => ({
      provider: 'claude' as const,
      providerSessionId: session.providerSessionId,
      cwd: session.cwd,
      title: session.title,
      preview: session.preview,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: session.status,
      rawSession: session,
    }));
  }
  async listLoadedSessions() {
    return this.activeTurnId ? [...this.sessions.keys()] : [];
  }
  async readSession(providerSessionId: string) {
    const session = this.sessions.get(providerSessionId);
    if (!session) {
      throw new Error('session missing');
    }
    return session;
  }
  async startSession(input: Parameters<AgentRuntime['startSession']>[0]) {
    const providerSessionId = `claude-session-${this.sessions.size + 1}`;
    const now = new Date().toISOString();
    const session = {
      provider: 'claude' as const,
      providerSessionId,
      cwd: input.cwd,
      title: null,
      preview: null,
      createdAt: now,
      updatedAt: now,
      status: 'idle' as const,
      turns: [],
      rawSession: null,
    };
    this.sessions.set(providerSessionId, session);
    return {
      provider: 'claude' as const,
      providerSessionId,
      model: input.model,
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      session,
      rawSession: session,
    };
  }
  async resumeSession(input: Parameters<AgentRuntime['resumeSession']>[0]) {
    const session = await this.readSession(input.providerSessionId);
    return {
      provider: 'claude' as const,
      providerSessionId: input.providerSessionId,
      model: input.model ?? null,
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      session,
      rawSession: session,
    };
  }
  async startTurn(input: Parameters<AgentRuntime['startTurn']>[0]) {
    const session = await this.readSession(input.providerSessionId);
    const providerTurnId = `claude-turn-${session.turns.length + 1}`;
    const userItem: AgentHistoryItem = {
      id: `${providerTurnId}:user`,
      kind: 'userMessage',
      text: input.prompt,
    };
    const turn = {
      providerTurnId,
      status: 'inProgress' as const,
      error: null,
      items: [userItem],
      rawTurn: null,
    };
    session.turns.push(turn);
    session.status = 'running';
    this.activeTurnId = providerTurnId;
    this.emitRuntimeEvent({
      type: 'turn.started',
      provider: 'claude',
      providerSessionId: input.providerSessionId,
      turn,
    });
    queueMicrotask(() => {
      const agentItem: AgentHistoryItem = {
        id: `${providerTurnId}:assistant`,
        kind: 'agentMessage',
        text: 'Hello from Claude',
      };
      turn.items.push(agentItem);
      this.emitRuntimeEvent({
        type: 'output.delta',
        provider: 'claude',
        providerSessionId: input.providerSessionId,
        providerTurnId,
        itemId: agentItem.id,
        delta: agentItem.text,
      });
    });
    return turn;
  }
  async interruptTurn(input: Parameters<AgentRuntime['interruptTurn']>[0]) {
    const session = await this.readSession(input.providerSessionId);
    const turn = session.turns.find((entry: any) => entry.providerTurnId === input.providerTurnId);
    if (!turn) {
      return null;
    }
    turn.status = 'interrupted';
    session.status = 'interrupted';
    this.activeTurnId = null;
    return turn;
  }
  async listMcpServers() {
    return [
      {
        name: 'docs',
        authStatus: 'unsupported',
        tools: [{ name: 'search', title: 'search', description: 'Search docs' }],
        resourceCount: 0,
        resourceTemplateCount: 0,
      },
    ];
  }
  completeTurn(providerSessionId: string, providerTurnId: string) {
    const session = this.sessions.get(providerSessionId);
    const turn = session?.turns.find((entry: any) => entry.providerTurnId === providerTurnId);
    if (!session || !turn) {
      return;
    }
    turn.status = 'completed';
    session.status = 'idle';
    this.activeTurnId = null;
    this.emitRuntimeEvent({
      type: 'turn.completed',
      provider: 'claude',
      providerSessionId,
      turn,
    });
  }
  private emitRuntimeEvent(event: AgentRuntimeEvent) {
    this.emit('event', event);
  }
}

describe('supervisor api', () => {
  let tempDir = '';
  let codexHome = '';
  let app: ReturnType<typeof buildApp>;
  let fakeCodexManager: FakeCodexManager;
  let fakeClaudeRuntime: FakeClaudeRuntime | null = null;
  let launchBuildRestartCalls = 0;

  function buildTestApp(manager: FakeCodexManager, options: { claudeRuntime?: FakeClaudeRuntime } = {}) {
    const runtimes: AgentRuntime[] = [
      new CodexRuntimeAdapter(manager as any),
    ];
    if (options.claudeRuntime) {
      runtimes.push(options.claudeRuntime);
    }
    return buildApp({
      env: {
        NODE_ENV: 'test',
        APP_NAME: 'Test Supervisor',
        APP_VERSION: '0.1.0-test',
        DATABASE_URL: path.join(tempDir, 'test.sqlite'),
        WORKSPACE_ROOT: tempDir,
        CODEX_HOME: codexHome
      },
      runtimeBootstrap: {
        agentRuntimes: new AgentRuntimeRegistry(runtimes),
        localCodexSessionStore: new LocalCodexSessionStore(codexHome),
        codexManagement: new CodexManagementService(codexHome),
        providerHostHomes: {
          codex: codexHome,
          ...(options.claudeRuntime ? { claude: path.join(tempDir, 'claude-home') } : {}),
        },
      },
      serviceLifecycle: {
        async launchBuildRestart() {
          launchBuildRestartCalls += 1;
          return { pid: 12345 };
        },
      },
    });
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-api-'));
    codexHome = path.join(tempDir, 'codex-home');
    await fs.mkdir(path.join(tempDir, 'workspace'));
    await fs.writeFile(path.join(tempDir, 'workspace', 'README.md'), '# hello');
    await fs.mkdir(path.join(tempDir, 'dev'));
    await fs.mkdir(codexHome, { recursive: true });
    fakeCodexManager = new FakeCodexManager();
    fakeClaudeRuntime = null;
    launchBuildRestartCalls = 0;
    vi.stubEnv('REMOTE_CODEX_PACKAGE_ROOT', repoRoot);

    app = buildTestApp(fakeCodexManager);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
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

  it('restarts the selected agent runtime on demand', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent-runtimes/codex/restart',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: 'codex',
      status: {
        state: 'ready',
        transport: 'stdio',
      },
    });
  });

  it('launches detached provider build and restart on demand', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent-runtimes/codex/build-restart',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'launched',
      pid: 12345,
      message: 'Build and restart launched.',
    });
    expect(launchBuildRestartCalls).toBe(1);
  });

  it('reads editable provider host files from CODEX_HOME', async () => {
    await fs.writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');

    const response = await app.inject({
      method: 'GET',
      url: '/api/config/providers/codex/files/config.toml',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'config.toml',
      exists: true,
      content: 'model = "gpt-5.4"\n',
    });
  });

  it('returns empty content for missing editable provider host files', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/config/providers/codex/files/auth.json',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'auth.json',
      exists: false,
      content: '',
    });
  });

  it('writes editable provider host files under CODEX_HOME', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/providers/codex/files/auth.json',
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

  it('creates and lists provider host config archives', async () => {
    await fs.writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/config/providers/codex/archives',
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
      url: '/api/config/providers/codex/archives',
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toHaveLength(1);
    expect(listResponse.json()[0]).toMatchObject({
      label: 'Known good config',
    });
  });

  it('renames provider host config archives', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/config/providers/codex/archives',
      payload: {
        label: 'Before',
      },
    });
    const archiveId = createResponse.json().id;

    const renameResponse = await app.inject({
      method: 'PATCH',
      url: `/api/config/providers/codex/archives/${archiveId}`,
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

  it('applies provider host config archives and restarts the backend', async () => {
    await fs.writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');
    await fs.writeFile(path.join(codexHome, 'auth.json'), '{"token":"old"}\n', 'utf8');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/config/providers/codex/archives',
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
      url: `/api/config/providers/codex/archives/${archiveId}/apply`,
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

  it('returns and saves workspace settings', async () => {
    const initialResponse = await app.inject({
      method: 'GET',
      url: '/api/config/workspace-settings',
    });

    expect(initialResponse.statusCode).toBe(200);
    expect(initialResponse.json()).toMatchObject({
      workspaceRoot: await fs.realpath(tempDir),
      devHome: await fs.realpath(tempDir),
    });

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: '/api/config/workspace-settings',
      payload: {
        devHome: `${path.join(tempDir, 'dev')}/`,
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      workspaceRoot: await fs.realpath(tempDir),
      devHome: await fs.realpath(path.join(tempDir, 'dev')),
    });
  });

  it('rejects workspace dev home outside workspace root', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-dev-home-'));

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/workspace-settings',
      payload: {
        devHome: outsideDir,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'forbidden',
    });

    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('creates one missing workspace directory under dev home', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/config/workspace-settings',
      payload: {
        devHome: path.join(tempDir, 'dev'),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'dev', 'new-project'),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      label: 'new-project',
      absPath: await fs.realpath(path.join(tempDir, 'dev', 'new-project')),
    });
  });

  it('rejects an existing git clone target without overwrite', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/config/workspace-settings',
      payload: {
        devHome: path.join(tempDir, 'dev'),
      },
    });
    await fs.mkdir(path.join(tempDir, 'dev', 'demo'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        gitUrl: 'https://github.com/example/demo.git',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'conflict',
    });
  });

  it('clones a git repository into dev home and creates a workspace', async () => {
    const remoteRepo = path.join(tempDir, 'remote.git');
    const sourceRepo = path.join(tempDir, 'source');
    await fs.mkdir(sourceRepo);
    await fs.writeFile(path.join(sourceRepo, 'README.md'), '# cloned');

    async function runGit(args: string[], cwd: string) {
      const { spawn } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        const child = spawn('git', args, { cwd, stdio: 'ignore' });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`git ${args.join(' ')} failed with ${code}`));
        });
      });
    }

    await runGit(['init'], sourceRepo);
    await runGit(['config', 'user.email', 'test@example.com'], sourceRepo);
    await runGit(['config', 'user.name', 'Test User'], sourceRepo);
    await runGit(['add', 'README.md'], sourceRepo);
    await runGit(['commit', '-m', 'initial'], sourceRepo);
    await runGit(['clone', '--bare', sourceRepo, remoteRepo], tempDir);

    await app.inject({
      method: 'PATCH',
      url: '/api/config/workspace-settings',
      payload: {
        devHome: path.join(tempDir, 'dev'),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        gitUrl: remoteRepo,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      label: 'remote',
      absPath: await fs.realpath(path.join(tempDir, 'dev', 'remote')),
    });
    await expect(fs.readFile(path.join(tempDir, 'dev', 'remote', 'README.md'), 'utf8'))
      .resolves.toBe('# cloned');
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

  it('returns a clear unavailable response for an unconfigured backend', async () => {
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
        provider: 'claude',
        model: 'claude-sonnet-4-5',
        approvalMode: 'yolo',
        title: 'Claude Thread'
      }
    });

    expect(createResponse.statusCode).toBe(501);
    expect(createResponse.json()).toMatchObject({
      code: 'service_unavailable',
      message: 'Agent runtime provider is not configured: claude',
    });
  });

  it('registers Claude as a backend when configured', async () => {
    await app.close();
    fakeClaudeRuntime = new FakeClaudeRuntime();
    app = buildTestApp(fakeCodexManager, { claudeRuntime: fakeClaudeRuntime });
    await app.ready();

    const statusResponse = await app.inject({
      method: 'GET',
      url: '/api/agent-runtimes/claude/status',
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      provider: 'claude',
      displayName: 'Claude',
      status: {
        transport: 'sdk',
      },
      capabilities: {
        turns: {
          start: true,
          steer: false,
          interrupt: true,
        },
        controls: {
          goals: false,
          performanceMode: false,
        },
      },
      managementSchema: {
        providerConfigFormat: 'none',
        mcpConfigFormat: 'none',
      },
    });

    const modelsResponse = await app.inject({
      method: 'GET',
      url: '/api/agent-runtimes/claude/models',
    });
    expect(modelsResponse.statusCode).toBe(200);
    expect(modelsResponse.json()).toEqual([
      expect.objectContaining({
        model: 'sonnet',
        displayName: 'Claude Sonnet',
      }),
    ]);
  });

  it('creates a Claude thread and streams assistant output through runtime events', async () => {
    await app.close();
    fakeClaudeRuntime = new FakeClaudeRuntime();
    app = buildTestApp(fakeCodexManager, { claudeRuntime: fakeClaudeRuntime });
    await app.ready();

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
        provider: 'claude',
        model: 'sonnet',
        approvalMode: 'guarded',
        title: 'Claude Thread'
      }
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      provider: 'claude',
      providerSessionId: 'claude-session-1',
      model: 'sonnet',
      fastMode: false,
    });

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createResponse.json().id}/prompt`,
      payload: {
        prompt: 'Say hello.',
      }
    });
    expect(promptResponse.statusCode).toBe(200);
    expect(promptResponse.json()).toMatchObject({
      provider: 'claude',
      status: 'running',
      activeTurnId: 'claude-turn-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createResponse.json().id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().turns.at(-1)).toMatchObject({
      id: 'claude-turn-1',
      status: 'inProgress',
      items: [
        expect.objectContaining({ kind: 'userMessage', text: 'Say hello.' }),
        expect.objectContaining({ kind: 'agentMessage', text: 'Hello from Claude' }),
      ],
    });

    const runningPromptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createResponse.json().id}/prompt`,
      payload: {
        prompt: 'Second prompt while running.',
      },
    });
    expect(runningPromptResponse.statusCode).toBe(409);
    expect(runningPromptResponse.json()).toMatchObject({
      code: 'conflict',
      message: 'This backend does not support sending input while a turn is running.',
    });

    fakeClaudeRuntime.completeTurn('claude-session-1', 'claude-turn-1');
    const completedDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createResponse.json().id}`,
    });
    expect(completedDetailResponse.json().thread).toMatchObject({
      status: 'idle',
      activeTurnId: null,
    });
    expect(completedDetailResponse.json().turns.at(-1)).toMatchObject({
      status: 'completed',
      model: 'sonnet',
      reasoningEffort: 'medium',
      reasoningEffortAvailable: true,
      items: expect.arrayContaining([
        expect.objectContaining({ kind: 'agentMessage', text: 'Hello from Claude' }),
      ]),
    });
  });

  it('uses thread settings as display metadata when a Claude historical turn id differs from the live id', async () => {
    await app.close();
    fakeClaudeRuntime = new FakeClaudeRuntime();
    app = buildTestApp(fakeCodexManager, { claudeRuntime: fakeClaudeRuntime });
    await app.ready();

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspaceResponse.json().id,
        provider: 'claude',
        model: 'sonnet',
        reasoningEffort: 'high',
        approvalMode: 'guarded',
        title: 'Claude Historical Thread'
      }
    });

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createResponse.json().id}/prompt`,
      payload: {
        prompt: 'Say hello.',
      }
    });
    expect(promptResponse.statusCode).toBe(200);

    const session = fakeClaudeRuntime.sessions.get('claude-session-1');
    session.turns = [
      {
        providerTurnId: 'claude-turn-019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
        startedAt: '2026-05-20T17:03:35.740Z',
        status: 'completed',
        error: null,
        items: [
          {
            id: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
            kind: 'userMessage',
            text: 'Say hello.',
          },
          {
            id: 'assistant-historical',
            kind: 'agentMessage',
            text: 'Hello from Claude history',
          },
        ],
      },
    ];
    fakeClaudeRuntime.completeTurn('claude-session-1', 'claude-turn-1');

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createResponse.json().id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().turns.at(-1)).toMatchObject({
      id: 'claude-turn-019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
      startedAt: '2026-05-20T17:03:35.740Z',
      status: 'completed',
      model: 'sonnet',
      reasoningEffort: 'medium',
      reasoningEffortAvailable: true,
    });
  });

  it('uses local turn metadata time when Claude history lacks a parseable timestamp', async () => {
    await app.close();
    fakeClaudeRuntime = new FakeClaudeRuntime();
    app = buildTestApp(fakeCodexManager, { claudeRuntime: fakeClaudeRuntime });
    await app.ready();

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspaceResponse.json().id,
        provider: 'claude',
        model: 'sonnet',
        approvalMode: 'guarded',
        title: 'Claude Timestamp Thread'
      }
    });
    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createResponse.json().id}/prompt`,
      payload: {
        prompt: 'Say hello.',
      }
    });
    expect(promptResponse.statusCode).toBe(200);

    const liveDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createResponse.json().id}`,
    });
    const liveStartedAt = liveDetailResponse.json().turns.at(-1).startedAt;
    expect(liveStartedAt).toEqual(expect.any(String));

    fakeClaudeRuntime.completeTurn('claude-session-1', 'claude-turn-1');
    const session = fakeClaudeRuntime.sessions.get('claude-session-1');
    session.turns = [
      {
        providerTurnId: 'claude-turn-not-a-v7-id',
        startedAt: null,
        status: 'completed',
        error: null,
        items: [
          {
            id: 'user-not-a-v7-id',
            kind: 'userMessage',
            text: 'Say hello.',
          },
          {
            id: 'assistant-historical',
            kind: 'agentMessage',
            text: 'Hello from Claude history',
          },
        ],
      },
    ];

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createResponse.json().id}`,
    });
    expect(detailResponse.json().turns.at(-1)).toMatchObject({
      id: 'claude-turn-not-a-v7-id',
      startedAt: liveStartedAt,
      status: 'completed',
      model: 'sonnet',
      reasoningEffort: 'medium',
    });
  });

  it('interrupts an active Claude turn', async () => {
    await app.close();
    fakeClaudeRuntime = new FakeClaudeRuntime();
    app = buildTestApp(fakeCodexManager, { claudeRuntime: fakeClaudeRuntime });
    await app.ready();

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: path.join(tempDir, 'workspace')
      }
    });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspaceResponse.json().id,
        provider: 'claude',
        model: 'sonnet',
        approvalMode: 'guarded',
      }
    });
    await app.inject({
      method: 'POST',
      url: `/api/threads/${createResponse.json().id}/prompt`,
      payload: {
        prompt: 'Run until interrupted.',
      }
    });

    const interruptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createResponse.json().id}/interrupt`,
      payload: {
        turnId: 'claude-turn-1',
      },
    });

    expect(interruptResponse.statusCode).toBe(200);
    expect(interruptResponse.json()).toMatchObject({
      provider: 'claude',
      status: 'interrupted',
      activeTurnId: null,
      isLoaded: true,
    });
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
    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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
    expect(fakeCodexManager.readThreadCallCount.get(createdThread.providerSessionId)).toBe(1);

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
    expect(fakeCodexManager.readThreadCallCount.get(createdThread.providerSessionId)).toBe(2);
  });

  it('lists export turn options newest first with prompt previews and exports selected turns as a PDF', async () => {
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
        title: 'Export Thread'
      }
    });

    const createdThread = createResponse.json();
    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
    expect(remoteThread).toBeTruthy();
    remoteThread!.status = { type: 'idle' };
    remoteThread!.turns = Array.from({ length: 12 }, (_, index) => ({
      id: `export-turn-${index + 1}`,
      status: 'completed',
      error: null,
      items: [
        {
          id: `export-user-${index + 1}`,
          type: 'userMessage',
          content: [
            {
              type: 'text',
              text: `Prompt ${index + 1} with enough content to identify the requested export row`
            }
          ]
        },
        {
          id: `export-agent-${index + 1}`,
          type: 'agentMessage',
          content: [{ type: 'text', text: `Answer ${index + 1}` }]
        }
      ]
    })) as any;

    const optionsResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/export-turns`
    });

    expect(optionsResponse.statusCode).toBe(200);
    expect(optionsResponse.json().totalTurnCount).toBe(12);
    expect(optionsResponse.json().turns[0]).toMatchObject({
      turnId: 'export-turn-12',
      turnNumber: 12,
      userPromptPreview: 'Prompt 12 with enough content to identify the requested export row'
    });

    const pdfResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/exports/pdf`,
      payload: {
        mode: 'selected',
        turnIds: ['export-turn-11', 'export-turn-2'],
      }
    });

    expect(pdfResponse.statusCode).toBe(200);
    expect(pdfResponse.headers['content-type']).toContain('application/pdf');
    expect(pdfResponse.headers['content-disposition']).toContain('remote-codex-export-thread');
    expect(pdfResponse.rawPayload.toString('utf8')).toContain('%PDF-1.4');

    const downloadResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/exports/pdf?mode=selected&turnIds=export-turn-11,export-turn-2&includeTokenAndPrice=true&includeCommandOutput=false&includeAbsolutePaths=false`,
    });

    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.headers['content-type']).toContain('application/pdf');
    expect(downloadResponse.headers['content-disposition']).toContain('attachment');
    expect(downloadResponse.rawPayload.toString('utf8')).toContain('%PDF-1.4');

    const htmlResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/exports/pdf?format=html&mode=selected&turnIds=export-turn-11,export-turn-2&includeTokenAndPrice=true`,
    });

    expect(htmlResponse.statusCode).toBe(200);
    expect(htmlResponse.headers['content-type']).toContain('text/html');
    expect(htmlResponse.headers['content-disposition']).toContain('.html');
    expect(htmlResponse.rawPayload.toString('utf8')).toContain('<main class="share-shell">');
    expect(htmlResponse.rawPayload.toString('utf8')).toContain('Prompt 2 with enough content');
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
    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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
    expect(fakeCodexManager.readThreadCallCount.get(createdThread.providerSessionId)).toBe(2);

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
        threadId: createdThread.providerSessionId,
        turn: remoteThread!.turns.at(-1),
      }
    });

    const refreshedDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(refreshedDetailResponse.statusCode).toBe(200);
    expect(fakeCodexManager.readThreadCallCount.get(createdThread.providerSessionId)).toBe(3);
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
    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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
    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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
      promptedThread.providerSessionId,
      new JsonRpcClientError(
        `failed to load rollout \`/Users/fonsh/.codex/sessions/2026/04/10/rollout-2026-04-10T15-50-02-${promptedThread.providerSessionId}.jsonl\` for thread ${promptedThread.providerSessionId}: rollout at /Users/fonsh/.codex/sessions/2026/04/10/rollout-2026-04-10T15-50-02-${promptedThread.providerSessionId}.jsonl is empty`,
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

    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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
    const sourceThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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
      createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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

    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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

    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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

    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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
        threadId: createdThread.providerSessionId,
        turnId: firstPromptResponse.json().activeTurnId,
        prompt: 'Follow up while still running',
      }),
    ]);

    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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

    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId);
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
        providerSessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
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
      createdThread.providerSessionId,
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

  it('lists thread hooks and writes project hooks.json entries', async () => {
    const workspacePath = path.join(tempDir, 'workspace');
    fakeCodexManager.hooksEntries = [
      {
        cwd: workspacePath,
        hooks: [
          {
            key: 'hook-1',
            eventName: 'preToolUse',
            handlerType: 'command',
            matcher: 'Bash',
            command: 'node hook.js',
            timeoutSec: 30,
            statusMessage: 'Checking command',
            sourcePath: path.join(workspacePath, '.codex/hooks.json'),
            source: 'project',
            pluginId: null,
            displayOrder: 0,
            enabled: true,
            isManaged: false,
            currentHash: 'hash',
            trustStatus: 'trusted',
          },
          {
            key: 'hook-created',
            eventName: 'preToolUse',
            handlerType: 'command',
            matcher: 'Bash',
            command: 'node -e "console.error(\\"hook ran\\")"',
            timeoutSec: 5,
            statusMessage: 'Testing hook',
            sourcePath: path.join(workspacePath, '.codex/hooks.json'),
            source: 'project',
            pluginId: null,
            displayOrder: 1,
            enabled: true,
            isManaged: false,
            currentHash: 'created-hash',
            trustStatus: 'untrusted',
          },
          {
            key: 'hook-updated',
            eventName: 'postToolUse',
            handlerType: 'command',
            matcher: 'Bash',
            command: 'node -e "console.error(\\"updated hook ran\\")"',
            timeoutSec: 8,
            statusMessage: 'Updated hook',
            sourcePath: path.join(workspacePath, '.codex/hooks.json'),
            source: 'project',
            pluginId: null,
            displayOrder: 2,
            enabled: true,
            isManaged: false,
            currentHash: 'updated-hash',
            trustStatus: 'untrusted',
          },
        ],
        warnings: [],
        errors: [],
      },
    ];

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: workspacePath,
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
        title: 'Hooks Thread',
      },
    });
    const createdThread = createResponse.json();

    const hooksResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/hooks`,
    });

    expect(hooksResponse.statusCode).toBe(200);
    expect(hooksResponse.json()).toMatchObject({
      cwd: workspacePath,
      projectHooksPath: path.join(workspacePath, '.codex/hooks.json'),
      globalHooksPath: path.join(codexHome, 'hooks.json'),
    });
    expect(hooksResponse.json().hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: 'preToolUse',
          matcher: 'Bash',
          command: 'node hook.js',
          source: 'project',
          trustStatus: 'trusted',
        }),
      ]),
    );

    const createHookResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/hooks`,
      payload: {
        scope: 'project',
        eventName: 'preToolUse',
        matcher: 'Bash',
        command: 'node -e "console.error(\\"hook ran\\")"',
        timeoutSec: 5,
        statusMessage: 'Testing hook',
      },
    });

    expect(createHookResponse.statusCode).toBe(200);
    expect(fakeCodexManager.hookTrustCalls).toContainEqual({
      key: 'hook-created',
      trustedHash: 'created-hash',
    });
    expect(createHookResponse.json().hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'hook-created',
          trustStatus: 'trusted',
        }),
      ]),
    );
    await expect(
      fs.readFile(path.join(workspacePath, '.codex/hooks.json'), 'utf8'),
    ).resolves.toBe(
      `${JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'node -e "console.error(\\"hook ran\\")"',
                    timeout: 5,
                    statusMessage: 'Testing hook',
                  },
                ],
                matcher: 'Bash',
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    const updateHookResponse = await app.inject({
      method: 'PUT',
      url: `/api/threads/${createdThread.id}/hooks`,
      payload: {
        scope: 'project',
        eventName: 'postToolUse',
        matcher: 'Bash',
        command: 'node -e "console.error(\\"updated hook ran\\")"',
        timeoutSec: 8,
        statusMessage: 'Updated hook',
        target: {
          scope: 'project',
          eventName: 'preToolUse',
          matcher: 'Bash',
          command: 'node -e "console.error(\\"hook ran\\")"',
          timeoutSec: 5,
          statusMessage: 'Testing hook',
        },
      },
    });

    expect(updateHookResponse.statusCode).toBe(200);
    expect(fakeCodexManager.hookTrustCalls).toContainEqual({
      key: 'hook-updated',
      trustedHash: 'updated-hash',
    });
    await expect(
      fs.readFile(path.join(workspacePath, '.codex/hooks.json'), 'utf8'),
    ).resolves.toBe(
      `${JSON.stringify(
        {
          hooks: {
            PostToolUse: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'node -e "console.error(\\"updated hook ran\\")"',
                    timeout: 8,
                    statusMessage: 'Updated hook',
                  },
                ],
                matcher: 'Bash',
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    const untrustHookResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/hooks/untrust`,
      payload: {
        key: 'hook-updated',
      },
    });

    expect(untrustHookResponse.statusCode).toBe(200);
    expect(fakeCodexManager.hookTrustCalls.at(-1)).toEqual({
      key: 'hook-updated',
      trustedHash: null,
    });
    expect(untrustHookResponse.json().hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'hook-updated',
          trustStatus: 'untrusted',
        }),
      ]),
    );

    const trustHookResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/hooks/trust`,
      payload: {
        key: 'hook-updated',
        currentHash: 'updated-hash',
      },
    });

    expect(trustHookResponse.statusCode).toBe(200);
    expect(fakeCodexManager.hookTrustCalls.at(-1)).toEqual({
      key: 'hook-updated',
      trustedHash: 'updated-hash',
    });
    expect(trustHookResponse.json().hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'hook-updated',
          trustStatus: 'trusted',
        }),
      ]),
    );
  });

  it('falls back to hooks.json when the codex app-server has no hooks/list endpoint', async () => {
    const workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(path.join(workspacePath, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, '.codex/hooks.json'),
      `${JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [
                  {
                    type: 'command',
                    command: 'node project-hook.js',
                    timeout: 12,
                    statusMessage: 'Checking Bash',
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fakeCodexManager.hooksListError = new JsonRpcClientError(
      'endpoint not found: hooks/list',
      'remote_error',
      {
        code: -32601,
      },
    );

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        absPath: workspacePath,
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
        title: 'Hooks Fallback Thread',
      },
    });
    const createdThread = createResponse.json();

    const hooksResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/hooks`,
    });

    expect(hooksResponse.statusCode).toBe(200);
    expect(hooksResponse.json()).toMatchObject({
      cwd: workspacePath,
      warnings: [
        'Codex app-server does not expose hooks/list yet; showing hooks parsed from hooks.json only.',
      ],
      hooks: [
        {
          eventName: 'preToolUse',
          matcher: 'Bash',
          command: 'node project-hook.js',
          timeoutSec: 12,
          statusMessage: 'Checking Bash',
          source: 'project',
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
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
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

    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
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
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
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

    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
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
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    fakeCodexManager.emit('notification', {
      method: 'turn/plan/updated',
      params: {
        threadId: startedThread.providerSessionId,
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
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    fakeCodexManager.emit('notification', {
      method: 'item/started',
      params: {
        threadId: startedThread.providerSessionId,
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
    expect(detailResponse.json().liveItems).toBeNull();
    expect(detailResponse.json().turns.at(-1).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'command-live-1',
          kind: 'commandExecution',
          text: '/bin/bash -lc sleep 20',
          status: 'running',
        }),
      ]),
    );
  });

  it('keeps live command and file change items visible after the turn completes', async () => {
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
        title: 'Persisted Live Items Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Run a command and patch a file.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    fakeCodexManager.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        item: {
          id: 'command-live-1',
          type: 'commandExecution',
          command: 'pnpm test',
          aggregatedOutput: 'tests passed',
          status: 'completed',
        },
      }
    });
    fakeCodexManager.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        item: {
          id: 'file-change-live-1',
          type: 'fileChange',
          status: 'completed',
          changes: [
            {
              diff: ['--- a/src/app.ts', '+++ b/src/app.ts', '@@', '-old', '+new'].join('\n'),
            },
          ],
        },
      }
    });

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'agent-final',
          type: 'agentMessage',
          text: 'Done.',
        },
      ],
    };
    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turn: completedTurn
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().liveItems).toBeNull();
    expect(detailResponse.json().turns.at(-1)).toMatchObject({
      status: 'completed',
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'command-live-1',
          kind: 'commandExecution',
          text: 'pnpm test',
          status: 'completed',
          hasDeferredDetail: true,
        }),
        expect.objectContaining({
          id: 'file-change-live-1',
          kind: 'fileChange',
          previewText: '1 file changed · +1 · -1',
          text: 'src/app.ts',
          status: 'completed',
        }),
      ]),
    });

    const commandDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/items/command-live-1/detail`
    });

    expect(commandDetailResponse.statusCode).toBe(200);
    expect(commandDetailResponse.json().text).toContain('tests passed');
  });

  it('surfaces hook run notifications as timeline history items', async () => {
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
        title: 'Hook Run Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Run a command.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    fakeCodexManager.emit('notification', {
      method: 'hook/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        run: {
          id: 'hook-run-1',
          eventName: 'preToolUse',
          handlerType: 'command',
          executionMode: 'sync',
          scope: 'turn',
          sourcePath: path.join(tempDir, 'workspace/.codex/hooks.json'),
          source: 'project',
          displayOrder: 0,
          status: 'completed',
          statusMessage: 'Checking Bash command',
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 12,
          entries: [
            {
              kind: 'context',
              text: 'Hook printed command details.',
            },
          ],
          systemMessage: 'Hook system message.',
        },
      },
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().liveItems).toBeNull();
    const hookItem = detailResponse
      .json()
      .turns.at(-1)
      .items.find((item: any) => item.id === 'hook:hook-run-1');
    expect(hookItem).toMatchObject({
      id: 'hook:hook-run-1',
      kind: 'hook',
      text: 'PreToolUse hook',
      previewText: 'Checking Bash command',
      status: 'Completed',
      hookEventName: 'preToolUse',
      hookEventLabel: 'PreToolUse',
      hookHandlerType: 'command',
      hookScope: 'turn',
      hookSource: 'project',
      hookStatusMessage: 'Checking Bash command',
      hookOutputEntries: [
        {
          kind: 'context',
          text: 'Hook printed command details.',
        },
        {
          kind: 'warning',
          text: 'Hook system message.',
        },
      ],
    });
    expect(hookItem.detailText).toContain(
      'Hook printed command details.',
    );
    expect(hookItem.detailText).toContain(
      'Hook system message.',
    );
  });

  it('materializes hook prompt XML as a hook timeline item', async () => {
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
        title: 'Hook Prompt Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Reply ok.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'hook-prompt-1',
          type: 'agentMessage',
          text: '<hook_prompt hook_run_id="stop:0:/tmp/demo/.codex/hooks.json">remote-codex hook ran</hook_prompt>',
        },
      ],
    };
    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn],
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turn: completedTurn,
      },
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().turns.at(-1).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'hook',
          text: 'Stop hook',
          hookEventLabel: 'Stop',
          hookOutputEntries: [
            {
              kind: 'warning',
              text: 'remote-codex hook ran',
            },
          ],
        }),
      ]),
    );
    expect(JSON.stringify(detailResponse.json().turns.at(-1).items)).not.toContain(
      '<hook_prompt',
    );
  });

  it('uses persisted command snapshots when final history contains only command placeholders', async () => {
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
        title: 'Command Placeholder Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Run several commands.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    for (const command of [
      { id: 'command-live-1', command: ['pnpm', 'test'], output: 'test suite ok' },
      { id: 'command-live-2', command: 'pnpm build', output: 'build ok' },
    ]) {
      fakeCodexManager.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: startedThread.providerSessionId,
          turnId: activeTurn!.id,
          item: {
            id: command.id,
            type: 'commandExecution',
            command: command.command,
            aggregated_output: command.output,
            status: 'completed',
          },
        }
      });
    }

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'command-live-1',
          type: 'commandExecution',
          command: 'Command',
          aggregatedOutput: null,
          status: 'completed',
        },
        {
          id: 'command-live-2',
          type: 'commandExecution',
          command: 'Command',
          aggregatedOutput: null,
          status: 'completed',
        },
        {
          id: 'agent-final',
          type: 'agentMessage',
          text: 'Done.',
        },
      ],
    };
    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turn: completedTurn
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    const commandItems = detailResponse
      .json()
      .turns.at(-1)
      .items.filter((item: any) => item.kind === 'commandExecution');

    expect(commandItems).toMatchObject([
      {
        id: 'command-live-1',
        text: 'pnpm test',
        hasDeferredDetail: true,
      },
      {
        id: 'command-live-2',
        text: 'pnpm build',
        hasDeferredDetail: true,
      },
    ]);

    const firstCommandDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/items/command-live-1/detail`
    });
    const secondCommandDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/items/command-live-2/detail`
    });

    expect(firstCommandDetailResponse.statusCode).toBe(200);
    expect(firstCommandDetailResponse.json().text).toContain('test suite ok');
    expect(secondCommandDetailResponse.statusCode).toBe(200);
    expect(secondCommandDetailResponse.json().text).toContain('build ok');
  });

  it('preserves persisted command order around materialized agent messages', async () => {
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
        title: 'Interleaved Command Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Run commands with commentary.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    fakeCodexManager.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        item: {
          id: 'command-before-agent',
          type: 'commandExecution',
          command: 'pnpm lint',
          aggregatedOutput: 'lint ok',
          status: 'completed',
        },
      }
    });
    fakeCodexManager.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        itemId: 'agent-mid',
        delta: 'Lint passed, now building.',
      }
    });
    fakeCodexManager.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        item: {
          id: 'command-after-agent',
          type: 'commandExecution',
          command: 'pnpm build',
          aggregatedOutput: 'build ok',
          status: 'completed',
        },
      }
    });

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'agent-mid',
          type: 'agentMessage',
          text: 'Lint passed, now building.',
        },
        {
          id: 'agent-final',
          type: 'agentMessage',
          text: 'Done.',
        },
      ],
    };
    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turn: completedTurn
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    const itemIds = detailResponse
      .json()
      .turns.at(-1)
      .items.map((item: any) => item.id);

    expect(itemIds).toEqual([
      activeTurn!.items[0]!.id,
      'command-before-agent',
      'agent-mid',
      'command-after-agent',
      'agent-final',
    ]);
  });

  it('restores materialized command order when the final history appends commands after agent text', async () => {
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
        title: 'Materialized Command Order Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Run commands, explain, then run more.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    for (const event of [
      {
        method: 'item/completed' as const,
        item: {
          id: 'command-1',
          type: 'commandExecution',
          command: 'pwd',
          aggregatedOutput: '/tmp/demo',
          status: 'completed',
        },
      },
      {
        method: 'item/completed' as const,
        item: {
          id: 'command-2',
          type: 'commandExecution',
          command: 'ls',
          aggregatedOutput: 'package.json',
          status: 'completed',
        },
      },
    ]) {
      fakeCodexManager.emit('notification', {
        method: event.method,
        params: {
          threadId: startedThread.providerSessionId,
          turnId: activeTurn!.id,
          item: event.item,
        }
      });
    }
    fakeCodexManager.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        itemId: 'agent-mid',
        delta: 'I checked the workspace.',
      }
    });
    fakeCodexManager.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        item: {
          id: 'command-3',
          type: 'commandExecution',
          command: 'pnpm test',
          aggregatedOutput: 'tests passed',
          status: 'completed',
        },
      }
    });

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'agent-mid',
          type: 'agentMessage',
          text: 'I checked the workspace.',
        },
        {
          id: 'agent-final',
          type: 'agentMessage',
          text: 'Tests passed.',
        },
        {
          id: 'command-1',
          type: 'commandExecution',
          command: 'pwd',
          aggregatedOutput: '/tmp/demo',
          status: 'completed',
        },
        {
          id: 'command-2',
          type: 'commandExecution',
          command: 'ls',
          aggregatedOutput: 'package.json',
          status: 'completed',
        },
        {
          id: 'command-3',
          type: 'commandExecution',
          command: 'pnpm test',
          aggregatedOutput: 'tests passed',
          status: 'completed',
        },
      ],
    };
    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turn: completedTurn
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    const itemIds = detailResponse
      .json()
      .turns.at(-1)
      .items.map((item: any) => item.id);

    expect(itemIds).toEqual([
      activeTurn!.items[0]!.id,
      'command-1',
      'command-2',
      'agent-mid',
      'command-3',
      'agent-final',
    ]);
  });

  it('keeps live agent messages interleaved with live command batches', async () => {
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
        title: 'Live Interleaved Timeline Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Explain between command batches.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    fakeCodexManager.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        itemId: 'agent-before',
        delta: 'I will run the first batch.',
      }
    });
    for (const command of [
      {
        id: 'command-1',
        type: 'commandExecution',
        command: 'pnpm lint',
        aggregatedOutput: 'lint ok',
        status: 'completed',
      },
      {
        id: 'command-2',
        type: 'commandExecution',
        command: 'pnpm test',
        aggregatedOutput: 'test ok',
        status: 'completed',
      },
    ]) {
      fakeCodexManager.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: startedThread.providerSessionId,
          turnId: activeTurn!.id,
          item: command,
        }
      });
    }
    fakeCodexManager.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        itemId: 'agent-between',
        delta: 'The first batch passed. I will build next.',
      }
    });
    fakeCodexManager.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        item: {
          id: 'command-3',
          type: 'commandExecution',
          command: 'pnpm build',
          aggregatedOutput: 'build ok',
          status: 'completed',
        },
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().liveItems).toBeNull();
    expect(detailResponse.json().turns.at(-1).items.map((item: any) => item.id)).toEqual([
      activeTurn!.items[0]!.id,
      'agent-before',
      'command-1',
      'command-2',
      'agent-between',
      'command-3',
    ]);
  });

  it('keeps live ordering hints after running turn items materialize in readThread', async () => {
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
        title: 'Materialized Active Timeline Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Run a batch, explain, then keep running.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    for (const item of [
      {
        id: 'command-a',
        type: 'commandExecution',
        command: 'pnpm typecheck',
        aggregatedOutput: 'typecheck ok',
        status: 'completed',
      },
      {
        id: 'command-b',
        type: 'commandExecution',
        command: 'pnpm test',
        aggregatedOutput: 'test ok',
        status: 'completed',
      },
    ]) {
      fakeCodexManager.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: startedThread.providerSessionId,
          turnId: activeTurn!.id,
          item,
        }
      });
    }

    fakeCodexManager.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        itemId: 'agent-between',
        delta: 'The first batch passed. I will keep going.',
      }
    });

    fakeCodexManager.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        item: {
          id: 'command-c',
          type: 'commandExecution',
          command: 'pnpm build',
          aggregatedOutput: 'build ok',
          status: 'completed',
        },
      }
    });

    const materializedActiveTurn = {
      ...activeTurn!,
      status: 'inProgress' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'command-a',
          type: 'commandExecution',
          command: 'pnpm typecheck',
          aggregatedOutput: 'typecheck ok',
          status: 'completed',
        },
        {
          id: 'command-b',
          type: 'commandExecution',
          command: 'pnpm test',
          aggregatedOutput: 'test ok',
          status: 'completed',
        },
        {
          id: 'command-c',
          type: 'commandExecution',
          command: 'pnpm build',
          aggregatedOutput: 'build ok',
          status: 'completed',
        },
        {
          id: 'agent-between',
          type: 'agentMessage',
          text: 'The first batch passed. I will keep going.',
        },
      ],
    };
    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'active', activeFlags: [] },
      turns: [...remoteThread!.turns.slice(0, -1), materializedActiveTurn]
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().liveItems).toBeNull();
    expect(
      detailResponse.json().turns.at(-1).items.map((item: any) => item.id),
    ).toEqual([
      activeTurn!.items[0]!.id,
      'command-a',
      'command-b',
      'agent-between',
      'command-c',
    ]);
  });

  it('preserves final-history messages between recorded live command batches', async () => {
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
        title: 'Interleaved Final History Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Run a batch, explain, then run another batch.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    for (const item of [
      {
        id: 'command-a',
        type: 'commandExecution',
        command: 'pnpm typecheck',
        aggregatedOutput: 'typecheck ok',
        status: 'completed',
      },
      {
        id: 'command-b',
        type: 'commandExecution',
        command: 'pnpm test',
        aggregatedOutput: 'test ok',
        status: 'completed',
      },
      {
        id: 'command-c',
        type: 'commandExecution',
        command: 'pnpm build',
        aggregatedOutput: 'build ok',
        status: 'completed',
      },
    ]) {
      fakeCodexManager.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: startedThread.providerSessionId,
          turnId: activeTurn!.id,
          item,
        }
      });
      if (item.id === 'command-b') {
        fakeCodexManager.emit('notification', {
          method: 'item/agentMessage/delta',
          params: {
            threadId: startedThread.providerSessionId,
            turnId: activeTurn!.id,
            itemId: 'agent-between',
            delta: 'First batch is done. I am running the final check.',
          }
        });
      }
    }

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'command-a',
          type: 'commandExecution',
          command: 'pnpm typecheck',
          aggregatedOutput: 'typecheck ok',
          status: 'completed',
        },
        {
          id: 'command-b',
          type: 'commandExecution',
          command: 'pnpm test',
          aggregatedOutput: 'test ok',
          status: 'completed',
        },
        {
          id: 'agent-between',
          type: 'agentMessage',
          text: 'First batch is done. I am running the final check.',
        },
        {
          id: 'command-c',
          type: 'commandExecution',
          command: 'pnpm build',
          aggregatedOutput: 'build ok',
          status: 'completed',
        },
        {
          id: 'agent-final',
          type: 'agentMessage',
          text: 'All checks passed.',
        },
      ],
    };
    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turn: completedTurn
      }
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(
      detailResponse
        .json()
        .turns.at(-1)
        .items.map((item: any) => item.id),
    ).toEqual([
      activeTurn!.items[0]!.id,
      'command-a',
      'command-b',
      'agent-between',
      'command-c',
      'agent-final',
    ]);
  });

  it('restores completed turn item order from persisted live sequence after restart', async () => {
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
        title: 'Persisted Interleaved Timeline Thread'
      }
    });
    const createdThread = createResponse.json();

    const promptResponse = await app.inject({
      method: 'POST',
      url: `/api/threads/${createdThread.id}/prompt`,
      payload: {
        prompt: 'Run two commands, explain, then run the final command.',
      }
    });

    expect(promptResponse.statusCode).toBe(200);
    const startedThread = promptResponse.json();
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
    const activeTurn = remoteThread?.turns.at(-1);
    expect(activeTurn).toBeTruthy();

    for (const command of [
      {
        id: 'command-a',
        type: 'commandExecution',
        command: 'pnpm typecheck',
        aggregatedOutput: 'typecheck ok',
        status: 'completed',
      },
      {
        id: 'command-b',
        type: 'commandExecution',
        command: 'pnpm test',
        aggregatedOutput: 'test ok',
        status: 'completed',
      },
    ]) {
      fakeCodexManager.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: startedThread.providerSessionId,
          turnId: activeTurn!.id,
          item: command,
        }
      });
    }

    fakeCodexManager.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        itemId: 'agent-between',
        delta: 'The first two commands passed. I am building now.',
      }
    });

    fakeCodexManager.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turnId: activeTurn!.id,
        item: {
          id: 'command-c',
          type: 'commandExecution',
          command: 'pnpm build',
          aggregatedOutput: 'build ok',
          status: 'completed',
        },
      }
    });

    const completedTurn = {
      ...activeTurn!,
      status: 'completed' as const,
      items: [
        ...activeTurn!.items,
        {
          id: 'command-a',
          type: 'commandExecution',
          command: 'pnpm typecheck',
          aggregatedOutput: 'typecheck ok',
          status: 'completed',
        },
        {
          id: 'command-b',
          type: 'commandExecution',
          command: 'pnpm test',
          aggregatedOutput: 'test ok',
          status: 'completed',
        },
        {
          id: 'command-c',
          type: 'commandExecution',
          command: 'pnpm build',
          aggregatedOutput: 'build ok',
          status: 'completed',
        },
        {
          id: 'agent-between',
          type: 'agentMessage',
          text: 'The first two commands passed. I am building now.',
        },
        {
          id: 'agent-final',
          type: 'agentMessage',
          text: 'All checks passed.',
        },
      ],
    };
    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
        turn: completedTurn
      }
    });

    await app.close();

    const restartedCodexManager = new FakeCodexManager();
    restartedCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    restartedCodexManager.loadedThreadIds.add(startedThread.providerSessionId);
    fakeCodexManager = restartedCodexManager;
    app = buildTestApp(fakeCodexManager);
    await app.ready();

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(
      detailResponse
        .json()
        .turns.at(-1)
        .items.map((item: any) => item.id),
    ).toEqual([
      activeTurn!.items[0]!.id,
      'command-a',
      'command-b',
      'agent-between',
      'command-c',
      'agent-final',
    ]);
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
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
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

    fakeCodexManager.threads.set(startedThread.providerSessionId, {
      ...remoteThread!,
      status: { type: 'idle' },
      turns: [...remoteThread!.turns.slice(0, -1), completedTurn]
    });
    fakeCodexManager.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: startedThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
        threadId: createdThread.providerSessionId,
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
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
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

    fakeCodexManager.threads.set(startedThread.providerSessionId, {
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
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
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

    fakeCodexManager.threads.set(startedThread.providerSessionId, {
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
    const remoteThread = fakeCodexManager.threads.get(startedThread.providerSessionId);
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

    fakeCodexManager.threads.set(startedThread.providerSessionId, {
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
      threadId: createdThread.providerSessionId,
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
    expect(fakeCodexManager.goalClearCalls).toContain(createdThread.providerSessionId);
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

    const runningRecord = fakeCodexManager.threads.get(createdThread.providerSessionId);
    const activeTurnId = runningRecord?.turns.at(-1)?.id;
    if (!activeTurnId) {
      throw new Error('Expected fake Codex manager to start a turn.');
    }
    const activeGoal = fakeCodexManager.goals.get(createdThread.providerSessionId)!;
    fakeCodexManager.emitServerEvent({
      method: 'thread/goal/updated',
      params: {
        threadId: createdThread.providerSessionId,
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
      localGoalId: expect.any(String),
    });
    expect(runningDetailResponse.json().goal.createdAt).toBe(
      runningDetailResponse.json().goalHistory[0].createdAt,
    );
    expect(runningDetailResponse.json().goalHistory).toEqual([
      expect.objectContaining({
        objective: 'Keep working until all checklist items are done.',
        status: 'active',
        completedAt: null,
      })
    ]);

    fakeCodexManager.completeTurn(createdThread.providerSessionId, activeTurnId, 'completed');
    fakeCodexManager.goals.set(createdThread.providerSessionId, {
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
      ...fakeCodexManager.goals.get(createdThread.providerSessionId)!,
      status: 'complete',
      createdAt: Date.parse(completedCreatedAt),
      updatedAt: Date.now(),
    };
    fakeCodexManager.emitServerEvent({
      method: 'thread/goal/updated',
      params: {
        threadId: createdThread.providerSessionId,
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

  it('merges a remote goal snapshot with different createdAt into the local goal history', async () => {
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
        title: 'Remote Goal Merge Thread'
      }
    });
    const createdThread = createResponse.json();

    const setResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/goal`,
      payload: {
        objective: 'Keep the goal monitor deduped.',
        status: 'active',
      }
    });
    expect(setResponse.statusCode).toBe(200);
    const localCreatedAt = setResponse.json().goal.createdAt;
    const localGoalId = setResponse.json().goal.localGoalId;

    fakeCodexManager.goals.set(createdThread.providerSessionId, {
      threadId: createdThread.providerSessionId,
      objective: 'Keep the goal monitor deduped.',
      status: 'complete',
      tokenBudget: null,
      tokensUsed: 42000,
      timeUsedSeconds: 180,
      createdAt: Date.parse(localCreatedAt) + 60_000,
      updatedAt: Date.now(),
    });

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/goal`,
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().goal).toMatchObject({
      localGoalId,
      createdAt: localCreatedAt,
      status: 'complete',
      tokensUsed: 42000,
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });
    expect(detailResponse.json().goalHistory).toHaveLength(1);
    expect(detailResponse.json().goalHistory[0]).toMatchObject({
      localGoalId,
      createdAt: localCreatedAt,
      status: 'complete',
      tokensUsed: 42000,
    });
  });

  it('starts a new goal with fresh progress when replacing an active goal', async () => {
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
        title: 'Fresh Goal Progress Thread'
      }
    });
    const createdThread = createResponse.json();

    const firstGoalResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/goal`,
      payload: {
        objective: 'Finish the first task.',
        status: 'active',
      }
    });
    expect(firstGoalResponse.statusCode).toBe(200);
    const firstGoalId = firstGoalResponse.json().goal.localGoalId;
    fakeCodexManager.goals.set(createdThread.providerSessionId, {
      ...fakeCodexManager.goals.get(createdThread.providerSessionId)!,
      tokensUsed: 5_400_000,
      timeUsedSeconds: 15_300,
    });

    const secondGoalResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/goal`,
      payload: {
        objective: 'Start a clean follow-up task.',
        status: 'active',
      }
    });

    expect(secondGoalResponse.statusCode).toBe(200);
    expect(secondGoalResponse.json().goal).toMatchObject({
      objective: 'Start a clean follow-up task.',
      status: 'active',
      tokensUsed: 0,
      timeUsedSeconds: 0,
    });
    expect(secondGoalResponse.json().goal.localGoalId).not.toBe(firstGoalId);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.json().goalHistory).toEqual([
      expect.objectContaining({
        objective: 'Start a clean follow-up task.',
        status: 'active',
        tokensUsed: 0,
        timeUsedSeconds: 0,
      }),
      expect.objectContaining({
        objective: 'Finish the first task.',
        status: 'terminated',
      }),
    ]);

    const fetchGoalResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/goal`,
    });

    expect(fetchGoalResponse.json().goal).toMatchObject({
      objective: 'Start a clean follow-up task.',
      status: 'active',
      tokensUsed: 0,
      timeUsedSeconds: 0,
    });
  });

  it('terminates the active goal locally without inheriting remote completed state', async () => {
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
        title: 'Terminate Goal Thread'
      }
    });
    const createdThread = createResponse.json();

    await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/goal`,
      payload: {
        objective: 'Stop when asked.',
        status: 'active',
      }
    });
    fakeCodexManager.goals.set(createdThread.providerSessionId, {
      ...fakeCodexManager.goals.get(createdThread.providerSessionId)!,
      status: 'complete',
      tokensUsed: 1000,
      timeUsedSeconds: 60,
    });

    const terminateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${createdThread.id}/goal`,
      payload: {
        status: 'terminated',
      }
    });

    expect(terminateResponse.statusCode).toBe(200);
    expect(terminateResponse.json().goal).toMatchObject({
      objective: 'Stop when asked.',
      status: 'terminated',
    });
    expect(fakeCodexManager.goalSetCalls.at(-1)).not.toMatchObject({
      status: 'terminated',
    });

    const fetchGoalResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}/goal`,
    });

    expect(fetchGoalResponse.json().goal).toMatchObject({
      objective: 'Stop when asked.',
      status: 'terminated',
    });
  });

  it('prices token updates for autonomous goal turns started by app-server events', async () => {
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
        approvalMode: 'yolo',
        title: 'Goal Pricing Thread'
      }
    });
    const createdThread = createResponse.json();
    const goalTurnId = '018f0000-0000-7000-8000-000000000123';
    const remoteThread = fakeCodexManager.threads.get(createdThread.providerSessionId)!;
    fakeCodexManager.threads.set(createdThread.providerSessionId, {
      ...remoteThread,
      status: { type: 'active', activeFlags: [] },
      turns: [
        ...remoteThread.turns,
        {
          id: goalTurnId,
          status: 'inProgress',
          error: null,
          items: [],
        } as any,
      ],
    });

    fakeCodexManager.emit('notification', {
      method: 'turn/started',
      params: {
        threadId: createdThread.providerSessionId,
        turn: {
          id: goalTurnId,
          status: 'inProgress',
          error: null,
          items: [],
        },
      },
    });

    fakeCodexManager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: createdThread.providerSessionId,
        turnId: goalTurnId,
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

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/threads/${createdThread.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    const turn = detailResponse.json().turns.find((entry: { id: string }) => entry.id === goalTurnId);
    expect(turn).toMatchObject({
      model: 'gpt-5.4',
      priceEstimate: {
        pricingModelKey: 'gpt-5.4',
        pricingTierKey: 'standard',
        currency: 'USD',
      },
    });
    expect(turn?.priceEstimate?.totalUsd).toBeGreaterThan(0);
  });
});
