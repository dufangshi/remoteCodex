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
import { HttpError } from '../app';

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
const providerParamSchema = z.object({
  provider: agentBackendIdSchema,
});

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
      host: app.services.config.host,
      port: app.services.config.port,
      workspaceRoot: app.services.config.workspaceRoot,
      environment: app.services.config.nodeEnv
    } satisfies RuntimeConfigDto;
  });

  app.get('/api/worker/metadata', async () => {
    return {
      role: app.services.config.runtimeRole,
      sandboxId: app.services.config.sandboxId,
      userId: app.services.config.userId,
      workspaceRoot: app.services.config.workspaceRoot,
      managementRoutesEnabled: app.services.config.managementRoutesEnabled,
      agentRuntimeManagementEnabled: app.services.config.agentRuntimeManagementEnabled,
      providers: app.services.agentRuntimes.all().map((runtime) => ({
        provider: runtime.provider,
        status: runtime.getStatus(),
      })),
    };
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
