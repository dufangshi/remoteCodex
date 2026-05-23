import { FastifyRequest } from 'fastify';

import { ControlPlaneRepository } from './repository';

export interface AuthIdentity {
  authProvider: string;
  authSubject: string;
}

export function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

export function identityFromRequest(request: FastifyRequest): AuthIdentity | null {
  const provider = request.headers['x-auth-provider'];
  const subject = request.headers['x-auth-subject'];
  if (typeof provider === 'string' && typeof subject === 'string') {
    return {
      authProvider: provider,
      authSubject: subject,
    };
  }

  const token = readBearerToken(request);
  if (!token) {
    return null;
  }

  if (token.startsWith('dev:')) {
    return {
      authProvider: 'dev',
      authSubject: token.slice('dev:'.length),
    };
  }

  return null;
}

export function requireAuthenticatedUser(
  request: FastifyRequest,
  repository: ControlPlaneRepository,
) {
  const identity = identityFromRequest(request);
  if (!identity) {
    return null;
  }
  return repository.getUserByAuthSubject(identity.authProvider, identity.authSubject) ?? null;
}
