import { FastifyRequest } from 'fastify';

import {
  SignedTokenPayload,
  verifySignedToken,
} from '../../../packages/shared/src/tokens';
import { ControlPlaneRepository } from './repository';

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
    private readonly input: {
      secret: string;
      provider?: string;
      issuer?: string | null;
      audience?: string | null;
      clockSkewSeconds?: number;
    },
  ) {}

  identityFromRequest(request: FastifyRequest): AuthIdentity | null {
    const token = readBearerToken(request);
    if (!token) {
      return null;
    }

    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const clockSkewSeconds = this.input.clockSkewSeconds ?? 60;
      const payload = verifySignedToken<SignedTokenPayload>(
        token,
        this.input.secret,
        nowSeconds - clockSkewSeconds,
      );
      if (this.input.issuer && payload.iss !== this.input.issuer) {
        return null;
      }
      if (this.input.audience && !payloadHasAudience(payload.aud, this.input.audience)) {
        return null;
      }
      if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds + clockSkewSeconds) {
        return null;
      }
      if (typeof payload.iat === 'number' && payload.iat > nowSeconds + clockSkewSeconds) {
        return null;
      }
      return {
        authProvider: this.input.provider ?? 'jwt',
        authSubject: payload.sub,
      };
    } catch {
      return null;
    }
  }
}

export class ProductSessionAuthVerifier extends JwtAuthVerifier {
  constructor(input: {
    secret: string;
    clockSkewSeconds?: number;
  }) {
    const verifierInput: {
      secret: string;
      provider: string;
      issuer: string;
      audience: string;
      clockSkewSeconds?: number;
    } = {
      secret: input.secret,
      provider: 'control-plane',
      issuer: 'remote-codex-control-plane',
      audience: 'remote-codex-control-plane',
    };
    if (input.clockSkewSeconds !== undefined) {
      verifierInput.clockSkewSeconds = input.clockSkewSeconds;
    }
    super(verifierInput);
  }
}

export class CompositeAuthVerifier implements AuthVerifier {
  constructor(private readonly verifiers: AuthVerifier[]) {}

  identityFromRequest(request: FastifyRequest): AuthIdentity | null {
    for (const verifier of this.verifiers) {
      const identity = verifier.identityFromRequest(request);
      if (identity) {
        return identity;
      }
    }
    return null;
  }
}

function payloadHasAudience(value: unknown, expected: string) {
  if (typeof value === 'string') {
    return value === expected;
  }
  if (Array.isArray(value)) {
    return value.includes(expected);
  }
  return false;
}

export function createAuthVerifier(input: {
  mode: 'dev' | 'jwt';
  jwtSecret: string | null;
  jwtProvider: string;
  jwtIssuer?: string | null;
  jwtAudience?: string | null;
  jwtClockSkewSeconds?: number;
  productSessionSecret?: string;
}): AuthVerifier {
  const productSessionVerifier = input.productSessionSecret
    ? new ProductSessionAuthVerifier({
        secret: input.productSessionSecret,
        ...(input.jwtClockSkewSeconds === undefined
          ? {}
          : { clockSkewSeconds: input.jwtClockSkewSeconds }),
      })
    : null;
  if (input.mode === 'jwt') {
    if (!input.jwtSecret) {
      throw new Error('CONTROL_PLANE_AUTH_JWT_SECRET is required when CONTROL_PLANE_AUTH_MODE=jwt.');
    }
    const verifierInput: {
      secret: string;
      provider: string;
      issuer?: string | null;
      audience?: string | null;
      clockSkewSeconds?: number;
    } = {
      secret: input.jwtSecret,
      provider: input.jwtProvider,
    };
    if (input.jwtIssuer !== undefined) {
      verifierInput.issuer = input.jwtIssuer;
    }
    if (input.jwtAudience !== undefined) {
      verifierInput.audience = input.jwtAudience;
    }
    if (input.jwtClockSkewSeconds !== undefined) {
      verifierInput.clockSkewSeconds = input.jwtClockSkewSeconds;
    }
    const jwtVerifier = new JwtAuthVerifier(verifierInput);
    return productSessionVerifier
      ? new CompositeAuthVerifier([productSessionVerifier, jwtVerifier])
      : jwtVerifier;
  }
  const devVerifier = new DevAuthVerifier();
  return productSessionVerifier
    ? new CompositeAuthVerifier([productSessionVerifier, devVerifier])
    : devVerifier;
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
  if (identity.authProvider === 'control-plane') {
    return repository.getUserById(identity.authSubject) ?? null;
  }
  return (
    repository.getUserByAuthSubject(identity.authProvider, identity.authSubject) ??
    repository.getUserByAuthIdentity(identity.authProvider, identity.authSubject) ??
    null
  );
}
