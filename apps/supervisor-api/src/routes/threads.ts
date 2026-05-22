import fs from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  deleteShellSessionRecord,
  deleteViewerSessionsByShellId,
  getShellSessionRecordByThreadId,
  getThreadRecordById,
  getWorkspaceRecordById,
} from '../../../../packages/db/src/index';
import {
  ExportThreadPdfInput,
  ImportThreadInput,
  CreateThreadHookInput,
  ForkThreadInput,
  PromptAttachmentManifestEntryDto,
  ReasoningEffortDto,
  RespondThreadActionRequestInput,
  ResumeThreadInput,
  SandboxModeDto,
  SendThreadPromptInput,
  UpdateThreadGoalInput,
  UpdateThreadHookInput,
  UpdateThreadSettingsInput,
  UpdateThreadInput,
} from '../../../../packages/shared/src/index';
import { HttpError } from '../app';
import { agentBackendIdSchema } from '../provider-schemas';

const createThreadSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().optional(),
  provider: agentBackendIdSchema.optional(),
  model: z.string().min(1),
  approvalMode: z.enum(['yolo', 'guarded']).default('yolo')
});

const promptSchema = z.object({
  prompt: z.string().min(1),
  clientRequestId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as [ReasoningEffortDto, ...ReasoningEffortDto[]]).nullable().optional(),
  collaborationMode: z.enum(['default', 'plan']).optional(),
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access'] as [SandboxModeDto, ...SandboxModeDto[]]).nullable().optional()
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
  fastMode: z.boolean().optional(),
  collaborationMode: z.enum(['default', 'plan']).optional(),
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access'] as [SandboxModeDto, ...SandboxModeDto[]]).nullable().optional()
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one thread setting must be provided.'
});

const updateThreadGoalSchema = z.object({
  objective: z.string().min(1).nullable().optional(),
  status: z.enum(['active', 'paused', 'budgetLimited', 'complete', 'terminated']).nullable().optional(),
  tokenBudget: z.number().int().positive().nullable().optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one goal field must be provided.'
});

const interruptSchema = z.object({
  turnId: z.string().optional()
});

const importThreadSchema = z.object({
  sessionId: z.string().min(1),
});

const resumeThreadSchema = z.object({
  model: z.string().min(1).optional(),
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access'] as [SandboxModeDto, ...SandboxModeDto[]]).nullable().optional()
});

const forkThreadSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('latest'),
  }),
  z.object({
    mode: z.literal('turn'),
    turnId: z.string().min(1),
  }),
]);

const hookEventNameSchema = z.enum([
  'preToolUse',
  'permissionRequest',
  'postToolUse',
  'preCompact',
  'postCompact',
  'sessionStart',
  'userPromptSubmit',
  'stop',
]);

const createThreadHookSchema = z.object({
  scope: z.enum(['global', 'project']),
  eventName: hookEventNameSchema,
  matcher: z.string().nullable().optional(),
  command: z.string().trim().min(1),
  timeoutSec: z.number().int().positive().max(86_400).nullable().optional(),
  statusMessage: z.string().nullable().optional(),
});

const updateThreadHookSchema = createThreadHookSchema.extend({
  target: createThreadHookSchema,
});

const trustThreadHookSchema = z.object({
  key: z.string().min(1),
  currentHash: z.string().min(1),
});

