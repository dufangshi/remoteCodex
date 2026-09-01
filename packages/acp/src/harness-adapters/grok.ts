import * as acp from '@agentclientprotocol/sdk';

import type { AgentModel } from '../../../agent-runtime/src/index';
import { normalizeAcpEffort } from './effort';
import type {
  AcpHarnessAdapter,
  AcpHarnessSessionProjection,
} from './types';

interface GrokModelState {
  currentModelId?: string;
  availableModels?: GrokModelInfo[];
}

interface GrokModelInfo {
  modelId: string;
  name?: string;
  description?: string;
  _meta?: {
    reasoningEffort?: string;
    reasoningEfforts?: Array<{
      id?: string;
      value?: string;
      label?: string;
      description?: string;
      default?: boolean;
    }>;
  };
}

function grokModelState(response: unknown): GrokModelState | null {
  if (!response || typeof response !== 'object') {
    return null;
  }
  const models = (response as { models?: unknown }).models;
  if (!models || typeof models !== 'object') {
    return null;
  }
  const availableModels = (models as { availableModels?: unknown }).availableModels;
  return Array.isArray(availableModels) ? models as GrokModelState : null;
}

function selectedModel(state: GrokModelState) {
  const models = state.availableModels ?? [];
  return models.find((model) => model.modelId === state.currentModelId) ??
    models[0] ??
    null;
}

function modelOptions(state: GrokModelState): AgentModel[] {
  const currentModelId = state.currentModelId ?? null;
  return (state.availableModels ?? []).flatMap((model, index) => {
    if (!model.modelId) {
      return [];
    }
    const efforts = (model._meta?.reasoningEfforts ?? []).flatMap((entry) => {
      const reasoningEffort = normalizeAcpEffort(entry.value ?? entry.id);
      return reasoningEffort
        ? [{
            reasoningEffort,
            description: entry.description ?? entry.label ?? '',
          }]
        : [];
    });
    const declaredDefault = model._meta?.reasoningEfforts?.find(
      (entry) => entry.default,
    );
    return [{
      id: model.modelId,
      model: model.modelId,
      displayName: model.name ?? model.modelId,
      description: model.description ?? '',
      isDefault:
        model.modelId === currentModelId || (!currentModelId && index === 0),
      hidden: false,
      supportedReasoningEfforts: efforts,
      defaultReasoningEffort:
        normalizeAcpEffort(model._meta?.reasoningEffort) ??
        normalizeAcpEffort(declaredDefault?.value ?? declaredDefault?.id),
      selectionKind: 'model',
    }];
  });
}

function projection(state: GrokModelState): AcpHarnessSessionProjection {
  const model = selectedModel(state);
  const declaredDefault = model?._meta?.reasoningEfforts?.find(
    (entry) => entry.default,
  );
  return {
    state,
    models: modelOptions(state),
    model: state.currentModelId ?? model?.modelId ?? null,
    reasoningEffort:
      normalizeAcpEffort(model?._meta?.reasoningEffort) ??
      normalizeAcpEffort(declaredDefault?.value ?? declaredDefault?.id),
  };
}

export const grokAcpHarnessAdapter: AcpHarnessAdapter = {
  id: 'grok',
  sessionNewMeta: ({ reasoningEffort }) =>
    reasoningEffort ? { reasoningEffort } : {},
  projectSession: (response) => {
    const state = grokModelState(response);
    return state ? projection(state) : null;
  },
  modelsFromState: (state) => modelOptions(state as GrokModelState),
  applyModel: async ({ context, sessionId, state, model }) => {
    await context.request('session/set_model', {
      sessionId,
      modelId: model,
    });
    (state as GrokModelState).currentModelId = model;
    return projection(state as GrokModelState);
  },
  applyReasoningEffort: async ({
    context,
    sessionId,
    cwd,
    state,
    reasoningEffort,
  }) => {
    const model = selectedModel(state as GrokModelState);
    const selected = model?._meta?.reasoningEfforts?.find(
      (entry) =>
        normalizeAcpEffort(entry.value ?? entry.id) ===
        normalizeAcpEffort(reasoningEffort),
    );
    const effort = selected?.value ?? selected?.id;
    if (!effort) {
      return null;
    }
    const response = await context.request(acp.methods.agent.session.load, {
      sessionId,
      cwd,
      mcpServers: [],
      _meta: { reasoningEffort: effort },
    });
    const nextState = grokModelState(response);
    return nextState ? projection(nextState) : null;
  },
};
