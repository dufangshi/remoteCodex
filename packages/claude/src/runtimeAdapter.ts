import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type {
  AgentActionQuestion,
  AgentActionRequestResponseInput,
  AgentHistoryItem,
  AgentMcpServer,
  AgentModel,
  AgentPendingProviderRequest,
  AgentProviderRequest,
  AgentProviderRequestMapping,
  AgentProviderCapabilities,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeManagementSchema,
  AgentRuntimeToolboxItemSchema,
  AgentRuntimeStatus,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTurn,
  InterruptAgentTurnInput,
  ReadAgentSessionOptions,
  ResumeAgentSessionInput,
  StartAgentSessionInput,
  StartAgentSessionResult,
  StartAgentTurnInput,
} from '../../agent-runtime/src/index';
import type {
  AgentBackendInstallationDto,
} from '../../shared/src/index';
import {
  AgentRuntimeError,
  markTransientAgentHistoryItem,
} from '../../agent-runtime/src/index';
import {
  assistantMessageToHistoryItems,
  buildAgentTurn,
  hiddenInitPrompt,
  isHiddenContinuationMessage,
  isHiddenInitMessage,
  partialReasoningDelta,
  partialTextDelta,
  resultForToolUse,
  suppressedClaudeToolUseIds,
  toolUseFromPartialStart,
  toolUseToHistoryItem,
  toolResultBlocks,
  userMessageHistoryItem,
  userMessageToHistoryItem,
} from './historyItems';

const execFileAsync = promisify(execFile);

type ClaudePromptInput = string | AsyncIterable<SDKUserMessage>;
type ClaudeMessageContent =
  | string
  | Array<{
      type: 'text';
      text: string;
    } | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      };
    }>;
type ClaudeMessageContentBlock = Exclude<ClaudeMessageContent, string>[number];
type ClaudeQueryFunction = (input: {
  prompt: ClaudePromptInput;
  options: ClaudeQueryOptions;
}) => Query;
type ClaudeListSessionsFunction = (_options: ListSessionsOptions) => Promise<SDKSessionInfo[]>;
type ClaudeGetSessionMessagesFunction = (
  sessionId: string,
  options: GetSessionMessagesOptions,
) => Promise<SessionMessage[]>;
type ClaudeGetSessionInfoFunction = (
  sessionId: string,
  options: GetSessionInfoOptions,
) => Promise<SDKSessionInfo | null>;
interface ClaudeSdkModule {
  query: ClaudeQueryFunction;
  listSessions: ClaudeListSessionsFunction;
  getSessionMessages: ClaudeGetSessionMessagesFunction;
  getSessionInfo: ClaudeGetSessionInfoFunction;
}
interface Query extends AsyncIterable<SDKMessage> {
  close(): void;
  interrupt(): Promise<void>;
  supportedModels(): Promise<ModelInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
}
interface SDKMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  cwd?: string;
  model?: string;
  slash_commands?: unknown;
  uuid?: string;
  message?: unknown;
  event?: unknown;
  parent_tool_use_id?: string | null;
  tool_use_result?: unknown;
  tool_use_id?: string;
  tool_name?: string;
  elapsed_time_seconds?: number;
  usage?: unknown;
  modelUsage?: unknown;
  errors?: string[];
  stop_reason?: string;
}
interface SDKUserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: ClaudeMessageContent;
  };
  parent_tool_use_id: string | null;
}
interface SDKSessionInfo {
  sessionId: string;
  cwd?: string;
  firstPrompt?: string | null;
  summary?: string | null;
  customTitle?: string | null;
  createdAt?: number | null;
  lastModified?: number | null;
}
type SessionMessage = SDKMessage;
interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportedEffortLevels?: string[];
  supportsEffort?: boolean;
}
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
interface SandboxSettings {
  enabled: boolean;
  autoAllowBashIfSandboxed?: boolean;
  allowUnsandboxedCommands?: boolean;
  filesystem?: {
    allowWrite?: string[];
    denyWrite?: string[];
  };
}
interface ClaudeQueryOptions {
  includeHookEvents?: boolean;
  permissionMode?: PermissionMode;
  thinking?: {
    type: string;
    display: string;
  };
  env?: Record<string, string | undefined>;
  cwd?: string;
  sandbox?: SandboxSettings;
  model?: string;
  betas?: string[];
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  resume?: string;
  includePartialMessages?: boolean;
  maxTurns?: number;
  tools?: unknown;
  allowDangerouslySkipPermissions?: boolean;
  pathToClaudeCodeExecutable?: string;
}
type GetSessionInfoOptions = Record<string, never>;
interface GetSessionMessagesOptions {
  includeSystemMessages?: boolean;
}
type ListSessionsOptions = Record<string, never>;
interface McpServerStatus {
  name: string;
  status: string;
  tools?: Array<{
    name: string;
    description?: string | null;
  }>;
}
export interface ClaudeRuntimeAdapterOptions {
  home: string;
  command?: string;
  clientInfo?: {
    name: string;
    title?: string;
    version?: string;
  };
  query?: ClaudeQueryFunction;
  listSessions?: ClaudeListSessionsFunction;
  getSessionMessages?: ClaudeGetSessionMessagesFunction;
  getSessionInfo?: ClaudeGetSessionInfoFunction;
  sdk?: ClaudeSdkModule;
}

interface ActiveClaudeTurn {
  providerSessionId: string;
  providerTurnId: string;
  startedAt: string;
  query: Query;
  items: Map<string, AgentHistoryItem>;
  itemOrder: string[];
  emittedItems: Set<string>;
  currentStreamMessageId: string | null;
  interrupted: boolean;
  completed: boolean;
  suppressedToolUseIds: Set<string>;
  assistantUsage: ClaudeTokenUsageBreakdown | null;
  resultUsage: ClaudeTokenUsageBreakdown | null;
  modelContextWindow: number | null;
}

const promptPhotoTokenPattern = /\[PHOTO\s+([^\]]+)\]/g;

function mimeTypeForImagePath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg' as const;
    case '.png':
      return 'image/png' as const;
    case '.gif':
      return 'image/gif' as const;
    case '.webp':
      return 'image/webp' as const;
    default:
      return null;
  }
}

function extensionForImageMediaType(mediaType: string | null | undefined) {
  switch (mediaType?.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

function resolvePromptAssetPath(assetPath: string, cwd: string | null | undefined) {
  if (!cwd) {
    return null;
  }
  const resolvedPath = path.isAbsolute(assetPath)
    ? path.normalize(assetPath)
    : path.resolve(cwd, assetPath);
  const relativePath = path.relative(cwd, resolvedPath);
  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return resolvedPath;
  }
  return null;
}

function safeAssetFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || randomUUID();
}

async function* singleUserMessage(content: ClaudeMessageContent): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
  };
}

async function promptWithImageBlocks(
  prompt: string,
  cwd: string | null | undefined,
): Promise<ClaudePromptInput> {
  const matches = [...prompt.matchAll(promptPhotoTokenPattern)];
  if (matches.length === 0) {
    return prompt;
  }

  const blocks: ClaudeMessageContentBlock[] = [];
  let cursor = 0;
  let includedImage = false;

  for (const match of matches) {
    const token = match[0];
    const assetPath = match[1]?.trim() ?? '';
    const start = match.index ?? 0;
    const precedingText = prompt.slice(cursor, start);
    if (precedingText) {
      blocks.push({ type: 'text', text: precedingText });
    }

    const resolvedPath = resolvePromptAssetPath(assetPath, cwd);
    const mediaType = resolvedPath ? mimeTypeForImagePath(resolvedPath) : null;
    if (!resolvedPath || !mediaType) {
      blocks.push({ type: 'text', text: token });
      cursor = start + token.length;
      continue;
    }

    try {
      const data = await fs.readFile(resolvedPath, 'base64');
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data,
        },
      });
      includedImage = true;
    } catch {
      blocks.push({ type: 'text', text: token });
    }

    cursor = start + token.length;
  }

  const trailingText = prompt.slice(cursor);
  if (trailingText) {
    blocks.push({ type: 'text', text: trailingText });
  }

  if (!includedImage) {
    return prompt;
  }

  return singleUserMessage(blocks);
}

