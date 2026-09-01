import type * as acp from '@agentclientprotocol/sdk';

import type { AgentModel } from '../../../agent-runtime/src/index';
import { normalizeAcpEffort } from './effort';
import type { AcpHarnessAdapter } from './types';

interface CursorModelConfig {
  value: string;
  name: string;
  configOptions?: acp.SessionConfigOption[];
}

function selectOptions(option: acp.SessionConfigOption) {
  if (option.type !== 'select') {
    return [];
  }
  return option.options.flatMap((entry) =>
    'options' in entry ? entry.options : [entry],
  );
}

function reasoningConfig(options: acp.SessionConfigOption[]) {
  return options.find(
    (option) =>
      option.category === 'thought_level' &&
      option.type === 'select' &&
      selectOptions(option).some((entry) => normalizeAcpEffort(entry.value)),
  ) ?? null;
}

function cursorModel(model: CursorModelConfig, index: number): AgentModel {
  const configOptions = model.configOptions ?? [];
  const reasoning = reasoningConfig(configOptions);
  return {
    id: model.value,
    model: model.value,
    displayName: model.name || model.value,
    description: '',
    isDefault: index === 0,
    hidden: false,
    supportsPerformanceMode: configOptions.some(
      (option) => option.id === 'fast' || option.id === 'fast-mode',
    ),
    supportedReasoningEfforts: reasoning
      ? selectOptions(reasoning).flatMap((entry) => {
          const reasoningEffort = normalizeAcpEffort(entry.value);
          return reasoningEffort
            ? [{
                reasoningEffort,
                description: entry.description ?? entry.name ?? '',
              }]
            : [];
        })
      : [],
    defaultReasoningEffort: reasoning?.type === 'select'
      ? normalizeAcpEffort(reasoning.currentValue)
      : null,
    selectionKind: 'model',
  };
}

export const cursorAcpHarnessAdapter: AcpHarnessAdapter = {
  id: 'cursor',
  // Cursor exposes model parameters as standard session config options only
  // when the client explicitly opts into its parameterized picker extension.
  initializeClientMeta: {
    parameterizedModelPicker: true,
  },
  promptPreamble:
    'Cursor ACP client constraint: do not launch background subagents. ' +
    'If you delegate work, wait for every subagent result in the current turn ' +
    'and deliver the complete requested answer before ending the turn.',
  listModels: async (context) => {
    const response = await context.request(
      'cursor/list_available_models',
      {},
    ) as { models?: CursorModelConfig[] };
    return Array.isArray(response.models)
      ? response.models.map(cursorModel)
      : null;
  },
};
