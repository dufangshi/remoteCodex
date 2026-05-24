import { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';

import { ShellCreateInput, UpdateShellInput } from '../../../../packages/shared/src/index';

export async function registerShellRoutes(
  app: FastifyInstance,
  options: {
    preHandler?: RouteShorthandOptions['preHandler'];
  } = {},
) {
  const threadIdParams = z.object({ id: z.string().uuid() });
  const shellIdParams = z.object({ id: z.string().uuid() });
  const createShellSchema = z.object({
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    label: z.string().trim().min(1).max(80).optional(),
  });
  const updateShellSchema = z.object({
    label: z.string().trim().min(1).max(80).nullable().optional(),
  });

  const routeOptions: RouteShorthandOptions = options.preHandler
    ? { preHandler: options.preHandler }
    : {};

  app.get('/api/threads/:id/shell', routeOptions, async (request) => {
    const params = threadIdParams.parse(request.params);
    return app.services.shellService.getThreadShellState(params.id);
  });

  app.post('/api/threads/:id/shell', routeOptions, async (request) => {
    const params = threadIdParams.parse(request.params);
    const body = createShellSchema.parse(request.body ?? {});
    const input: ShellCreateInput = {
      ...(body.cols !== undefined ? { cols: body.cols } : {}),
      ...(body.rows !== undefined ? { rows: body.rows } : {}),
      ...(body.label !== undefined ? { label: body.label } : {}),
    };
    return app.services.shellService.createShellForThread(params.id, input);
  });

  app.post('/api/shells/:id/terminate', routeOptions, async (request) => {
    const params = shellIdParams.parse(request.params);
    return app.services.shellService.terminateShell(params.id);
  });

  app.patch('/api/shells/:id', routeOptions, async (request) => {
    const params = shellIdParams.parse(request.params);
    const body = updateShellSchema.parse(request.body ?? {});
    const input: UpdateShellInput = {
      ...('label' in body ? { label: body.label ?? null } : {}),
    };
    return app.services.shellService.updateShell(params.id, input);
  });
}