function mergeActiveTranscriptItems(
  transcriptItems: AgentHistoryItem[],
  activeItems: AgentHistoryItem[],
) {
  const mergedItems = [...transcriptItems];
  const itemIds = new Set(mergedItems.map((item) => item.id));
  for (const item of activeItems) {
    if (item.kind === 'userMessage' || itemIds.has(item.id)) {
      continue;
    }
    mergedItems.push(item);
    itemIds.add(item.id);
  }
  return mergedItems;
}

interface ClaudeTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export const claudeCapabilities: AgentProviderCapabilities = {
  sessions: {
    list: true,
    read: true,
    resume: true,
    importLocal: false,
  },
  turns: {
    start: true,
    streamInput: false,
    steer: false,
    interrupt: true,
    compact: false,
  },
  branching: {
    fork: false,
    hardRollback: false,
    resumeAt: false,
    rewindFiles: false,
  },
  controls: {
    planMode: true,
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
  usage: {
    contextWindow: true,
    tokenUsage: true,
    costUsd: true,
  },
};

function normalizeClaudeSlashCommands(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const commands = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const command = entry.trim().replace(/^\/+/, '');
    if (command) {
      commands.add(command);
    }
  }
  return [...commands].sort((left, right) => left.localeCompare(right));
}

function claudeSlashLabel(command: string) {
  switch (command) {
    case 'compact':
      return '/compact';
    case 'clear':
      return '/clear';
    case 'context':
      return '/context';
    case 'usage':
      return '/usage';
    default:
      return `/${command}`;
  }
}

function buildClaudeToolboxItems(
  slashCommands: string[],
): AgentRuntimeToolboxItemSchema[] {
  const discovered = new Set(slashCommands);
  const items: AgentRuntimeToolboxItemSchema[] = [
    {
      action: 'mcp',
      command: '/mcp',
      label: 'MCP',
      description: 'Open MCP status for this Claude Code session.',
      panel: 'mcp',
    },
  ];

  for (const command of slashCommands) {
    if (command === 'mcp') {
      continue;
    }
    items.push({
      action: 'prompt',
      command: `/${command}`,
      label: claudeSlashLabel(command),
      description: 'Claude Code slash command discovered from the SDK session.',
    });
  }

  if (!discovered.has('btw')) {
    items.push({
      action: 'unsupported',
      command: '/btw',
      label: '/btw',
      description:
        'Not listed by the current Claude Agent SDK session; it may require the interactive Claude TTY or a different Claude Code version.',
    });
  }

  return items;
}

const DEFAULT_CLAUDE_MODELS: AgentModel[] = [
  {
    id: 'sonnet',
    model: 'sonnet',
    displayName: 'Claude Sonnet',
    description: 'Claude Code default Sonnet model alias.',
    isDefault: true,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low effort' },
      { reasoningEffort: 'medium', description: 'Medium effort' },
      { reasoningEffort: 'high', description: 'High effort' },
      { reasoningEffort: 'xhigh', description: 'Extra high effort' },
      { reasoningEffort: 'max', description: 'Maximum effort' },
    ],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'sonnet-1m',
    model: 'sonnet[1m]',
    displayName: 'Claude Sonnet 1M',
    description: 'Claude Code Sonnet with the 1M token context beta enabled.',
    isDefault: false,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low effort' },
      { reasoningEffort: 'medium', description: 'Medium effort' },
      { reasoningEffort: 'high', description: 'High effort' },
      { reasoningEffort: 'xhigh', description: 'Extra high effort' },
      { reasoningEffort: 'max', description: 'Maximum effort' },
    ],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'fable',
    model: 'fable',
    displayName: 'Claude Fable',
    description: 'Claude Code Fable model alias.',
    isDefault: false,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low effort' },
      { reasoningEffort: 'medium', description: 'Medium effort' },
      { reasoningEffort: 'high', description: 'High effort' },
      { reasoningEffort: 'xhigh', description: 'Extra high effort' },
      { reasoningEffort: 'max', description: 'Maximum effort' },
    ],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'opus',
    model: 'opus',
    displayName: 'Claude Opus',
    description: 'Claude Code Opus model alias.',
    isDefault: false,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low effort' },
      { reasoningEffort: 'medium', description: 'Medium effort' },
      { reasoningEffort: 'high', description: 'High effort' },
      { reasoningEffort: 'xhigh', description: 'Extra high effort' },
      { reasoningEffort: 'max', description: 'Maximum effort' },
    ],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'haiku',
    model: 'haiku',
    displayName: 'Claude Haiku',
    description: 'Claude Code Haiku model alias.',
    isDefault: false,
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toIsoFromMs(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value).toISOString();
}

