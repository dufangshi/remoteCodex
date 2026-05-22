import { EventEmitter } from 'node:events';

import {
  agentBackendMetadata,
} from '../../shared/src/index';
import type {
  AgentBackendInstallationDto,
} from '../../shared/src/index';
import type {
  AgentSessionDetail,
  AgentTurn,
  AgentProviderId,
  AgentProviderCapabilities,
  AgentRuntime,
  AgentRuntimeManagementSchema,
  AgentRuntimeStatus,
  InterruptAgentTurnInput,
  ReadAgentSessionOptions,
  ResumeAgentSessionInput,
  StartAgentSessionInput,
  StartAgentSessionResult,
  StartAgentTurnInput,
} from './types';
import { AgentRuntimeError } from './types';

const unavailableCapabilities: AgentProviderCapabilities = {
  sessions: {
    list: false,
    read: false,
    resume: false,
    importLocal: false,
  },
  turns: {
    start: false,
    streamInput: false,
    steer: false,
    interrupt: false,
    compact: false,
  },
  branching: {
    fork: false,
    hardRollback: false,
    resumeAt: false,
    rewindFiles: false,
  },
  controls: {
    planMode: false,
    permissionRequests: false,
    sandboxMode: false,
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
    contextWindow: false,
    tokenUsage: false,
    costUsd: false,
  },
};

const unavailableManagementSchema: AgentRuntimeManagementSchema = {
  hostConfigFiles: [],
  toolboxItems: [],
  hookCommandTemplates: [],
  providerConfigFormat: 'none',
  mcpConfigFormat: 'none',
  configArchives: false,
  buildRestart: false,
};

export interface UnavailableRuntimeOptions {
  provider: AgentProviderId;
  reason: string;
}

export class UnavailableRuntimeAdapter extends EventEmitter implements AgentRuntime {
  readonly provider: AgentProviderId;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities = unavailableCapabilities;
  readonly managementSchema = unavailableManagementSchema;
  readonly installation: AgentBackendInstallationDto;

  private readonly status: AgentRuntimeStatus;

  constructor(options: UnavailableRuntimeOptions) {
    super();
    const metadata = agentBackendMetadata[options.provider];
    this.provider = options.provider;
    this.displayName = metadata.displayName;
    this.description = metadata.description;
    this.installation = {
      packageName: null,
      installed: false,
      installedVersion: null,
      latestVersion: null,
      installCommand: null,
      updateCommand: null,
      busy: false,
      lastError: options.reason,
    };
    this.status = {
      state: 'stopped',
      transport: metadata.defaultTransport,
      lastStartedAt: null,
      lastError: options.reason,
      restartCount: 0,
    };
  }

  getStatus(): AgentRuntimeStatus {
    return { ...this.status };
  }

  async start() {}

  async stop() {}

  async listModels() {
    return [];
  }

  async listSessions() {
    return [];
  }

  async listLoadedSessions() {
    return [];
  }

  async readSession(
    _providerSessionId: string,
    _options?: ReadAgentSessionOptions,
  ): Promise<AgentSessionDetail> {
    throw this.unavailableError();
  }

  async startSession(_input: StartAgentSessionInput): Promise<StartAgentSessionResult> {
    throw this.unavailableError();
  }

  async resumeSession(_input: ResumeAgentSessionInput): Promise<StartAgentSessionResult> {
    throw this.unavailableError();
  }

  async startTurn(_input: StartAgentTurnInput): Promise<AgentTurn> {
    throw this.unavailableError();
  }

  async interruptTurn(_input: InterruptAgentTurnInput): Promise<AgentTurn | null> {
    throw this.unavailableError();
  }

  private unavailableError() {
    return new AgentRuntimeError(
      this.status.lastError ?? `${this.displayName} is not available.`,
      this.provider,
      'provider_unavailable',
    );
  }
}
