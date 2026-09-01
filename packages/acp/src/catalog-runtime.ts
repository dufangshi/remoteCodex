import { EventEmitter } from 'node:events';

import {
  AgentRuntimeError,
  type AgentActionRequestResponseInput,
  type AgentModel,
  type AgentPendingProviderRequest,
  type AgentProviderCapabilities,
  type AgentProviderRequest,
  type AgentProviderRequestMapping,
  type AgentRuntime,
  type AgentRuntimeEvent,
  type AgentRuntimeManagementSchema,
  type AgentRuntimeStatus,
  type AgentSessionDetail,
  type AgentSessionSummary,
  type AgentTurn,
  type InterruptAgentTurnInput,
  type ReadAgentSessionOptions,
  type ResumeAgentSessionInput,
  type SendAgentInputInput,
  type SetAgentGoalInput,
  type StartAgentSessionInput,
  type StartAgentSessionResult,
  type StartAgentTurnInput,
} from '../../agent-runtime/src/index';
import type { AgentBackendInstallationDto } from '../../shared/src/index';
import {
  AcpAgentCatalog,
  acpAgentMetadata,
  type AcpAgentCatalogEntry,
} from './agent-catalog';
import { snapshotAcpAgentCapabilities } from './capabilities';
import { AcpRuntimeAdapter } from './runtimeAdapter';
import { loadCodexAcpEnvironment } from './codex-environment';
import { acpHarnessAdapterFor } from './harness-adapters';

interface AcpCatalogRuntimeOptions {
  customCommand?: string | null;
  codexHome?: string | null;
  startupTimeoutMs?: number;
  clientInfo?: {
    name: string;
    title?: string;
    version?: string;
  };
  catalog?: AcpAgentCatalog;
}

const SESSION_DELIMITER = '::';

const catalogCapabilities: AgentProviderCapabilities = {
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
    permissionRequests: true,
    sandboxMode: true,
    performanceMode: false,
    goals: false,
  },
  management: {
    models: false,
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
    costUsd: false,
  },
};

const catalogManagementSchema: AgentRuntimeManagementSchema = {
  hostConfigFiles: [],
  toolboxItems: [
    { action: 'fast', command: '/fast', label: 'Fast mode' },
    { action: 'compact', command: '/compact', label: 'Compact context' },
    { action: 'goal', command: '/goal', label: 'Goal' },
    { action: 'fork', command: '/fork', label: 'Fork' },
  ],
  hookCommandTemplates: [],
  providerConfigFormat: 'none',
  mcpConfigFormat: 'none',
  configArchives: false,
  buildRestart: false,
};

function encodeSessionId(agentId: string, providerSessionId: string) {
  return `${agentId}${SESSION_DELIMITER}${providerSessionId}`;
}

function decodeScopedId(value: string | number) {
  const normalized = String(value);
  const delimiterIndex = normalized.indexOf(SESSION_DELIMITER);
  if (delimiterIndex <= 0) {
    return null;
  }
  return {
    agentId: normalized.slice(0, delimiterIndex),
    rawId: normalized.slice(delimiterIndex + SESSION_DELIMITER.length),
  };
}

function scopedSession(agentId: string, session: AgentSessionDetail): AgentSessionDetail {
  return {
    ...session,
    agentId,
    providerSessionId: encodeSessionId(agentId, session.providerSessionId),
  };
}

function scopedSummary(agentId: string, session: AgentSessionSummary): AgentSessionSummary {
  return {
    ...session,
    agentId,
    providerSessionId: encodeSessionId(agentId, session.providerSessionId),
  };
}

function delegatedSessionInput(input: StartAgentSessionInput): StartAgentSessionInput {
  const delegated = { ...input };
  delete delegated.agentId;
  return delegated;
}

export class AcpCatalogRuntimeAdapter extends EventEmitter implements AgentRuntime {
  readonly provider = 'acp' as const;
  readonly displayName = 'ACP Agent';
  readonly description = 'Choose from installed ACP-native agents and ACP adapters.';
  readonly capabilities = structuredClone(catalogCapabilities);
  readonly managementSchema = catalogManagementSchema;
  readonly installation: AgentBackendInstallationDto = {
    packageName: null,
    installed: true,
    installedVersion: 'Built in · 0 ACP agents ready',
    latestVersion: null,
    installCommand: null,
    updateCommand: null,
    busy: false,
    lastError: null,
  };

