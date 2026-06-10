import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { RuntimeConfig } from '../../../packages/config/src/index';
import type { ApiErrorShape, AuthSessionDto } from '../../../packages/shared/src/index';

const AUTH_COOKIE_NAME = 'remote_codex_session';

export type AuthSession = AuthSessionDto;

export class AuthService {
  readonly required: boolean;
  readonly mode: RuntimeConfig['mode'];
  private readonly username: string | null;
  private readonly password: string | null;
  private readonly secret: string | null;
  private readonly sessionTtlSeconds: number;

  constructor(config: RuntimeConfig) {
    this.mode = config.mode;
    this.required = config.mode === 'server' || config.mode === 'relay';
    this.username = config.auth.adminUsername;
    this.password = config.auth.adminPassword;
    this.secret = config.auth.sessionSecret;
    this.sessionTtlSeconds = config.auth.sessionTtlSeconds;

    if (this.required) {
      const missing = [
        this.username ? null : 'REMOTE_CODEX_ADMIN_USERNAME',
        this.password ? null : 'REMOTE_CODEX_ADMIN_PASSWORD',
        this.secret ? null : 'REMOTE_CODEX_SESSION_SECRET',
      ].filter(Boolean);
      if (missing.length > 0) {
        throw new Error(
          `${config.mode} mode requires auth configuration: ${missing.join(', ')}.`,
        );
      }
    }
  }

  login(input: { username: string; password: string }) {
    if (!this.required) {
      return {
        token: null,
        session: {
          authenticated: true,
          username: null,
          expiresAt: null,
          mode: this.mode,
          authRequired: false,
        } satisfies AuthSession,
      };
    }

    if (!this.username || !this.password || !this.secret) {
      return null;
    }

    if (
      !constantTimeEqual(input.username, this.username) ||
      !constantTimeEqual(input.password, this.password)
    ) {
      return null;
    }

    return this.createSession(this.username);
  }

  verifyRequest(request: FastifyRequest): AuthSession {
    if (!this.required) {
      return {
        authenticated: true,
        username: null,
        expiresAt: null,
        mode: this.mode,
        authRequired: false,
      };
    }

    const token =
      readBearerToken(request) ?? readQueryToken(request) ?? readCookieToken(request);
    if (!token || !this.secret) {
      return unauthenticatedSession(this.mode);
    }

    return this.verifyToken(token);
  }

  attachSessionCookie(reply: FastifyReply, token: string) {
    reply.header(
      'set-cookie',
      `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${this.sessionTtlSeconds}`,
    );
  }

  clearSessionCookie(reply: FastifyReply) {
    reply.header(
      'set-cookie',
      `${AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    );
  }

  private createSession(username: string) {
    const expiresAtMs = Date.now() + this.sessionTtlSeconds * 1000;
    const payload = {
      username,
      expiresAt: expiresAtMs,
      nonce: crypto.randomBytes(16).toString('base64url'),
    };
    const payloadText = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const signature = this.sign(payloadText);
    return {
      token: `${payloadText}.${signature}`,
      session: {
        authenticated: true,
        username,
        expiresAt: new Date(expiresAtMs).toISOString(),
        mode: this.mode,
        authRequired: this.required,
      } satisfies AuthSession,
    };
  }

  private verifyToken(token: string): AuthSession {
    const [payloadText, signature, extra] = token.split('.');
    if (!payloadText || !signature || extra !== undefined) {
      return unauthenticatedSession(this.mode);
    }

    if (!constantTimeEqual(signature, this.sign(payloadText))) {
      return unauthenticatedSession(this.mode);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(
        Buffer.from(payloadText, 'base64url').toString('utf8'),
      ) as unknown;
    } catch {
      return unauthenticatedSession(this.mode);
    }

    if (!isSessionPayload(payload)) {
      return unauthenticatedSession(this.mode);
    }

    if (payload.expiresAt <= Date.now()) {
      return unauthenticatedSession(this.mode);
    }

    return {
      authenticated: true,
      username: payload.username,
      expiresAt: new Date(payload.expiresAt).toISOString(),
      mode: this.mode,
      authRequired: this.required,
    };
  }

  private sign(payloadText: string) {
    return crypto
      .createHmac('sha256', this.secret ?? '')
      .update(payloadText)
      .digest('base64url');
  }
}

export function unauthorizedPayload(): ApiErrorShape {
  return {
    code: 'unauthorized',
    message: 'Authentication is required.',
  };
}

export function readBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match ? match[1]!.trim() : null;
}

function readCookieToken(request: FastifyRequest) {
  const cookie = request.headers.cookie;
  if (!cookie) {
    return null;
  }

  const entries = cookie.split(';');
  for (const entry of entries) {
    const [name, ...valueParts] = entry.trim().split('=');
    if (name === AUTH_COOKIE_NAME) {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return null;
}

function readQueryToken(request: FastifyRequest) {
  const query = request.query;
  if (!query || typeof query !== 'object' || !('token' in query)) {
    return null;
  }

  const token = query.token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function unauthenticatedSession(mode: RuntimeConfig['mode']): AuthSession {
  return {
    authenticated: false,
    username: null,
    expiresAt: null,
    mode,
    authRequired: mode === 'server' || mode === 'relay',
  };
}

function isSessionPayload(value: unknown): value is {
  username: string;
  expiresAt: number;
  nonce: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'username' in value &&
    typeof value.username === 'string' &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'number' &&
    'nonce' in value &&
    typeof value.nonce === 'string'
  );
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
