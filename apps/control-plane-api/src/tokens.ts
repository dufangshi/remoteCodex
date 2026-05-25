import { createHmac, timingSafeEqual } from 'node:crypto';

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function sign(input: string, secret: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(input).digest());
}

export interface RouteTokenPayload {
  sub: string;
  sandbox_id: string;
  workspace_id?: string;
  session_id?: string;
  scopes: string[];
  iat: number;
  exp: number;
  jti: string;
}

export interface SignedTokenPayload {
  sub: string;
  iat?: number;
  exp: number;
  jti?: string;
  [key: string]: unknown;
}

export interface SigningKey {
  id: string;
  secret: string;
}

export function createSignedToken(
  payload: SignedTokenPayload,
  secret: string,
  options: { kid?: string } = {},
): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
    ...(options.kid ? { kid: options.kid } : {}),
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

function decodeHeader(token: string) {
  const [encodedHeader] = token.split('.');
  if (!encodedHeader) {
    throw new Error('Invalid token shape.');
  }
  return JSON.parse(base64UrlDecode(encodedHeader).toString('utf8')) as {
    alg?: string;
    typ?: string;
    kid?: string;
  };
}

export function verifySignedToken<TPayload extends { sub: string; exp: number } = RouteTokenPayload>(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Invalid token shape.');
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = sign(signingInput, secret);
  const actualBuffer = Buffer.from(parts[2]);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid token signature.');
  }

  const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8')) as TPayload;
  if (payload.exp <= nowSeconds) {
    throw new Error('Token expired.');
  }

  return payload;
}

export function verifySignedTokenWithKeys<
  TPayload extends { sub: string; exp: number } = RouteTokenPayload,
>(
  token: string,
  keys: SigningKey[],
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (keys.length === 0) {
    throw new Error('No signing keys configured.');
  }

  const header = decodeHeader(token);
  if (header.alg !== 'HS256') {
    throw new Error('Unsupported token algorithm.');
  }

  if (header.kid) {
    const key = keys.find((candidate) => candidate.id === header.kid);
    if (!key) {
      throw new Error('Unknown token key id.');
    }
    return verifySignedToken<TPayload>(token, key.secret, nowSeconds);
  }

  let lastError: unknown = null;
  for (const key of keys) {
    try {
      return verifySignedToken<TPayload>(token, key.secret, nowSeconds);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Invalid token.');
}
