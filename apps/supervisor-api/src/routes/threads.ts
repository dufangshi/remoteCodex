import fs from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  deleteShellSessionRecord,
  deleteViewerSessionsByShellId,
  getShellSessionRecordByThreadId,
  getThreadRecordById,
  getWorkspaceRecordById,
} from '../../../../packages/db/src/index';
import {
  ImportThreadInput,
  PromptAttachmentManifestEntryDto,
  ReasoningEffortDto,
  RespondThreadActionRequestInput,
  ResumeThreadInput,
  SendThreadPromptInput,
  UpdateThreadSettingsInput,
  UpdateThreadInput,
} from '../../../../packages/shared/src/index';
import { HttpError } from '../app';

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

const promptAttachmentManifestEntrySchema = z.object({
  clientId: z.string().min(1),
  kind: z.enum(['photo', 'file']),
  originalName: z.string().optional(),
  placeholder: z.string().min(1),
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

const threadDetailQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  beforeTurnId: z.string().min(1).optional(),
});

const threadImageQuerySchema = z.object({
  path: z.string().min(1),
});

const MAX_PROMPT_ATTACHMENTS = 10;
const MAX_PROMPT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

interface UploadedPromptAttachment {
  manifest: PromptAttachmentManifestEntryDto;
  buffer: Buffer;
}

function defaultAttachmentOriginalName(
  kind: PromptAttachmentManifestEntryDto['kind'],
  index: number,
) {
  return kind === 'photo' ? `photo-${index + 1}.jpg` : `file-${index + 1}`;
}

function toSendThreadPromptInput(body: {
  prompt: string;
  model: string | undefined;
  reasoningEffort: ReasoningEffortDto | null | undefined;
  collaborationMode: 'default' | 'plan' | undefined;
}): SendThreadPromptInput {
  return {
    prompt: body.prompt,
    ...(body.model !== undefined ? { model: body.model } : {}),
    ...(body.reasoningEffort !== undefined
      ? { reasoningEffort: body.reasoningEffort }
      : {}),
    ...(body.collaborationMode !== undefined
      ? { collaborationMode: body.collaborationMode }
      : {}),
  };
}

