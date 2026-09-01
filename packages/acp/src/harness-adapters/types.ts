import type * as acp from '@agentclientprotocol/sdk';

import type { AgentModel } from '../../../agent-runtime/src/index';
import type { AcpNegotiatedCapabilitySnapshot } from '../capabilities';
import type { HarnessExtensionRegistry } from '../extension-registry';

export interface AcpHarnessSessionProjection {
  state: unknown;
  models: AgentModel[];
  model: string | null;
  reasoningEffort: string | null;
}

export interface AcpHarnessAdapter {
  readonly id: string;
  readonly initializeClientMeta?: Readonly<Record<string, unknown>>;
  readonly promptPreamble?: string;
  listModels?(context: acp.ClientContext): Promise<AgentModel[] | null>;
  sessionNewMeta?(input: {
    reasoningEffort?: string | null;
  }): Record<string, unknown>;
  projectSession?(response: unknown): AcpHarnessSessionProjection | null;
  modelsFromState?(state: unknown): AgentModel[];
  applyModel?(input: {
    context: acp.ClientContext;
    sessionId: string;
    state: unknown;
    model: string;
  }): Promise<AcpHarnessSessionProjection | null>;
  applyReasoningEffort?(input: {
    context: acp.ClientContext;
    sessionId: string;
    cwd: string;
    state: unknown;
    reasoningEffort: string;
  }): Promise<AcpHarnessSessionProjection | null>;
  registerExtensions?(input: {
    registry: HarnessExtensionRegistry;
    snapshot: AcpNegotiatedCapabilitySnapshot;
    runControlPrompt: (
      providerSessionId: string,
      prompt: string,
      signal: AbortSignal,
    ) => Promise<unknown>;
  }): void;
}
