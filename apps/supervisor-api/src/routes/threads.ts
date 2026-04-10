import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  ImportThreadInput,
  ReasoningEffortDto,
  RespondThreadActionRequestInput,
  ResumeThreadInput,
  SendThreadPromptInput,
  UpdateThreadSettingsInput,
  UpdateThreadInput,
} from '../../../../packages/shared/src/index';

const createThreadSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().optional(),
  model: z.string().min(1),
  approvalMode: z.enum(['yolo', 'guarded']).default('yolo')
});

const promptSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as [ReasoningEffortDto, ...ReasoningEffortDto[]]).nullable().optional(),
  collaborationMode: z.enum(['default', 'plan']).optional()
});

const updateThreadSchema = z.object({
  title: z.string().min(1)
});

const updateThreadSettingsSchema = z.object({
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as [ReasoningEffortDto, ...ReasoningEffortDto[]]).nullable().optional(),
  collaborationMode: z.enum(['default', 'plan']).optional()
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one thread setting must be provided.'
});

const interruptSchema = z.object({
  turnId: z.string().optional()
});

const importThreadSchema = z.object({
  sessionId: z.string().min(1),
});

const resumeThreadSchema = z.object({
  model: z.string().min(1).optional()
});

const respondThreadRequestSchema = z.object({
  answers: z.record(z.string(), z.object({
    answers: z.array(z.string())
  }))
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

  app.patch('/api/threads/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateThreadSchema.parse(request.body) satisfies UpdateThreadInput;
    return app.services.threadService.updateThreadTitle(params.id, body.title);
  });

  app.patch('/api/threads/:id/settings', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateThreadSettingsSchema.parse(request.body);
    const input: UpdateThreadSettingsInput = {
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.reasoningEffort !== undefined ? { reasoningEffort: body.reasoningEffort } : {}),
      ...(body.collaborationMode !== undefined ? { collaborationMode: body.collaborationMode } : {})
    };
    return app.services.threadService.updateThreadSettings(params.id, input);
  });

  app.post('/api/threads/:id/resume', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = resumeThreadSchema.parse(request.body ?? {});
    const input: ResumeThreadInput = {
      ...(body.model !== undefined ? { model: body.model } : {})
    };
    return app.services.threadService.resumeThread(params.id, input);
  });

  app.post('/api/threads/:id/prompt', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = promptSchema.parse(request.body);
    const input: SendThreadPromptInput = {
      prompt: body.prompt,
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.reasoningEffort !== undefined ? { reasoningEffort: body.reasoningEffort } : {}),
      ...(body.collaborationMode !== undefined ? { collaborationMode: body.collaborationMode } : {})
    };
    return app.services.threadService.sendPrompt(params.id, input);
  });

  app.post('/api/threads/:id/requests/:requestId/respond', async (request) => {
    const params = z.object({
      id: z.string().uuid(),
      requestId: z.string().min(1)
    }).parse(request.params);
    const body = respondThreadRequestSchema.parse(request.body) satisfies RespondThreadActionRequestInput;
    return app.services.threadService.respondToRequest(params.id, params.requestId, body);
  });

  app.post('/api/threads/:id/interrupt', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = interruptSchema.parse(request.body ?? {});
    return app.services.threadService.interruptThread(params.id, body.turnId);
  });
}