async function parseMultipartPromptRequest(
  request: FastifyRequest,
) {
  const fields = new Map<string, string>();
  const uploadedFiles: Array<{ buffer: Buffer; filename: string | null }> = [];

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'attachments') {
        throw new HttpError(400, {
          code: 'bad_request',
          message: `Unexpected multipart file field: ${part.fieldname}.`
        });
      }

      const buffer = await part.toBuffer();
      if (buffer.byteLength > MAX_PROMPT_ATTACHMENT_BYTES) {
        throw new HttpError(400, {
          code: 'bad_request',
          message: `Each attachment must be ${MAX_PROMPT_ATTACHMENT_BYTES / (1024 * 1024)} MB or smaller.`
        });
      }

      uploadedFiles.push({
        buffer,
        filename: part.filename?.trim() || null,
      });
      continue;
    }

    fields.set(part.fieldname, String(part.value ?? ''));
  }

  const body = toSendThreadPromptInput(
    (() => {
      const parsed = promptSchema.parse({
        prompt: fields.get('prompt'),
        ...(fields.has('model') ? { model: fields.get('model') } : {}),
        ...(fields.has('reasoningEffort')
          ? { reasoningEffort: fields.get('reasoningEffort') }
          : {}),
        ...(fields.has('collaborationMode')
          ? { collaborationMode: fields.get('collaborationMode') }
          : {}),
      });
      return {
        prompt: parsed.prompt,
        model: parsed.model,
        reasoningEffort: parsed.reasoningEffort,
        collaborationMode: parsed.collaborationMode,
      };
    })(),
  );

  if (uploadedFiles.length === 0) {
    return {
      input: body,
      attachments: [] as UploadedPromptAttachment[],
    };
  }

  if (uploadedFiles.length > MAX_PROMPT_ATTACHMENTS) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: `A prompt can include at most ${MAX_PROMPT_ATTACHMENTS} attachments.`
    });
  }

  const manifestRaw = fields.get('attachmentManifest');
  if (!manifestRaw) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'attachmentManifest is required when files are uploaded.'
    });
  }

  let manifestParsed: unknown;
  try {
    manifestParsed = JSON.parse(manifestRaw);
  } catch {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'attachmentManifest must be valid JSON.'
    });
  }

  const manifest = z
    .array(promptAttachmentManifestEntrySchema)
    .max(MAX_PROMPT_ATTACHMENTS)
    .parse(manifestParsed);

  if (manifest.length !== uploadedFiles.length) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'attachmentManifest must describe every uploaded attachment.'
    });
  }

  const attachments: UploadedPromptAttachment[] = [];
  for (const [index, file] of uploadedFiles.entries()) {
    const fallbackName =
      file.filename ??
      defaultAttachmentOriginalName(manifest[index]!.kind, index);
    const normalizedOriginalName =
      manifest[index]!.originalName?.trim() || fallbackName;

    attachments.push({
      manifest: {
        ...manifest[index]!,
        originalName: normalizedOriginalName,
      },
      buffer: file.buffer,
    });
  }

  return {
    input: body,
    attachments,
  };
}

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
    const query = threadDetailQuerySchema.parse(request.query);
    return app.services.threadService.getThreadDetail(params.id, {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.beforeTurnId !== undefined
        ? { beforeTurnId: query.beforeTurnId }
        : {}),
    });
  });

  app.get('/api/threads/:id/items/:itemId/detail', async (request) => {
    const params = z.object({
      id: z.string().uuid(),
      itemId: z.string().min(1),
    }).parse(request.params);
    return app.services.threadService.getThreadHistoryItemDetail(
      params.id,
      params.itemId,
    );
  });

  app.get('/api/threads/:id/assets/image', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = threadImageQuerySchema.parse(request.query);
    const record = getThreadRecordById(app.services.database.db, params.id);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const workspace = getWorkspaceRecordById(app.services.database.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.'
      });
    }

    const candidatePath = path.isAbsolute(query.path)
      ? query.path
      : path.resolve(workspace.absPath, query.path);
    const requestedPath = await fs.realpath(candidatePath).catch(() => null);
    if (!requestedPath) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Image file was not found.'
      });
    }

    const resolvedWorkspaceRoot = await fs
      .realpath(app.services.config.workspaceRoot)
      .catch(() => path.resolve(app.services.config.workspaceRoot));
    const workspacePrefix = resolvedWorkspaceRoot.endsWith(path.sep)
      ? resolvedWorkspaceRoot
      : `${resolvedWorkspaceRoot}${path.sep}`;

    if (
      requestedPath !== resolvedWorkspaceRoot &&
      !requestedPath.startsWith(workspacePrefix)
    ) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Image path must stay within the configured workspace root.'
      });
    }

    const stats = await fs.stat(requestedPath).catch(() => null);
    if (!stats?.isFile()) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Image file was not found.'
      });
    }

    const lowerPath = requestedPath.toLowerCase();
    const contentType =
      lowerPath.endsWith('.png') ? 'image/png'
        : lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg') ? 'image/jpeg'
          : lowerPath.endsWith('.gif') ? 'image/gif'
            : lowerPath.endsWith('.webp') ? 'image/webp'
              : lowerPath.endsWith('.svg') ? 'image/svg+xml'
                : lowerPath.endsWith('.heic') ? 'image/heic'
                  : lowerPath.endsWith('.heif') ? 'image/heif'
                    : 'application/octet-stream';

    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'private, max-age=60');
    return reply.send(await fs.readFile(requestedPath));
  });

  app.patch('/api/threads/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateThreadSchema.parse(request.body) satisfies UpdateThreadInput;
    return app.services.threadService.updateThreadTitle(params.id, body.title);
  });

  app.delete('/api/threads/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const shell = getShellSessionRecordByThreadId(app.services.database.db, params.id);

    if (shell) {
      if (shell.status !== 'exited' && shell.status !== 'not_found') {
        await app.services.shellService.terminateShell(shell.id);
      }
      deleteViewerSessionsByShellId(app.services.database.db, shell.id);
      deleteShellSessionRecord(app.services.database.db, shell.id);
    }

    return app.services.threadService.deleteThread(params.id);
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

  app.post('/api/threads/:id/disconnect', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const detail = await app.services.threadService.disconnectThread(params.id);
    await app.services.shellService.detachThreadViewers(params.id);
    return detail;
  });

  app.post('/api/threads/:id/prompt', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = request.isMultipart()
      ? await parseMultipartPromptRequest(request)
      : {
          input: (() => {
            const parsedBody = promptSchema.parse(request.body);
            return toSendThreadPromptInput({
              prompt: parsedBody.prompt,
              model: parsedBody.model,
              reasoningEffort: parsedBody.reasoningEffort,
              collaborationMode: parsedBody.collaborationMode,
            });
          })(),
          attachments: [] as UploadedPromptAttachment[],
        };
    const input =
      parsed.attachments.length > 0
        ? await app.services.threadService.preparePromptAttachments(
            params.id,
            parsed.input,
            parsed.attachments,
          )
        : parsed.input;
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
