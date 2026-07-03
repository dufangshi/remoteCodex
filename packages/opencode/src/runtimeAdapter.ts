import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type {
  AgentHistoryItem,
  AgentModel,
  AgentProviderCapabilities,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeManagementSchema,
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
  contextWindowForModel,
} from '../../agent-runtime/src/index';
import {
  openCodeMessagesToTurns,
  openCodeMessageToHistoryItems,
  openCodeMessagesToPlanUpdate,
} from './historyItems';

const execFileAsync = promisify(execFile);
const openCodeWaitTimeoutMs = 1_500;
const openCodePromptPollIntervalMs = 500;
const openCodePromptTimeoutMs = 120_000;

interface OpenCodeSdkModule {
  createOpencode(options?: unknown): Promise<{
    client: OpenCodeClient;
    server: {
      url: string;
      close(): void;
    };
  }>;
}

interface OpenCodeClient {
  config?: {
    get(parameters?: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
    providers(parameters?: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
  };
  v2?: {
    session?: {
      messages(parameters: unknown, options?: unknown): Promise<OpenCodeResult<{ items?: unknown[] } | unknown[]>>;
      prompt?(parameters: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
      wait?(parameters: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
    };
  };
  model?: {
    list(parameters?: unknown, options?: unknown): Promise<OpenCodeResult<unknown[]>>;
  };
  provider?: {
    list(parameters?: unknown, options?: unknown): Promise<OpenCodeResult<unknown[]>>;
  };
  session: {
    list(parameters?: unknown, options?: unknown): Promise<OpenCodeResult<{ items?: unknown[] } | unknown[]>>;
    create(parameters?: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
    status?(parameters?: unknown, options?: unknown): Promise<OpenCodeResult<Record<string, unknown>>>;
    get(parameters: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
    update?(parameters: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
    messages(parameters: unknown, options?: unknown): Promise<OpenCodeResult<{ items?: unknown[] } | unknown[]>>;
    prompt(parameters: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
    wait?(parameters: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
    abort(parameters: unknown, options?: unknown): Promise<OpenCodeResult<unknown>>;
  };
}

type OpenCodeResult<T> =
  | T
  | {
      data?: T;
      error?: unknown;
    };
type OpenCodePromptInput = {
  sessionID: string;
  directory?: string | null | undefined;
  model?: {
    providerID: string;
    modelID: string;
  };
  agent?: string;
  variant?: string;
  parts?: Array<{
    type: 'text';
    text: string;
  }>;
};

type OpenCodePermissionRule = {
  permission: string;
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
};

type OpenCodeLocationInput = {
  sessionID?: string;
  directory?: string | null | undefined;
  workspace?: string | null | undefined;
};

export interface OpenCodeRuntimeAdapterOptions {
  home: string;
  command?: string;
  clientInfo?: {
    name: string;
    title?: string;
    version?: string;
  };
  sdk?: OpenCodeSdkModule;
}

const opencodeCapabilities: AgentProviderCapabilities = {
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
    compact: true,
  },
  branching: {
    fork: true,
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
    mcpStatus: false,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeNumberValue(value: unknown) {
  const number = numberValue(value);
  return number !== null && number >= 0 ? number : null;
}

function isoFromMs(value: unknown) {
  const time = numberValue(value);
  return time === null ? null : new Date(time).toISOString();
}

function unwrapResult<T>(result: OpenCodeResult<T>): T {
  if (isRecord(result) && 'error' in result && result.error !== undefined) {
    const error = result.error;
    const message = isRecord(error) && typeof error.message === 'string'
      ? error.message
      : String(error);
    throw new Error(message);
  }
  if (isRecord(result) && 'data' in result) {
    return result.data as T;
  }
  return result as T;
}

function resultItems(result: { items?: unknown[] } | unknown[]) {
  return Array.isArray(result) ? result : result.items ?? [];
}

function modelKey(providerID: string, modelID: string, variant?: string | null) {
  return variant ? `${providerID}/${modelID}@${variant}` : `${providerID}/${modelID}`;
}

function providerModelKey(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`;
}

function parseModelKey(value: string | null | undefined) {
  const [providerAndModel = '', variant] = (value ?? '').split('@', 2);
  const [providerID, modelID] = providerAndModel.split('/', 2);
  if (!providerID || !modelID) {
    return null;
  }
  return {
    providerID,
    modelID,
    ...(variant ? { variant } : {}),
  };
}

function mapModel(record: unknown, index: number): AgentModel | null {
  if (!isRecord(record)) {
    return null;
  }
  const providerID = stringValue(record.providerID);
  const id = stringValue(record.id);
  if (!providerID || !id) {
    return null;
  }
  const name = stringValue(record.name) ?? id;
  const variants = Array.isArray(record.variants) ? record.variants : [];
  const defaultVariant = isRecord(record.options) ? stringValue(record.options.variant) : null;
  const variantIds = variants
    .map((variant) => (isRecord(variant) ? stringValue(variant.id) : null))
    .filter((variant): variant is string => Boolean(variant));
  const firstVariant = defaultVariant ?? variantIds[0] ?? null;
  const model = modelKey(providerID, id, firstVariant);
  const enabled = record.enabled !== false;
  return {
    id: model,
    model,
    displayName: `${name} (${providerID})`,
    description: `OpenCode ${providerID}/${id}${firstVariant ? ` variant ${firstVariant}` : ''}`,
    isDefault: index === 0,
    hidden: !enabled,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  };
}

function configuredProviderModelRecords(config: unknown) {
  const data = isRecord(config) && isRecord(config.data) ? config.data : config;
  const providerConfig = isRecord(data) && isRecord(data.provider)
    ? data.provider
    : isRecord(data) && isRecord(data.providers)
      ? data.providers
      : null;
  const configured = new Map<string, Record<string, unknown>>();
  if (!providerConfig) {
    return configured;
  }
  Object.entries(providerConfig).forEach(([providerID, provider]) => {
    if (!isRecord(provider) || !isRecord(provider.models)) {
      return;
    }
    Object.entries(provider.models).forEach(([modelID, model]) => {
      configured.set(providerModelKey(providerID, modelID), isRecord(model) ? model : {});
    });
  });
  return configured;
}

function mapProviderModel(
  provider: unknown,
  record: unknown,
  index: number,
  configuredRecord?: Record<string, unknown>,
): AgentModel | null {
  if (!isRecord(provider) || !isRecord(record)) {
    return null;
  }
  const providerID = stringValue(record.providerID) ?? stringValue(provider.id);
  const id = stringValue(record.id);
  if (!providerID || !id) {
    return null;
  }
  const name = stringValue(configuredRecord?.name) ?? stringValue(record.name) ?? id;
  const variants = configuredRecord
    ? isRecord(configuredRecord.variants)
      ? Object.keys(configuredRecord.variants)
      : []
    : isRecord(record.variants)
      ? Object.keys(record.variants)
      : [];
  const model = providerModelKey(providerID, id);
  const providerName = stringValue(provider.name) ?? providerID;
  const disabled = configuredRecord?.status === 'disabled' || record.status === 'disabled' || provider.disabled === true;
  const reasoningEfforts = variants
    .map((variant) => ({
      reasoningEffort: variant,
      description: variant === 'none'
        ? 'No reasoning'
        : variant === 'xhigh'
          ? 'Maximum reasoning'
          : `${variant[0]?.toUpperCase() ?? ''}${variant.slice(1)} reasoning`,
    }));
  return {
    id: model,
    model,
    displayName: `${name} (${providerName})`,
    description: variants.length > 0
      ? `OpenCode ${providerID}/${id} variants ${variants.join(', ')}`
      : `OpenCode ${providerID}/${id}`,
    isDefault: index === 0,
    hidden: disabled,
    supportedReasoningEfforts: reasoningEfforts,
    defaultReasoningEffort: variants.length > 0
      ? variants.includes('medium')
        ? 'medium'
        : variants[0] ?? null
      : null,
  };
}

function providerModels(result: unknown, configuredModels?: Map<string, Record<string, unknown>>) {
  const data = isRecord(result) && Array.isArray(result.providers)
    ? result
    : isRecord(result) && isRecord(result.data) && Array.isArray(result.data.providers)
      ? result.data
      : null;
  const providers = Array.isArray(data?.providers) ? data.providers : [];
  const models: AgentModel[] = [];
  providers.forEach((provider: unknown) => {
    if (!isRecord(provider) || !isRecord(provider.models)) {
      return;
    }
    Object.values(provider.models).forEach((model) => {
      if (!isRecord(model)) {
        return;
      }
      const providerID = stringValue(model.providerID) ?? stringValue(provider.id);
      const modelID = stringValue(model.id);
      if (!providerID || !modelID) {
        return;
      }
      const configuredRecord = configuredModels?.get(providerModelKey(providerID, modelID));
      if (configuredModels && configuredModels.size > 0 && !configuredRecord) {
        return;
      }
      const mapped = mapProviderModel(provider, model, models.length, configuredRecord);
      if (mapped) {
        models.push(mapped);
      }
    });
  });
  return models;
}

function promptModel(model: ReturnType<typeof parseModelKey>) {
  return model
    ? {
        providerID: model.providerID,
        modelID: model.modelID,
      }
    : null;
}

function promptInput(
  input: StartAgentTurnInput,
  directory: string | null | undefined,
  model: ReturnType<typeof parseModelKey>,
): OpenCodePromptInput {
  const modelSelection = promptModel(model);
  const variant = input.reasoningEffort ?? model?.variant;
  const common = {
    sessionID: input.providerSessionId,
    directory,
    ...(input.collaborationMode === 'plan' ? { agent: 'plan' } : {}),
    ...(modelSelection
      ? {
          model: modelSelection,
          ...(variant ? { variant } : {}),
        }
      : {}),
  };

  return {
    ...common,
    parts: [{ type: 'text', text: input.prompt }],
  };
}

function locationInput(
  providerSessionId?: string,
  directory?: string | null | undefined,
): OpenCodeLocationInput {
  return {
    ...(providerSessionId ? { sessionID: providerSessionId } : {}),
    directory,
  };
}

function modelContextWindowFromTokens(tokens: Record<string, unknown>) {
  return nonNegativeNumberValue(
    tokens.contextWindow ??
    tokens.context_window ??
    tokens.contextWindowTokens ??
    tokens.context_window_tokens ??
    tokens.modelContextWindow ??
    tokens.model_context_window,
  );
}

function openCodeUsageFromTokens(tokens: unknown) {
  if (!isRecord(tokens)) {
    return null;
  }

  const inputTokens = nonNegativeNumberValue(tokens.input ?? tokens.inputTokens ?? tokens.input_tokens) ?? 0;
  const outputTokens = nonNegativeNumberValue(tokens.output ?? tokens.outputTokens ?? tokens.output_tokens) ?? 0;
  const reasoningOutputTokens = nonNegativeNumberValue(
    tokens.reasoning ?? tokens.reasoningOutputTokens ?? tokens.reasoning_output_tokens,
  ) ?? 0;
  const cache = isRecord(tokens.cache) ? tokens.cache : null;
  const cachedInputTokens = nonNegativeNumberValue(
    tokens.cachedInputTokens ?? tokens.cached_input_tokens ?? cache?.read,
  ) ?? 0;
  const totalTokens = nonNegativeNumberValue(tokens.total ?? tokens.totalTokens ?? tokens.total_tokens)
    ?? inputTokens + outputTokens;

  if (totalTokens <= 0) {
    return null;
  }

  return {
    usage: {
      totalTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
    },
    modelContextWindow: modelContextWindowFromTokens(tokens),
  };
}

function messageTokenUsage(message: unknown) {
  if (!isRecord(message)) {
    return null;
  }

  const legacyMessage = isRecord(message.info) && Array.isArray(message.parts)
    ? {
        type: stringValue(message.info.role) ?? stringValue(message.info.type),
        content: message.parts,
        tokens: message.info.tokens,
      }
    : null;
  if (legacyMessage) {
    return messageTokenUsage(legacyMessage);
  }

  const directTokens = openCodeUsageFromTokens(message.tokens);
  if (directTokens) {
    return directTokens;
  }

  const parts = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(message.content)
      ? message.content
      : [];
  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }
    const partType = stringValue(part.type);
    if (partType !== 'step-finish') {
      continue;
    }
    const usage = openCodeUsageFromTokens(part.tokens);
    if (usage) {
      return usage;
    }
  }
  return null;
}

function modelContextWindowFromModel(model: ReturnType<typeof parseModelKey>) {
  if (!model) {
    return null;
  }
  return contextWindowForModel(providerModelKey(model.providerID, model.modelID))
    ?? contextWindowForModel(model.modelID);
}

function turnTokenUsage(messages: unknown[], model: ReturnType<typeof parseModelKey>) {
  const usageRecords = messages
    .map(messageTokenUsage)
    .filter((usage): usage is NonNullable<ReturnType<typeof messageTokenUsage>> => Boolean(usage));
  if (usageRecords.length === 0) {
    return null;
  }

  const [firstRecord, ...remainingRecords] = usageRecords.map((record) => record.usage);
  if (!firstRecord) {
    return null;
  }
  const total = remainingRecords.reduce((sum, usage) => ({
      totalTokens: sum.totalTokens + usage.totalTokens,
      inputTokens: sum.inputTokens + usage.inputTokens,
      cachedInputTokens: sum.cachedInputTokens + usage.cachedInputTokens,
      outputTokens: sum.outputTokens + usage.outputTokens,
      reasoningOutputTokens: sum.reasoningOutputTokens + usage.reasoningOutputTokens,
    }), firstRecord);
  const modelContextWindow = usageRecords.find((record) => record.modelContextWindow)?.modelContextWindow
    ?? modelContextWindowFromModel(model);

  return {
    total,
    last: total,
    modelContextWindow,
    cumulative: false,
  };
}

function openCodeStatusType(value: unknown): 'idle' | 'busy' | 'retry' | null {
  const type =
    typeof value === 'string'
      ? value
      : isRecord(value)
        ? stringValue(value.type) ??
          stringValue(value.status) ??
          (isRecord(value.status) ? stringValue(value.status.type) : null)
        : null;
  return type === 'idle' || type === 'busy' || type === 'retry' ? type : null;
}

function permissionRule(
  permission: string,
  action: OpenCodePermissionRule['action'],
  pattern = '*',
): OpenCodePermissionRule {
  return { permission, pattern, action };
}

function openCodePermissionsForSandboxMode(
  sandboxMode: StartAgentTurnInput['sandboxMode'],
): OpenCodePermissionRule[] | undefined {
  switch (sandboxMode) {
    case 'read-only':
      return [
        permissionRule('read', 'allow'),
        permissionRule('list', 'allow'),
        permissionRule('glob', 'allow'),
        permissionRule('grep', 'allow'),
        permissionRule('edit', 'deny'),
        permissionRule('bash', 'deny'),
        permissionRule('task', 'deny'),
        permissionRule('external_directory', 'deny'),
        permissionRule('repo_clone', 'deny'),
        permissionRule('repo_overview', 'allow'),
        permissionRule('webfetch', 'allow'),
        permissionRule('websearch', 'allow'),
        permissionRule('todowrite', 'allow'),
        permissionRule('question', 'allow'),
        permissionRule('skill', 'allow'),
        permissionRule('lsp', 'allow'),
        permissionRule('doom_loop', 'deny'),
      ];
    case 'workspace-write':
      return [
        permissionRule('read', 'allow'),
        permissionRule('list', 'allow'),
        permissionRule('glob', 'allow'),
        permissionRule('grep', 'allow'),
        permissionRule('edit', 'allow'),
        permissionRule('bash', 'ask'),
        permissionRule('task', 'ask'),
        permissionRule('external_directory', 'ask'),
        permissionRule('repo_clone', 'ask'),
        permissionRule('repo_overview', 'allow'),
        permissionRule('webfetch', 'allow'),
        permissionRule('websearch', 'allow'),
        permissionRule('todowrite', 'allow'),
        permissionRule('question', 'allow'),
        permissionRule('skill', 'allow'),
        permissionRule('lsp', 'allow'),
        permissionRule('doom_loop', 'ask'),
      ];
    case 'danger-full-access':
      return [
        permissionRule('read', 'allow'),
        permissionRule('list', 'allow'),
        permissionRule('glob', 'allow'),
        permissionRule('grep', 'allow'),
        permissionRule('edit', 'allow'),
        permissionRule('bash', 'allow'),
        permissionRule('task', 'allow'),
        permissionRule('external_directory', 'allow'),
        permissionRule('repo_clone', 'allow'),
        permissionRule('repo_overview', 'allow'),
        permissionRule('webfetch', 'allow'),
        permissionRule('websearch', 'allow'),
        permissionRule('todowrite', 'allow'),
        permissionRule('question', 'allow'),
        permissionRule('skill', 'allow'),
        permissionRule('lsp', 'allow'),
        permissionRule('doom_loop', 'allow'),
      ];
    default:
      return undefined;
  }
}

function hasMeaningfulTurnResult(turn: AgentTurn | null) {
  return Boolean(turn?.error) || Boolean(turn?.items.some(isTerminalRuntimeItem));
}

function liveHistoryItemsForTurn(turn: AgentTurn | null): AgentHistoryItem[] {
  if (!turn) {
    return [];
  }
  return turn.items.filter(isLiveRuntimeItem);
}

function isLiveRuntimeItem(item: AgentHistoryItem) {
  return (
    item.kind !== 'userMessage' &&
    item.kind !== 'other' &&
    item.kind !== 'contextCompaction'
  );
}

function isTerminalRuntimeItem(item: AgentHistoryItem) {
  return item.kind === 'agentMessage' || item.kind === 'plan' || item.status === 'failed';
}

function turnWithPlanItemForCollaborationMode(
  turn: AgentTurn,
  collaborationMode: StartAgentTurnInput['collaborationMode'],
): AgentTurn {
  if (collaborationMode !== 'plan' || turn.items.some((item) => item.kind === 'plan')) {
    return turn;
  }

  const lastAgentMessageIndex = turn.items.findLastIndex((item) => item.kind === 'agentMessage');
  if (lastAgentMessageIndex < 0) {
    return turn;
  }

  return {
    ...turn,
    items: turn.items.map((item, index) => (
      index === lastAgentMessageIndex
        ? {
            ...item,
            kind: 'plan' as const,
            previewText: item.previewText ?? 'Plan ready for review.',
          }
        : item
    )),
  };
}

function messageId(message: unknown) {
  if (!isRecord(message)) {
    return null;
  }
  return stringValue(message.id) ?? (isRecord(message.info) ? stringValue(message.info.id) : null);
}

function sessionSummary(record: unknown): AgentSessionSummary | null {
  if (!isRecord(record)) {
    return null;
  }
  const id = stringValue(record.id);
  if (!id) {
    return null;
  }
  const time = isRecord(record.time) ? record.time : {};
  const model = isRecord(record.model)
    ? modelKey(
        stringValue(record.model.providerID) ?? 'unknown',
        stringValue(record.model.id) ?? 'unknown',
        stringValue(record.model.variant),
      )
    : null;
  return {
    provider: 'opencode',
    providerSessionId: id,
    cwd: stringValue(record.directory) ?? stringValue(record.path) ?? '',
    title: stringValue(record.title),
    preview: model,
    createdAt: isoFromMs(time.created),
    updatedAt: isoFromMs(time.updated),
    status: 'idle',
    rawSession: record,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('Unable to allocate a local OpenCode server port.'));
        }
      });
    });
  });
}

export class OpenCodeRuntimeAdapter extends EventEmitter implements AgentRuntime {
  readonly provider = 'opencode' as const;
  readonly displayName = 'OpenCode';
  readonly description = 'Local OpenCode runtime.';
  readonly capabilities = opencodeCapabilities;
  readonly installation: AgentBackendInstallationDto = {
    packageName: 'opencode-ai',
    installed: false,
    installedVersion: null,
    latestVersion: null,
    installCommand: 'npm install -g opencode-ai @opencode-ai/sdk',
    updateCommand: 'npm install -g opencode-ai@latest @opencode-ai/sdk@latest',
    busy: false,
    lastError: null,
  };
  readonly managementSchema: AgentRuntimeManagementSchema = {
    hostConfigFiles: [],
    toolboxItems: [
      { action: 'compact', command: '/compact', label: 'Compact' },
      { action: 'fork', command: '/fork', label: 'Fork', panel: 'fork' },
      { action: 'mcp', command: '/mcp', label: 'MCP', panel: 'mcp' },
    ],
    hookCommandTemplates: [],
    providerConfigFormat: 'json',
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
  private client: OpenCodeClient | null = null;
  private server: { url: string; close(): void } | null = null;
  private readonly sessionCwds = new Map<string, string>();
  private readonly sessionModels = new Map<string, string | null>();
  private readonly sessionSandboxModes = new Map<string, StartAgentTurnInput['sandboxMode']>();
  private readonly activeTurns = new Map<string, {
    providerSessionId: string;
    aborted: boolean;
    completedItemIds: Set<string>;
    runningItemIds: Set<string>;
    lastPlanSignature: string | null;
  }>();

  constructor(private readonly options: OpenCodeRuntimeAdapterOptions) {
    super();
  }

  getStatus(): AgentRuntimeStatus {
    return { ...this.status };
  }

  async start() {
    try {
      await fs.mkdir(this.options.home, { recursive: true });
      const sdk = this.options.sdk ?? await this.loadSdk();
      const port = this.options.sdk ? undefined : await availablePort();
      const instance = await sdk.createOpencode({
        hostname: '127.0.0.1',
        ...(port ? { port } : {}),
      });
      this.installation.installed = true;
      this.installation.lastError = null;
      this.client = instance.client;
      this.server = instance.server;
      this.status = {
        ...this.status,
        state: 'ready',
        lastStartedAt: new Date().toISOString(),
        lastError: null,
        restartCount: this.status.state === 'stopped' ? this.status.restartCount : this.status.restartCount + 1,
      };
      this.emit('status', this.getStatus());
    } catch (error) {
      this.client = null;
      this.server = null;
      this.installation.installed = false;
      this.installation.lastError = errorMessage(error);
      this.status = {
        ...this.status,
        state: 'stopped',
        lastError: `OpenCode is not installed or could not start. ${errorMessage(error)}`,
      };
      this.emit('status', this.getStatus());
    }
  }

  async stop() {
    this.server?.close();
    this.server = null;
    this.client = null;
    this.sessionSandboxModes.clear();
    this.activeTurns.clear();
    this.status = {
      ...this.status,
      state: 'stopped',
      lastError: null,
    };
    this.emit('status', this.getStatus());
  }

  async listModels(): Promise<AgentModel[]> {
    const client = await this.requireClient();
    if (client.config?.providers) {
      const configuredModels = client.config.get
        ? configuredProviderModelRecords(unwrapResult(await client.config.get()))
        : undefined;
      const providers = providerModels(
        unwrapResult(await client.config.providers()),
        configuredModels,
      );
      if (providers.length > 0) {
        return providers.map((model, index) => ({ ...model, isDefault: index === 0 }));
      }
    }
    const result = client.model?.list
      ? unwrapResult(await client.model.list({ query: { location: {} } }))
      : [];
    return result
      .map(mapModel)
      .filter((model): model is AgentModel => Boolean(model))
      .map((model, index) => ({ ...model, isDefault: index === 0 }));
  }

  async listSessions(): Promise<AgentSessionSummary[]> {
    const client = await this.requireClient();
    const sessions = resultItems(unwrapResult(await client.session.list({ limit: 100 })));
    return sessions
      .map(sessionSummary)
      .filter((session): session is AgentSessionSummary => Boolean(session));
  }

  async listLoadedSessions(): Promise<string[]> {
    return (await this.listSessions()).map((session) => session.providerSessionId);
  }

  async readSession(providerSessionId: string, options: ReadAgentSessionOptions = {}): Promise<AgentSessionDetail> {
    const client = await this.requireClient();
    const directory = options.workspacePath ?? this.sessionCwds.get(providerSessionId);
    const [sessionRecord, messages] = await Promise.all([
      client.session.get(locationInput(providerSessionId, directory)),
      this.readSessionMessages(client, providerSessionId, directory),
    ]);
    const summary = sessionSummary(unwrapResult(sessionRecord)) ?? {
      provider: 'opencode' as const,
      providerSessionId,
      cwd: options.workspacePath ?? this.sessionCwds.get(providerSessionId) ?? '',
      title: null,
      preview: null,
      createdAt: null,
      updatedAt: null,
      status: 'idle' as const,
      rawSession: null,
    };
    return {
      ...summary,
      turns: openCodeMessagesToTurns(messages, {
        workspacePath: directory ?? summary.cwd,
      }),
    };
  }

  async startSession(input: StartAgentSessionInput): Promise<StartAgentSessionResult> {
    const client = await this.requireClient();
    const model = parseModelKey(input.model);
    const permission = openCodePermissionsForSandboxMode(input.sandboxMode);
    const session = unwrapResult(await client.session.create({
      ...locationInput(undefined, input.cwd),
      ...(model
        ? {
            model: {
              id: model.modelID,
              providerID: model.providerID,
              ...(model.variant ? { variant: model.variant } : {}),
            },
          }
        : {}),
      ...(permission ? { permission } : {}),
    }));
    const summary = sessionSummary(session);
    if (!summary) {
      throw new AgentRuntimeError('OpenCode did not return a session id.', 'opencode', 'invalid_response');
    }
    this.sessionCwds.set(summary.providerSessionId, input.cwd);
    this.sessionModels.set(summary.providerSessionId, input.model);
    if (input.sandboxMode !== undefined) {
      this.sessionSandboxModes.set(summary.providerSessionId, input.sandboxMode);
    }
    return {
      provider: 'opencode',
      providerSessionId: summary.providerSessionId,
      model: input.model,
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      session: {
        ...summary,
        cwd: summary.cwd || input.cwd,
        turns: [],
      },
      rawSession: session,
    };
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<StartAgentSessionResult> {
    const session = await this.readSession(input.providerSessionId);
    if (input.model !== undefined) {
      this.sessionModels.set(input.providerSessionId, input.model);
    }
    if (input.sandboxMode !== undefined) {
      this.sessionSandboxModes.set(input.providerSessionId, input.sandboxMode);
    }
    return {
      provider: 'opencode',
      providerSessionId: input.providerSessionId,
      model: input.model ?? this.sessionModels.get(input.providerSessionId) ?? null,
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      session,
      rawSession: session.rawSession,
    };
  }

  async startTurn(input: StartAgentTurnInput): Promise<AgentTurn> {
    const client = await this.requireClient();
    const providerTurnId = input.displayTurnId ?? crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const model = parseModelKey(input.model ?? this.sessionModels.get(input.providerSessionId));
    this.activeTurns.set(providerTurnId, {
      providerSessionId: input.providerSessionId,
      aborted: false,
      completedItemIds: new Set(),
      runningItemIds: new Set(),
      lastPlanSignature: null,
    });
    const initialItems = input.hidden
      ? []
      : [{
          id: `${providerTurnId}:user`,
          kind: 'userMessage' as const,
          text: input.displayPrompt ?? input.prompt,
        }];
    const startedTurn: AgentTurn = {
      providerTurnId,
      startedAt,
      status: 'inProgress',
      error: null,
      items: initialItems,
    };
    this.emitRuntimeEvent({
      type: 'turn.started',
      provider: 'opencode',
      providerSessionId: input.providerSessionId,
      turn: startedTurn,
    });
    void this.runPrompt(client, input, providerTurnId, startedAt, model);
    return startedTurn;
  }

  async interruptTurn(input: InterruptAgentTurnInput): Promise<AgentTurn | null> {
    const client = await this.requireClient();
    const active = this.activeTurns.get(input.providerTurnId);
    if (!active) {
      return null;
    }
    active.aborted = true;
    await client.session.abort(locationInput(input.providerSessionId, this.sessionCwds.get(input.providerSessionId)));
    this.activeTurns.delete(input.providerTurnId);
    return {
      providerTurnId: input.providerTurnId,
      status: 'interrupted',
      error: null,
      items: [],
    };
  }

  async compactSession(providerSessionId: string) {
    const client = await this.requireClient();
    if ('compact' in client.session && typeof client.session.compact === 'function') {
      await (client.session.compact as (input: unknown) => Promise<unknown>)({
        ...locationInput(providerSessionId, this.sessionCwds.get(providerSessionId)),
      });
    }
  }

  private async runPrompt(
    client: OpenCodeClient,
    input: StartAgentTurnInput,
    providerTurnId: string,
    startedAt: string,
    model: ReturnType<typeof parseModelKey>,
  ) {
    try {
      const directory = input.workspacePath ?? this.sessionCwds.get(input.providerSessionId);
      await this.updateSessionSandboxMode(client, input.providerSessionId, directory, input.sandboxMode);
      const baselineMessages = await this.readSessionMessages(client, input.providerSessionId, directory);
      const baselineMessageIds = new Set(baselineMessages.map(messageId).filter((id): id is string => Boolean(id)));
      let promptResponse: unknown = null;
      let promptError: unknown = null;
      const promptPromise = client.session.prompt(promptInput(input, directory, model))
        .then((response) => {
          promptResponse = unwrapResult(response);
        })
        .catch((error) => {
          promptError = error;
        });
      void promptPromise;
      this.emitRuntimeEvent({
        type: 'session.status.changed',
        provider: 'opencode',
        providerSessionId: input.providerSessionId,
        status: 'running',
      });
      await this.waitForPrompt(client, input.providerSessionId, directory);
      const active = this.activeTurns.get(providerTurnId);
      if (active?.aborted) {
        return;
      }
      const readOptions: ReadAgentSessionOptions = {};
      const workspacePath = input.workspacePath ?? undefined;
      if (workspacePath) {
        readOptions.workspacePath = workspacePath;
      }
      const turn = await this.waitForTurnResult(
        input.providerSessionId,
        readOptions,
        providerTurnId,
        baselineMessageIds,
        model,
        promptPromise,
        () => promptResponse,
        () => promptError,
      );
      const completedTurn = turnWithPlanItemForCollaborationMode(turn ?? {
        providerTurnId,
        startedAt,
        status: 'completed' as const,
        error: promptError ? { message: errorMessage(promptError) } : null,
        items: openCodeMessageToHistoryItems(
          promptResponse,
          directory ? { workspacePath: directory } : {},
        ),
      }, input.collaborationMode);
      this.activeTurns.delete(providerTurnId);
      this.emitRuntimeEvent({
        type: 'turn.completed',
        provider: 'opencode',
        providerSessionId: input.providerSessionId,
        turn: {
          ...completedTurn,
          providerTurnId,
          startedAt: completedTurn.startedAt ?? startedAt,
        },
      });
    } catch (error) {
      this.activeTurns.delete(providerTurnId);
      this.emitRuntimeEvent({
        type: 'turn.failed',
        provider: 'opencode',
        providerSessionId: input.providerSessionId,
        providerTurnId,
        error: errorMessage(error),
      });
    }
  }

  private async waitForTurnResult(
    providerSessionId: string,
    readOptions: ReadAgentSessionOptions,
    providerTurnId: string,
    baselineMessageIds: Set<string>,
    model: ReturnType<typeof parseModelKey>,
    promptPromise: Promise<void>,
    promptResponse: () => unknown,
    promptError: () => unknown,
  ) {
    const deadline = Date.now() + openCodePromptTimeoutMs;
    let promptSettled = false;
    promptPromise.finally(() => {
      promptSettled = true;
    });

    while (Date.now() < deadline) {
      const active = this.activeTurns.get(providerTurnId);
      if (active?.aborted) {
        return null;
      }

      const client = await this.requireClient();
      const directory = readOptions.workspacePath ?? this.sessionCwds.get(providerSessionId);
      const messages = await this.readSessionMessages(client, providerSessionId, directory);
      const newMessages = messages.filter((message) => {
        const id = messageId(message);
        return !id || !baselineMessageIds.has(id);
      });
      const turns = openCodeMessagesToTurns(
        newMessages,
        directory ? { workspacePath: directory } : {},
      );
      const turn = turns[turns.length - 1] ?? null;
      this.emitPlanUpdate(providerSessionId, providerTurnId, newMessages);
      this.emitLiveTurnItems(providerSessionId, providerTurnId, turn);
      const sessionStatus = await this.readOpenCodeSessionStatus(client, providerSessionId, directory);
      const sessionIdle = sessionStatus === 'idle';
      if (sessionIdle && hasMeaningfulTurnResult(turn)) {
        this.emitTurnUsage(providerSessionId, providerTurnId, turnTokenUsage(newMessages, model));
        return turn;
      }

      if (promptSettled && promptError()) {
        throw promptError();
      }
      if (promptSettled) {
        const responseItems = openCodeMessageToHistoryItems(
          promptResponse(),
          directory ? { workspacePath: directory } : {},
        );
        if (responseItems.length > 0) {
          responseItems.forEach((item) => {
            if (isLiveRuntimeItem(item)) {
              this.emitRuntimeItem(providerSessionId, providerTurnId, item);
            }
          });
          if (!sessionIdle && sessionStatus !== null) {
            await sleep(openCodePromptPollIntervalMs);
            continue;
          }
          if (!responseItems.some(isTerminalRuntimeItem)) {
            await sleep(openCodePromptPollIntervalMs);
            continue;
          }
          this.emitTurnUsage(providerSessionId, providerTurnId, turnTokenUsage([promptResponse()], model));
          return {
            providerTurnId,
            startedAt: null,
            status: 'completed' as const,
            error: null,
            items: responseItems,
          };
        }
      }
      await sleep(openCodePromptPollIntervalMs);
    }

    throw new Error('Timed out waiting for OpenCode to write a response.');
  }

  private async readOpenCodeSessionStatus(
    client: OpenCodeClient,
    providerSessionId: string,
    directory: string | null | undefined,
  ) {
    if (!client.session.status) {
      return null;
    }
    try {
      const statusMap = unwrapResult(await client.session.status({
        query: {
          ...(directory ? { directory } : {}),
        },
      }));
      if (!isRecord(statusMap)) {
        return null;
      }
      return openCodeStatusType(statusMap[providerSessionId]);
    } catch {
      return null;
    }
  }

  private emitTurnUsage(
    providerSessionId: string,
    providerTurnId: string,
    usage: ReturnType<typeof turnTokenUsage>,
  ) {
    if (!usage) {
      return;
    }
    this.emitRuntimeEvent({
      type: 'usage.updated',
      provider: 'opencode',
      providerSessionId,
      providerTurnId,
      usage,
    });
  }

  private emitPlanUpdate(
    providerSessionId: string,
    providerTurnId: string,
    messages: unknown[],
  ) {
    const active = this.activeTurns.get(providerTurnId);
    if (!active) {
      return;
    }
    const planUpdate = openCodeMessagesToPlanUpdate(messages);
    if (!planUpdate) {
      return;
    }
    const signature = JSON.stringify(planUpdate);
    if (active.lastPlanSignature === signature) {
      return;
    }
    active.lastPlanSignature = signature;
    this.emitRuntimeEvent({
      type: 'plan.updated',
      provider: 'opencode',
      providerSessionId,
      providerTurnId,
      explanation: planUpdate.explanation,
      plan: planUpdate.plan,
    });
  }

  private emitLiveTurnItems(
    providerSessionId: string,
    providerTurnId: string,
    turn: AgentTurn | null,
  ) {
    for (const item of liveHistoryItemsForTurn(turn)) {
      this.emitRuntimeItem(providerSessionId, providerTurnId, item);
    }
  }

  private emitRuntimeItem(
    providerSessionId: string,
    providerTurnId: string,
    item: AgentHistoryItem,
  ) {
    const active = this.activeTurns.get(providerTurnId);
    if (!active || !isLiveRuntimeItem(item)) {
      return;
    }
    const isRunning = item.status === 'running';
    if (isRunning) {
      if (active.completedItemIds.has(item.id) || active.runningItemIds.has(item.id)) {
        return;
      }
      active.runningItemIds.add(item.id);
    } else if (active.completedItemIds.has(item.id)) {
      return;
    } else {
      active.completedItemIds.add(item.id);
    }
    this.emitRuntimeEvent({
      type: isRunning ? 'item.started' : 'item.completed',
      provider: 'opencode',
      providerSessionId,
      providerTurnId,
      item,
    });
  }

  private async updateSessionSandboxMode(
    client: OpenCodeClient,
    providerSessionId: string,
    directory: string | null | undefined,
    sandboxMode: StartAgentTurnInput['sandboxMode'],
  ) {
    const permission = openCodePermissionsForSandboxMode(sandboxMode);
    if (!permission || !client.session.update) {
      return;
    }
    if (this.sessionSandboxModes.get(providerSessionId) === sandboxMode) {
      return;
    }
    unwrapResult(await client.session.update({
      ...locationInput(providerSessionId, directory),
      permission,
    }));
    this.sessionSandboxModes.set(providerSessionId, sandboxMode);
  }

  private async readSessionMessages(
    client: OpenCodeClient,
    providerSessionId: string,
    directory: string | null | undefined,
  ) {
    const parameters = {
      ...locationInput(providerSessionId, directory),
    };
    const legacyMessages = async () => resultItems(unwrapResult(await client.session.messages(parameters)));
    try {
      const messages = await legacyMessages();
      if (messages.length > 0 || !client.v2?.session?.messages) {
        return messages;
      }
    } catch (legacyError) {
      if (!client.v2?.session?.messages) {
        throw legacyError;
      }
      try {
        return resultItems(unwrapResult(await client.v2.session.messages(parameters)));
      } catch (v2Error) {
        throw new Error(
          `OpenCode session messages failed. legacy: ${errorMessage(legacyError)}; v2: ${errorMessage(v2Error)}`,
        );
      }
    }
    return resultItems(unwrapResult(await client.v2!.session!.messages(parameters)));
  }

  private async waitForPrompt(
    client: OpenCodeClient,
    providerSessionId: string,
    directory: string | null | undefined,
  ) {
    const parameters = {
      ...locationInput(providerSessionId, directory),
    };
    if (client.v2?.session?.wait) {
      try {
        unwrapResult(await withTimeout(client.v2.session.wait(parameters), openCodeWaitTimeoutMs));
        return;
      } catch {
        // OpenCode's v2 session surface is still incomplete in some releases.
      }
    }
    if (client.session.wait) {
      try {
        unwrapResult(await withTimeout(client.session.wait(parameters), openCodeWaitTimeoutMs));
      } catch {
        // Prompt polling below is the source of truth; OpenCode wait can outlive useful response writes.
      }
    }
  }

  private async requireClient() {
    if (!this.client) {
      await this.start();
    }
    if (!this.client) {
      throw new AgentRuntimeError(
        this.status.lastError ?? 'OpenCode is unavailable.',
        'opencode',
        'provider_unavailable',
      );
    }
    return this.client;
  }

  private async loadSdk(): Promise<OpenCodeSdkModule> {
    try {
      return await importOptionalPackage('@opencode-ai/sdk/v2') as OpenCodeSdkModule;
    } catch (error) {
      throw new AgentRuntimeError(
        'Install OpenCode support with npm install -g opencode-ai and npm install -g @opencode-ai/sdk, or add @opencode-ai/sdk to this checkout.',
        'opencode',
        'provider_unavailable',
        undefined,
        error,
      );
    }
  }

  private emitRuntimeEvent(event: AgentRuntimeEvent) {
    this.emit('event', event);
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
      const resolved = resolveOptionalPackage(requireFromGlobal, globalRoot, specifier);
      return await dynamicImport(pathToFileURL(resolved).href);
    } catch {
      throw localError;
    }
  }
}

function resolveOptionalPackage(
  requireFromGlobal: ReturnType<typeof createRequire>,
  globalRoot: string,
  specifier: string,
) {
  try {
    return requireFromGlobal.resolve(specifier);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' &&
      specifier === '@opencode-ai/sdk/v2'
    ) {
      return path.join(globalRoot, '@opencode-ai', 'sdk', 'dist', 'v2', 'index.js');
    }
    throw error;
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