  private readonly catalog: AcpAgentCatalog;
  private readonly agents = new Map<string, AcpRuntimeAdapter>();
  private readonly modelCache = new Map<string, { at: number; models: AgentModel[] }>();
  private readonly operationalMetrics = {
    sessionStartFailures: 0,
    resumeFailures: 0,
    capabilityProbeFailures: 0,
  };
  private status: AgentRuntimeStatus = {
    state: 'stopped',
    transport: 'stdio',
    lastStartedAt: null,
    lastError: null,
    restartCount: 0,
  };

  constructor(private readonly options: AcpCatalogRuntimeOptions = {}) {
    super();
    this.catalog = options.catalog ?? new AcpAgentCatalog(
      options.customCommand !== undefined
        ? { customCommand: options.customCommand }
        : {},
    );
  }

  getStatus() {
    return {
      ...this.status,
      operationalMetrics: { ...this.operationalMetrics },
    };
  }

  async start() {
    this.status = {
      ...this.status,
      state: 'starting',
      lastError: null,
      restartCount: this.status.lastStartedAt ? this.status.restartCount + 1 : 0,
    };
    this.emit('status', this.getStatus());
    await this.refreshCatalog(true);
  }

  async stop() {
    await Promise.allSettled([...this.agents.values()].map((agent) => agent.stop()));
    this.agents.clear();
    this.recomputeAgentCapabilities();
    this.status = {
      ...this.status,
      state: 'stopped',
      lastError: null,
    };
    this.emit('status', this.getStatus());
  }

  async listModels(): Promise<AgentModel[]> {
    return this.listAgentOptions();
  }

  async listAgentOptions(): Promise<AgentModel[]> {
    const entries = await this.refreshCatalog();
    const defaultAgent = entries.find((entry) => entry.availability === 'ready')?.id ?? null;
    return entries.map((entry) => ({
      id: entry.id,
      model: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      isDefault: entry.id === defaultAgent,
      hidden: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
      selectionKind: 'agent',
      acpAgent: acpAgentMetadata(entry),
    }));
  }

