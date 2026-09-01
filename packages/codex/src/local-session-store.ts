import {
  unwatchFile,
  watchFile,
  type Dirent,
  type Stats,
} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  ThreadHistoryItemDto,
  ThreadSourceDto,
  ThreadTurnDto,
  truncateAutoThreadTitle,
} from '../../shared/src/index';
import {
  agentTurnToThreadTurnDto,
  codexTurnToAgentTurn,
} from './historyItems';
import type {
  CodexTurnError,
  CodexTurnItem,
  CodexTurnStatus,
} from './types';

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

interface PaginatedTurnRow {
  turnId: string;
  rolloutOrdinal: number;
  status: string;
  errorJson: string | null;
  startedAt: number | null;
}

interface PaginatedItemRow {
  turnId: string;
  rolloutOrdinal: number;
  createdAtMs: number;
  itemType: string;
  itemJson: string;
}

interface LocalCodexSessionStoreOptions {
  watchIntervalMs?: number;
  watchThrottleMs?: number;
}

export interface LocalCodexSessionRecord {
  sessionId: string;
  cwd: string;
  title: string | null;
  model: string | null;
  rolloutPath: string | null;
  turns: ThreadTurnDto[];
}

export interface LocalCodexImportSession {
  provider: 'codex';
  source: Extract<ThreadSourceDto, 'local_codex_import'>;
  sessionId: string;
  cwd: string;
  title: string;
  model: string | null;
  summaryText: string | null;
  fastMode: boolean;
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

function transcriptMessageText(payload: any) {
  if (!Array.isArray(payload?.content)) {
    return null;
  }

  const text = payload.content
    .filter(
      (content: any) =>
        (content?.type === 'input_text' || content?.type === 'output_text') &&
        typeof content.text === 'string' &&
        content.text.trim(),
    )
    .map((content: any) => content.text)
    .join('\n\n');

  return text || null;
}

function camelCaseKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function camelCaseValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelCaseValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      camelCaseKey(key),
      camelCaseValue(entry),
    ]),
  );
}

function completedRolloutHistoryItem(
  payload: any,
  timestamp: string | null | undefined,
) {
  if (!payload?.item || typeof payload.item !== 'object') {
    return null;
  }
  const normalized = camelCaseValue(payload.item) as Record<string, unknown>;
  if (typeof normalized.id !== 'string' || typeof normalized.type !== 'string') {
    return null;
  }
  const normalizedType =
    normalized.type.charAt(0).toLowerCase() + normalized.type.slice(1);
  if (normalizedType === 'userMessage' || normalizedType === 'agentMessage') {
    return null;
  }
  if (normalizedType === 'reasoning') {
    const summaryText = normalized.summaryText;
    normalized.summary = Array.isArray(summaryText)
      ? summaryText.filter((entry): entry is string => typeof entry === 'string')
      : typeof summaryText === 'string' && summaryText.trim()
        ? [summaryText]
        : [];
    const rawContent = normalized.rawContent;
    normalized.text = Array.isArray(rawContent)
      ? rawContent
        .map((entry) =>
          typeof entry === 'string'
            ? entry
            : entry && typeof entry === 'object' && typeof (entry as any).text === 'string'
              ? (entry as any).text
              : '',
        )
        .filter(Boolean)
        .join('\n')
      : '';
  }

  const createdAtCandidate =
    typeof payload.started_at_ms === 'number'
      ? payload.started_at_ms
      : timestamp ?? null;
  const agentTurn = codexTurnToAgentTurn({
    id: typeof payload.turn_id === 'string' ? payload.turn_id : 'rollout-turn',
    status: 'inProgress',
    error: null,
    items: [
      {
        ...normalized,
        id: normalized.id,
        type: normalizedType,
        createdAt: createdAtCandidate,
      } as unknown as CodexTurnItem,
    ],
  });
  const historyItem = agentTurn.items[0] ?? null;
  return historyItem?.kind === 'reasoning' && historyItem.text.trim().length === 0
    ? null
    : historyItem;
}