function isoFromUuidV7(value: string | null | undefined) {
  const normalized = value?.replace(/-/g, '').trim();
  if (!normalized || normalized.length !== 32 || normalized[12] !== '7') {
    return null;
  }

  const timestampHex = normalized.slice(0, 12);
  const timestamp = Number.parseInt(timestampHex, 16);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function mapModelInfo(model: ModelInfo, index: number): AgentModel {
  return {
    id: model.value,
    model: model.value,
    displayName: model.displayName,
    description: model.description,
    isDefault: index === 0,
    hidden: false,
    supportedReasoningEfforts: (model.supportedEffortLevels ?? []).map((effort) => ({
      reasoningEffort: effort,
      description: `${effort} effort`,
    })),
    defaultReasoningEffort: model.supportsEffort ? 'medium' : null,
  };
}

function withClaudeCodeModelAliases(models: AgentModel[]) {
  const output = [...models];
  const defaultSonnet = DEFAULT_CLAUDE_MODELS[0]!;
  const oneMillionSonnet = DEFAULT_CLAUDE_MODELS[1]!;
  const fable = DEFAULT_CLAUDE_MODELS[2]!;
  const hasSonnetAlias = output.some((model) => model.model === 'sonnet');
  if (!hasSonnetAlias) {
    output.unshift(defaultSonnet);
  }
  if (!output.some((model) => model.model === 'sonnet[1m]')) {
    output.splice(1, 0, oneMillionSonnet);
  }
  if (!output.some((model) => model.model === 'fable')) {
    output.splice(2, 0, fable);
  }
  return output.map((model, index) => ({
    ...model,
    isDefault: index === 0,
  }));
}

function normalizeClaudeModelForQuery(model: string | null | undefined) {
  return model === 'sonnet[1m]' ? 'sonnet' : model;
}

function shouldEnableOneMillionContext(model: string | null | undefined) {
  return model === 'sonnet[1m]';
}

function displayClaudeModel(
  requestedModel: string | null | undefined,
  runtimeModel: string | null | undefined,
) {
  return shouldEnableOneMillionContext(requestedModel)
    ? requestedModel!
    : runtimeModel ?? requestedModel ?? null;
}

function permissionModeForInput(
  input: Pick<StartAgentSessionInput, 'approvalMode'> & {
    collaborationMode?: StartAgentTurnInput['collaborationMode'];
    sandboxMode?: StartAgentTurnInput['sandboxMode'];
  },
): { permissionMode: PermissionMode; allowDangerouslySkipPermissions?: boolean } {
  if (input.collaborationMode === 'plan') {
    return { permissionMode: 'plan' };
  }
  if (input.approvalMode === 'yolo' || input.sandboxMode === 'danger-full-access') {
    return {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };
  }
  if (input.sandboxMode === 'workspace-write') {
    return { permissionMode: 'acceptEdits' };
  }
  return { permissionMode: 'default' };
}

function sandboxSettingsForInput(
  input: {
    cwd?: string | null | undefined;
    sandboxMode?: StartAgentTurnInput['sandboxMode'];
  },
): SandboxSettings | undefined {
  if (!input.sandboxMode || input.sandboxMode === 'danger-full-access') {
    return undefined;
  }

  if (input.sandboxMode === 'read-only') {
    return {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      ...(input.cwd
        ? {
            filesystem: {
              denyWrite: [input.cwd],
            },
          }
        : {}),
    };
  }

  return {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    ...(input.cwd
      ? {
          filesystem: {
            allowWrite: [input.cwd],
          },
        }
      : {}),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isHiddenInitSessionText(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === hiddenInitPrompt().toLowerCase() ||
    normalized === 'initialize remote codex session'
  );
}

function sessionSummaryFromInfo(info: SDKSessionInfo): AgentSessionSummary {
  const firstPrompt = info.firstPrompt && !isHiddenInitSessionText(info.firstPrompt)
    ? info.firstPrompt
    : null;
  const summary = info.summary && !isHiddenInitSessionText(info.summary)
    ? info.summary
    : null;
  return {
    provider: 'claude',
    providerSessionId: info.sessionId,
    cwd: info.cwd ?? '',
    title: info.customTitle ?? summary,
    preview: firstPrompt ?? summary,
    createdAt: toIsoFromMs(info.createdAt),
    updatedAt: toIsoFromMs(info.lastModified),
    status: 'idle',
    rawSession: info,
  };
}

function queryResultStatus(message: SDKMessage): AgentTurn['status'] | null {
  if (message.type !== 'result') {
    return null;
  }
  return message.subtype === 'success' ? 'completed' : 'failed';
}

function queryResultError(message: SDKMessage): string | null {
  if (message.type !== 'result' || message.subtype === 'success') {
    return null;
  }
  return message.errors?.join('\n') || message.stop_reason || 'Claude turn failed.';
}

function assistantMessagePayload(message: SDKMessage) {
  return message.type === 'assistant' ? message.message : null;
}

function messageIdFromPayload(message: unknown) {
  return isRecord(message) && typeof message.id === 'string' && message.id
    ? message.id
    : null;
}

function messageUuid(message: SDKMessage | SessionMessage, fallback: string) {
  return typeof message.uuid === 'string' && message.uuid ? message.uuid : fallback;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function nullableFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function addClaudeUsage(
  left: ClaudeTokenUsageBreakdown,
  right: ClaudeTokenUsageBreakdown,
): ClaudeTokenUsageBreakdown {
  return {
    totalTokens: left.totalTokens + right.totalTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
  };
}

function normalizeClaudeUsage(value: unknown): ClaudeTokenUsageBreakdown | null {
  if (!isRecord(value)) {
    return null;
  }

  const baseInputTokens = finiteNumber(value.input_tokens ?? value.inputTokens);
  const cacheCreationInputTokens = finiteNumber(
    value.cache_creation_input_tokens ?? value.cacheCreationInputTokens,
  );
  const cacheReadInputTokens = finiteNumber(
    value.cache_read_input_tokens ?? value.cacheReadInputTokens,
  );
  const outputTokens = finiteNumber(value.output_tokens ?? value.outputTokens);
  const inputTokens = baseInputTokens + cacheCreationInputTokens + cacheReadInputTokens;
  const totalTokens = inputTokens + outputTokens;

  if (totalTokens <= 0) {
    return null;
  }

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens: cacheReadInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
  };
}

function usageFromAssistantMessage(message: SDKMessage) {
  if (message.type !== 'assistant' || !isRecord(message.message)) {
    return null;
  }
  return normalizeClaudeUsage(message.message.usage);
}

function usageFromResultMessage(message: SDKMessage) {
  return message.type === 'result' ? normalizeClaudeUsage(message.usage) : null;
}

function contextWindowFromResultMessage(message: SDKMessage) {
  if (message.type !== 'result' || !isRecord(message.modelUsage)) {
    return null;
  }
  for (const usage of Object.values(message.modelUsage)) {
    if (!isRecord(usage)) {
      continue;
    }
    const contextWindow = nullableFiniteNumber(usage.contextWindow);
    if (contextWindow && contextWindow > 0) {
      return contextWindow;
    }
  }
  return null;
}

function claudeUsagePayload(
  usage: ClaudeTokenUsageBreakdown,
  modelContextWindow: number | null,
) {
  return {
    total: usage,
    last: usage,
    modelContextWindow,
    cumulative: false,
  };
}

function streamMessageId(event: unknown) {
  if (!isRecord(event) || event.type !== 'message_start') {
    return null;
  }
  const message = event.message;
  return messageIdFromPayload(message);
}

function addOrUpdateItem(state: ActiveClaudeTurn, item: AgentHistoryItem) {
  if (!state.items.has(item.id)) {
    state.itemOrder.push(item.id);
  }
  state.items.set(item.id, item);
}

function orderedItems(state: ActiveClaudeTurn) {
  return state.itemOrder
    .map((id) => state.items.get(id))
    .filter((item): item is AgentHistoryItem => Boolean(item));
}

function stringFromRecord(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

function normalizeClaudeQuestionOptions(value: unknown): AgentActionQuestion['options'] {
  if (!Array.isArray(value)) {
    return null;
  }
  const options = value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const label = stringFromRecord(entry, 'label');
      if (!label) {
        return null;
      }
      return {
        label,
        description: stringFromRecord(entry, 'description') ?? label,
      };
    })
    .filter((entry): entry is NonNullable<AgentActionQuestion['options']>[number] =>
      Boolean(entry),
    );
  return options.length > 0 ? options : null;
}

function normalizeClaudeAskUserQuestions(input: unknown): AgentActionQuestion[] {
  if (!isRecord(input) || !Array.isArray(input.questions)) {
    return [];
  }
  return input.questions
    .map((entry, index): AgentActionQuestion | null => {
      if (!isRecord(entry)) {
        return null;
      }
      const question = stringFromRecord(entry, 'question');
      if (!question) {
        return null;
      }
      const header = stringFromRecord(entry, 'header') ?? `Question ${index + 1}`;
      return {
        id: `question-${index + 1}`,
        header,
        question,
        multiSelect: entry.multiSelect === true,
        isOther: true,
        isSecret: false,
        options: normalizeClaudeQuestionOptions(entry.options),
      };
    })
    .filter((entry): entry is AgentActionQuestion => Boolean(entry));
}

function claudeAskUserToolUseFromAssistantMessage(message: unknown) {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return null;
  }
  for (const [index, block] of message.content.entries()) {
    if (!isRecord(block) || block.type !== 'tool_use') {
      continue;
    }
    const name = stringFromRecord(block, 'name');
    if (name !== 'AskUserQuestion') {
      continue;
    }
    const id = stringFromRecord(block, 'id') ?? `ask-user-question-${index}`;
    return {
      id,
      input: block.input,
    };
  }
  return null;
}

