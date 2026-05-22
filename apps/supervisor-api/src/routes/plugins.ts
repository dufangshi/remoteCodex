import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type {
  ImportPluginInput,
  PluginDto,
  UpdatePluginInput,
} from '../../../../packages/shared/src/index';
import { HttpError } from '../app';

const pluginParamsSchema = z.object({
  pluginId: z.string().min(1),
});

const updatePluginSchema = z.object({
  enabled: z.boolean(),
});

const importPluginSchema = z.object({
  enabled: z.boolean().optional(),
  manifestJson: z.string().optional(),
  manifest: z.unknown().optional(),
}).refine((value) => value.manifest !== undefined || value.manifestJson !== undefined, {
  message: 'Plugin import requires manifest or manifestJson.',
});

export async function registerPluginRoutes(app: FastifyInstance) {
  app.get('/api/plugins', async () => {
    return app.services.pluginService.listPlugins() satisfies PluginDto[];
  });

  app.post('/api/plugins/import', async (request) => {
    const parsed = importPluginSchema.parse(request.body);
    const body: ImportPluginInput = {
      ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
      ...(parsed.manifest === undefined ? {} : { manifest: parsed.manifest }),
      ...(parsed.manifestJson === undefined ? {} : { manifestJson: parsed.manifestJson }),
    };
    try {
      return app.services.pluginService.importPlugin(body) satisfies PluginDto;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new HttpError(400, {
          code: 'bad_request',
          message: 'Plugin manifest JSON is invalid.',
        });
      }
      throw new HttpError(400, {
        code: 'bad_request',
        message: error instanceof Error ? error.message : 'Plugin import failed.',
      });
    }
  });

  app.get('/api/plugins/:pluginId', async (request) => {
    const { pluginId } = pluginParamsSchema.parse(request.params);
    const plugin = app.services.pluginService.getPlugin(pluginId);
    if (!plugin) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Plugin was not found.',
      });
    }
    return plugin satisfies PluginDto;
  });

  app.patch('/api/plugins/:pluginId', async (request) => {
    const { pluginId } = pluginParamsSchema.parse(request.params);
    const body = updatePluginSchema.parse(request.body) satisfies UpdatePluginInput;
    try {
      return app.services.pluginService.setPluginEnabled(pluginId, body.enabled);
    } catch {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Plugin was not found.',
      });
    }
  });
}
