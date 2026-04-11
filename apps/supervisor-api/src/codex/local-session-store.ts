import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../../../packages/shared/src/index';
import { truncateAutoThreadTitle } from './thread-title';

interface LocalStateThreadRow {
  id: string;
  cwd: string;
  title: string | null;
  rolloutPath: string | null;
  model: string | null;
}

interface ParsedTranscript {
  cwd: string | null;
  title: string | null;
  turns: ThreadTurnDto[];
}

export interface LocalCodexSessionRecord {
  sessionId: string;
  cwd: string;
  title: string | null;
  model: string | null;
  rolloutPath: string | null;
  turns: ThreadTurnDto[];
}

interface MutableTurn {
  id: string;
  startedAt: string | null;
  status: ThreadTurnDto['status'];
  error: string | null;
  items: ThreadHistoryItemDto[];
}

function basenameFromPath(absPath: string) {
  const normalized = absPath.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).at(-1) ?? normalized;
}

function summarizeTitleFromTurns(turns: ThreadTurnDto[]) {
  const firstUserMessage = turns
    .flatMap((turn) => turn.items)
    .find((item) => item.kind === 'userMessage' && item.text.trim());

  if (!firstUserMessage) {
    return null;
  }

  return truncateAutoThreadTitle(firstUserMessage.text);
}

function createHistoryItemId(turnId: string, prefix: string, index: number) {
  return `${turnId}-${prefix}-${index}`;
}

function finalizeTurn(turn: MutableTurn | null, turns: ThreadTurnDto[]) {
  if (!turn || turn.items.length === 0) {
    return;
  }

  turns.push({
    id: turn.id,
    startedAt: turn.startedAt,
    status: turn.status,
    error: turn.error,
    items: turn.items,
  });
}

