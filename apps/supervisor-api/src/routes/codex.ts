import { FastifyInstance } from 'fastify';

import { CodexStatusDto, ModelOptionDto } from '../../../../packages/shared/src/index';

export async function registerCodexRoutes(app: FastifyInstance) {
  app.get('/api/codex/status', async () => {
    const status = app.services.codexManager.getStatus();

    return {
      state: status.state,
      transport: status.transport,
      lastStartedAt: status.lastStartedAt,
      lastError: status.lastError,
      restartCount: status.restartCount
    } satisfies CodexStatusDto;
  });

  app.get('/api/codex/models', async () => {
    const models = await app.services.threadService.listModels();
    return models satisfies ModelOptionDto[];
  });
}