function mapClaudeAskUserQuestionRequest(request: AgentProviderRequest): AgentProviderRequestMapping | null {
  if (request.method !== 'tool/AskUserQuestion') {
    return null;
  }
  if (!isRecord(request.params)) {
    return null;
  }
  const providerSessionId = stringFromRecord(request.params, 'providerSessionId');
  if (!providerSessionId) {
    return null;
  }
  const questions = normalizeClaudeAskUserQuestions(request.params.input);
  if (questions.length === 0) {
    return null;
  }
  const requestId = String(request.id);
  const turnId = stringFromRecord(request.params, 'providerTurnId');
  const firstQuestion = questions[0] ?? null;
  return {
    providerRequestId: request.id,
    providerSessionId,
    autoApprovedResult: null,
    pendingRequest: {
      providerRequestId: request.id,
      responseKind: 'askUserQuestion',
      responsePayload: {
        continueAsPrompt: true,
      },
      request: {
        id: requestId,
        kind: 'requestUserInput',
        title: firstQuestion?.header ?? 'User input required',
        description: firstQuestion?.question ?? null,
        turnId,
        itemId: stringFromRecord(request.params, 'toolUseId'),
        createdAt: new Date().toISOString(),
        questions,
      },
    },
  };
}

function buildClaudeProviderRequestResponse(
  pending: AgentPendingProviderRequest,
  input: AgentActionRequestResponseInput,
) {
  if (pending.responseKind !== 'askUserQuestion') {
    return input;
  }
  const answers = Object.fromEntries(
    pending.request.questions.map((question) => [
      question.question,
      input.answers[question.id]?.answers.join(', ') ?? '',
    ]),
  );
  return {
    questions: pending.request.questions.map((question) => ({
      question: question.question,
      header: question.header,
      answer: input.answers[question.id]?.answers ?? [],
    })),
    answers,
    annotations: {},
    toolResult: {
      questions: pending.request.questions.map((question) => ({
        question: question.question,
        header: question.header,
        options: question.options ?? [],
        multiSelect: question.multiSelect === true,
      })),
      answers,
      annotations: {},
    },
  };
}

function queryOptionsForRuntime(
  input: {
    home: string;
    command: string | undefined;
    clientApp: string;
    cwd?: string | null | undefined;
    model?: string | null | undefined;
    reasoningEffort?: string | null | undefined;
    resume?: string | null | undefined;
    approvalMode: StartAgentSessionInput['approvalMode'];
    collaborationMode?: StartAgentTurnInput['collaborationMode'] | undefined;
    sandboxMode?: StartAgentTurnInput['sandboxMode'] | undefined;
    includePartialMessages?: boolean | undefined;
    tools?: ClaudeQueryOptions['tools'] | undefined;
    maxTurns?: number | undefined;
  },
): ClaudeQueryOptions {
  const permission = permissionModeForInput(input);
  const options: ClaudeQueryOptions = {
    includeHookEvents: false,
    permissionMode: permission.permissionMode,
    thinking: {
      type: 'adaptive',
      display: 'summarized',
    },
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: input.clientApp,
    },
  };
  if (input.cwd) {
    options.cwd = input.cwd;
  }
  const sandbox = sandboxSettingsForInput(input);
  if (sandbox) {
    options.sandbox = sandbox;
  }
  if (input.model) {
    const model = normalizeClaudeModelForQuery(input.model);
    if (model) {
      options.model = model;
    }
  }
  if (shouldEnableOneMillionContext(input.model)) {
    options.betas = ['context-1m-2025-08-07'];
  }
  if (input.reasoningEffort) {
    const effort = input.reasoningEffort;
    if (['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
      options.effort = effort as NonNullable<ClaudeQueryOptions['effort']>;
    }
  }
  if (input.resume) {
    options.resume = input.resume;
  }
  if (input.includePartialMessages !== undefined) {
    options.includePartialMessages = input.includePartialMessages;
  }
  if (input.maxTurns !== undefined) {
    options.maxTurns = input.maxTurns;
  }
  if (input.tools !== undefined && (!Array.isArray(input.tools) || input.tools.length > 0)) {
    options.tools = input.tools;
  }
  if (permission.allowDangerouslySkipPermissions) {
    options.allowDangerouslySkipPermissions = true;
  }
  options.pathToClaudeCodeExecutable = input.command?.trim() || 'claude';
  return options;
}

export class ClaudeRuntimeAdapter extends EventEmitter implements AgentRuntime {
  readonly provider = 'claude' as const;
  readonly displayName = 'Claude Code';
  readonly description = 'Local Claude Code Agent SDK runtime.';
  readonly capabilities = claudeCapabilities;
  readonly installation: AgentBackendInstallationDto = {
    packageName: '@anthropic-ai/claude-agent-sdk',
    installed: false,
    installedVersion: null,
    latestVersion: null,
    installCommand: 'npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk',
    updateCommand: 'npm install -g @anthropic-ai/claude-code@latest @anthropic-ai/claude-agent-sdk@latest',
    busy: false,
    lastError: null,
  };
  readonly managementSchema: AgentRuntimeManagementSchema = {
    hostConfigFiles: [],
    toolboxItems: buildClaudeToolboxItems([]),
    hookCommandTemplates: [],
    providerConfigFormat: 'none',
    mcpConfigFormat: 'none',
    configArchives: false,
    buildRestart: false,
  };

  private status: AgentRuntimeStatus = {
    state: 'stopped',
    transport: 'sdk',
    lastStartedAt: null,
    lastError: null,
    restartCount: 0,
  };
  private queryFactory: ClaudeQueryFunction;
  private listSessionsFn: ClaudeListSessionsFunction;
  private getSessionMessagesFn: ClaudeGetSessionMessagesFunction;
  private getSessionInfoFn: ClaudeGetSessionInfoFunction;
  private readonly activeTurns = new Map<string, ActiveClaudeTurn>();
  private readonly knownSessionIds = new Set<string>();
  private readonly sessionCwds = new Map<string, string>();
  private readonly sessionModels = new Map<string, string | null>();
  private readonly sessionApprovalModes = new Map<string, StartAgentSessionInput['approvalMode']>();
  private readonly liveUserPrompts = new Map<string, Map<string, string>>();
  private readonly clientApp: string;
  private sdkLoadError: string | null = null;

  constructor(private readonly options: ClaudeRuntimeAdapterOptions) {
    super();
    const sdk = options.sdk;
    this.queryFactory = options.query ?? sdk?.query ?? this.unavailableQueryFactory.bind(this);
    this.listSessionsFn = options.listSessions ?? sdk?.listSessions ?? this.unavailableListSessions.bind(this);
    this.getSessionMessagesFn = options.getSessionMessages ?? sdk?.getSessionMessages ?? this.unavailableGetSessionMessages.bind(this);
    this.getSessionInfoFn = options.getSessionInfo ?? sdk?.getSessionInfo ?? this.unavailableGetSessionInfo.bind(this);
    this.clientApp = [
      options.clientInfo?.name ?? 'remote-codex-supervisor',
      options.clientInfo?.version,
    ].filter(Boolean).join('/');
  }

  getStatus(): AgentRuntimeStatus {
    return { ...this.status };
  }

  private updateToolboxItemsFromSystemInit(message: SDKMessage) {
    this.managementSchema.toolboxItems = buildClaudeToolboxItems(
      normalizeClaudeSlashCommands(message.slash_commands),
    );
  }

  async start() {
    await fs.mkdir(this.options.home, { recursive: true });
    if (!this.options.query && !this.options.sdk) {
      try {
        const sdk = await this.loadSdk();
        this.queryFactory = sdk.query;
        this.listSessionsFn = sdk.listSessions;
        this.getSessionMessagesFn = sdk.getSessionMessages;
        this.getSessionInfoFn = sdk.getSessionInfo;
        this.sdkLoadError = null;
        this.installation.installed = true;
        this.installation.lastError = null;
      } catch (error) {
        this.sdkLoadError = errorMessage(error);
        this.installation.installed = false;
        this.installation.lastError = this.sdkLoadError;
        this.status = {
          ...this.status,
          state: 'stopped',
          lastError: `Claude Code SDK is not installed or could not be loaded. ${this.sdkLoadError}`,
        };
        this.emit('status', this.getStatus());
        return;
      }
    }
    this.status = {
      ...this.status,
      state: 'ready',
      lastStartedAt: new Date().toISOString(),
      lastError: null,
      restartCount: this.status.state === 'stopped' ? this.status.restartCount : this.status.restartCount + 1,
    };
    this.emit('status', this.getStatus());
  }