function parseTranscript(contents: string): ParsedTranscript {
  const turns: ThreadTurnDto[] = [];
  let cwd: string | null = null;
  let currentTurn: MutableTurn | null = null;
  let fallbackTurnCount = 0;
  let agentItemCount = 0;
  let userItemCount = 0;

  const ensureCurrentTurn = (timestamp?: string) => {
    if (currentTurn) {
      return currentTurn;
    }

    fallbackTurnCount += 1;
    currentTurn = {
      id: `local-turn-${fallbackTurnCount}`,
      startedAt: timestamp ?? null,
      status: 'inProgress',
      error: null,
      items: [],
    };
    agentItemCount = 0;
    userItemCount = 0;
    return currentTurn;
  };

  for (const line of contents.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === 'session_meta') {
      const payload = entry.payload ?? {};
      if (typeof payload.cwd === 'string' && payload.cwd.trim()) {
        cwd = payload.cwd;
      }
      continue;
    }

    if (entry.type !== 'event_msg') {
      continue;
    }

    const payload = entry.payload ?? {};
    const payloadType = payload.type;

    if (payloadType === 'task_started') {
      finalizeTurn(currentTurn, turns);
      currentTurn = {
        id:
          typeof payload.turn_id === 'string' && payload.turn_id.trim()
            ? payload.turn_id
            : `local-turn-${fallbackTurnCount + 1}`,
        startedAt: entry.timestamp ?? null,
        status: 'inProgress',
        error: null,
        items: [],
      };
      agentItemCount = 0;
      userItemCount = 0;
      continue;
    }

    if (payloadType === 'user_message' && typeof payload.message === 'string') {
      const turn = ensureCurrentTurn(entry.timestamp);
      userItemCount += 1;
      turn.items.push({
        id: createHistoryItemId(turn.id, 'user', userItemCount),
        kind: 'userMessage',
        text: payload.message,
      });
      continue;
    }

    if (payloadType === 'agent_message' && typeof payload.message === 'string') {
      const turn = ensureCurrentTurn(entry.timestamp);
      agentItemCount += 1;
      turn.items.push({
        id: createHistoryItemId(turn.id, 'agent', agentItemCount),
        kind: 'agentMessage',
        text: payload.message,
        status: typeof payload.phase === 'string' ? payload.phase : null,
      });
      continue;
    }

    if (payloadType === 'task_complete') {
      const turn = ensureCurrentTurn(entry.timestamp);
      turn.status = turn.error ? 'failed' : 'completed';
      finalizeTurn(turn, turns);
      currentTurn = null;
      continue;
    }

    if (payloadType === 'error') {
      const turn = ensureCurrentTurn(entry.timestamp);
      turn.status = 'failed';
      turn.error =
        typeof payload.message === 'string'
          ? payload.message
          : 'Local Codex session failed.';
    }
  }

  finalizeTurn(currentTurn, turns);

  return {
    cwd,
    title: summarizeTitleFromTurns(turns),
    turns,
  };
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class LocalCodexSessionStore {
  constructor(private readonly codexHome: string) {}

  async findSession(
    sessionId: string,
  ): Promise<LocalCodexSessionRecord | null> {
    const stateRecord = await this.findSessionInStateDatabases(sessionId);
    const transcriptPath = await this.resolveTranscriptPath(
      stateRecord?.rolloutPath ?? null,
      sessionId,
    );
    const transcript = transcriptPath
      ? parseTranscript(await fs.readFile(transcriptPath, 'utf8'))
      : null;
    const cwd = stateRecord?.cwd ?? transcript?.cwd ?? null;

    if (!cwd) {
      return null;
    }

    return {
      sessionId,
      cwd,
      title:
        stateRecord?.title?.trim() ||
        transcript?.title?.trim() ||
        basenameFromPath(cwd),
      model: stateRecord?.model ?? null,
      rolloutPath: transcriptPath,
      turns: transcript?.turns ?? [],
    };
  }

  private async findSessionInStateDatabases(
    sessionId: string,
  ): Promise<LocalStateThreadRow | null> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.codexHome);
    } catch {
      return null;
    }

    const stateFiles = await Promise.all(
      entries
        .filter((entry) => /^state_\d+\.sqlite$/i.test(entry))
        .map(async (entry) => {
          const absPath = path.join(this.codexHome, entry);
          const stats = await fs.stat(absPath);
          return {
            absPath,
            mtimeMs: stats.mtimeMs,
          };
        }),
    );

    stateFiles.sort((left, right) => right.mtimeMs - left.mtimeMs);

    for (const stateFile of stateFiles) {
      const sqlite = new Database(stateFile.absPath, {
        readonly: true,
        fileMustExist: true,
      });

      try {
        const row = sqlite
          .prepare(
            `
              SELECT
                id,
                cwd,
                title,
                rollout_path AS rolloutPath,
                model
              FROM threads
              WHERE id = ?
              LIMIT 1
            `,
          )
          .get(sessionId) as LocalStateThreadRow | undefined;

        if (row) {
          return row;
        }
      } catch {
        // Ignore incompatible sqlite files and continue probing.
      } finally {
        sqlite.close();
      }
    }

    return null;
  }

  private async resolveTranscriptPath(
    rolloutPath: string | null,
    sessionId: string,
  ): Promise<string | null> {
    if (rolloutPath?.trim()) {
      const absolutePath = path.isAbsolute(rolloutPath)
        ? rolloutPath
        : path.resolve(this.codexHome, rolloutPath);

      if (await fileExists(absolutePath)) {
        return absolutePath;
      }
    }

    return this.findTranscriptFile(path.join(this.codexHome, 'sessions'), sessionId);
  }

  private async findTranscriptFile(
    directory: string,
    sessionId: string,
  ): Promise<string | null> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      const absPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.findTranscriptFile(absPath, sessionId);
        if (nested) {
          return nested;
        }
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith('.jsonl') &&
        entry.name.includes(sessionId)
      ) {
        return absPath;
      }
    }

    return null;
  }
}