function appendUniqueTurnItem(turn: MutableTurn, item: ThreadHistoryItemDto) {
  const existingIndex = turn.items.findIndex((entry) => entry.id === item.id);
  if (existingIndex >= 0) {
    turn.items[existingIndex] = item;
    return;
  }
  turn.items.push(item);
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

function isoTimestampFromEpochSeconds(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? null
    : new Date(value * 1_000).toISOString();
}

function normalizePaginatedTurnStatus(status: string): CodexTurnStatus {
  switch (status) {
    case 'completed':
    case 'interrupted':
    case 'failed':
    case 'inProgress':
      return status;
    default:
      return 'inProgress';
  }
}

function parsePaginatedTurnError(value: string | null): CodexTurnError | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).message === 'string'
    ) {
      return parsed as CodexTurnError;
    }
    return { message: value };
  } catch {
    return { message: value };
  }
}

function mergeSessionTurns(
  paginatedTurns: ThreadTurnDto[],
  transcriptTurns: ThreadTurnDto[],
) {
  if (paginatedTurns.length === 0) {
    return transcriptTurns;
  }

  const transcriptById = new Map(
    transcriptTurns.map((turn) => [turn.id, turn]),
  );
  const merged = paginatedTurns.map((turn) => {
    const transcriptTurn = transcriptById.get(turn.id);
    if (!transcriptTurn) {
      return turn;
    }
    transcriptById.delete(turn.id);

    const paginatedItemIds = new Set(turn.items.map((item) => item.id));
    const missingTranscriptItems = transcriptTurn.items.filter(
      (item) => !paginatedItemIds.has(item.id),
    );
    const items = [...turn.items, ...missingTranscriptItems]
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const leftMillis = Date.parse(left.item.createdAt ?? '');
        const rightMillis = Date.parse(right.item.createdAt ?? '');
        if (Number.isFinite(leftMillis) && Number.isFinite(rightMillis)) {
          const delta = leftMillis - rightMillis;
          return delta === 0 ? left.index - right.index : delta;
        }
        if (Number.isFinite(leftMillis)) return -1;
        if (Number.isFinite(rightMillis)) return 1;
        return left.index - right.index;
      })
      .map((entry, transcriptOrder) => ({
        ...entry.item,
        transcriptOrder,
      }));

    return {
      ...turn,
      startedAt: turn.startedAt ?? transcriptTurn.startedAt,
      status: transcriptTurn.status,
      error: transcriptTurn.error ?? turn.error,
      items,
    };
  });

  merged.push(...transcriptById.values());
  return merged.sort((left, right) =>
    (left.startedAt ?? '').localeCompare(right.startedAt ?? ''),
  );
}

