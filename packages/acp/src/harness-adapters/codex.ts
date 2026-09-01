import type { HarnessExtensionCallEnvelope } from '../extensions';
import type { AcpHarnessAdapter } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const codexAcpHarnessAdapter: AcpHarnessAdapter = {
  id: 'codex',
  registerExtensions: ({ registry, runControlPrompt }) => {
    registry.register({
      ownerId: 'acp-agent',
      descriptor: {
        id: 'codex.control',
        version: 1,
        stability: 'experimental',
        methods: ['compact'],
        events: [],
      },
      transport: {
        request: async (_method, params, signal) => {
          const providerSessionId = isRecord(params)
            ? String(params.providerSessionId ?? '')
            : '';
          return runControlPrompt(providerSessionId, '/compact', signal);
        },
      },
      paramMappers: {
        compact: (envelope: HarnessExtensionCallEnvelope) => ({
          providerSessionId: isRecord(envelope.params)
            ? envelope.params.providerSessionId
            : null,
        }),
      },
      capabilityPatch: { turns: { compact: true } },
    });
  },
};
