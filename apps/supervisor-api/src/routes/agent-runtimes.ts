import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  AgentBackendDto,
  AgentBackendIdDto,
  ModelOptionDto,
  ReasoningEffortDto,
} from '../../../../packages/shared/src/index';

const providerParamSchema = z.object({
  provider: z.enum(['codex', 'claude']),
});

function providerNotConfigured(provider: AgentBackendIdDto) {
  const error = new Error(`Agent runtime provider is not configured: ${provider}`);
  (error as Error & { statusCode?: number }).statusCode = 404;
  return error;
}

function runtimeDto(app: FastifyInstance, provider: AgentBackendIdDto): AgentBackendDto {
  const runtime = app.services.agentRuntimes.getOptional(provider);
  if (!runtime) {
    throw providerNotConfigured(provider);
  }
  return {
    provider: runtime.provider,
    displayName: runtime.displayName,
    description: runtime.description,
    enabled: true,
    isDefault: provider === 'codex',
    status: runtime.getStatus(),
    capabilities: runtime.capabilities,
    managementSchema: runtime.managementSchema,
  };
}

export async function registerAgentRuntimeRoutes(app: FastifyInstance) {
  app.get('/api/agent-runtimes', async () => {
    return app.services.agentRuntimes.list() satisfies AgentBackendDto[];
  });

  app.get('/api/agent-runtimes/:provider/status', async (request) => {
    const { provider } = providerParamSchema.parse(request.params);
    return runtimeDto(app, provider);
  });

  app.post('/api/agent-runtimes/:provider/restart', async (request) => {
    const { provider } = providerParamSchema.parse(request.params);
    const runtime = app.services.agentRuntimes.getOptional(provider);
    if (!runtime) {
      throw providerNotConfigured(provider);
    }
    await runtime.stop();
    await runtime.start();
    return runtimeDto(app, provider);
  });

  app.get('/api/agent-runtimes/:provider/models', async (request) => {
    const { provider } = providerParamSchema.parse(request.params);
    const runtime = app.services.agentRuntimes.getOptional(provider);
    if (!runtime) {
      throw providerNotConfigured(provider);
    }
    return (await runtime.listModels()).map((model) => ({
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      isDefault: model.isDefault,
      hidden: model.hidden,
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((entry) => ({
        reasoningEffort: entry.reasoningEffort as ReasoningEffortDto,
        description: entry.description,
      })),
      defaultReasoningEffort: (model.defaultReasoningEffort ?? 'none') as ReasoningEffortDto,
    })) satisfies ModelOptionDto[];
  });

  app.post('/api/agent-runtimes/:provider/build-restart', async (request) => {
    const { provider } = providerParamSchema.parse(request.params);
    const runtime = app.services.agentRuntimes.getOptional(provider);
    if (!runtime) {
      throw providerNotConfigured(provider);
    }
    if (!runtime.managementSchema.buildRestart) {
      const error = new Error('This backend does not support build and restart.');
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    const launched = await app.services.serviceLifecycle.launchBuildRestart();

    return {
      status: 'launched',
      pid: launched.pid,
      message: 'Build and restart launched.',
    };
  });
}