  async listModelsForAgent(agentId: string, cwd: string) {
    try {
      const cacheKey = `${agentId}\0${cwd}`;
      const cached = this.modelCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 30_000) {
        return cached.models;
      }
      const agent = await this.agentFor(agentId);
      let models = await agent.inspectModelOptions(cwd);
      if (agent.capabilities.controls.performanceMode) {
        models = models.map((model) => ({
          ...model,
          supportsPerformanceMode: true,
        }));
      }
      if (models.length === 1 && models[0]?.model === 'default') {
        const commandModels = await this.catalog.listCommandModels(agentId);
        if (commandModels.length > 0) {
          const discoveredDefaults = models[0];
          models = commandModels.map((model) => ({
            ...model,
            supportsPerformanceMode:
              model.supportsPerformanceMode ??
              discoveredDefaults.supportsPerformanceMode ??
              false,
            supportedReasoningEfforts:
              model.supportedReasoningEfforts.length > 0
                ? model.supportedReasoningEfforts
                : discoveredDefaults.supportedReasoningEfforts,
            defaultReasoningEffort:
              model.defaultReasoningEffort ??
              discoveredDefaults.defaultReasoningEffort,
          }));
        }
      }
      this.modelCache.set(cacheKey, { at: Date.now(), models });
      return models;
    } catch (error) {
      this.operationalMetrics.capabilityProbeFailures += 1;
      throw error;
    }
  }

  async getAgentCapabilitySnapshot(agentId: string) {
    const entry = (await this.refreshCatalog()).find((candidate) => candidate.id === agentId);
    if (!entry) {
      throw new AgentRuntimeError(`Unknown ACP agent: ${agentId}`, 'acp', 'request_failed');
    }
    if (entry.availability !== 'ready') {
      return snapshotAcpAgentCapabilities({
        agentId,
        availability: entry.availability,
        effectiveCapabilities: this.capabilities,
      });
    }
    const agent = await this.agentFor(agentId);
    return snapshotAcpAgentCapabilities({
      agentId,
      availability: entry.availability,
      negotiated: agent.getProtocolSnapshot(),
      effectiveCapabilities: agent.capabilities,
    });
  }

  getScopedCapabilities(input: {
    agentId?: string | null;
    providerSessionId?: string | null;
  }) {
    const sessionOwner = input.providerSessionId
      ? decodeScopedId(input.providerSessionId)
      : null;
    const agentId = sessionOwner?.agentId ?? input.agentId ?? null;
    const child = agentId ? this.agents.get(agentId) : null;
    return structuredClone(child?.capabilities ?? catalogCapabilities);
  }

  async installModel(modelId: string) {
    await this.catalog.installAdapter(modelId);
    await this.refreshCatalog(true);
  }

  async listSessions() {
    const sessions = await Promise.all(
      [...this.agents.entries()].map(async ([agentId, agent]) =>
        (await agent.listSessions()).map((session) => scopedSummary(agentId, session)),
      ),
    );
    return sessions.flat();
  }

  async listImportSessions(agentId?: string | null) {
    const entries = agentId
      ? (await this.refreshCatalog()).filter((entry) => entry.id === agentId)
      : [];
    const sessions = await Promise.all(
      entries.map(async (entry) => {
        if (entry.availability !== 'ready') {
          return [];
        }
        try {
          const agent = await this.agentFor(entry.id);
          return (await agent.listSessions()).map((session) =>
            scopedSummary(entry.id, session));
        } catch {
          return [];
        }
      }),
    );
    return sessions.flat();
  }

  async listLoadedSessions() {
    const sessions = await Promise.all(
      [...this.agents.entries()].map(async ([agentId, agent]) =>
        (await agent.listLoadedSessions()).map((sessionId) =>
          encodeSessionId(agentId, sessionId),
        ),
      ),
    );
    return sessions.flat();
  }

  async readSession(
    providerSessionId: string,
    options?: ReadAgentSessionOptions,
  ): Promise<AgentSessionDetail> {
    void options;
    const owner = this.requireSessionOwner(providerSessionId);
    const agent = await this.agentFor(owner.agentId);
    return scopedSession(
      owner.agentId,
      await agent.readSession(owner.rawId),
    );
  }

  async startSession(input: StartAgentSessionInput): Promise<StartAgentSessionResult> {
    const agentId = input.agentId;
    if (!agentId) {
      throw new AgentRuntimeError('Select an ACP agent before creating the thread.', 'acp');
    }
    let agent: AcpRuntimeAdapter;
    let response: StartAgentSessionResult;
    try {
      agent = await this.agentFor(agentId);
      response = await agent.startSession(delegatedSessionInput(input));
    } catch (error) {
      this.operationalMetrics.sessionStartFailures += 1;
      throw error;
    }
    const probedDefaultModel = this.modelCache
      .get(`${agentId}\0${input.cwd}`)
      ?.models.find((model) => model.isDefault)?.model ?? null;
    const resolvedModel = response.model && response.model !== 'default'
      ? response.model
      : input.model !== 'default'
        ? input.model
        : probedDefaultModel ?? input.model;
    this.refreshAgentSessionCapabilities(agentId, agent);
    this.modelCache.clear();
    const session = scopedSession(agentId, response.session);
    return {
      ...response,
      agentId,
      providerSessionId: session.providerSessionId,
      model: resolvedModel,
      reasoningEffort: response.reasoningEffort ?? input.reasoningEffort ?? null,
      session,
    };
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<StartAgentSessionResult> {
    const owner = this.requireSessionOwner(input.providerSessionId);
    let agent: AcpRuntimeAdapter;
    let response: StartAgentSessionResult;
    try {
      agent = await this.agentFor(owner.agentId);
      response = await agent.resumeSession({
        ...input,
        providerSessionId: owner.rawId,
      });
    } catch (error) {
      this.operationalMetrics.resumeFailures += 1;
      throw error;
    }
    this.refreshAgentSessionCapabilities(owner.agentId, agent);
    this.modelCache.clear();
    const session = scopedSession(owner.agentId, response.session);
    return {
      ...response,
      agentId: owner.agentId,
      providerSessionId: session.providerSessionId,
      model: response.model ?? input.model ?? null,
      session,
    };
  }

  async startTurn(input: StartAgentTurnInput): Promise<AgentTurn> {
    const owner = this.requireSessionOwner(input.providerSessionId);
    const agent = await this.agentFor(owner.agentId);
    return agent.startTurn({
      ...input,
      providerSessionId: owner.rawId,
    });
  }

  async interruptTurn(input: InterruptAgentTurnInput): Promise<AgentTurn | null> {
    const owner = this.requireSessionOwner(input.providerSessionId);
    const agent = await this.agentFor(owner.agentId);
    return agent.interruptTurn({
      ...input,
      providerSessionId: owner.rawId,
    });
  }

  async sendInput(input: SendAgentInputInput) {
    const owner = this.requireSessionOwner(input.providerSessionId);
    const agent = await this.agentFor(owner.agentId);
    return agent.sendInput({
      ...input,
      providerSessionId: owner.rawId,
    });
  }

  async compactSession(providerSessionId: string) {
    const owner = this.requireSessionOwner(providerSessionId);
    const agent = await this.agentFor(owner.agentId);
    return agent.compactSession(owner.rawId);
  }

  async forkSession(input: { providerSessionId: string; atTurnId?: string | null }) {
    const owner = this.requireSessionOwner(input.providerSessionId);
    const agent = await this.agentFor(owner.agentId);
    return scopedSession(owner.agentId, await agent.forkSession({
      ...input,
      providerSessionId: owner.rawId,
    }));
  }

  async getGoal(providerSessionId: string) {
    const owner = this.requireSessionOwner(providerSessionId);
    const agent = await this.agentFor(owner.agentId);
    return agent.getGoal(owner.rawId);
  }

  async setGoal(input: SetAgentGoalInput) {
    const owner = this.requireSessionOwner(input.providerSessionId);
    const agent = await this.agentFor(owner.agentId);
    const goal = await agent.setGoal({
      ...input,
      providerSessionId: owner.rawId,
    });
    return {
      ...goal,
      providerSessionId: encodeSessionId(owner.agentId, goal.providerSessionId),
    };
  }

  async clearGoal(providerSessionId: string) {
    const owner = this.requireSessionOwner(providerSessionId);
    const agent = await this.agentFor(owner.agentId);
    return agent.clearGoal(owner.rawId);
  }

  mapProviderRequest(
    request: AgentProviderRequest,
    options: { approvalMode: 'yolo' | 'guarded' },
  ): AgentProviderRequestMapping | null {
    const owner = decodeScopedId(request.id);
    const agent = owner ? this.agents.get(owner.agentId) : null;
    if (!owner || !agent) {
      return null;
    }
    const scopedProviderSessionId = request.params && typeof request.params === 'object'
      ? String((request.params as Record<string, unknown>).sessionId ?? '')
      : '';
    const sessionOwner = decodeScopedId(scopedProviderSessionId);
    if (!sessionOwner || sessionOwner.agentId !== owner.agentId || !sessionOwner.rawId) {
      return null;
    }
    const params = request.params && typeof request.params === 'object'
      ? {
          ...(request.params as Record<string, unknown>),
          sessionId: sessionOwner.rawId,
        }
      : request.params;
    const mapping = agent.mapProviderRequest({
      ...request,
      id: owner.rawId,
      params,
    }, options);
    if (!mapping) {
      return null;
    }
    const providerRequestId = encodeSessionId(owner.agentId, String(mapping.providerRequestId));
    return {
      ...mapping,
      providerRequestId,
      providerSessionId: encodeSessionId(owner.agentId, mapping.providerSessionId),
      pendingRequest: mapping.pendingRequest
        ? {
            ...mapping.pendingRequest,
            providerRequestId,
            request: {
              ...mapping.pendingRequest.request,
              id: `acp-permission:${providerRequestId}`,
            },
          }
        : null,
    };
  }

  buildProviderRequestResponse(
    pending: AgentPendingProviderRequest,
    input: AgentActionRequestResponseInput,
  ) {
    const owner = decodeScopedId(pending.providerRequestId);
    const agent = owner ? this.agents.get(owner.agentId) : null;
    if (!owner || !agent) {
      throw new Error('ACP permission request owner is no longer available.');
    }
    return agent.buildProviderRequestResponse({
      ...pending,
      providerRequestId: owner.rawId,
    }, input);
  }

  respondToProviderRequest(id: string | number, result: unknown) {
    const owner = decodeScopedId(id);
    const agent = owner ? this.agents.get(owner.agentId) : null;
    agent?.respondToProviderRequest(owner!.rawId, result);
  }

  private async refreshCatalog(force = false) {
    const entries = await this.catalog.list({ force });
    const ready = entries.filter((entry) => entry.availability === 'ready');
    const baseInstalled = entries.filter((entry) => entry.availability !== 'base_missing');
    this.installation.installed = true;
    this.installation.installedVersion =
      `Built in · ${ready.length} ACP agent${ready.length === 1 ? '' : 's'} ready`;
    this.installation.lastError = ready.length > 0
      ? null
      : baseInstalled.length > 0
        ? 'ACP adapters or native ACP servers are not ready.'
        : 'No supported base agent was detected.';
    this.status = {
      ...this.status,
      state: ready.length > 0 ? 'ready' : 'degraded',
      lastStartedAt: this.status.lastStartedAt ?? new Date().toISOString(),
      lastError: this.installation.lastError,
    };
    this.emit('status', this.getStatus());
    return entries;
  }

  private async agentFor(agentId: string) {
    const existing = this.agents.get(agentId);
    if (existing) {
      await existing.start();
      this.mergeAgentCapabilities(existing);
      return existing;
    }

    const entry = (await this.catalog.list()).find((candidate) => candidate.id === agentId);
    if (!entry) {
      throw new AgentRuntimeError(`Unknown ACP agent: ${agentId}`, 'acp', 'request_failed');
    }
    if (entry.availability !== 'ready') {
      throw new AgentRuntimeError(entry.statusMessage, 'acp', 'provider_unavailable', {
        agentId,
        availability: entry.availability,
        baseProbeCommand: entry.baseProbeCommand,
        serverProbeCommand: entry.serverProbeCommand,
      });
    }

    const agent = await this.createAgent(entry);
    this.agents.set(agentId, agent);
    try {
      await agent.start();
      this.mergeAgentCapabilities(agent);
      return agent;
    } catch (error) {
      this.agents.delete(agentId);
      throw error;
    }
  }

  private mergeAgentCapabilities(agent: AcpRuntimeAdapter) {
    void agent;
    this.recomputeAgentCapabilities();
  }

  private refreshAgentSessionCapabilities(
    agentId: string,
    agent: AcpRuntimeAdapter,
  ) {
    for (const key of this.modelCache.keys()) {
      if (key.startsWith(`${agentId}\0`)) {
        this.modelCache.delete(key);
      }
    }
    this.mergeAgentCapabilities(agent);
  }

  private recomputeAgentCapabilities() {
    const next = structuredClone(catalogCapabilities);
    for (const child of this.agents.values()) {
      next.turns.steer ||= child.capabilities.turns.steer;
      next.turns.compact ||= child.capabilities.turns.compact;
      next.branching.fork ||= child.capabilities.branching.fork;
      next.controls.goals ||= child.capabilities.controls.goals;
      next.controls.performanceMode ||= child.capabilities.controls.performanceMode;
      next.management.mcpStatus ||= child.capabilities.management.mcpStatus;
      next.management.skills ||= child.capabilities.management.skills;
      next.management.hooks ||= child.capabilities.management.hooks;
    }
    for (const section of Object.keys(next) as Array<keyof AgentProviderCapabilities>) {
      Object.assign(this.capabilities[section], next[section]);
    }
  }

  private async createAgent(entry: AcpAgentCatalogEntry) {
    const env = entry.id === 'codex'
      ? await loadCodexAcpEnvironment(
          this.options.codexHome,
          process.env,
          entry.baseCommand,
        )
      : undefined;
    const agent = new AcpRuntimeAdapter({
      command: entry.serverCommand,
      harnessAdapter: acpHarnessAdapterFor(entry.id),
      ...(env ? { env } : {}),
      ...(this.options.startupTimeoutMs !== undefined
        ? { startupTimeoutMs: this.options.startupTimeoutMs }
        : {}),
      ...(this.options.clientInfo !== undefined
        ? { clientInfo: this.options.clientInfo }
        : {}),
    });
    agent.on('event', (event: AgentRuntimeEvent) => {
      const providerSessionId = encodeSessionId(entry.id, event.providerSessionId);
      this.emit('event', {
        ...event,
        providerSessionId,
        ...(event.type === 'goal.updated'
          ? {
              goal: {
                ...event.goal,
                providerSessionId,
              },
            }
          : {}),
      } satisfies AgentRuntimeEvent);
    });
    agent.on('provider-request', (request: AgentProviderRequest) => {
      const params = request.params && typeof request.params === 'object'
        ? {
            ...(request.params as Record<string, unknown>),
            sessionId: encodeSessionId(
              entry.id,
              String((request.params as Record<string, unknown>).sessionId ?? ''),
            ),
          }
        : request.params;
      this.emit('provider-request', {
        ...request,
        id: encodeSessionId(entry.id, String(request.id)),
        params,
      } satisfies AgentProviderRequest);
    });
    agent.on('stderr', (message) => this.emit('stderr', `[${entry.id}] ${String(message)}`));
    agent.on('warning', (message) => this.emit('warning', `[${entry.id}] ${String(message)}`));
    return agent;
  }

  private requireSessionOwner(providerSessionId: string) {
    const owner = decodeScopedId(providerSessionId);
    if (!owner || !this.catalog.definition(owner.agentId)) {
      throw new AgentRuntimeError(
        `ACP session is missing its agent scope: ${providerSessionId}`,
        'acp',
        'invalid_response',
      );
    }
    return owner;
  }
}

export const acpSessionId = {
  encode: encodeSessionId,
  decode: decodeScopedId,
};
