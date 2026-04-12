import { FastifyInstance } from 'fastify';

import { CodexStatusDto, ModelOptionDto } from '../../../../packages/shared/src/index';

function codexStatusDto(app: FastifyInstance): CodexStatusDto {
  const status = app.services.codexManager.getStatus();

  return {
    state: status.state,
    transport: status.transport,
    lastStartedAt: status.lastStartedAt,
    lastError: status.lastError,
    restartCount: status.restartCount,
  };
}

export async function registerCodexRoutes(app: FastifyInstance) {
  app.get('/api/codex/status', async () => {
    return codexStatusDto(app);
  });

  app.post('/api/codex/restart', async () => {
    await app.services.codexManager.stop();
    await app.services.codexManager.start();

    return codexStatusDto(app);
  });

  app.get('/api/codex/models', async () => {
    const models = await app.services.threadService.listModels();
    return models satisfies ModelOptionDto[];
  });
}
