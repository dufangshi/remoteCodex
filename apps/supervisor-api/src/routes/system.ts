import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  CreateProviderHostConfigArchiveInput,
  HealthDto,
  RenameProviderHostConfigArchiveInput,
  RuntimeConfigDto,
  UpdateProviderHostFileInput,
  UpdateWorkspaceSettingsInput,
  VersionDto
} from '../../../../packages/shared/src/index';
import { agentBackendIdSchema } from '../provider-schemas';
import {
  getWorkspaceSettings,
  saveWorkspaceSettings,
} from '../workspace-settings';
import {
  getLatestThreadTurnMetadataByThreadId,
  listHarnessJobWatches,
  listThreadRecords,
} from '../../../../packages/db/src/repositories';
import { HttpError } from '../app';
import { readWorkerRuntimeManifest } from '../worker-runtime-manifest';

const updateProviderHostFileSchema = z.object({
  content: z.string(),
});
const archiveIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const createProviderHostConfigArchiveSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
});
const renameProviderHostConfigArchiveSchema = z.object({
  label: z.string().trim().min(1).max(120),
});
const updateWorkspaceSettingsSchema = z.object({
  devHome: z.string().trim().min(1),
  defaultBackend: agentBackendIdSchema.optional(),
});
const checkpointSessionSchema = z.object({
  sessionId: z.string().uuid(),
  workerSessionId: z.string().min(1).nullable().optional(),
  status: z.enum(['created', 'active', 'idle', 'archived', 'deleted']).optional(),
});
const providerParamSchema = z.object({
  provider: agentBackendIdSchema,
});
const harnessModuleParamSchema = z.object({
  module: z.enum(['estructural', 'quntur', 'farmaco']),
});
const harnessRunParamSchema = harnessModuleParamSchema.extend({
  runId: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_.-]+$/),
});
const harnessToolParamSchema = harnessModuleParamSchema.extend({
  tool: z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/),
});
const harnessInvokeBodySchema = z.record(z.string(), z.unknown());
const harnessJobWatchBodySchema = z.object({
  jobId: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/),
  threadId: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(300).optional(),
});
const harnessHookParamSchema = z.object({
  token: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/),
});
const harnessInvokeContextSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  threadId: z.string().min(1).max(200).nullable().optional(),
  turnId: z.string().min(1).max(200).nullable().optional(),
  recordUsage: z.boolean().optional(),
  estimatedComputeUnits: z.number().finite().nonnegative().nullable().optional(),
  estimatedCostUsd: z.number().finite().nonnegative().nullable().optional(),
}).partial();
type HarnessInvokeContext = z.infer<typeof harnessInvokeContextSchema>;
type HarnessAttributionSource = 'request-context' | 'worker-inferred' | 'worker-runtime';

