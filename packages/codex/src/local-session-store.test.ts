import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalCodexSessionStore } from './local-session-store';

describe('LocalCodexSessionStore', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('recovers current response-item rollouts when the state database is corrupt', async () => {
    const codexHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'remote-codex-local-session-'),
    );
    tempDirectories.push(codexHome);
    const sessionId = '01a059bf-c303-79b1-8802-f922d3a81968';
    const workspacePath = path.join(codexHome, 'workspace');
    const sessionsDirectory = path.join(codexHome, 'sessions', '2026', '08', '31');
    await fs.mkdir(sessionsDirectory, { recursive: true });
    await fs.writeFile(
      path.join(codexHome, 'state_5.sqlite'),
      'this is not a valid sqlite database',
    );
    await fs.writeFile(
      path.join(sessionsDirectory, `rollout-${sessionId}.jsonl`),
      [
        {
          timestamp: '2026-08-31T21:36:17.000Z',
          type: 'session_meta',
          payload: { id: sessionId, cwd: workspacePath },
        },
        {
          timestamp: '2026-08-31T21:36:18.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-1' },
        },
        {
          timestamp: '2026-08-31T21:36:19.000Z',
          type: 'response_item',
          payload: {
            id: 'message-user-1',
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'Recover this session.' },
              { type: 'input_image', image_url: 'data:image/png;base64,ignored' },
            ],
          },
        },
        {
          timestamp: '2026-08-31T21:36:24.000Z',
          type: 'response_item',
          payload: {
            id: 'message-agent-1',
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'Recovered.' }],
          },
        },
        {
          timestamp: '2026-08-31T21:36:25.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'turn-1' },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n'),
    );

    const session = await new LocalCodexSessionStore(codexHome).findSession(
      sessionId,
    );

    expect(session).toMatchObject({
      sessionId,
      cwd: workspacePath,
      title: 'Recover this se...',
      turns: [
        {
          id: 'turn-1',
          startedAt: '2026-08-31T21:36:18.000Z',
          status: 'completed',
          items: [
            {
              id: 'message-user-1',
              kind: 'userMessage',
              text: 'Recover this session.',
              createdAt: '2026-08-31T21:36:19.000Z',
            },
            {
              id: 'message-agent-1',
              kind: 'agentMessage',
              text: 'Recovered.',
              createdAt: '2026-08-31T21:36:24.000Z',
            },
          ],
        },
      ],
    });
  });

  it('parses legacy and response-item turns from a session that spans upgrades', async () => {
    const codexHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'remote-codex-mixed-session-'),
    );
    tempDirectories.push(codexHome);
    const sessionId = '01a059bf-c303-79b1-8802-f922d3a81969';
    const workspacePath = path.join(codexHome, 'workspace');
    const sessionsDirectory = path.join(codexHome, 'sessions');
    await fs.mkdir(sessionsDirectory, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDirectory, `rollout-${sessionId}.jsonl`),
      [
        {
          timestamp: '2026-08-30T00:00:00.000Z',
          type: 'session_meta',
          payload: { id: sessionId, cwd: workspacePath },
        },
        {
          timestamp: '2026-08-30T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'legacy-turn' },
        },
        {
          timestamp: '2026-08-30T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Legacy prompt' },
        },
        {
          timestamp: '2026-08-30T00:00:03.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Legacy reply' },
        },
        {
          timestamp: '2026-08-30T00:00:04.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete' },
        },
        {
          timestamp: '2026-08-31T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'modern-turn' },
        },
        {
          timestamp: '2026-08-31T00:00:02.000Z',
          type: 'response_item',
          payload: {
            id: 'modern-user',
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Modern prompt' }],
          },
        },
        {
          timestamp: '2026-08-31T00:00:03.000Z',
          type: 'response_item',
          payload: {
            id: 'modern-agent',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Modern reply' }],
          },
        },
        {
          timestamp: '2026-08-31T00:00:04.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete' },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n'),
    );

    const session = await new LocalCodexSessionStore(codexHome).findSession(
      sessionId,
    );

    expect(session?.turns.map((turn) => turn.items.map((item) => item.text))).toEqual([
      ['Legacy prompt', 'Legacy reply'],
      ['Modern prompt', 'Modern reply'],
    ]);
  });

  it('merges complete paginated tool history with newer rollout-only turns', async () => {
    const codexHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'remote-codex-paginated-session-'),
    );
    tempDirectories.push(codexHome);
    const sessionId = '01a059bf-c303-79b1-8802-f922d3a81970';
    const workspacePath = path.join(codexHome, 'workspace');
    const sessionsDirectory = path.join(codexHome, 'sessions');
    await fs.mkdir(sessionsDirectory, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDirectory, `rollout-${sessionId}.jsonl`),
      [
        {
          timestamp: '2026-08-31T00:00:00.000Z',
          type: 'session_meta',
          payload: { id: sessionId, cwd: workspacePath },
        },
        {
          timestamp: '2026-08-31T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-rich' },
        },
        {
          timestamp: '2026-08-31T00:00:02.000Z',
          type: 'response_item',
          payload: {
            id: 'user-rich',
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Inspect.' }],
          },
        },
        {
          timestamp: '2026-08-31T00:00:03.500Z',
          type: 'response_item',
          payload: {
            id: 'agent-commentary',
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'Running checks.' }],
          },
        },
        {
          timestamp: '2026-08-31T00:00:05.000Z',
          type: 'response_item',
          payload: {
            id: 'agent-rich',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        },
        {
          timestamp: '2026-08-31T00:00:06.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete' },
        },
        {
          timestamp: '2026-08-31T00:01:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-new' },
        },
        {
          timestamp: '2026-08-31T00:01:01.000Z',
          type: 'response_item',
          payload: {
            id: 'user-new',
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Continue.' }],
          },
        },
        {
          timestamp: '2026-08-31T00:01:01.500Z',
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            turn_id: 'turn-new',
            item: {
              id: 'reasoning-empty-new',
              type: 'Reasoning',
              summary_text: [],
              raw_content: [],
            },
          },
        },
        {
          timestamp: '2026-08-31T00:01:02.000Z',
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            turn_id: 'turn-new',
            started_at_ms: 1_788_134_462_000,
            item: {
              id: 'command-new',
              type: 'CommandExecution',
              command: 'git status --short',
              aggregated_output: '',
              status: 'completed',
              exit_code: 0,
            },
          },
        },
      ].map((entry) => JSON.stringify(entry)).join('\n'),
    );

    const sqlite = new Database(path.join(codexHome, 'thread_history_1.sqlite'));
    sqlite.exec(`
      CREATE TABLE thread_turns (
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        rollout_ordinal INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_json TEXT,
        started_at INTEGER,
        PRIMARY KEY (thread_id, turn_id)
      );
      CREATE TABLE thread_items (
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        rollout_ordinal INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        item_type TEXT NOT NULL,
        item_json TEXT NOT NULL,
        PRIMARY KEY (thread_id, turn_id, item_id)
      );
    `);
    sqlite.prepare(
      'INSERT INTO thread_turns VALUES (?, ?, ?, ?, ?, ?)',
    ).run(sessionId, 'turn-rich', 1, 'completed', null, 1_788_134_401);
    const insertItem = sqlite.prepare(
      'INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const rawItems = [
      {
        ordinal: 2,
        createdAtMs: 1_788_134_402_000,
        type: 'userMessage',
        item: {
          id: 'user-rich',
          type: 'userMessage',
          content: [{ type: 'text', text: 'Inspect.' }],
        },
      },
      {
        ordinal: 3,
        createdAtMs: 1_788_134_403_000,
        type: 'reasoning',
        item: {
          id: 'reason-rich',
          type: 'reasoning',
          summary: ['Checking the workspace.'],
        },
      },
      {
        ordinal: 4,
        createdAtMs: 1_788_134_404_000,
        type: 'commandExecution',
        item: {
          id: 'command-rich',
          type: 'commandExecution',
          command: 'pwd',
          aggregatedOutput: workspacePath,
          status: 'completed',
          exitCode: 0,
        },
      },
      {
        ordinal: 5,
        createdAtMs: 1_788_134_405_000,
        type: 'agentMessage',
        item: {
          id: 'agent-rich',
          type: 'agentMessage',
          text: 'Done.',
        },
      },
    ];
    for (const raw of rawItems) {
      insertItem.run(
        sessionId,
        'turn-rich',
        raw.item.id,
        raw.ordinal,
        raw.createdAtMs,
        raw.type,
        JSON.stringify(raw.item),
      );
    }
    sqlite.close();

    const session = await new LocalCodexSessionStore(codexHome).findSession(
      sessionId,
    );

    expect(session?.turns).toHaveLength(2);
    expect(session?.turns[0]).toMatchObject({
      id: 'turn-rich',
      status: 'completed',
      items: [
        { id: 'user-rich', kind: 'userMessage' },
        { id: 'reason-rich', kind: 'reasoning' },
        { id: 'agent-commentary', kind: 'agentMessage' },
        { id: 'command-rich', kind: 'commandExecution' },
        { id: 'agent-rich', kind: 'agentMessage' },
      ],
    });
    expect(session?.turns[1]).toMatchObject({
      id: 'turn-new',
      status: 'inProgress',
      items: [
        { id: 'user-new', kind: 'userMessage' },
        { id: 'command-new', kind: 'commandExecution' },
      ],
    });
  });

  it('watches rollout changes for externally running imported sessions', async () => {
    const codexHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'remote-codex-watched-session-'),
    );
    tempDirectories.push(codexHome);
    const sessionId = '01a059bf-c303-79b1-8802-f922d3a81971';
    const sessionsDirectory = path.join(codexHome, 'sessions');
    const transcriptPath = path.join(
      sessionsDirectory,
      `rollout-${sessionId}.jsonl`,
    );
    await fs.mkdir(sessionsDirectory, { recursive: true });
    await fs.writeFile(
      transcriptPath,
      `${JSON.stringify({
        timestamp: '2026-08-31T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: sessionId, cwd: codexHome },
      })}\n`,
    );
    const store = new LocalCodexSessionStore(codexHome, {
      watchIntervalMs: 20,
      watchThrottleMs: 25,
    });
    let changes = 0;
    let resolveChange: (() => void) | null = null;
    const changed = new Promise<void>((resolve) => {
      resolveChange = resolve;
    });
    const stop = await store.watchSession(sessionId, () => {
      changes += 1;
      resolveChange?.();
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    await fs.appendFile(
      transcriptPath,
      `${JSON.stringify({
        timestamp: '2026-08-31T00:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-1' },
      })}\n`,
    );
    await Promise.race([
      changed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('watcher timed out')), 2_000),
      ),
    ]);

    stop();
    await fs.appendFile(transcriptPath, '{}\n');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(changes).toBe(1);
  });
});
