import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type {
  ApiErrorShape,
  AuthLoginResultDto,
  AuthSessionDto,
} from '../../../../packages/shared/src/index';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/api/auth/session', async (request) => {
    return app.services.authService.verifyRequest(request) satisfies AuthSessionDto;
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body ?? {});
    const login = app.services.authService.login(body);
    if (!login) {
      reply.status(401).send({
        code: 'unauthorized',
        message: 'Invalid username or password.',
      } satisfies ApiErrorShape);
      return;
    }

    if (login.token) {
      app.services.authService.attachSessionCookie(reply, login.token);
    }
    return {
      token: login.token,
      session: login.session,
    } satisfies AuthLoginResultDto;
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    app.services.authService.clearSessionCookie(reply);
    return {
      authenticated: false,
      username: null,
      expiresAt: null,
      mode: app.services.authService.mode,
      authRequired: app.services.authService.required,
    } satisfies AuthSessionDto;
  });
}
