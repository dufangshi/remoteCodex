import { FastifyRequest } from 'fastify';

import { ControlPlaneRepository } from './repository';
import { SignedTokenPayload, verifySignedToken } from './tokens';

export interface AuthIdentity {
  authProvider: string;
  authSubject: string;
}

export interface AuthVerifier {
  identityFromRequest(request: FastifyRequest): AuthIdentity | null;
}

export function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

export class DevAuthVerifier implements AuthVerifier {
  identityFromRequest(request: FastifyRequest): AuthIdentity | null {
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
}

export class JwtAuthVerifier implements AuthVerifier {
  constructor(
    private readonly secret: string,
    private readonly provider = 'jwt',
  ) {}

  identityFromRequest(request: FastifyRequest): AuthIdentity | null {
    const token = readBearerToken(request);
    if (!token) {
      return null;
    }

    try {
      const payload = verifySignedToken<SignedTokenPayload>(token, this.secret);
      return {
        authProvider: this.provider,
        authSubject: payload.sub,
      };
    } catch {
      return null;
    }
  }
}

export function createAuthVerifier(input: {
  mode: 'dev' | 'jwt';
  jwtSecret: string | null;
  jwtProvider: string;
}): AuthVerifier {
  if (input.mode === 'jwt') {
    if (!input.jwtSecret) {
      throw new Error('CONTROL_PLANE_AUTH_JWT_SECRET is required when CONTROL_PLANE_AUTH_MODE=jwt.');
    }
    return new JwtAuthVerifier(input.jwtSecret, input.jwtProvider);
  }
  return new DevAuthVerifier();
}

export function identityFromRequest(request: FastifyRequest): AuthIdentity | null {
  return new DevAuthVerifier().identityFromRequest(request);
}

export function legacyIdentityFromRequest(request: FastifyRequest): AuthIdentity | null {
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
  verifier: AuthVerifier = new DevAuthVerifier(),
) {
  const identity = verifier.identityFromRequest(request);
  if (!identity) {
    return null;
  }
  return repository.getUserByAuthSubject(identity.authProvider, identity.authSubject) ?? null;
}
