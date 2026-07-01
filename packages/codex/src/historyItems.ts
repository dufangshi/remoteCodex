import type {
  CodexTurnRecord,
  CodexTurnItem,
} from './types';
import type { AgentTurn } from '../../agent-runtime/src/index';
import { isTransientAgentHistoryItem } from '../../agent-runtime/src/index';
import type {
  ThreadHistoryItemDetailDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../shared/src/index';

import { parseCodexHookPromptText } from './hookHistory';

const DEFERRED_COMMAND_DETAIL_TITLE = 'Command Output';
const DEFERRED_TOOL_DETAIL_TITLE = 'Tool Call Details';
const DEFERRED_AGENT_TOOL_DETAIL_TITLE = 'Agent Details';

export type TurnItemOrderSnapshot = Map<string, Map<string, number>>;

interface WebSearchSourceRecord {
  title: string | null;
  url: string | null;
  snippet: string | null;
}

export function parseUuidV7Timestamp(id: string): string | null {
  const normalized = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(normalized) || normalized[12]?.toLowerCase() !== '7') {
    return null;
  }

  const millis = Number.parseInt(normalized.slice(0, 12), 16);
  if (!Number.isFinite(millis)) {
    return null;
  }

  return new Date(millis).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isoTimestampOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epochMs = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(epochMs).toISOString();
  }

  const text = stringOrNull(value);
  if (!text) {
    return null;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function codexItemCreatedAt(item: CodexTurnItem) {
  const candidates = [
    item.createdAt,
    item.created_at,
    item.startedAt,
    item.started_at,
    item.completedAt,
    item.completed_at,
  ];

  for (const candidate of candidates) {
    const timestamp = isoTimestampOrNull(candidate);
    if (timestamp) {
      return timestamp;
    }
  }

  return parseUuidV7Timestamp(item.id);
}

function withCodexItemTimestamp<T extends ThreadHistoryItemDto>(
  item: CodexTurnItem,
  historyItem: T,
): T {
  return {
    ...historyItem,
    createdAt: historyItem.createdAt ?? codexItemCreatedAt(item),
  };
}

function numberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => stringOrNull(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function projectRelativePathLabel(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const slashNormalized = normalized.replace(/\\/g, '/');
  if (!slashNormalized.startsWith('/')) {
    return slashNormalized.replace(/^\.\//, '');
  }

  const markers = [
    '/apps/',
    '/packages/',
    '/src/',
    '/test/',
    '/tests/',
    '/docs/',
    '/config/',
    '/scripts/',
    '/e2e/',
    '/.agents/',
    '/.codex/',
  ];
  for (const marker of markers) {
    const markerIndex = slashNormalized.indexOf(marker);
    if (markerIndex >= 0) {
      return slashNormalized.slice(markerIndex + 1);
    }
  }

  return slashNormalized;
}

function normalizeTextLines(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  while (lines.length > 1 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  return lines;
}

function textFromContentEntries(
  content: CodexTurnItem['content'],
  fallback: string | null = null,
) {
  const text =
    content
      ?.map((entry) => {
        if (typeof entry.text === 'string') {
          return entry.text;
        }

        const assetEntry = entry as {
          path?: unknown;
          imagePath?: unknown;
          filePath?: unknown;
        };
        const assetPath =
          typeof assetEntry.path === 'string'
            ? assetEntry.path
            : typeof assetEntry.imagePath === 'string'
              ? assetEntry.imagePath
              : typeof assetEntry.filePath === 'string'
                ? assetEntry.filePath
                : null;
        if (entry.type === 'localImage' && assetPath) {
          return `[PHOTO ${assetPath}]`;
        }

        return `[${entry.type}]`;
      })
      .join('\n')
      .trim();

  return text || fallback;
}

function codexItemText(item: CodexTurnItem, fallback = '') {
  const contentText = textFromContentEntries(item.content);
  const directText = typeof item.text === 'string' && item.text.trim() ? item.text : null;

  if (
    contentText &&
    (!directText ||
      contentText.includes('\n') ||
      (Array.isArray(item.content) && item.content.length > 1))
  ) {
    return contentText;
  }

  return directText ?? contentText ?? fallback;
}

function summarizeCommandText(text: string) {
  const lines = normalizeTextLines(text);
  return lines.find((line) => line.trim().length > 0) ?? lines[0] ?? 'Command output';
}

function textFromUnknown(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() ? value : null;
  }

  if (Array.isArray(value)) {
    const parts: string[] = value
      .map((entry) => textFromUnknown(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join(' ') : null;
  }

  return null;
}

function safeJsonStringify(value: unknown) {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized && serialized !== 'null' ? serialized : null;
  } catch {
    return String(value);
  }
}

function summarizeToolCallText(text: string) {
  const lines = normalizeTextLines(text);
  return lines.find((line) => line.trim().length > 0) ?? lines[0] ?? 'Tool call';
}

function containsRemoteCodexArtifact(text: string | null | undefined) {
  return /```(?:artifact|remote-codex-artifact)\b/i.test(text ?? '');
}

function deferCommandHistoryItem(
  item: ThreadHistoryItemDto & { kind: 'commandExecution' },
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const fullText = item.detailText?.trim() || item.text || 'Command output';
  deferredDetails.set(item.id, {
    id: item.id,
    kind: item.kind,
    title: DEFERRED_COMMAND_DETAIL_TITLE,
    text: fullText,
  });

  return {
    ...item,
    text: summarizeCommandText(fullText),
    detailText: null,
    hasDeferredDetail: true,
  };
}

function formatCommandHistoryItem(
  item: CodexTurnItem,
  deferredDetails?: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const nestedRecords = [
    item,
    isRecord(item.action) ? item.action : null,
    isRecord(item.result) ? item.result : null,
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  const commandText =
    textFromUnknown(valueFromNestedRecords(nestedRecords, ['command', 'cmd', 'argv'])) ??
    stringOrNull(item.text) ??
    'Command output';
  const outputText =
    textFromUnknown(
      valueFromNestedRecords(nestedRecords, [
        'aggregatedOutput',
        'aggregated_output',
        'output',
        'stdout',
        'stderr',
        'text',
      ]),
    ) ?? null;
  const detailText = [commandText, outputText].filter(Boolean).join('\n\n');
  const historyItem: ThreadHistoryItemDto & { kind: 'commandExecution' } = {
    id: item.id,
    kind: 'commandExecution',
    text: detailText,
    status: item.status ?? null,
  };

  return deferredDetails
    ? deferCommandHistoryItem(historyItem, deferredDetails)
    : historyItem;
}

function deferToolCallHistoryItem(
  item: ThreadHistoryItemDto & { kind: 'toolCall' | 'agentToolCall' | 'skillToolCall' },
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const fullText = item.detailText?.trim() || item.text || 'Tool call';
  deferredDetails.set(item.id, {
    id: item.id,
    kind: item.kind,
    title:
      item.kind === 'agentToolCall'
        ? DEFERRED_AGENT_TOOL_DETAIL_TITLE
        : item.kind === 'skillToolCall'
          ? 'Skill Details'
          : DEFERRED_TOOL_DETAIL_TITLE,
    text: fullText,
  });

  return {
    ...item,
    text: summarizeToolCallText(fullText),
    detailText: null,
    hasDeferredDetail: true,
  };
}

function extractToolCallRecords(item: CodexTurnItem) {
  const action = isRecord(item.action) ? item.action : null;
  const result = isRecord(item.result) ? item.result : null;

  return {
    action,
    result,
    input: action && isRecord(action.input) ? action.input : null,
    output: result && isRecord(result.output) ? result.output : null,
  };
}

function valueFromNestedRecords(
  records: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
) {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
  }

  return null;
}

function textContentFromMcpToolResult(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return null;
  }

  const texts = value.content
    .map((entry) =>
      isRecord(entry) && entry.type === 'text' ? stringOrNull(entry.text) : null,
    )
    .filter((entry): entry is string => Boolean(entry));
  return texts.length > 0 ? texts.join('\n\n') : null;
}

function formatToolCallHistoryItem(
  item: CodexTurnItem,
  deferredDetails?: Map<string, ThreadHistoryItemDetailDto>,
  kind: 'toolCall' | 'agentToolCall' | 'skillToolCall' = 'toolCall',
): ThreadHistoryItemDto {
  const { action, result, input, output } = extractToolCallRecords(item);
  const nestedRecords = [item, action, result, input, output];
  const toolName = uniqueStrings([
    stringOrNull(valueFromNestedRecords(nestedRecords, [
      'tool',
      'toolName',
      'tool_name',
      'name',
      'title',
      'functionName',
      'function_name',
    ])),
  ])[0] ?? null;
  const serverName = uniqueStrings([
    stringOrNull(valueFromNestedRecords(nestedRecords, [
      'server',
      'serverName',
      'server_name',
      'mcpServer',
      'mcp_server',
      'namespace',
    ])),
  ])[0] ?? null;
  const status = stringOrNull(item.status) ?? stringOrNull(item.phase) ?? null;
  const summaryLine = serverName && toolName
    ? `${serverName}/${toolName}`
    : toolName ?? serverName ?? stringOrNull(item.text) ?? item.type;
  const displaySummary =
    kind === 'agentToolCall' && !/^agent\b/i.test(summaryLine)
      ? `Agent: ${summaryLine}`
      : summaryLine;

  const detailLines = [displaySummary];
  if (status) {
    detailLines.push(`Status: ${status}`);
  }

  const text = stringOrNull(item.text);
  if (text && text !== summaryLine && text !== displaySummary) {
    detailLines.push('', text);
  }

  const argumentPayload = input ?? action;
  const resultPayload = output ?? result;
  const argumentText = safeJsonStringify(argumentPayload);
  const resultText = safeJsonStringify(resultPayload);
  const resultContentText = textContentFromMcpToolResult(resultPayload);

  if (argumentText) {
    detailLines.push('', 'Arguments', argumentText);
  }
  if (resultText) {
    detailLines.push('', 'Result', resultText);
  }
  if (resultContentText && resultContentText !== resultText) {
    detailLines.push('', 'Result Text', resultContentText);
  }

  const historyItem: ThreadHistoryItemDto = {
    id: item.id,
    kind,
    text: displaySummary,
    previewText: kind === 'agentToolCall' ? 'Agent' : displaySummary,
    detailText: detailLines.join('\n'),
    status,
  };

  if (
    deferredDetails &&
    !containsRemoteCodexArtifact(historyItem.detailText) &&
    (Boolean(argumentText) ||
      Boolean(resultText) ||
      (historyItem.detailText?.length ?? 0) > 240)
  ) {
    return deferToolCallHistoryItem(
      historyItem as ThreadHistoryItemDto & {
        kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
      },
      deferredDetails,
    );
  }

  return historyItem;
}

export function deferLargeHistoryItemDetails(
  turn: ThreadTurnDto,
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto {
  return {
    ...turn,
    items: turn.items.map((item) =>
      item.kind === 'commandExecution'
        ? deferCommandHistoryItem(
            item as ThreadHistoryItemDto & { kind: 'commandExecution' },
            deferredDetails,
          )
        : item.kind === 'toolCall'
          || item.kind === 'agentToolCall'
          || item.kind === 'skillToolCall'
          ? deferToolCallHistoryItem(
              item as ThreadHistoryItemDto & {
                kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
              },
              deferredDetails,
            )
        : item,
    ),
  };
}

export function shouldPersistLiveHistoryItem(item: ThreadHistoryItemDto) {
  return (
    item.kind === 'commandExecution' ||
    item.kind === 'fileChange' ||
    item.kind === 'fileRead' ||
    item.kind === 'hook' ||
    item.kind === 'agentToolCall' ||
    item.kind === 'skillToolCall' ||
    item.kind === 'toolCall' ||
    item.kind === 'webSearch'
  );
}

export function shouldPersistFinalHistoryItem(item: ThreadHistoryItemDto) {
  return item.kind === 'agentMessage' || shouldPersistLiveHistoryItem(item);
}

export function shouldPersistRuntimeFinalHistoryItem(
  item: ThreadHistoryItemDto,
) {
  if (item.kind === 'agentMessage' && isTransientAgentHistoryItem(item)) {
    return false;
  }

  return shouldPersistFinalHistoryItem(item);
}

function visibleRuntimeTurnItems(items: ThreadHistoryItemDto[]) {
  const hasFinalAgentMessage = items.some(
    (item) => item.kind === 'agentMessage' && !isTransientAgentHistoryItem(item),
  );
  if (!hasFinalAgentMessage) {
    return items;
  }

  return items.filter(
    (item) => !(item.kind === 'agentMessage' && isTransientAgentHistoryItem(item)),
  );
}

export function parseStoredHistoryItem(value: string): ThreadHistoryItemDto | null {
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.id === 'string' &&
      typeof parsed.kind === 'string' &&
      typeof parsed.text === 'string'
    ) {
      return parsed as ThreadHistoryItemDto;
    }
  } catch {
    return null;
  }

  return null;
}

function hasHistoryItemSequence(item: ThreadHistoryItemDto) {
  return typeof item.sequence === 'number' && Number.isFinite(item.sequence);
}

function historyItemSequence(item: ThreadHistoryItemDto) {
  return hasHistoryItemSequence(item) ? item.sequence! : Number.POSITIVE_INFINITY;
}

export function sortHistoryItemsBySequence<T extends ThreadHistoryItemDto>(items: T[]): T[] {
  return sortTurnItemsByRecordedSequence(items) as T[];
}

function sortTurnItemsByRecordedSequence(items: ThreadHistoryItemDto[]) {
  const leadingItems: ThreadHistoryItemDto[] = [];
  let index = 0;

  while (
    index < items.length &&
    items[index]?.kind === 'userMessage' &&
    !hasHistoryItemSequence(items[index]!)
  ) {
    leadingItems.push(items[index]!);
    index += 1;
  }

  const trailingItems = items.slice(index);
  if (!trailingItems.some(hasHistoryItemSequence)) {
    return items;
  }

  const sequenceValues = trailingItems
    .map((item) => historyItemSequence(item))
    .filter(Number.isFinite);
  const maxSequence = sequenceValues.length > 0 ? Math.max(...sequenceValues) : 0;
  const orderedItems: Array<{
    item: ThreadHistoryItemDto;
    index: number;
    order: number;
  }> = [];

  let cursor = 0;
  while (cursor < trailingItems.length) {
    const item = trailingItems[cursor]!;
    if (hasHistoryItemSequence(item)) {
      orderedItems.push({ item, index: cursor, order: historyItemSequence(item) });
      cursor += 1;
      continue;
    }

    const blockStart = cursor;
    while (
      cursor < trailingItems.length &&
      !hasHistoryItemSequence(trailingItems[cursor]!)
    ) {
      cursor += 1;
    }

    const block = trailingItems.slice(blockStart, cursor);
    const previousSequenced = [...trailingItems.slice(0, blockStart)]
      .reverse()
      .find(hasHistoryItemSequence);
    const nextSequenced = trailingItems.slice(cursor).find(hasHistoryItemSequence);
    const previousSequence = previousSequenced
      ? historyItemSequence(previousSequenced)
      : null;
    const nextSequence = nextSequenced ? historyItemSequence(nextSequenced) : null;

    block.forEach((blockItem, blockIndex) => {
      let order: number;
      if (previousSequence === null && nextSequence !== null) {
        order = nextSequence - (block.length - blockIndex) / (block.length + 1);
      } else if (
        previousSequence !== null &&
        nextSequence !== null &&
        nextSequence > previousSequence
      ) {
        const span = nextSequence - previousSequence;
        order = previousSequence + ((blockIndex + 1) / (block.length + 1)) * span;
      } else {
        order = maxSequence + 1 + blockIndex / (block.length + 1);
      }
      orderedItems.push({
        item: blockItem,
        index: blockStart + blockIndex,
        order,
      });
    });
  }

  const sortedTrailingItems = orderedItems
    .sort((left, right) => {
      const orderDelta = left.order - right.order;
      return orderDelta === 0 ? left.index - right.index : orderDelta;
    })
    .map((entry) => entry.item);

  return [...leadingItems, ...sortedTrailingItems];
}

function mergeHistoryItemsBySequence(
  items: ThreadHistoryItemDto[],
  missingItems: ThreadHistoryItemDto[],
) {
  if (missingItems.length === 0) {
    return sortTurnItemsByRecordedSequence(items);
  }

  if (!missingItems.some(hasHistoryItemSequence)) {
    return sortTurnItemsByRecordedSequence([...items, ...missingItems]);
  }

  const mergedItems = [...items];
  const orderedMissingItems = sortHistoryItemsBySequence(missingItems);
  for (const missingItem of orderedMissingItems) {
    if (!hasHistoryItemSequence(missingItem)) {
      mergedItems.push(missingItem);
      continue;
    }

    const firstGreaterIndex = mergedItems.findIndex(
      (item) =>
        hasHistoryItemSequence(item) &&
        historyItemSequence(item) > historyItemSequence(missingItem),
    );
    if (firstGreaterIndex >= 0) {
      mergedItems.splice(firstGreaterIndex, 0, missingItem);
      continue;
    }

    const lastLowerIndex = mergedItems.findLastIndex(
      (item) =>
        hasHistoryItemSequence(item) &&
        historyItemSequence(item) < historyItemSequence(missingItem),
    );
    if (lastLowerIndex >= 0) {
      mergedItems.splice(lastLowerIndex + 1, 0, missingItem);
      continue;
    }

    mergedItems.push(missingItem);
  }

  return sortTurnItemsByRecordedSequence(mergedItems);
}

function copyPersistedSequence(
  item: ThreadHistoryItemDto,
  persistedItem: ThreadHistoryItemDto,
) {
  let nextItem = item;
  if (hasHistoryItemSequence(persistedItem)) {
    const sequence = historyItemSequence(persistedItem);
    if (nextItem.sequence !== sequence) {
      nextItem = { ...nextItem, sequence };
    }
  }

  return nextItem;
}

function shouldAppendPersistedMissingItem(
  turn: ThreadTurnDto,
  item: ThreadHistoryItemDto,
) {
  if (item.kind !== 'agentMessage') {
    return true;
  }

  // Older builds persisted streaming assistant drafts. Once the provider
  // transcript has final assistant text, do not resurrect those draft rows.
  const isCrossTurnProjection = Boolean(item.sourceTurnId && item.sourceTurnId !== turn.id);
  return !(
    turn.status === 'completed' &&
    turn.items.some((turnItem) => turnItem.kind === 'agentMessage') &&
    !isCrossTurnProjection
  );
}

export function mergePersistedHistoryItemsIntoTurns(
  turns: ThreadTurnDto[],
  persistedItemsByTurnId: Map<string, ThreadHistoryItemDto[]>,
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto[] {
  if (persistedItemsByTurnId.size === 0) {
    return turns;
  }

  return turns.map((turn) => {
    const persistedItems = persistedItemsByTurnId.get(turn.id);
    if (!persistedItems || persistedItems.length === 0) {
      return turn;
    }

    let changed = false;
    const persistedItemsById = new Map(persistedItems.map((item) => [item.id, item]));
    const nextItems = turn.items.map((item) => {
      const persistedItem = persistedItemsById.get(item.id);
      if (!persistedItem) {
        return item;
      }

      persistedItemsById.delete(item.id);

      if (item.kind !== persistedItem.kind) {
        return item;
      }

      const sequencedItem = copyPersistedSequence(item, persistedItem);
      if (sequencedItem !== item) {
        changed = true;
      }

      if (
        persistedItem.kind === 'commandExecution' ||
        persistedItem.kind === 'toolCall' ||
        persistedItem.kind === 'agentToolCall' ||
        persistedItem.kind === 'skillToolCall'
      ) {
        const existingText = item.detailText?.trim() || item.text.trim();
        const persistedText = persistedItem.detailText?.trim() || persistedItem.text.trim();
        if (persistedText.length > existingText.length) {
          changed = true;
          return persistedItem.kind === 'commandExecution'
            ? deferCommandHistoryItem(
                persistedItem as ThreadHistoryItemDto & { kind: 'commandExecution' },
                deferredDetails,
              )
            : deferToolCallHistoryItem(
                persistedItem as ThreadHistoryItemDto & {
                  kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
                },
                deferredDetails,
              );
        }
      }

      return sequencedItem;
    });

    const existingItemIds = new Set(nextItems.map((item) => item.id));
    const missingItems = [...persistedItemsById.values()]
      .filter((item) => !existingItemIds.has(item.id))
      .filter((item) => shouldAppendPersistedMissingItem(turn, item))
      .map((item) =>
        item.kind === 'commandExecution'
          ? deferCommandHistoryItem(
              item as ThreadHistoryItemDto & { kind: 'commandExecution' },
              deferredDetails,
            )
          : item.kind === 'toolCall'
            || item.kind === 'agentToolCall'
            || item.kind === 'skillToolCall'
            ? deferToolCallHistoryItem(
                item as ThreadHistoryItemDto & {
                  kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
                },
                deferredDetails,
              )
            : item,
      );
    if (missingItems.length === 0 && !changed) {
      return turn;
    }

    return {
      ...turn,
      items: mergeHistoryItemsBySequence(nextItems, missingItems),
    };
  });
}

function extractWebSearchQueries(item: CodexTurnItem) {
  const action = isRecord(item.action) ? item.action : null;
  const result = isRecord(item.result) ? item.result : null;

  return uniqueStrings([
    stringOrNull(item.query),
    ...stringArray(item.queries),
    action ? stringOrNull(action.query) : null,
    ...(action ? stringArray(action.queries) : []),
    action && isRecord(action.input) ? stringOrNull(action.input.query) : null,
    result ? stringOrNull(result.query) : null,
    ...(result ? stringArray(result.queries) : []),
  ]);
}

function normalizeWebSearchSource(value: unknown): WebSearchSourceRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = stringOrNull(value.title) ?? stringOrNull(value.name);
  const url = stringOrNull(value.url) ?? stringOrNull(value.link);
  const snippet =
    stringOrNull(value.snippet) ??
    stringOrNull(value.description) ??
    stringOrNull(value.text);

  if (!title && !url && !snippet) {
    return null;
  }

  return { title, url, snippet };
}

function extractWebSearchSources(item: CodexTurnItem) {
  const action = isRecord(item.action) ? item.action : null;
  const result = isRecord(item.result) ? item.result : null;

  const candidates: unknown[] = [
    item.sources,
    action?.sources,
    result?.sources,
    result?.results,
    action?.results,
    item.results,
    item.searchResults,
    item.webResults,
  ];

  const sources: WebSearchSourceRecord[] = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    for (const entry of candidate) {
      const normalized = normalizeWebSearchSource(entry);
      if (normalized) {
        sources.push(normalized);
      }
    }
  }

  return sources.filter((source, index, allSources) => {
    return (
      index ===
      allSources.findIndex(
        (entry) =>
          entry.title === source.title &&
          entry.url === source.url &&
          entry.snippet === source.snippet,
      )
    );
  });
}

function stringifyPayload(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function extractImageAssetPath(item: CodexTurnItem) {
  const candidates: unknown[] = [
    item.path,
    item.imagePath,
    item.filePath,
    isRecord(item.action) ? item.action.path : null,
    isRecord(item.action) ? item.action.imagePath : null,
    isRecord(item.result) ? item.result.path : null,
    isRecord(item.result) ? item.result.imagePath : null,
  ];

  for (const candidate of candidates) {
    const normalized = stringOrNull(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function formatImageHistoryItem(item: CodexTurnItem): ThreadHistoryItemDto {
  const assetPath = extractImageAssetPath(item);
  const text =
    stringOrNull(item.text) ??
    assetPath ??
    'Image view';

  return {
    id: item.id,
    kind: 'image',
    text,
    previewText: text,
    detailText: assetPath,
    assetPath,
    status: item.status ?? null,
  };
}

function formatWebSearchHistoryItem(item: CodexTurnItem): ThreadHistoryItemDto {
  const queries = extractWebSearchQueries(item);
  const sources = extractWebSearchSources(item);
  const supplementalText = stringOrNull(item.text);
  const previewText =
    queries.length > 0
      ? queries.length <= 2
        ? queries.join('\n')
        : `${queries[0]}\n${queries[1]}\n+${queries.length - 2} more queries`
      : supplementalText ?? 'Web search';

  const detailLines: string[] = [];

  if (queries.length > 0) {
    detailLines.push(queries.length === 1 ? 'Search query' : 'Search queries', '');
    detailLines.push(...queries.map((query) => `- ${query}`), '');
  }

  if (sources.length > 0) {
    detailLines.push('Sources', '');
    for (const source of sources) {
      detailLines.push(`- ${source.title ?? 'Untitled source'}`);
      if (source.url) {
        detailLines.push(`  ${source.url}`);
      }
      if (source.snippet) {
        detailLines.push(`  ${source.snippet}`);
      }
    }
    detailLines.push('');
  }

  if (supplementalText && !queries.includes(supplementalText)) {
    detailLines.push('Additional text', '', supplementalText, '');
  }

  if (sources.length === 0) {
    const rawPayload = stringifyPayload(item);
    if (rawPayload) {
      detailLines.push('Raw payload', '', rawPayload, '');
    }
  }

  return {
    id: item.id,
    kind: 'webSearch',
    text: previewText,
    previewText,
    detailText: detailLines.join('\n').trim() || null,
    status: item.status ?? null,
  };
}

function isRunningItemStatus(status: string | null | undefined) {
  if (!status) {
    return false;
  }

  const normalized = status.toLowerCase();
  return (
    normalized.includes('running') ||
    normalized.includes('inprogress') ||
    normalized.includes('in_progress') ||
    normalized.includes('compacting')
  );
}

function formatContextCompactionHistoryItem(item: CodexTurnItem): ThreadHistoryItemDto {
  const rawText =
    stringOrNull(item.text) ??
    (Array.isArray(item.summary) ? item.summary.filter(Boolean).join('\n') : null);
  const status = stringOrNull(item.status) ?? stringOrNull(item.phase) ?? null;
  const previewText = isRunningItemStatus(status)
    ? 'Compacting context'
    : 'Context compacted';
  const detailText = rawText && rawText !== previewText ? rawText : null;

  return {
    id: item.id,
    kind: 'contextCompaction',
    text: previewText,
    previewText,
    detailText,
    status,
  };
}

function countUnifiedDiffStats(diffText: string) {
  let additions = 0;
  let deletions = 0;

  for (const line of diffText.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
      continue;
    }
    if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function extractPathFromDiffText(diffText: string) {
  for (const line of diffText.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.startsWith('+++ ')) {
      continue;
    }

    const candidate = line.slice(4).trim();
    if (!candidate || candidate === '/dev/null') {
      continue;
    }

    return candidate.replace(/^b\//, '');
  }

  return null;
}

function extractFileChangeEntries(item: CodexTurnItem) {
  const candidateArrays: unknown[] = [
    item.changes,
    item.files,
    isRecord(item.result) ? item.result.changes : null,
    isRecord(item.result) ? item.result.files : null,
    isRecord(item.action) ? item.action.changes : null,
    isRecord(item.action) ? item.action.files : null,
  ];

  const normalizedEntries = new Map<
    string,
    { path: string | null; additions: number; deletions: number }
  >();

  function valueFromRecords(
    records: Array<Record<string, unknown>>,
    keys: string[],
  ) {
    for (const record of records) {
      for (const key of keys) {
        const value = record[key];
        if (value !== undefined && value !== null) {
          return value;
        }
      }
    }

    return null;
  }

  function normalizeEntry(entry: unknown) {
    if (typeof entry === 'string') {
      return {
        path: entry.trim() || null,
        additions: 0,
        deletions: 0,
      };
    }

    if (!isRecord(entry)) {
      return null;
    }

    const nestedRecords = [
      entry,
      isRecord(entry.result) ? entry.result : null,
      isRecord(entry.action) ? entry.action : null,
      isRecord(entry.stats) ? entry.stats : null,
      isRecord(entry.summary) ? entry.summary : null,
      isRecord(entry.diff) ? entry.diff : null,
    ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));

    const path = uniqueStrings([
      stringOrNull(valueFromRecords(nestedRecords, ['path', 'filePath', 'targetPath'])),
      stringOrNull(
        valueFromRecords(nestedRecords, [
          'relativePath',
          'relative_path',
          'filename',
          'file',
          'newPath',
          'new_path',
          'oldPath',
          'old_path',
        ]),
      ),
    ])
      .map(projectRelativePathLabel)
      .find((entry): entry is string => Boolean(entry)) ?? null;

    const explicitAdditions =
      numberOrNull(
        valueFromRecords(nestedRecords, [
          'additions',
          'added',
          'insertions',
          'linesAdded',
          'lines_added',
          'addedLines',
          'added_lines',
          'numAdded',
          'num_added',
        ]),
      ) ?? 0;
    const explicitDeletions =
      numberOrNull(
        valueFromRecords(nestedRecords, [
          'deletions',
          'removed',
          'deleted',
          'linesRemoved',
          'lines_removed',
          'removedLines',
          'removed_lines',
          'numRemoved',
          'num_removed',
        ]),
      ) ?? 0;
    const diffText = stringOrNull(
      valueFromRecords(nestedRecords, ['diff', 'patch', 'unifiedDiff', 'unified_diff']),
    );
    const diffStats =
      explicitAdditions === 0 && explicitDeletions === 0 && diffText
        ? countUnifiedDiffStats(diffText)
        : null;
    const additions = explicitAdditions || diffStats?.additions || 0;
    const deletions = explicitDeletions || diffStats?.deletions || 0;
    const normalizedPath =
      path ?? (diffText ? projectRelativePathLabel(extractPathFromDiffText(diffText)) : null);

    if (!normalizedPath && additions === 0 && deletions === 0) {
      return null;
    }

    return {
      path: normalizedPath,
      additions,
      deletions,
    };
  }

  for (const candidateArray of candidateArrays) {
    if (!Array.isArray(candidateArray)) {
      continue;
    }

    for (const entry of candidateArray) {
      const normalized = normalizeEntry(entry);
      if (!normalized) {
        continue;
      }

      const key = normalized.path ?? `unknown:${normalizedEntries.size}`;
      const current = normalizedEntries.get(key);
      if (current) {
        current.additions += normalized.additions;
        current.deletions += normalized.deletions;
        continue;
      }

      normalizedEntries.set(key, normalized);
    }
  }

  return [...normalizedEntries.values()];
}

function formatFileChangeHistoryItem(item: CodexTurnItem): ThreadHistoryItemDto {
  const entries = extractFileChangeEntries(item);
  const fallbackText = stringOrNull(item.text) ?? 'File changes applied.';

  if (entries.length === 0) {
    return {
      id: item.id,
      kind: 'fileChange',
      text: fallbackText,
      previewText: fallbackText,
      status: item.status ?? null,
    };
  }

  const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
  const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);
  const summaryParts = [
    `${entries.length} ${entries.length === 1 ? 'file' : 'files'} changed`,
  ];
  if (additions > 0) {
    summaryParts.push(`+${additions}`);
  }
  if (deletions > 0) {
    summaryParts.push(`-${deletions}`);
  }

  const previewText = summaryParts.join(' · ');
  const fileNames = entries
    .map((entry) => entry.path)
    .filter((entry): entry is string => Boolean(entry));
  const primaryFileName = fileNames[0] ?? previewText;
  const compactPathText =
    fileNames.length === 0
      ? previewText
      : fileNames.length === 1
        ? primaryFileName
        : `${primaryFileName}, +${fileNames.length - 1} more`;
  const detailLines = entries.map((entry) => {
    const counts: string[] = [];
    if (entry.additions > 0) {
      counts.push(`+${entry.additions}`);
    }
    if (entry.deletions > 0) {
      counts.push(`-${entry.deletions}`);
    }
    return `- ${entry.path ?? 'Unknown file'}${counts.length > 0 ? ` (${counts.join(' ')})` : ''}`;
  });

  if (fallbackText !== 'File changes applied.' && fallbackText !== previewText) {
    detailLines.push('', fallbackText);
  }

  return {
    id: item.id,
    kind: 'fileChange',
    text: compactPathText,
    previewText,
    detailText: detailLines.join('\n'),
    status: item.status ?? null,
    changedFiles: entries.length,
    addedLines: additions,
    removedLines: deletions,
  };
}

function itemToHistoryItem(
  item: CodexTurnItem,
  deferredDetails?: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const hookPrompt = parseCodexHookPromptText(codexItemText(item));
  if (hookPrompt) {
    return {
      id: `hook-prompt:${hookPrompt.hookRunId ?? item.id}`,
      kind: 'hook',
      text: `${hookPrompt.eventLabel} hook`,
      previewText: hookPrompt.output || `${hookPrompt.eventLabel} hook`,
      detailText: hookPrompt.output || null,
      status: 'Completed',
      hookEventName: hookPrompt.eventName,
      hookEventLabel: hookPrompt.eventLabel,
      hookHandlerType: 'command',
      hookScope: 'turn',
      hookSource: hookPrompt.sourcePath ? 'project' : null,
      hookSourcePath: hookPrompt.sourcePath,
      hookStatusMessage: null,
      hookOutputEntries: hookPrompt.outputEntries,
    };
  }

  switch (item.type) {
    case 'userMessage':
      return {
        id: item.id,
        kind: 'userMessage',
        text: codexItemText(item),
      };
    case 'agentMessage':
      return {
        id: item.id,
        kind: 'agentMessage',
        text: codexItemText(item),
      };
    case 'text':
      return {
        id: item.id,
        kind: 'agentMessage',
        text: codexItemText(item),
      };
    case 'plan':
      return {
        id: item.id,
        kind: 'plan',
        text: codexItemText(item),
      };
    case 'contextCompaction':
    case 'context_compaction':
      return formatContextCompactionHistoryItem(item);
    case 'reasoning':
      return {
        id: item.id,
        kind: 'reasoning',
        text: [item.summary?.join('\n') ?? '', item.text ?? ''].filter(Boolean).join('\n\n'),
      };
    case 'commandExecution':
      return formatCommandHistoryItem(item, deferredDetails);
    case 'webSearch':
    case 'web_search':
    case 'webSearchCall':
    case 'web_search_call':
      return formatWebSearchHistoryItem(item);
    case 'imageView':
    case 'image_view':
    case 'viewImage':
    case 'view_image':
      return formatImageHistoryItem(item);
    case 'fileChange':
      return formatFileChangeHistoryItem(item);
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return formatToolCallHistoryItem(item, deferredDetails);
    case 'collabAgentToolCall':
      return formatToolCallHistoryItem(item, deferredDetails, 'agentToolCall');
    default:
      return {
        id: item.id,
        kind: 'other',
        text: codexItemText(item, item.type),
      };
  }
}

export function liveCodexItemToHistoryItem(
  item: CodexTurnItem,
  phase: 'started' | 'completed',
): ThreadHistoryItemDto | null {
  const historyItem = withCodexItemTimestamp(item, itemToHistoryItem(item));

  if (
    historyItem.kind !== 'commandExecution' &&
    historyItem.kind !== 'toolCall' &&
    historyItem.kind !== 'agentToolCall' &&
    historyItem.kind !== 'skillToolCall' &&
    historyItem.kind !== 'fileChange' &&
    historyItem.kind !== 'webSearch'
  ) {
    return null;
  }

  return {
    ...historyItem,
    status:
      historyItem.status ??
      (phase === 'started' ? 'running' : 'completed'),
  };
}

export function agentTurnToThreadTurnDto(
  turn: AgentTurn,
  deferredDetails?: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto {
  const baseTurn: ThreadTurnDto = {
    id: turn.providerTurnId,
    startedAt: turn.startedAt ?? parseUuidV7Timestamp(turn.providerTurnId),
    status: turn.status,
    error: turn.error?.message ?? null,
    items: visibleRuntimeTurnItems(turn.items).map((item, transcriptIndex) =>
      item.transcriptOrder === transcriptIndex
        ? item
        : { ...item, transcriptOrder: transcriptIndex },
    ),
  };

  return deferredDetails ? deferLargeHistoryItemDetails(baseTurn, deferredDetails) : baseTurn;
}

export function codexTurnToAgentTurn(turn: CodexTurnRecord): AgentTurn {
  return {
    providerTurnId: turn.id,
    rawTurnId: turn.id,
    status: turn.status,
    error: turn.error,
    items: turn.items.map((item) =>
      withCodexItemTimestamp(item, itemToHistoryItem(item)),
    ),
    rawTurn: turn,
  };
}

function applyRecordedTurnItemOrder(
  turn: ThreadTurnDto,
  turnItemOrder: TurnItemOrderSnapshot,
): ThreadTurnDto {
  const itemOrder = turnItemOrder.get(turn.id);
  if (!itemOrder || itemOrder.size === 0) {
    return turn;
  }

  let changed = false;
  const items = turn.items.map((item) => {
    const sequence = itemOrder.get(item.id);
    if (sequence === undefined || item.sequence === sequence) {
      return item;
    }

    changed = true;
    return {
      ...item,
      sequence,
    };
  });

  return changed ? { ...turn, items: sortTurnItemsByRecordedSequence(items) } : turn;
}

export function applyRecordedTurnItemOrders(
  turns: ThreadTurnDto[],
  turnItemOrder: TurnItemOrderSnapshot,
): ThreadTurnDto[] {
  if (turnItemOrder.size === 0) {
    return turns;
  }

  return turns.map((turn) => applyRecordedTurnItemOrder(turn, turnItemOrder));
}
