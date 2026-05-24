import path from 'node:path';

import type {
  AgentHistoryItem,
  AgentTurn,
} from '../../agent-runtime/src/index';

export interface OpenCodeHistoryItemMappingOptions {
  workspacePath?: string | null;
}

export interface OpenCodePlanUpdate {
  explanation: string | null;
  plan: Array<{ step: string; status: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizedToolName(toolName: string) {
  return toolName.replace(/[\s_-]+/g, '').toLowerCase();
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isoFromMs(value: unknown) {
  const time = numberValue(value);
  if (time === null) {
    return null;
  }
  return new Date(time).toISOString();
}

function toolContentText(content: unknown) {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((entry) => {
      if (!isRecord(entry)) {
        return '';
      }
      if (typeof entry.text === 'string') {
        return entry.text;
      }
      if (typeof entry.url === 'string') {
        return entry.url;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function toolStateDetail(state: Record<string, unknown>) {
  const parts = ['State:', compactJson(state)];
  const output = stringValue(state.output) ?? toolContentText(state.content);
  if (output) {
    parts.push('', 'Output:', output);
  }
  const error = isRecord(state.error)
    ? stringValue(state.error.message) ?? compactJson(state.error)
    : stringValue(state.error);
  if (error) {
    parts.push('', 'Error:', error);
  }
  return parts.join('\n');
}

function toolStateStatus(state: Record<string, unknown>) {
  const status = stringValue(state.status);
  if (status === 'pending' || status === 'running') {
    return 'running';
  }
  if (status === 'error') {
    return 'failed';
  }
  return 'completed';
}

function toolSummary(input: unknown) {
  if (!isRecord(input)) {
    return stringValue(input) ?? compactJson(input);
  }
  return (
    stringValue(input.description) ??
    stringValue(input.command) ??
    stringValue(input.cmd) ??
    stringValue(input.filePath) ??
    stringValue(input.file_path) ??
    stringValue(input.path) ??
    stringValue(input.file) ??
    stringValue(input.relativePath) ??
    stringValue(input.relative_path) ??
    stringValue(input.pattern) ??
    stringValue(input.query) ??
    stringValue(input.url) ??
    compactJson(input)
  );
}

function commandSummary(input: unknown, state: Record<string, unknown>) {
  const command = isRecord(input)
    ? stringValue(input.command) ?? stringValue(input.cmd)
    : null;
  if (command) {
    return command;
  }
  const raw = stringValue(state.raw);
  if (raw) {
    return raw;
  }
  return toolSummary(input);
}

function firstStringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function filePathFromInput(input: unknown) {
  if (!isRecord(input)) {
    return null;
  }
  return firstStringValue(input, [
    'filePath',
    'file_path',
    'path',
    'file',
    'relativePath',
    'relative_path',
    'target',
  ]);
}

function displayPath(pathValue: string | null, options: OpenCodeHistoryItemMappingOptions) {
  if (!pathValue) {
    return null;
  }
  if (!path.isAbsolute(pathValue) || !options.workspacePath) {
    return pathValue;
  }

  const root = path.resolve(options.workspacePath);
  const absolutePath = path.resolve(pathValue);
  const relativePath = path.relative(root, absolutePath);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    return pathValue;
  }
  return relativePath;
}

function toolIsLowInformationPatch(
  normalized: string,
  state: Record<string, unknown>,
  input: unknown,
  patchText: string | null,
  path: string | null,
  metadataStats: ReturnType<typeof fileChangeStatsFromMetadata>,
) {
  if (normalized !== 'applypatch' && normalized !== 'patch') {
    return false;
  }
  if (toolStateStatus(state) !== 'running') {
    return false;
  }
  if (path || patchText || metadataStats || stringValue(state.output)) {
    return false;
  }
  return !isRecord(input) || Object.keys(input).length === 0;
}

function countUnifiedDiffStats(diffText: string | null) {
  if (!diffText) {
    return null;
  }
  let addedLines = 0;
  let removedLines = 0;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      addedLines += 1;
    } else if (line.startsWith('-')) {
      removedLines += 1;
    }
  }
  return { addedLines, removedLines };
}

function extractPathFromPatchText(patchText: string | null) {
  if (!patchText) {
    return null;
  }
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function fileChangeStatsFromMetadata(metadata: unknown) {
  if (!isRecord(metadata) || !Array.isArray(metadata.files)) {
    return null;
  }
  const files = metadata.files.filter(isRecord);
  if (files.length === 0) {
    return null;
  }
  const paths = files
    .map((file) => (
      stringValue(file.filePath) ??
      stringValue(file.path) ??
      stringValue(file.relativePath)
    ))
    .filter((path): path is string => Boolean(path));
  const addedLines = files.reduce((total, file) => (
    total +
    (numberValue(file.additions) ??
      numberValue(file.addedLines) ??
      numberValue(file.added) ??
      0)
  ), 0);
  const removedLines = files.reduce((total, file) => (
    total +
    (numberValue(file.deletions) ??
      numberValue(file.removedLines) ??
      numberValue(file.removed) ??
      0)
  ), 0);
  return {
    changedFiles: files.length,
    path: paths[0] ?? null,
    previewText: paths.length > 1
      ? `${paths.length} changed files`
      : paths[0] ?? `${files.length} changed file${files.length === 1 ? '' : 's'}`,
    addedLines,
    removedLines,
  };
}

function todoRecordsFromValue(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value) && Array.isArray(value.todos)) {
    return value.todos;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return todoRecordsFromValue(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function planUpdateFromTodoTool(tool: Record<string, unknown>): OpenCodePlanUpdate | null {
  const name = stringValue(tool.name) ?? stringValue(tool.tool) ?? '';
  const normalized = normalizedToolName(name);
  if (normalized !== 'todowrite' && normalized !== 'todo' && normalized !== 'todos') {
    return null;
  }

  const state = isRecord(tool.state) ? tool.state : {};
  const todos =
    todoRecordsFromValue(state.input) ??
    (isRecord(state.metadata) ? todoRecordsFromValue(state.metadata) : null) ??
    todoRecordsFromValue(state.output);
  if (!todos || todos.length === 0) {
    return null;
  }

  const plan = todos
    .map((todo) => {
      if (!isRecord(todo)) {
        return null;
      }
      const step = stringValue(todo.content) ?? stringValue(todo.step) ?? stringValue(todo.title);
      if (!step) {
        return null;
      }
      return {
        step,
        status: stringValue(todo.status) ?? 'pending',
      };
    })
    .filter((step): step is { step: string; status: string } => Boolean(step));

  return plan.length > 0
    ? {
        explanation: null,
        plan,
      }
    : null;
}

function normalizeLegacyPart(part: unknown): unknown {
  if (!isRecord(part)) {
    return null;
  }
  const type = stringValue(part.type);
  if (type !== 'tool') {
    return part;
  }
  return {
    ...part,
    name: stringValue(part.name) ?? stringValue(part.tool) ?? 'Tool',
  };
}

function normalizeLegacyParts(parts: unknown[], fallbackText: string | null) {
  const normalized = parts.map(normalizeLegacyPart).filter(Boolean);
  if (normalized.length > 0 || !fallbackText) {
    return normalized;
  }
  return [{ type: 'text', text: fallbackText }];
}

function normalizeLegacyMessage(message: unknown): unknown {
  if (!isRecord(message) || !isRecord(message.info) || !Array.isArray(message.parts)) {
    return message;
  }
  const info = message.info;
  const role = stringValue(info.role) ?? stringValue(info.type);
  const id = stringValue(info.id) ?? crypto.randomUUID();
  const time = isRecord(info.time) ? info.time : undefined;

  if (role === 'user') {
    const text = message.parts
      .map((part) => (isRecord(part) && stringValue(part.text) ? part.text : null))
      .filter((text): text is string => Boolean(text))
      .join('\n');
    return {
      id,
      type: 'user',
      time,
      text,
    };
  }

  if (role !== 'assistant') {
    return message;
  }

  const model = isRecord(info.model)
    ? {
        id: stringValue(info.model.id) ?? stringValue(info.model.modelID) ?? stringValue(info.modelID) ?? 'unknown',
        providerID: stringValue(info.model.providerID) ?? stringValue(info.providerID) ?? 'unknown',
        variant: stringValue(info.model.variant) ?? stringValue(info.variant) ?? 'default',
      }
    : {
        id: stringValue(info.modelID) ?? 'unknown',
        providerID: stringValue(info.providerID) ?? 'unknown',
        variant: stringValue(info.variant) ?? 'default',
      };

  return {
    id,
    type: 'assistant',
    time,
    agent: stringValue(info.agent) ?? 'build',
    model,
    content: normalizeLegacyParts(message.parts, stringValue(info.text)),
    error: info.error,
    cost: numberValue(info.cost) ?? undefined,
    tokens: isRecord(info.tokens) ? info.tokens : undefined,
    finish: stringValue(info.finish) ?? undefined,
  };
}

function mapAssistantTool(
  messageId: string,
  tool: Record<string, unknown>,
  options: OpenCodeHistoryItemMappingOptions,
): AgentHistoryItem | null {
  const id = stringValue(tool.id) ?? `${messageId}:tool`;
  const name = stringValue(tool.name) ?? stringValue(tool.tool) ?? 'Tool';
  const state = isRecord(tool.state) ? tool.state : {};
  const input = state.input;
  const summary = toolSummary(input);
  const detailText = [`Tool: ${name}`, '', 'Input:', compactJson(input), '', toolStateDetail(state)]
    .filter(Boolean)
    .join('\n');
  const normalized = normalizedToolName(name);

  if (normalized === 'bash' || normalized === 'shell') {
    const command = commandSummary(input, state);
    return {
      id,
      kind: 'commandExecution',
      text: command || name,
      previewText: command || name,
      detailText,
      status: toolStateStatus(state),
    };
  }

  if ([
    'edit',
    'multiedit',
    'write',
    'notebookedit',
    'applypatch',
    'patch',
  ].includes(normalized)) {
    const metadataStats = fileChangeStatsFromMetadata(state.metadata);
    const patchText = isRecord(input)
      ? stringValue(input.patchText) ??
        stringValue(input.patch) ??
        stringValue(input.diff)
      : null;
    const path = metadataStats?.path ?? filePathFromInput(input) ?? extractPathFromPatchText(patchText);
    if (toolIsLowInformationPatch(normalized, state, input, patchText, path, metadataStats)) {
      return null;
    }
    const output = stringValue(state.output);
    const diffStats = countUnifiedDiffStats(patchText);
    const displayFilePath = displayPath(path, options);
    return {
      id,
      kind: 'fileChange',
      text: metadataStats
        ? metadataStats.changedFiles > 1
          ? `${metadataStats.changedFiles} changed files`
          : displayFilePath ?? metadataStats.previewText
        : displayFilePath ?? output ?? summary ?? name,
      previewText: metadataStats
        ? metadataStats.changedFiles > 1
          ? `${metadataStats.changedFiles} changed files`
          : displayFilePath ?? metadataStats.previewText
        : displayFilePath
          ? `${name}: ${displayFilePath}`
          : output ?? summary ?? name,
      detailText,
      changedFiles: metadataStats?.changedFiles ?? (path ? 1 : null),
      addedLines: metadataStats?.addedLines ?? diffStats?.addedLines ?? null,
      removedLines: metadataStats?.removedLines ?? diffStats?.removedLines ?? null,
      status: toolStateStatus(state),
    };
  }

  if (['read', 'grep', 'glob', 'list', 'ls', 'bashoutput'].includes(normalized)) {
    const path = filePathFromInput(input);
    const text = displayPath(path, options) ?? summary ?? name;
    return {
      id,
      kind: 'fileRead',
      text,
      previewText: text,
      detailText,
      status: toolStateStatus(state),
    };
  }

  if (normalized.includes('web')) {
    return {
      id,
      kind: 'webSearch',
      text: summary || name,
      previewText: summary || name,
      detailText,
      status: toolStateStatus(state),
    };
  }

  if (normalized === 'todowrite' || normalized === 'todo' || normalized === 'todos') {
    return null;
  }

  if (normalized === 'task' || normalized === 'agent') {
    return {
      id,
      kind: 'agentToolCall',
      text: summary ? `${name}: ${summary}` : name,
      previewText: name,
      detailText,
      status: toolStateStatus(state),
    };
  }

  if (normalized === 'skill') {
    const skill = isRecord(input) ? stringValue(input.skill) ?? stringValue(input.name) : null;
    return {
      id,
      kind: 'skillToolCall',
      text: skill ? `Skill: ${skill}` : summary ? `${name}: ${summary}` : name,
      previewText: skill ?? name,
      detailText,
      status: toolStateStatus(state),
    };
  }

  return {
    id,
    kind: 'toolCall',
    text: summary ? `${name}: ${summary}` : name,
    previewText: name,
    detailText,
    status: toolStateStatus(state),
  };
}

function openCodeMessageToPlanUpdate(message: unknown): OpenCodePlanUpdate | null {
  const normalizedMessage = normalizeLegacyMessage(message);
  if (!isRecord(normalizedMessage)) {
    return null;
  }
  const content = Array.isArray(normalizedMessage.content)
    ? normalizedMessage.content
    : [];
  for (const part of content) {
    if (!isRecord(part) || stringValue(part.type) !== 'tool') {
      continue;
    }
    const planUpdate = planUpdateFromTodoTool(part);
    if (planUpdate) {
      return planUpdate;
    }
  }
  return null;
}

export function openCodeMessagesToPlanUpdate(messages: unknown[]): OpenCodePlanUpdate | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const planUpdate = openCodeMessageToPlanUpdate(messages[index]);
    if (planUpdate) {
      return planUpdate;
    }
  }
  return null;
}

function mapAssistantPart(
  messageId: string,
  part: Record<string, unknown>,
  index: number,
  options: OpenCodeHistoryItemMappingOptions,
): AgentHistoryItem | null {
  const partId = stringValue(part.id) ?? `${messageId}:${stringValue(part.type) ?? 'part'}:${index}`;
  const partType = stringValue(part.type);

  if (partType === 'text') {
    const text = stringValue(part.text);
    return text
      ? {
          id: `${messageId}:text:${index}`,
          kind: 'agentMessage',
          text,
        }
      : null;
  }

  if (partType === 'reasoning') {
    const text = stringValue(part.text);
    return text
      ? {
          id: partId,
          kind: 'reasoning',
          text,
        }
      : null;
  }

  if (partType === 'tool') {
    return mapAssistantTool(messageId, part, options);
  }

  if (partType === 'file') {
    const sourcePath = isRecord(part.source) ? stringValue(part.source.path) : null;
    const filename = displayPath(sourcePath, options) ??
      stringValue(part.filename) ??
      stringValue(part.url) ??
      'Attached file';
    const sourceText = isRecord(part.source) && isRecord(part.source.text)
      ? stringValue(part.source.text.value)
      : null;
    return {
      id: partId,
      kind: 'fileRead',
      text: filename,
      previewText: filename,
      detailText: sourceText ?? compactJson(part),
      status: 'completed',
    };
  }

  if (partType === 'patch') {
    const files = Array.isArray(part.files)
      ? part.files.filter((file): file is string => typeof file === 'string')
      : [];
    const displayFiles = files.map((file) => displayPath(file, options) ?? file);
    return {
      id: partId,
      kind: 'fileChange',
      text: displayFiles.length > 0 ? displayFiles.join('\n') : stringValue(part.hash) ?? 'Patch',
      previewText: files.length > 0 ? `${files.length} changed file${files.length === 1 ? '' : 's'}` : 'Patch',
      detailText: compactJson(part),
      changedFiles: files.length || null,
      addedLines: null,
      removedLines: null,
      status: 'completed',
    };
  }

  if (partType === 'step-finish') {
    return null;
  }

  if (partType === 'step-start') {
    return null;
  }

  if (partType === 'snapshot') {
    return {
      id: partId,
      kind: 'other',
      text: stringValue(part.snapshot) ?? 'Snapshot',
      previewText: 'Snapshot',
      status: 'completed',
    };
  }

  if (partType === 'agent') {
    const name = stringValue(part.name) ?? 'Agent';
    const source = isRecord(part.source) ? stringValue(part.source.value) : null;
    return {
      id: partId,
      kind: 'agentToolCall',
      text: source ? `${name}: ${source}` : name,
      previewText: name,
      detailText: compactJson(part),
      status: 'completed',
    };
  }

  if (partType === 'subtask') {
    const description = stringValue(part.description);
    const prompt = stringValue(part.prompt);
    return {
      id: partId,
      kind: 'agentToolCall',
      text: description ?? prompt ?? 'Subtask',
      previewText: stringValue(part.agent) ?? 'Subtask',
      detailText: compactJson(part),
      status: 'completed',
    };
  }

  if (partType === 'retry') {
    const error = isRecord(part.error)
      ? stringValue(part.error.message) ?? compactJson(part.error)
      : stringValue(part.error);
    return {
      id: partId,
      kind: 'other',
      text: error ? `Retry ${numberValue(part.attempt) ?? ''}: ${error}` : `Retry ${numberValue(part.attempt) ?? ''}`.trim(),
      previewText: 'Retry',
      detailText: compactJson(part),
      status: 'failed',
    };
  }

  if (partType === 'compaction') {
    return {
      id: partId,
      kind: 'contextCompaction',
      text: part.auto === true ? 'Context compacted automatically' : 'Context compacted',
      previewText: 'Context compacted',
    };
  }

  return {
    id: partId,
    kind: 'other',
    text: compactJson(part),
    previewText: partType ?? 'OpenCode part',
  };
}

export function openCodeMessageToHistoryItems(
  message: unknown,
  options: OpenCodeHistoryItemMappingOptions = {},
): AgentHistoryItem[] {
  message = normalizeLegacyMessage(message);
  if (!isRecord(message)) {
    return [];
  }
  const id = stringValue(message.id) ?? crypto.randomUUID();
  const type = stringValue(message.type);
  if (type === 'user') {
    return [{
      id,
      kind: 'userMessage',
      text: stringValue(message.text) ?? '',
    }];
  }
  if (type === 'synthetic') {
    return [{
      id,
      kind: 'other',
      text: stringValue(message.text) ?? 'Synthetic message',
      previewText: 'Synthetic message',
    }];
  }
  if (type === 'shell') {
    const command = stringValue(message.command) ?? 'Shell command';
    return [{
      id,
      kind: 'commandExecution',
      text: command,
      previewText: command,
      detailText: stringValue(message.output) ?? null,
      status: isRecord(message.time) && typeof message.time.completed === 'number'
        ? 'completed'
        : 'running',
    }];
  }
  if (type === 'agent-switched') {
    return [{
      id,
      kind: 'other',
      text: `Agent switched to ${stringValue(message.agent) ?? 'unknown'}`,
      previewText: 'Agent switched',
    }];
  }
  if (type === 'model-switched') {
    const model = isRecord(message.model)
      ? [stringValue(message.model.providerID), stringValue(message.model.id)]
        .filter(Boolean)
        .join('/')
      : 'unknown';
    return [{
      id,
      kind: 'other',
      text: `Model switched to ${model}`,
      previewText: 'Model switched',
    }];
  }
  if (type === 'compaction') {
    return [{
      id,
      kind: 'contextCompaction',
      text: stringValue(message.summary) ?? 'Context compacted',
      previewText: `${stringValue(message.reason) ?? 'manual'} compaction`,
    }];
  }
  if (type !== 'assistant') {
    return [{
      id,
      kind: 'other',
      text: compactJson(message),
      previewText: type ?? 'OpenCode message',
    }];
  }

  const items: AgentHistoryItem[] = [];
  const content = Array.isArray(message.content) ? message.content : [];
  for (const [index, part] of content.entries()) {
    if (!isRecord(part)) {
      continue;
    }
    const item = mapAssistantPart(id, part, index, options);
    if (item) {
      items.push(item);
    }
  }

  const error = isRecord(message.error)
    ? stringValue(message.error.message) ?? compactJson(message.error)
    : null;
  if (error) {
    items.push({
      id: `${id}:error`,
      kind: 'other',
      text: error,
      previewText: 'Assistant error',
      status: 'failed',
    });
  }
  return items;
}

export function openCodeMessagesToTurns(
  messages: unknown[],
  options: OpenCodeHistoryItemMappingOptions = {},
): AgentTurn[] {
  const turns: AgentTurn[] = [];
  let current: {
    providerTurnId: string;
    startedAt: string | null;
    items: AgentHistoryItem[];
    error: string | null;
    hasAssistantResult: boolean;
  } | null = null;

  const flush = () => {
    if (!current || current.items.length === 0) {
      return;
    }
    turns.push({
      providerTurnId: current.providerTurnId,
      startedAt: current.startedAt,
      status: current.error ? 'failed' : current.hasAssistantResult ? 'completed' : 'inProgress',
      error: current.error ? { message: current.error } : null,
      items: current.items,
    });
    current = null;
  };

  for (const message of messages) {
    const normalizedMessage = normalizeLegacyMessage(message);
    if (!isRecord(normalizedMessage)) {
      continue;
    }
    const id = stringValue(normalizedMessage.id) ?? crypto.randomUUID();
    const type = stringValue(normalizedMessage.type);
    const createdAt = isRecord(normalizedMessage.time) ? isoFromMs(normalizedMessage.time.created) : null;
    if (type === 'user') {
      flush();
      current = {
        providerTurnId: `opencode-turn-${id}`,
        startedAt: createdAt,
        items: openCodeMessageToHistoryItems(normalizedMessage, options),
        error: null,
        hasAssistantResult: false,
      };
      continue;
    }
    if (!current) {
      current = {
        providerTurnId: `opencode-turn-${id}`,
        startedAt: createdAt,
        items: [],
        error: null,
        hasAssistantResult: false,
      };
    }
    const items = openCodeMessageToHistoryItems(normalizedMessage, options);
    current.items.push(...items);
    if (items.some((item) => item.kind !== 'userMessage' && item.kind !== 'other')) {
      current.hasAssistantResult = true;
    }
    if (isRecord(normalizedMessage.error)) {
      current.error = stringValue(normalizedMessage.error.message) ?? compactJson(normalizedMessage.error);
    }
  }
  flush();
  return turns;
}