const untrustThreadHookSchema = z.object({
  key: z.string().min(1),
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

const exportThreadPdfSchema = z.object({
  format: z.enum(['pdf', 'html']).optional(),
  mode: z.enum(['latest', 'selected']),
  limit: z.number().int().positive().max(100).optional(),
  turnIds: z.array(z.string().min(1)).max(100).optional(),
  profile: z.enum(['review', 'technical']).optional(),
  options: z.object({
    includeTokenAndPrice: z.boolean().optional(),
    includeCommandOutput: z.boolean().optional(),
    includeAbsolutePaths: z.boolean().optional(),
  }).optional(),
}).refine((body) => body.mode !== 'selected' || (body.turnIds?.length ?? 0) > 0, {
  message: 'turnIds are required for selected exports.',
});

const queryBooleanSchema = z.preprocess((value) => {
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  return value;
}, z.boolean());

const exportThreadPdfQuerySchema = z.object({
  format: z.enum(['pdf', 'html']).optional(),
  mode: z.enum(['latest', 'selected']),
  limit: z.coerce.number().int().positive().max(100).optional(),
  turnIds: z.string().optional(),
  profile: z.enum(['review', 'technical']).optional(),
  includeTokenAndPrice: queryBooleanSchema.optional(),
  includeCommandOutput: queryBooleanSchema.optional(),
  includeAbsolutePaths: queryBooleanSchema.optional(),
}).refine((query) => query.mode !== 'selected' || Boolean(query.turnIds?.trim()), {
  message: 'turnIds are required for selected exports.',
});

const threadImageQuerySchema = z.object({
  path: z.string().min(1),
});

async function sendThreadExport(
  app: FastifyInstance,
  reply: FastifyReply,
  threadId: string,
  input: ExportThreadPdfInput,
) {
  const result = await app.services.threadService.exportThreadTranscript(threadId, input);
  const encodedFilename = encodeURIComponent(result.filename);
  reply
    .header('content-type', result.contentType)
    .header('content-length', String(result.buffer.byteLength))
    .header(
      'content-disposition',
      `attachment; filename="${result.filename}"; filename*=UTF-8''${encodedFilename}`,
    );
  return reply.send(result.buffer);
}

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
  clientRequestId: string | undefined;
  model: string | undefined;
  reasoningEffort: ReasoningEffortDto | null | undefined;
  collaborationMode: 'default' | 'plan' | undefined;
  sandboxMode: SandboxModeDto | null | undefined;
}): SendThreadPromptInput {
  return {
    prompt: body.prompt,
    ...(body.clientRequestId !== undefined
      ? { clientRequestId: body.clientRequestId }
      : {}),
    ...(body.model !== undefined ? { model: body.model } : {}),
    ...(body.reasoningEffort !== undefined
      ? { reasoningEffort: body.reasoningEffort }
      : {}),
    ...(body.collaborationMode !== undefined
      ? { collaborationMode: body.collaborationMode }
      : {}),
    ...(body.sandboxMode !== undefined
      ? { sandboxMode: body.sandboxMode }
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
        ...(fields.has('clientRequestId')
          ? { clientRequestId: fields.get('clientRequestId') }
          : {}),
        ...(fields.has('model') ? { model: fields.get('model') } : {}),
        ...(fields.has('reasoningEffort')
          ? { reasoningEffort: fields.get('reasoningEffort') }
          : {}),
        ...(fields.has('collaborationMode')
          ? { collaborationMode: fields.get('collaborationMode') }
          : {}),
        ...(fields.has('sandboxMode')
          ? { sandboxMode: fields.get('sandboxMode') }
          : {}),
      });
      return {
        prompt: parsed.prompt,
        clientRequestId: parsed.clientRequestId,
        model: parsed.model,
        reasoningEffort: parsed.reasoningEffort,
        collaborationMode: parsed.collaborationMode,
        sandboxMode: parsed.sandboxMode,
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
    const input = {
      workspaceId: body.workspaceId,
      model: body.model,
      approvalMode: body.approvalMode,
      ...(body.provider !== undefined ? { provider: body.provider } : {}),
      ...(body.title ? { title: body.title } : {}),
    };
    return app.services.threadService.createThread(input);
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

  app.get('/api/threads/:id/export-turns', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return app.services.threadService.listThreadExportTurns(params.id);
  });

  app.get('/api/threads/:id/exports/pdf', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = exportThreadPdfQuerySchema.parse(request.query);
    const turnIds = query.turnIds
      ?.split(',')
      .map((turnId) => turnId.trim())
      .filter(Boolean);
    const options: NonNullable<ExportThreadPdfInput['options']> = {};
    if (query.includeTokenAndPrice !== undefined) {
      options.includeTokenAndPrice = query.includeTokenAndPrice;
    }
    if (query.includeCommandOutput !== undefined) {
      options.includeCommandOutput = query.includeCommandOutput;
    }
    if (query.includeAbsolutePaths !== undefined) {
      options.includeAbsolutePaths = query.includeAbsolutePaths;
    }
    const input: ExportThreadPdfInput = {
      ...(query.format !== undefined ? { format: query.format } : {}),
      mode: query.mode,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(turnIds !== undefined ? { turnIds } : {}),
      ...(query.profile !== undefined ? { profile: query.profile } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };
    return sendThreadExport(app, reply, params.id, input);
  });

  app.post('/api/threads/:id/exports/pdf', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = exportThreadPdfSchema.parse(request.body);
    const input: ExportThreadPdfInput = {
      ...(parsed.format !== undefined ? { format: parsed.format } : {}),
      mode: parsed.mode,
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
      ...(parsed.turnIds !== undefined ? { turnIds: parsed.turnIds } : {}),
      ...(parsed.profile !== undefined ? { profile: parsed.profile } : {}),
      ...(parsed.options !== undefined
        ? {
            options: {
              ...(parsed.options.includeTokenAndPrice !== undefined
                ? { includeTokenAndPrice: parsed.options.includeTokenAndPrice }
                : {}),
              ...(parsed.options.includeCommandOutput !== undefined
                ? { includeCommandOutput: parsed.options.includeCommandOutput }
                : {}),
              ...(parsed.options.includeAbsolutePaths !== undefined
                ? { includeAbsolutePaths: parsed.options.includeAbsolutePaths }
                : {}),
            },
          }
        : {}),
    };
    return sendThreadExport(app, reply, params.id, input);
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
      ...(body.fastMode !== undefined ? { fastMode: body.fastMode } : {}),
      ...(body.collaborationMode !== undefined ? { collaborationMode: body.collaborationMode } : {}),
      ...(body.sandboxMode !== undefined ? { sandboxMode: body.sandboxMode } : {})
    };
    return app.services.threadService.updateThreadSettings(params.id, input);
  });

  app.post('/api/threads/:id/compact', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return app.services.threadService.compactThread(params.id);
  });

  app.get('/api/threads/:id/goal', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return { goal: await app.services.threadService.getThreadGoal(params.id) };
  });

  app.patch('/api/threads/:id/goal', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsedBody = updateThreadGoalSchema.parse(request.body);
    const body: UpdateThreadGoalInput = {
      ...(parsedBody.objective !== undefined ? { objective: parsedBody.objective } : {}),
      ...(parsedBody.status !== undefined ? { status: parsedBody.status } : {}),
      ...(parsedBody.tokenBudget !== undefined ? { tokenBudget: parsedBody.tokenBudget } : {}),
    };
    return { goal: await app.services.threadService.updateThreadGoal(params.id, body) };
  });

  app.delete('/api/threads/:id/goal', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return app.services.threadService.clearThreadGoal(params.id);
  });

  app.get('/api/threads/:id/fork-turns', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return app.services.threadService.listForkTurnOptions(params.id);
  });

  app.post('/api/threads/:id/fork', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = forkThreadSchema.parse(request.body) satisfies ForkThreadInput;
    return app.services.threadService.forkThread(params.id, body);
  });

  app.get('/api/threads/:id/skills', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return app.services.threadService.listThreadSkills(params.id);
  });

  app.get('/api/threads/:id/mcp-servers', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return app.services.threadService.listThreadMcpServers(params.id);
  });

  app.get('/api/threads/:id/hooks', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return app.services.threadService.listThreadHooks(params.id);
  });

  app.post('/api/threads/:id/hooks', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsedBody = createThreadHookSchema.parse(request.body);
    const body: CreateThreadHookInput = {
      scope: parsedBody.scope,
      eventName: parsedBody.eventName,
      command: parsedBody.command,
      ...(parsedBody.matcher !== undefined ? { matcher: parsedBody.matcher } : {}),
      ...(parsedBody.timeoutSec !== undefined ? { timeoutSec: parsedBody.timeoutSec } : {}),
      ...(parsedBody.statusMessage !== undefined
        ? { statusMessage: parsedBody.statusMessage }
        : {}),
    };
    return app.services.threadService.createThreadHook(params.id, body);
  });

  app.put('/api/threads/:id/hooks', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsedBody = updateThreadHookSchema.parse(request.body);
    const body: UpdateThreadHookInput = {
      scope: parsedBody.scope,
      eventName: parsedBody.eventName,
      command: parsedBody.command,
      target: {
        scope: parsedBody.target.scope,
        eventName: parsedBody.target.eventName,
        command: parsedBody.target.command,
        ...(parsedBody.target.matcher !== undefined
          ? { matcher: parsedBody.target.matcher }
          : {}),
        ...(parsedBody.target.timeoutSec !== undefined
          ? { timeoutSec: parsedBody.target.timeoutSec }
          : {}),
        ...(parsedBody.target.statusMessage !== undefined
          ? { statusMessage: parsedBody.target.statusMessage }
          : {}),
      },
      ...(parsedBody.matcher !== undefined ? { matcher: parsedBody.matcher } : {}),
      ...(parsedBody.timeoutSec !== undefined ? { timeoutSec: parsedBody.timeoutSec } : {}),
      ...(parsedBody.statusMessage !== undefined
        ? { statusMessage: parsedBody.statusMessage }
        : {}),
    };
    return app.services.threadService.updateThreadHook(params.id, body);
  });

  app.post('/api/threads/:id/hooks/trust', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = trustThreadHookSchema.parse(request.body);
    return app.services.threadService.trustThreadHook(params.id, body);
  });

  app.post('/api/threads/:id/hooks/untrust', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = untrustThreadHookSchema.parse(request.body);
    return app.services.threadService.untrustThreadHook(params.id, body);
  });

  app.post('/api/threads/:id/resume', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = resumeThreadSchema.parse(request.body ?? {});
    const input: ResumeThreadInput = {
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.sandboxMode !== undefined ? { sandboxMode: body.sandboxMode } : {})
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
              clientRequestId: parsedBody.clientRequestId,
              model: parsedBody.model,
              reasoningEffort: parsedBody.reasoningEffort,
              collaborationMode: parsedBody.collaborationMode,
              sandboxMode: parsedBody.sandboxMode,
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
    return app.services.threadService.sendPrompt(params.id, input, {
      displayPrompt: parsed.input.prompt,
    });
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
