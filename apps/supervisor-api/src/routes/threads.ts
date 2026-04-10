import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  ImportThreadInput,
  SendThreadPromptInput,
} from '../../../../packages/shared/src/index';

const createThreadSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().optional(),
  model: z.string().min(1),
  approvalMode: z.enum(['yolo', 'guarded']).default('yolo')
});

const promptSchema = z.object({
  prompt: z.string().min(1)
});

const interruptSchema = z.object({
  turnId: z.string().optional()
});

const importThreadSchema = z.object({
  sessionId: z.string().min(1),
});

export async function registerThreadRoutes(app: FastifyInstance) {
  app.get('/api/threads', async () => {
    return app.services.threadService.listThreads();
  });

  app.post('/api/threads/start', async (request) => {
    const body = createThreadSchema.parse(request.body);
    return app.services.threadService.createThread(
      body.title
        ? {
            workspaceId: body.workspaceId,
            model: body.model,
            approvalMode: body.approvalMode,
            title: body.title
          }
        : {
            workspaceId: body.workspaceId,
            model: body.model,
            approvalMode: body.approvalMode
          }
    );
  });

  app.post('/api/threads/import', async (request) => {
    const body = importThreadSchema.parse(request.body) satisfies ImportThreadInput;
    return app.services.threadService.importThread(body.sessionId);
  });

  app.get('/api/threads/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return app.services.threadService.getThreadDetail(params.id);
  });

  app.post('/api/threads/:id/resume', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return app.services.threadService.resumeThread(params.id);
  });

  app.post('/api/threads/:id/prompt', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = promptSchema.parse(request.body) satisfies SendThreadPromptInput;
    return app.services.threadService.sendPrompt(params.id, body);
  });

  app.post('/api/threads/:id/interrupt', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = interruptSchema.parse(request.body ?? {});
    return app.services.threadService.interruptThread(params.id, body.turnId);
  });
}
