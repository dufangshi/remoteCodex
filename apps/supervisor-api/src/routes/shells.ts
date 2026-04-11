import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ShellCreateInput } from '../../../../packages/shared/src/index';

export async function registerShellRoutes(app: FastifyInstance) {
  const threadIdParams = z.object({ id: z.string().uuid() });
  const shellIdParams = z.object({ id: z.string().uuid() });
  const createShellSchema = z.object({
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
  });

  app.get('/api/threads/:id/shell', async (request) => {
    const params = threadIdParams.parse(request.params);
    return app.services.shellService.getThreadShellState(params.id);
  });

  app.post('/api/threads/:id/shell', async (request) => {
    const params = threadIdParams.parse(request.params);
    const body = createShellSchema.parse(request.body ?? {});
    const input: ShellCreateInput = {
      ...(body.cols !== undefined ? { cols: body.cols } : {}),
      ...(body.rows !== undefined ? { rows: body.rows } : {}),
    };
    return app.services.shellService.createShellForThread(params.id, input);
  });

  app.post('/api/shells/:id/terminate', async (request) => {
    const params = shellIdParams.parse(request.params);
    return app.services.shellService.terminateShell(params.id);
  });
}