function payloadObject(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  if ('payload' in payload && payload.payload && typeof payload.payload === 'object') {
    return payload.payload as Record<string, unknown>;
  }
  return payload as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function numberField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function harnessUsageMetadata(payload: unknown, attributionSource: HarnessAttributionSource) {
  const body = payloadObject(payload);
  return {
    attributionSource,
    runUrl: stringField(body, ['run_url', 'runUrl', 'url']),
    artifactsUrl: stringField(body, ['artifacts_url', 'artifactsUrl']),
    downloadUrl: stringField(body, ['download_url', 'downloadUrl']),
    resultStatus: stringField(body, ['status', 'state']),
  };
}

function splitHarnessInvokeContext(body: Record<string, unknown>) {
  const { _remoteCodexContext, ...input } = body;
  const context = _remoteCodexContext && typeof _remoteCodexContext === 'object'
    ? harnessInvokeContextSchema.parse(_remoteCodexContext)
    : {};
  return { input, context };
}

function enrichHarnessInvokeContext(
  app: FastifyInstance,
  context: HarnessInvokeContext,
): { context: HarnessInvokeContext; attributionSource: HarnessAttributionSource } {
  const hasRequestContext = Boolean(
    context.workspaceId ||
    context.sessionId ||
    context.threadId ||
    context.turnId,
  );
  if (context.workspaceId && context.threadId && context.turnId) {
    return {
      context,
      attributionSource: hasRequestContext ? 'request-context' : 'worker-runtime',
    };
  }

  const runningThreads = listThreadRecords(app.services.database.db)
    .filter((thread) => thread.status === 'running');
  if (runningThreads.length !== 1) {
    return {
      context,
      attributionSource: hasRequestContext ? 'request-context' : 'worker-runtime',
    };
  }

  const thread = runningThreads[0];
  if (!thread) {
    return {
      context,
      attributionSource: hasRequestContext ? 'request-context' : 'worker-runtime',
    };
  }
  const latestTurnMetadata = getLatestThreadTurnMetadataByThreadId(
    app.services.database.db,
    thread.id,
  );

  const enriched = {
    ...context,
    workspaceId: context.workspaceId ?? thread.workspaceId,
    threadId: context.threadId ?? thread.id,
    turnId: context.turnId ?? latestTurnMetadata?.turnId ?? thread.providerTurnId ?? null,
  };
  return {
    context: enriched,
    attributionSource: hasRequestContext ? 'request-context' : 'worker-inferred',
  };
}

function parseProviderHostFileParams(params: unknown) {
  return z
    .object({
      ...providerParamSchema.shape,
      name: z.string(),
    })
    .parse(params);
}

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString()
    } satisfies HealthDto;
  });

  app.get('/readyz', async () => {
    const runtimes = app.services.agentRuntimes.all().map((runtime) => ({
      provider: runtime.provider,
      status: runtime.getStatus(),
      enabled: runtime.installation.installed,
    }));

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
      worker: {
        role: app.services.config.runtimeRole,
        sandboxId: app.services.config.sandboxId,
        userId: app.services.config.userId,
        workspaceRoot: app.services.config.workspaceRoot,
      },
      runtimes,
    };
  });

  app.get('/api/version', async () => {
    return {
      name: app.services.config.appName,
      version: app.services.config.appVersion
    } satisfies VersionDto;
  });

  app.post('/api/service/build-restart', async () => {
    if (!app.services.config.managementRoutesEnabled) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Build restart is disabled for this worker.',
      });
    }
    const launched = await app.services.serviceLifecycle.launchBuildRestart();

    return {
      status: 'launched',
      pid: launched.pid,
      message: 'Build and restart launched.',
    };
  });

  app.get('/api/config/runtime', async () => {
    return {
      appName: app.services.config.appName,
      appVersion: app.services.config.appVersion,
      mode: app.services.config.mode,
      host: app.services.config.host,
      port: app.services.config.port,
      workspaceRoot: app.services.config.workspaceRoot,
      environment: app.services.config.nodeEnv
    } satisfies RuntimeConfigDto;
  });

  app.get('/api/worker/metadata', async (request) => {
    const runtimeManifest = readWorkerRuntimeManifest(
      app.services.config.workerRuntimeManifestPath,
    );
    const harness = app.services.harnessClient.configured();
    return {
      role: app.services.config.runtimeRole,
      sandboxId: app.services.config.sandboxId,
      userId: app.services.config.userId,
      workspaceRoot: app.services.config.workspaceRoot,
      managementRoutesEnabled: app.services.config.managementRoutesEnabled,
      agentRuntimeManagementEnabled: app.services.config.agentRuntimeManagementEnabled,
      harness: {
        enabled: harness.enabled,
        baseUrl: harness.baseUrl,
        keyPresent: harness.keyPresent,
        chemistryToolsEnabled: harness.chemistryToolsEnabled,
      },
      providers: app.services.agentRuntimes.all().map((runtime) => ({
        provider: runtime.provider,
        status: runtime.getStatus(),
      })),
      requestDiagnostics: {
        authorizationHeaderPresent: Boolean(request.headers.authorization),
        workerTokenHeaderPresent: Boolean(request.headers['x-remote-codex-worker-token']),
        identityEnvelopePresent: Boolean(request.headers['x-remote-codex-signature']),
      },
      runtimeManifest,
    };
  });

  app.post('/api/worker/session-checkpoint', async (request) => {
    const input = checkpointSessionSchema.parse(request.body);
    return app.services.controlPlaneSyncClient.checkpointSession(input);
  });

  app.get('/api/harness/status', async () => {
    const config = app.services.harnessClient.configured();
    if (!config.enabled) {
      return {
        ...config,
        health: null,
      };
    }
    try {
      return {
        ...config,
        health: await app.services.harnessClient.health(),
      };
    } catch (error) {
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/me', async () => {
    try {
      return await app.services.harnessClient.me();
    } catch (error) {
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/home', async () => {
    try {
      return await app.services.harnessClient.home();
    } catch (error) {
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/modules/:module/help', async (request) => {
    const params = harnessModuleParamSchema.parse(request.params);
    try {
      return await app.services.harnessClient.help(params.module);
    } catch (error) {
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/modules/:module/tools', async (request) => {
    const params = harnessModuleParamSchema.parse(request.params);
    try {
      return await app.services.harnessClient.listTools(params.module);
    } catch (error) {
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/modules/:module/runs', async (request) => {
    const params = harnessModuleParamSchema.parse(request.params);
    try {
      return await app.services.harnessClient.listRuns(params.module);
    } catch (error) {
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/modules/:module/runs/:runId', async (request) => {
    const params = harnessRunParamSchema.parse(request.params);
    try {
      return await app.services.harnessClient.runDetail(params.module, params.runId);
    } catch (error) {
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/modules/:module/runs/:runId/artifacts', async (request) => {
    const params = harnessRunParamSchema.parse(request.params);
    try {
      return await app.services.harnessClient.runArtifacts(params.module, params.runId);
    } catch (error) {
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/modules/:module/runs/:runId/download.zip', async (request, reply) => {
    const params = harnessRunParamSchema.parse(request.params);
    try {
      const artifact = await app.services.harnessClient.downloadRunArtifacts(params.module, params.runId);
      reply.header('content-type', artifact.contentType);
      reply.header(
        'content-disposition',
        artifact.contentDisposition ?? `attachment; filename="${params.module}-${params.runId}-artifacts.zip"`,
      );
      return reply.send(artifact.body);
    } catch (error) {
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.post('/api/harness/modules/:module/tools/:tool/invoke', async (request) => {
    const params = harnessToolParamSchema.parse(request.params);
    const body = harnessInvokeBodySchema.parse(request.body ?? {});
    const { input, context: parsedContext } = splitHarnessInvokeContext(body);
    const { context, attributionSource } = enrichHarnessInvokeContext(app, parsedContext);
    try {
      if (context.recordUsage !== false && app.services.controlPlaneSyncClient.checkHarnessQuota) {
        const quota = await app.services.controlPlaneSyncClient.checkHarnessQuota({
          workspaceId: context.workspaceId ?? null,
          sessionId: context.sessionId ?? null,
          module: params.module,
          tool: params.tool,
          estimatedComputeUnits: context.estimatedComputeUnits ?? null,
          estimatedCostUsd: context.estimatedCostUsd ?? null,
        }).catch(() => ({ allowed: true, denial: undefined }));
        if (!quota.allowed) {
          throw new HttpError(402, {
            code: 'quota_exceeded',
            message: 'Quota exceeded.',
            ...(quota.denial ? { details: quota.denial } : {}),
          });
        }
      }
      const payload = await app.services.harnessClient.invoke(params.module, params.tool, input);
      const result = payloadObject(payload);
      if (context.recordUsage !== false) {
        await app.services.controlPlaneSyncClient.recordHarnessUsageEvent({
          workspaceId: context.workspaceId ?? null,
          sessionId: context.sessionId ?? null,
          threadId: context.threadId ?? null,
          turnId: context.turnId ?? null,
          module: params.module,
          tool: params.tool,
          runId: stringField(result, ['run_id', 'runId']),
          jobId: stringField(result, ['job_id', 'jobId', 'compute_job_id', 'computeJobId']),
          externalEventId:
            stringField(result, ['event_id', 'eventId', 'request_id', 'requestId']) ??
            stringField(result, ['run_id', 'runId', 'job_id', 'jobId']),
          computeUnits: numberField(result, ['compute_units', 'computeUnits', 'worker_observed_seconds', 'workerObservedSeconds']),
          costUsd: numberField(result, ['cost_usd', 'costUsd', 'estimated_cost_usd', 'estimatedCostUsd']),
          status: stringField(result, ['status', 'state']) ?? 'unknown',
          metadata: harnessUsageMetadata(payload, attributionSource),
        }).catch(() => undefined);
      }
      const invokeJobId = stringField(result, ['job_id', 'jobId', 'compute_job_id', 'computeJobId']);
      if (invokeJobId && context.threadId && app.services.harnessWakeupService.enabled()) {
        await app.services.harnessWakeupService
          .watchJob({
            jobId: invokeJobId,
            threadId: context.threadId,
            title: `${params.module}/${params.tool}`,
          })
          .catch((watchError) => {
            request.log.warn(
              { err: watchError, jobId: invokeJobId },
              'Harness wakeup auto-watch failed.',
            );
          });
      }
      return payload;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/wakeup', async () => {
    try {
      return await app.services.harnessWakeupService.getWakeupInfo();
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.get('/api/harness/job-watches', async () => {
    return {
      watches: listHarnessJobWatches(app.services.database.db),
    };
  });

  app.post('/api/harness/job-watches', async (request, reply) => {
    const body = harnessJobWatchBodySchema.parse(request.body ?? {});
    try {
      const result = await app.services.harnessWakeupService.watchJob({
        jobId: body.jobId,
        threadId: body.threadId ?? null,
        title: body.title ?? null,
      });
      reply.status(201);
      return result;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, {
        code: 'harness_unavailable',
        message: error instanceof Error ? error.message : 'ElAgenteHarness is unavailable.',
      });
    }
  });

  app.register(async (hookApp) => {
    hookApp.addContentTypeParser(
      ['application/json', 'text/plain'],
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    );
    hookApp.addContentTypeParser(
      '*',
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    );

    hookApp.post('/api/hooks/harness-notify/:token', async (request, reply) => {
      const params = harnessHookParamSchema.parse(request.params);
      const signatureHeader = request.headers['x-webhook-signature'];
      const rawBody = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from(typeof request.body === 'string' ? request.body : '');
      const result = app.services.harnessWakeupService.handleCallback({
        hookToken: params.token,
        rawBody,
        signature: typeof signatureHeader === 'string' ? signatureHeader : null,
      });
      reply.status(202);
      return result;
    });
  });

  app.get('/api/config/workspace-settings', async () => {
    return getWorkspaceSettings(
      app.services.database.db,
      app.services.config.workspaceRoot,
    );
  });

  app.patch('/api/config/workspace-settings', async (request) => {
    if (!app.services.config.managementRoutesEnabled) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Workspace settings are managed by the control plane for this worker.',
      });
    }
    const body = updateWorkspaceSettingsSchema.parse(request.body);
    const input: UpdateWorkspaceSettingsInput = {
      devHome: body.devHome,
    };
    if (body.defaultBackend !== undefined) {
      input.defaultBackend = body.defaultBackend;
    }

    return saveWorkspaceSettings(
      app.services.database.db,
      app.services.config.workspaceRoot,
      input,
    );
  });

  app.get('/api/config/providers/:provider/files/:name', async (request) => {
    if (!app.services.config.managementRoutesEnabled) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Provider host config reads are disabled for this worker.',
      });
    }
    const params = parseProviderHostFileParams(request.params);

    return app.services.providerHostConfigService.readFile(params.provider, params.name);
  });

  app.patch('/api/config/providers/:provider/files/:name', async (request) => {
    if (!app.services.config.managementRoutesEnabled) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Provider host config writes are disabled for this worker.',
      });
    }
    const params = parseProviderHostFileParams(request.params);

    const body = updateProviderHostFileSchema.parse(request.body);
    const input: UpdateProviderHostFileInput = {
      content: body.content,
    };

    return app.services.providerHostConfigService.updateFile(params.provider, params.name, input);
  });

  app.get('/api/config/providers/:provider/archives', async (request) => {
    if (!app.services.config.managementRoutesEnabled) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Provider config archives are disabled for this worker.',
      });
    }
    const { provider } = providerParamSchema.parse(request.params);

    return app.services.providerHostConfigService.listArchives(provider);
  });

  app.post('/api/config/providers/:provider/archives', async (request) => {
    if (!app.services.config.managementRoutesEnabled) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Provider config archives are disabled for this worker.',
      });
    }
    const { provider } = providerParamSchema.parse(request.params);

    const body: CreateProviderHostConfigArchiveInput = {};
    const parsedBody = createProviderHostConfigArchiveSchema.parse(request.body ?? {});
    if (parsedBody.label !== undefined) {
      body.label = parsedBody.label;
    }

    return app.services.providerHostConfigService.createArchive(provider, body);
  });

  app.patch('/api/config/providers/:provider/archives/:id', async (request) => {
    if (!app.services.config.managementRoutesEnabled) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Provider config archives are disabled for this worker.',
      });
    }
    const params = z
      .object({
        ...providerParamSchema.shape,
        id: archiveIdSchema,
      })
      .parse(request.params);

    const body = renameProviderHostConfigArchiveSchema.parse(
      request.body,
    ) satisfies RenameProviderHostConfigArchiveInput;

    return app.services.providerHostConfigService.renameArchive(
      params.provider,
      params.id,
      body,
    );
  });

  app.post('/api/config/providers/:provider/archives/:id/apply', async (request) => {
    if (!app.services.config.managementRoutesEnabled) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Provider config archives are disabled for this worker.',
      });
    }
    const params = z
      .object({
        ...providerParamSchema.shape,
        id: archiveIdSchema,
      })
      .parse(request.params);

    const result = await app.services.providerHostConfigService.applyArchive(
      params.provider,
      params.id,
    );
    if (params.provider === 'codex') {
      await app.services.pluginService.syncManagedCodexMcpConfig({
        codexHome: app.services.config.agentProviders.codex.home ?? null,
        repoRoot: app.services.repoRoot,
      });
    }
    return result;
  });
}