  async stop() {
    for (const state of this.activeTurns.values()) {
      state.interrupted = true;
      state.query.close();
    }
    this.activeTurns.clear();
    this.status = {
      ...this.status,
      state: 'stopped',
      lastError: null,
    };
    this.emit('status', this.getStatus());
  }

  async listModels(): Promise<AgentModel[]> {
    const active = [...this.activeTurns.values()][0];
    if (!active) {
      return DEFAULT_CLAUDE_MODELS;
    }

    try {
      const models = await active.query.supportedModels();
      return withClaudeCodeModelAliases(models.map(mapModelInfo));
    } catch {
      return DEFAULT_CLAUDE_MODELS;
    }
  }

  async listSessions(): Promise<AgentSessionSummary[]> {
    const sessions = await this.withClaudeConfigEnv(() => this.listSessionsFn({} as ListSessionsOptions));
    return sessions.map((session) => {
      this.knownSessionIds.add(session.sessionId);
      return sessionSummaryFromInfo(session);
    });
  }

  async listLoadedSessions(): Promise<string[]> {
    for (const state of this.activeTurns.values()) {
      this.knownSessionIds.add(state.providerSessionId);
    }
    try {
      const sessions = await this.listSessions();
      for (const session of sessions) {
        this.knownSessionIds.add(session.providerSessionId);
      }
    } catch {
      // Keep in-memory known sessions if Claude's local history cannot be read.
    }
    return [...this.knownSessionIds];
  }

  async readSession(
    providerSessionId: string,
    options: ReadAgentSessionOptions = {},
  ): Promise<AgentSessionDetail> {
    const [info, messages] = await this.withClaudeConfigEnv(async () => Promise.all([
      this.getSessionInfoFn(providerSessionId, {} as GetSessionInfoOptions),
      this.getSessionMessagesFn(providerSessionId, {
        includeSystemMessages: true,
      } as GetSessionMessagesOptions),
    ]));
    this.knownSessionIds.add(providerSessionId);
    const summary = info
      ? sessionSummaryFromInfo(info)
      : {
          provider: 'claude' as const,
          providerSessionId,
          cwd: this.sessionCwds.get(providerSessionId) ?? '',
          title: null,
          preview: null,
          createdAt: null,
          updatedAt: null,
          status: 'idle' as const,
          rawSession: null,
        };

    const cwd = summary.cwd || this.sessionCwds.get(providerSessionId) || '';
    const historyAssetContext = {
      workspacePath: options.workspacePath || cwd,
      ...(options.localThreadId ? { localThreadId: options.localThreadId } : {}),
    };
    const turns = await this.sessionMessagesToTurns(messages, historyAssetContext);
    const activeTurn = [...this.activeTurns.values()].find(
      (turn) => turn.providerSessionId === providerSessionId,
    );

    return {
      ...summary,
      cwd,
      turns: this.reconcileActiveTranscriptTurn(providerSessionId, turns, activeTurn),
    };
  }

