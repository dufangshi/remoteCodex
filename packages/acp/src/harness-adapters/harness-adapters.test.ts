import { describe, expect, it, vi } from 'vitest';

import { acpHarnessAdapterFor } from './index';

describe('ACP harness adapters', () => {
  it('keeps unknown harnesses on the standard ACP contract', () => {
    expect(acpHarnessAdapterFor('unknown')).toMatchObject({ id: 'standard' });
    expect(acpHarnessAdapterFor('unknown').initializeClientMeta).toBeUndefined();
    expect(acpHarnessAdapterFor('unknown').fsCapabilities).toBeUndefined();
  });

  it('projects Grok legacy model metadata without leaking it into ACP core', () => {
    const adapter = acpHarnessAdapterFor('grok');
    expect(adapter.fsCapabilities).toEqual({
      readTextFile: false,
      writeTextFile: true,
    });
    const projected = adapter.projectSession?.({
      models: {
        currentModelId: 'grok-4.6',
        availableModels: [{
          modelId: 'grok-4.6',
          name: 'Grok 4.6',
          _meta: {
            reasoningEffort: 'high',
            reasoningEfforts: [
              { value: 'low', label: 'Low' },
              { value: 'high', label: 'High', default: true },
            ],
          },
        }],
      },
    });

    expect(projected).toMatchObject({
      model: 'grok-4.6',
      reasoningEffort: 'high',
      models: [{
        model: 'grok-4.6',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low' },
          { reasoningEffort: 'high' },
        ],
      }],
    });
  });

  it('opts Cursor into parameterized config and maps its exact model options', async () => {
    const adapter = acpHarnessAdapterFor('cursor');
    const request = vi.fn(async () => ({
      models: [{
        value: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        configOptions: [
          {
            id: 'reasoning',
            name: 'Reasoning',
            category: 'thought_level',
            type: 'select',
            currentValue: 'medium',
            options: [
              { value: 'low', name: 'Low' },
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
            ],
          },
          {
            id: 'fast',
            name: 'Fast',
            category: 'model_config',
            type: 'select',
            currentValue: 'false',
            options: [
              { value: 'false', name: 'Off' },
              { value: 'true', name: 'Fast' },
            ],
          },
        ],
      }],
    }));

    expect(adapter.initializeClientMeta).toEqual({
      parameterizedModelPicker: true,
    });
    await expect(
      adapter.listModels?.({ request } as never),
    ).resolves.toMatchObject([{
      model: 'gpt-5.6-sol',
      supportsPerformanceMode: true,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low' },
        { reasoningEffort: 'medium' },
        { reasoningEffort: 'high' },
      ],
      defaultReasoningEffort: 'medium',
    }]);
    expect(request).toHaveBeenCalledWith('cursor/list_available_models', {});
  });
});