function parseTranscript(contents: string): ParsedTranscript {
  const entries = contents
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  let transcriptSegmentIndex = -1;
  const indexedEntries = entries.map((entry: any) => {
    if (
      entry.type === 'event_msg' &&
      entry.payload?.type === 'task_started'
    ) {
      transcriptSegmentIndex += 1;
    }
    return { entry, segmentIndex: transcriptSegmentIndex };
  });
  const legacyMessageSegments = new Set(
    indexedEntries
      .filter(
        ({ entry }) =>
          entry.type === 'event_msg' &&
          (entry.payload?.type === 'user_message' ||
            entry.payload?.type === 'agent_message'),
      )
      .map(({ segmentIndex }) => segmentIndex),
  );
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

  for (const { entry, segmentIndex } of indexedEntries) {
    if (entry.type === 'session_meta') {
      const payload = entry.payload ?? {};
      if (typeof payload.cwd === 'string' && payload.cwd.trim()) {
        cwd = payload.cwd;
      }
      continue;
    }

    if (
      !legacyMessageSegments.has(segmentIndex) &&
      entry.type === 'response_item' &&
      entry.payload?.type === 'message'
    ) {
      const payload = entry.payload;
      const text = transcriptMessageText(payload);
      if (!text || (payload.role !== 'user' && payload.role !== 'assistant')) {
        continue;
      }

      const turn = ensureCurrentTurn(entry.timestamp);
      if (payload.role === 'user') {
        userItemCount += 1;
        turn.items.push({
          id:
            typeof payload.id === 'string' && payload.id.trim()
              ? payload.id
              : createHistoryItemId(turn.id, 'user', userItemCount),
          kind: 'userMessage',
          text,
          createdAt: entry.timestamp ?? null,
        });
      } else {
        agentItemCount += 1;
        turn.items.push({
          id:
            typeof payload.id === 'string' && payload.id.trim()
              ? payload.id
              : createHistoryItemId(turn.id, 'agent', agentItemCount),
          kind: 'agentMessage',
          text,
          status: typeof payload.phase === 'string' ? payload.phase : null,
          createdAt: entry.timestamp ?? null,
        });
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
        createdAt: entry.timestamp ?? null,
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
        createdAt: entry.timestamp ?? null,
      });
      continue;
    }

    if (payloadType === 'item_completed') {
      const item = completedRolloutHistoryItem(
        payload,
        typeof entry.timestamp === 'string' ? entry.timestamp : null,
      );
      if (item) {
        appendUniqueTurnItem(ensureCurrentTurn(entry.timestamp), item);
      }
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
  private readonly watchIntervalMs: number;
  private readonly watchThrottleMs: number;

  constructor(
    private readonly codexHome: string,
    options: LocalCodexSessionStoreOptions = {},
  ) {
    this.watchIntervalMs = options.watchIntervalMs ?? 500;
    this.watchThrottleMs = options.watchThrottleMs ?? 1_500;
  }

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
    const paginatedTurns = await this.findPaginatedTurns(sessionId);
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
      turns: mergeSessionTurns(paginatedTurns, transcript?.turns ?? []),
    };
  }

  async watchSession(
    sessionId: string,
    onChange: () => void,
  ): Promise<() => void> {
    const stateRecord = await this.findSessionInStateDatabases(sessionId);
    const transcriptPath = await this.resolveTranscriptPath(
      stateRecord?.rolloutPath ?? null,
      sessionId,
    );
    if (!transcriptPath) {
      return () => {};
    }

    let stopped = false;
    let lastEmittedAt = 0;
    let pending: NodeJS.Timeout | null = null;
    const emit = () => {
      pending = null;
      if (stopped) {
        return;
      }
      lastEmittedAt = Date.now();
      onChange();
    };
    const schedule = () => {
      if (stopped || pending) {
        return;
      }
      const delay = Math.max(
        0,
        this.watchThrottleMs - (Date.now() - lastEmittedAt),
      );
      pending = setTimeout(emit, delay);
    };
    const listener = (current: Stats, previous: Stats) => {
      if (
        current.size !== previous.size ||
        current.mtimeMs !== previous.mtimeMs
      ) {
        schedule();
      }
    };

    watchFile(
      transcriptPath,
      { persistent: false, interval: this.watchIntervalMs },
      listener,
    );
    return () => {
      stopped = true;
      if (pending) {
        clearTimeout(pending);
        pending = null;
      }
      unwatchFile(transcriptPath, listener);
    };
  }

  async findImportSession(
    sessionId: string,
    input: { fastMode: boolean; provider?: string | null },
  ): Promise<LocalCodexImportSession | null> {
    if (input.provider && input.provider !== 'codex') {
      return null;
    }
    const localSession = await this.findSession(sessionId);
    if (!localSession) {
      return null;
    }

    return {
      provider: 'codex',
      source: 'local_codex_import',
      sessionId: localSession.sessionId,
      cwd: localSession.cwd,
      title: truncateAutoThreadTitle(
        localSession.title?.trim() || 'Untitled imported session',
      ),
      model: localSession.model,
      summaryText:
        localSession.turns
          .flatMap((turn) => turn.items)
          .find((item) => item.kind === 'userMessage')
          ?.text ?? null,
      fastMode: input.fastMode,
    };
  }

  private async findSessionInStateDatabases(
    sessionId: string,
  ): Promise<LocalStateThreadRow | null> {
    const stateFiles = (
      await Promise.all(
        [this.codexHome, path.join(this.codexHome, 'sqlite')].map(
          async (directory) => {
            let entries: string[];
            try {
              entries = await fs.readdir(directory);
            } catch {
              return [];
            }

            return Promise.all(
              entries
                .filter((entry) => /^state_\d+\.sqlite$/i.test(entry))
                .map(async (entry) => {
                  const absPath = path.join(directory, entry);
                  const stats = await fs.stat(absPath);
                  return {
                    absPath,
                    mtimeMs: stats.mtimeMs,
                  };
                }),
            );
          },
        ),
      )
    ).flat();

    stateFiles.sort((left, right) => right.mtimeMs - left.mtimeMs);

    for (const stateFile of stateFiles) {
      let sqlite: Database.Database | null = null;

      try {
        sqlite = new Database(stateFile.absPath, {
          readonly: true,
          fileMustExist: true,
        });
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
        // A corrupt or incompatible index must not block rollout-file recovery.
      } finally {
        sqlite?.close();
      }
    }

    return null;
  }

  private async findPaginatedTurns(sessionId: string) {
    const databasePath = path.join(this.codexHome, 'thread_history_1.sqlite');
    let sqlite: Database.Database | null = null;
    try {
      sqlite = new Database(databasePath, {
        readonly: true,
        fileMustExist: true,
      });
      const turnRows = sqlite.prepare(
        `
          SELECT
            turn_id AS turnId,
            rollout_ordinal AS rolloutOrdinal,
            status,
            error_json AS errorJson,
            started_at AS startedAt
          FROM thread_turns
          WHERE thread_id = ?
          ORDER BY rollout_ordinal ASC
        `,
      ).all(sessionId) as PaginatedTurnRow[];
      if (turnRows.length === 0) {
        return [];
      }

      const itemRows = sqlite.prepare(
        `
          SELECT
            turn_id AS turnId,
            rollout_ordinal AS rolloutOrdinal,
            created_at_ms AS createdAtMs,
            item_type AS itemType,
            item_json AS itemJson
          FROM thread_items
          WHERE thread_id = ?
          ORDER BY rollout_ordinal ASC
        `,
      ).all(sessionId) as PaginatedItemRow[];
      const itemsByTurnId = new Map<string, CodexTurnItem[]>();
      for (const row of itemRows) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.itemJson);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          continue;
        }
        const parsedRecord = parsed as Record<string, unknown>;
        if (typeof parsedRecord.id !== 'string' || !parsedRecord.id.trim()) {
          continue;
        }
        const item = {
          ...parsedRecord,
          id: parsedRecord.id,
          type:
            typeof parsedRecord.type === 'string'
              ? parsedRecord.type
              : row.itemType,
          createdAt: row.createdAtMs,
        } as unknown as CodexTurnItem;
        const turnItems = itemsByTurnId.get(row.turnId) ?? [];
        turnItems.push(item);
        itemsByTurnId.set(row.turnId, turnItems);
      }

      return turnRows.map((row) => {
        const agentTurn = codexTurnToAgentTurn({
          id: row.turnId,
          status: normalizePaginatedTurnStatus(row.status),
          error: parsePaginatedTurnError(row.errorJson),
          items: itemsByTurnId.get(row.turnId) ?? [],
        });
        return agentTurnToThreadTurnDto({
          ...agentTurn,
          startedAt: isoTimestampFromEpochSeconds(row.startedAt),
        });
      });
    } catch {
      return [];
    } finally {
      sqlite?.close();
    }
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