  async startSession(input: StartAgentSessionInput): Promise<StartAgentSessionResult> {
    await fs.mkdir(this.options.home, { recursive: true });
    const query = this.queryFactory({
      prompt: hiddenInitPrompt(),
      options: queryOptionsForRuntime({
        home: this.options.home,
        command: this.options.command,
        clientApp: this.clientApp,
        cwd: input.cwd,
        model: input.model,
        approvalMode: input.approvalMode,
        sandboxMode: input.sandboxMode,
        includePartialMessages: false,
        tools: [],
        maxTurns: 1,
      }),
    });

    let providerSessionId: string | null = null;
    let model: string | null = input.model;
    const rawMessages: SDKMessage[] = [];
    try {
      for await (const message of query) {
        rawMessages.push(message);
        if (message.type === 'system' && message.subtype === 'init') {
          this.updateToolboxItemsFromSystemInit(message);
          const sessionId = message.session_id;
          if (sessionId) {
            providerSessionId = sessionId;
            model = displayClaudeModel(input.model, message.model ?? model);
            this.sessionCwds.set(sessionId, message.cwd ?? input.cwd);
          }
        } else if ('session_id' in message && typeof message.session_id === 'string') {
          providerSessionId ??= message.session_id;
        }
      }
    } catch (error) {
      this.markFailed(error);
      throw new AgentRuntimeError(errorMessage(error), 'claude', 'request_failed', undefined, error);
    } finally {
      query.close();
    }

    if (!providerSessionId) {
      throw new AgentRuntimeError(
        'Claude did not return a session id during initialization.',
        'claude',
        'invalid_response',
      );
    }

    this.sessionCwds.set(providerSessionId, input.cwd);
    this.knownSessionIds.add(providerSessionId);
    this.sessionModels.set(providerSessionId, displayClaudeModel(input.model, model));
    this.sessionApprovalModes.set(providerSessionId, input.approvalMode);
    const session: AgentSessionDetail = {
      provider: 'claude',
      providerSessionId,
      cwd: input.cwd,
      title: null,
      preview: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'idle',
      turns: [],
      rawSession: rawMessages,
    };
    return {
      provider: 'claude',
      providerSessionId,
      model: displayClaudeModel(input.model, model),
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      session,
      rawSession: rawMessages,
    };
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<StartAgentSessionResult> {
    const session = await this.readSession(input.providerSessionId);
    this.knownSessionIds.add(input.providerSessionId);
    if (input.model !== undefined) {
      this.sessionModels.set(input.providerSessionId, displayClaudeModel(input.model, input.model));
    }
    return {
      provider: 'claude',
      providerSessionId: input.providerSessionId,
      model: displayClaudeModel(
        input.model,
        input.model ?? this.sessionModels.get(input.providerSessionId) ?? null,
      ),
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      session,
      rawSession: session.rawSession,
    };
  }

  async startTurn(input: StartAgentTurnInput): Promise<AgentTurn> {
    const providerTurnId = input.displayTurnId ?? randomUUID();
    const runtimeTurnId = providerTurnId === input.displayTurnId ? randomUUID() : providerTurnId;
    const startedAt = new Date().toISOString();
    const cwd = input.workspacePath ?? this.sessionCwds.get(input.providerSessionId) ?? undefined;
    const approvalMode = this.sessionApprovalModes.get(input.providerSessionId) ?? 'guarded';
    const queryPrompt = await promptWithImageBlocks(input.prompt, cwd);
    const query = this.queryFactory({
      prompt: queryPrompt,
      options: queryOptionsForRuntime({
        home: this.options.home,
        command: this.options.command,
        clientApp: this.clientApp,
        cwd,
        model: input.model ?? this.sessionModels.get(input.providerSessionId) ?? undefined,
        reasoningEffort: input.reasoningEffort,
        resume: input.providerSessionId,
        approvalMode,
        collaborationMode: input.collaborationMode,
        sandboxMode: input.sandboxMode,
        includePartialMessages: true,
        tools: { type: 'preset', preset: 'claude_code' },
      }),
    });
    const userItem = userMessageToHistoryItem(`${providerTurnId}:user`, {
      content: input.prompt,
    });
    const initialItems = input.hidden ? [] : [userItem];
    const state: ActiveClaudeTurn = {
      providerSessionId: input.providerSessionId,
      providerTurnId,
      startedAt,
      query,
      items: new Map(initialItems.map((item) => [item.id, item])),
      itemOrder: initialItems.map((item) => item.id),
      emittedItems: new Set(),
      currentStreamMessageId: null,
      interrupted: false,
      completed: false,
      suppressedToolUseIds: new Set(),
      assistantUsage: null,
      resultUsage: null,
      modelContextWindow: null,
    };
    this.knownSessionIds.add(input.providerSessionId);
    let sessionPrompts = this.liveUserPrompts.get(input.providerSessionId);
    if (!sessionPrompts) {
      sessionPrompts = new Map();
      this.liveUserPrompts.set(input.providerSessionId, sessionPrompts);
    }
    sessionPrompts.set(providerTurnId, input.prompt);
    this.activeTurns.set(providerTurnId, state);
    if (runtimeTurnId !== providerTurnId) {
      this.activeTurns.set(runtimeTurnId, state);
    }
    this.emitRuntimeEvent({
      type: 'turn.started',
      provider: 'claude',
      providerSessionId: input.providerSessionId,
      turn: buildAgentTurn({
        providerTurnId,
        startedAt,
        status: 'inProgress',
        items: initialItems,
      }),
    });
    void this.consumeQuery(state);
    return buildAgentTurn({
      providerTurnId,
      startedAt,
      status: 'inProgress',
      items: initialItems,
    });
  }

  async interruptTurn(input: InterruptAgentTurnInput): Promise<AgentTurn | null> {
    const state =
      this.activeTurns.get(input.providerTurnId) ??
      [...this.activeTurns.values()].find(
        (entry) => entry.providerSessionId === input.providerSessionId,
      ) ??
      null;
    if (!state) {
      return null;
    }

    state.interrupted = true;
    try {
      await state.query.interrupt();
    } catch {
      // Some SDK query modes cannot interrupt; close still terminates the child process.
    }
    state.query.close();
    state.completed = true;
    this.deleteActiveTurn(state);
    this.knownSessionIds.add(state.providerSessionId);
    return buildAgentTurn({
      providerTurnId: state.providerTurnId,
      startedAt: state.startedAt,
      status: 'interrupted',
      items: orderedItems(state),
    });
  }

  private deleteActiveTurn(state: ActiveClaudeTurn) {
    for (const [turnId, active] of this.activeTurns.entries()) {
      if (active === state || turnId === state.providerTurnId) {
        this.activeTurns.delete(turnId);
      }
    }
    const sessionPrompts = this.liveUserPrompts.get(state.providerSessionId);
    sessionPrompts?.delete(state.providerTurnId);
    if (sessionPrompts?.size === 0) {
      this.liveUserPrompts.delete(state.providerSessionId);
    }
  }

  private reconcileActiveTranscriptTurn(
    providerSessionId: string,
    turns: AgentTurn[],
    activeTurn: ActiveClaudeTurn | undefined,
  ) {
    if (!activeTurn || turns.length === 0) {
      return turns;
    }

    const prompt = this.liveUserPrompts
      .get(providerSessionId)
      ?.get(activeTurn.providerTurnId);
    if (!prompt) {
      return turns;
    }

    const activeUserItem = userMessageHistoryItem(`${activeTurn.providerTurnId}:user`, prompt);
    const activeItems = [...activeTurn.itemOrder]
      .map((itemId) => activeTurn.items.get(itemId))
      .filter((item): item is AgentHistoryItem => Boolean(item));
    const transcriptTurnIndex = turns.findLastIndex(
      (turn) =>
        turn.status === 'completed' &&
        turn.items.some((item) => item.kind === 'userMessage') &&
        !turn.items.some((item) => item.kind === 'agentMessage'),
    );

    if (transcriptTurnIndex < 0) {
      return turns;
    }

    return turns.map((turn, index) => {
      if (index !== transcriptTurnIndex) {
        return turn;
      }

      return buildAgentTurn({
        providerTurnId: activeTurn.providerTurnId,
        startedAt: activeTurn.startedAt,
        status: 'inProgress',
        items: mergeActiveTranscriptItems(
          [activeUserItem, ...turn.items.filter((item) => item.kind !== 'userMessage')],
          activeItems,
        ),
      });
    });
  }

  async listMcpServers(): Promise<AgentMcpServer[]> {
    const active = [...this.activeTurns.values()][0];
    if (!active) {
      return [];
    }
    const servers = await active.query.mcpServerStatus();
    return servers.map((server) => this.mapMcpServer(server));
  }

  mapProviderRequest(
    request: AgentProviderRequest,
    options: { approvalMode: 'yolo' | 'guarded' },
  ): AgentProviderRequestMapping | null {
    void options;
    return mapClaudeAskUserQuestionRequest(request);
  }

  buildProviderRequestResponse(
    pending: AgentPendingProviderRequest,
    input: AgentActionRequestResponseInput,
  ) {
    return buildClaudeProviderRequestResponse(pending, input);
  }

  respondToProviderRequest(id: string | number, result: unknown) {
    void id;
    void result;
    // Claude Code's built-in AskUserQuestion arrives as transcripted tool use in
    // this SDK mode. The supervisor records the user's answer locally so the
    // interaction matches other backends, but there is no live JSON-RPC request
    // to resolve back into the Claude process.
  }

  private async consumeQuery(state: ActiveClaudeTurn) {
    const rawMessages: SDKMessage[] = [];
    try {
      for await (const message of state.query) {
        rawMessages.push(message);
        if (state.completed) {
          continue;
        }
        this.consumeMessage(state, message);
        const status = queryResultStatus(message);
        if (status) {
          state.completed = true;
          this.deleteActiveTurn(state);
          this.emitUsage(state);
          this.emitRuntimeEvent({
            type: 'turn.completed',
            provider: 'claude',
            providerSessionId: state.providerSessionId,
            turn: buildAgentTurn({
              providerTurnId: state.providerTurnId,
              startedAt: state.startedAt,
              status: state.interrupted ? 'interrupted' : status,
              error: queryResultError(message),
              items: orderedItems(state),
              rawTurn: rawMessages,
            }),
          });
        }
      }

      if (!state.completed) {
        state.completed = true;
        this.deleteActiveTurn(state);
        this.emitUsage(state);
        this.emitRuntimeEvent({
          type: 'turn.completed',
          provider: 'claude',
          providerSessionId: state.providerSessionId,
          turn: buildAgentTurn({
            providerTurnId: state.providerTurnId,
            startedAt: state.startedAt,
            status: state.interrupted ? 'interrupted' : 'completed',
            items: orderedItems(state),
            rawTurn: rawMessages,
          }),
        });
      }
    } catch (error) {
      this.deleteActiveTurn(state);
      if (state.interrupted) {
        return;
      }
      this.emitRuntimeEvent({
        type: 'turn.failed',
        provider: 'claude',
        providerSessionId: state.providerSessionId,
        providerTurnId: state.providerTurnId,
        error: errorMessage(error),
      });
    }
  }

  private consumeMessage(state: ActiveClaudeTurn, message: SDKMessage) {
    this.captureUsage(state, message);

    if (message.type === 'system' && message.subtype === 'init') {
      this.updateToolboxItemsFromSystemInit(message);
      if (message.session_id) {
        this.sessionCwds.set(message.session_id, message.cwd ?? '');
        this.sessionModels.set(message.session_id, message.model ?? null);
      }
      return;
    }

    if (message.type === 'stream_event') {
      const nextStreamMessageId = streamMessageId(message.event);
      if (nextStreamMessageId) {
        state.currentStreamMessageId = nextStreamMessageId;
      }
      const activeMessageId = state.currentStreamMessageId ?? messageUuid(message, state.providerTurnId);
      const toolItem = toolUseFromPartialStart({
        messageId: activeMessageId,
        event: message.event,
      });
      if (toolItem) {
        addOrUpdateItem(state, toolItem);
        this.emitItem(state, toolItem, 'item.started');
        return;
      }

      const reasoningItem = partialReasoningDelta({
        messageId: activeMessageId,
        event: message.event,
      });
      if (reasoningItem) {
        const existing = state.items.get(reasoningItem.id);
        const nextItem: AgentHistoryItem = existing?.kind === 'reasoning'
          ? {
              ...existing,
              text: `${existing.text}${reasoningItem.text}`,
              status: reasoningItem.status ?? existing.status ?? null,
            }
          : reasoningItem;
        addOrUpdateItem(state, nextItem);
        this.emitItem(state, nextItem, existing ? 'item.completed' : 'item.started', {
          force: Boolean(existing),
        });
        return;
      }

      const delta = partialTextDelta({
        messageId: activeMessageId,
        event: message.event,
      });
      if (delta) {
        const existing = state.items.get(delta.itemId);
        const nextItem: AgentHistoryItem = existing?.kind === 'agentMessage'
          ? markTransientAgentHistoryItem({
              ...existing,
              text: `${existing.text}${delta.delta}`,
            })
          : markTransientAgentHistoryItem({
              id: delta.itemId,
              kind: 'agentMessage',
              text: delta.delta,
            });
        addOrUpdateItem(state, nextItem);
        this.emitRuntimeEvent({
          type: 'output.delta',
          provider: 'claude',
          providerSessionId: state.providerSessionId,
          providerTurnId: state.providerTurnId,
          itemId: delta.itemId,
          delta: delta.delta,
        });
      }
      return;
    }

    if (message.type === 'user') {
      const rawToolResults = toolResultBlocks(message.message);
      const toolResults = rawToolResults.filter(
        (toolResult) => !state.suppressedToolUseIds.has(toolResult.toolUseId),
      );
      if (toolResults.length > 0) {
        for (const toolResult of toolResults) {
          const item = resultForToolUse({
            toolUseId: toolResult.toolUseId,
            result: message.tool_use_result ?? toolResult.result,
            previous: state.items.get(toolResult.toolUseId) ?? null,
          });
          addOrUpdateItem(state, item);
          this.emitItem(state, item, 'item.completed');
        }
        return;
      }
      if (rawToolResults.length > 0) {
        return;
      }
    }

    if (message.type === 'assistant') {
      const payload = assistantMessagePayload(message);
      const assistantMessageId = messageIdFromPayload(payload) ?? messageUuid(message, state.providerTurnId);
      const askUserQuestion = claudeAskUserToolUseFromAssistantMessage(payload);
      if (askUserQuestion) {
        state.suppressedToolUseIds.add(askUserQuestion.id);
        this.emit('provider-request', {
          provider: 'claude',
          id: askUserQuestion.id,
          method: 'tool/AskUserQuestion',
          params: {
            providerSessionId: state.providerSessionId,
            providerTurnId: state.providerTurnId,
            toolUseId: askUserQuestion.id,
            input: askUserQuestion.input,
          },
          rawRequest: message,
        } satisfies AgentProviderRequest);
      }
      for (const item of assistantMessageToHistoryItems({
        messageId: assistantMessageId,
        message: payload,
      })) {
        const existing = state.items.get(item.id);
        addOrUpdateItem(state, item);
        if (item.kind !== 'agentMessage' && !existing) {
          this.emitItem(state, item, 'item.started');
        } else if (item.kind !== 'agentMessage' && existing) {
          this.emitItem(state, item, 'item.started', { force: true });
        }
      }
      return;
    }

    if (message.type === 'user' && message.parent_tool_use_id) {
      if (state.suppressedToolUseIds.has(message.parent_tool_use_id)) {
        return;
      }
      const item = resultForToolUse({
        toolUseId: message.parent_tool_use_id,
        result: message.tool_use_result ?? message.message,
        previous: state.items.get(message.parent_tool_use_id) ?? null,
      });
      addOrUpdateItem(state, item);
      this.emitItem(state, item, 'item.completed');
      return;
    }

    if (message.type === 'tool_progress') {
      const toolUseId = message.tool_use_id;
      const toolName = message.tool_name;
      if (!toolUseId || !toolName) {
        return;
      }
      if (!state.items.has(toolUseId)) {
        const item = toolUseToHistoryItem({
          id: toolUseId,
          name: toolName,
          toolInput: {
            elapsed_time_seconds: message.elapsed_time_seconds,
          },
          status: 'running',
        });
        if (item) {
          addOrUpdateItem(state, item);
          this.emitItem(state, item, 'item.started');
        } else {
          state.suppressedToolUseIds.add(toolUseId);
        }
      }
      return;
    }

    if (message.type === 'system' && message.subtype === 'permission_denied') {
      const toolUseId = message.tool_use_id;
      if (!toolUseId) {
        return;
      }
      const previous = state.items.get(toolUseId);
      const item: AgentHistoryItem = previous
        ? {
            ...previous,
            status: 'denied',
            detailText: [previous.detailText ?? previous.text, '', message.message].join('\n'),
          }
        : {
            id: toolUseId,
            kind: 'toolCall',
            text: `${message.tool_name} denied`,
            detailText: typeof message.message === 'string' ? message.message : null,
            status: 'denied',
          };
      addOrUpdateItem(state, item);
      this.emitItem(state, item, 'item.completed');
    }
  }

  private captureUsage(state: ActiveClaudeTurn, message: SDKMessage) {
    const assistantUsage = usageFromAssistantMessage(message);
    if (assistantUsage) {
      state.assistantUsage = state.assistantUsage
        ? addClaudeUsage(state.assistantUsage, assistantUsage)
        : assistantUsage;
    }

    const resultUsage = usageFromResultMessage(message);
    if (resultUsage) {
      state.resultUsage = resultUsage;
    }

    const modelContextWindow = contextWindowFromResultMessage(message);
    if (modelContextWindow) {
      state.modelContextWindow = modelContextWindow;
    }
  }

  private emitUsage(state: ActiveClaudeTurn) {
    const usage = state.resultUsage ?? state.assistantUsage;
    if (!usage) {
      return;
    }
    this.emitRuntimeEvent({
      type: 'usage.updated',
      provider: 'claude',
      providerSessionId: state.providerSessionId,
      providerTurnId: state.providerTurnId,
      usage: claudeUsagePayload(usage, state.modelContextWindow),
    });
  }

  private emitItem(
    state: ActiveClaudeTurn,
    item: AgentHistoryItem,
    type: 'item.started' | 'item.completed',
    options: { force?: boolean } = {},
  ) {
    if (type === 'item.started') {
      if (state.emittedItems.has(item.id) && !options.force) {
        return;
      }
      state.emittedItems.add(item.id);
    }
    this.emitRuntimeEvent({
      type,
      provider: 'claude',
      providerSessionId: state.providerSessionId,
      providerTurnId: state.providerTurnId,
      item,
    });
  }

  private emitRuntimeEvent(event: AgentRuntimeEvent) {
    this.emit('event', event);
  }

  private async loadSdk(): Promise<ClaudeSdkModule> {
    try {
      return await importOptionalPackage('@anthropic-ai/claude-agent-sdk') as unknown as ClaudeSdkModule;
    } catch (error) {
      throw new AgentRuntimeError(
        'Install Claude Code support with npm install -g @anthropic-ai/claude-agent-sdk, or add @anthropic-ai/claude-agent-sdk to this checkout.',
        'claude',
        'provider_unavailable',
        undefined,
        error,
      );
    }
  }

  private unavailableError() {
    return new AgentRuntimeError(
      this.sdkLoadError ?? 'Claude Code SDK is not installed.',
      'claude',
      'provider_unavailable',
    );
  }

  private unavailableQueryFactory(): Query {
    throw this.unavailableError();
  }

  private async unavailableListSessions(): Promise<SDKSessionInfo[]> {
    throw this.unavailableError();
  }

  private async unavailableGetSessionMessages(): Promise<SessionMessage[]> {
    throw this.unavailableError();
  }

  private async unavailableGetSessionInfo(): Promise<SDKSessionInfo | null> {
    throw this.unavailableError();
  }

  private mapMcpServer(server: McpServerStatus): AgentMcpServer {
    return {
      name: server.name,
      authStatus: server.status === 'needs-auth' ? 'notLoggedIn' : 'unsupported',
      tools: (server.tools ?? []).map((tool) => ({
        name: tool.name,
        title: tool.name,
        description: tool.description ?? null,
      })),
      resourceCount: 0,
      resourceTemplateCount: 0,
    };
  }

  private async userMessageToHistoryItem(
    id: string,
    message: unknown,
    context: {
      localThreadId?: string;
      workspacePath?: string;
    },
  ): Promise<AgentHistoryItem> {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      return userMessageToHistoryItem(id, message);
    }

    const parts: string[] = [];
    for (let index = 0; index < message.content.length; index += 1) {
      const block = message.content[index];
      if (!isRecord(block)) {
        continue;
      }
      if (block.type === 'image') {
        const photoToken = await this.persistHistoryImageBlock({
          messageId: id,
          blockIndex: index,
          block,
          ...context,
        });
        if (photoToken) {
          parts.push(photoToken);
        }
        continue;
      }
      if (typeof block.text === 'string') {
        parts.push(block.text);
        continue;
      }
      if (typeof block.content === 'string') {
        parts.push(block.content);
      }
    }

    return userMessageHistoryItem(id, parts.filter(Boolean).join('\n'));
  }

  private async persistHistoryImageBlock(input: {
    messageId: string;
    blockIndex: number;
    block: Record<string, unknown>;
    localThreadId?: string;
    workspacePath?: string;
  }): Promise<string | null> {
    if (!input.localThreadId || !input.workspacePath) {
      return null;
    }

    const source = isRecord(input.block.source) ? input.block.source : null;
    if (!source || source.type !== 'base64') {
      return null;
    }

    const data = typeof source.data === 'string' ? source.data : null;
    if (!data) {
      return null;
    }

    const extension = extensionForImageMediaType(
      typeof source.media_type === 'string' ? source.media_type : null,
    );
    if (!extension) {
      return null;
    }

    const relativePath = `./.temp/threads/${input.localThreadId}/claude-history-${safeAssetFilePart(input.messageId)}-${input.blockIndex}.${extension}`;
    const targetPath = path.resolve(input.workspacePath, relativePath);
    const relativeToWorkspace = path.relative(input.workspacePath, targetPath);
    if (
      relativeToWorkspace === '' ||
      relativeToWorkspace.startsWith('..') ||
      path.isAbsolute(relativeToWorkspace)
    ) {
      return null;
    }

    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, Buffer.from(data, 'base64'));
      return `[PHOTO ${relativePath}]`;
    } catch {
      return null;
    }
  }

  private async sessionMessagesToTurns(
    messages: SessionMessage[],
    context: {
      localThreadId?: string;
      workspacePath?: string;
    } = {},
  ): Promise<AgentTurn[]> {
    const turns: AgentTurn[] = [];
    let current: {
      providerTurnId: string;
      startedAt: string | null;
      items: AgentHistoryItem[];
      itemsById: Map<string, AgentHistoryItem>;
    } | null = null;
    let skippingHiddenInit = false;
    const suppressedToolUseIds = new Set<string>();

    const upsertCurrentItem = (item: AgentHistoryItem) => {
      if (!current) {
        current = {
          providerTurnId: randomUUID(),
          startedAt: null,
          items: [],
          itemsById: new Map(),
        };
      }
      const existingIndex = current.items.findIndex((entry) => entry.id === item.id);
      if (existingIndex >= 0) {
        current.items[existingIndex] = item;
      } else {
        current.items.push(item);
      }
      current.itemsById.set(item.id, item);
    };

    for (const message of messages) {
      if (message.type === 'user') {
        const rawToolResults = toolResultBlocks(message.message);
        const toolResults = rawToolResults.filter(
          (toolResult) => !suppressedToolUseIds.has(toolResult.toolUseId),
        );
        if (toolResults.length > 0) {
          for (const toolResult of toolResults) {
            const previous = current?.itemsById.get(toolResult.toolUseId) ?? null;
            upsertCurrentItem(resultForToolUse({
              toolUseId: toolResult.toolUseId,
              result: toolResult.result,
              previous,
            }));
          }
          continue;
        }
        if (rawToolResults.length > 0) {
          continue;
        }
      }

      if (message.type === 'user' && !message.parent_tool_use_id) {
        if (isHiddenInitMessage(message.message)) {
          skippingHiddenInit = true;
          current = null;
          continue;
        }
        if (isHiddenContinuationMessage(message.message)) {
          continue;
        }
        skippingHiddenInit = false;
        if (current && current.items.length > 0) {
          turns.push(buildAgentTurn({
            providerTurnId: current.providerTurnId,
            startedAt: current.startedAt,
            status: 'completed',
            items: current.items,
          }));
        }
        const messageUuid = message.uuid ?? randomUUID();
        const userItem = await this.userMessageToHistoryItem(
          messageUuid,
          message.message,
          context,
        );
        current = {
          providerTurnId: `claude-turn-${messageUuid}`,
          startedAt: isoFromUuidV7(messageUuid),
          items: [userItem],
          itemsById: new Map([[messageUuid, userItem]]),
        };
        continue;
      }

      if (skippingHiddenInit && message.type === 'assistant') {
        continue;
      }

      if (message.type === 'assistant') {
        for (const toolUseId of suppressedClaudeToolUseIds(message.message)) {
          suppressedToolUseIds.add(toolUseId);
          current?.itemsById.delete(toolUseId);
        }
        for (const item of assistantMessageToHistoryItems({
          messageId: message.uuid ?? randomUUID(),
          message: message.message,
        })) {
          upsertCurrentItem(item);
        }
        continue;
      }

      if (message.type === 'user' && message.parent_tool_use_id) {
        if (suppressedToolUseIds.has(message.parent_tool_use_id)) {
          continue;
        }
        const previous = current?.itemsById.get(message.parent_tool_use_id) ?? null;
        upsertCurrentItem(resultForToolUse({
          toolUseId: message.parent_tool_use_id,
          result: isRecord(message.message) && 'content' in message.message
            ? message.message.content
            : message.message,
          previous,
        }));
      }
    }

    if (current && current.items.length > 0) {
      turns.push(buildAgentTurn({
        providerTurnId: current.providerTurnId,
        startedAt: current.startedAt,
        status: 'completed',
        items: current.items,
      }));
    }
    return turns;
  }

  private async withClaudeConfigEnv<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  private markFailed(error: unknown) {
    this.status = {
      ...this.status,
      state: 'failed',
      lastError: errorMessage(error),
    };
    this.emit('status', this.getStatus());
  }
}

async function importOptionalPackage(specifier: string) {
  const dynamicImport = new Function('specifier', 'return import(specifier);') as (
    specifier: string,
  ) => Promise<unknown>;
  try {
    return await dynamicImport(specifier);
  } catch (localError) {
    const globalRoot = await npmGlobalRoot();
    if (!globalRoot) {
      throw localError;
    }
    try {
      const requireFromGlobal = createRequire(path.join(globalRoot, 'remote-codex-global.cjs'));
      const resolved = requireFromGlobal.resolve(specifier);
      return await dynamicImport(pathToFileURL(resolved).href);
    } catch {
      throw localError;
    }
  }
}

async function npmGlobalRoot() {
  try {
    const { stdout } = await execFileAsync('npm', ['root', '-g'], {
      timeout: 3_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
