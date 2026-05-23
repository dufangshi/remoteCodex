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

export function createSignedToken(payload: RouteTokenPayload, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

export function verifySignedToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
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

  const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8')) as RouteTokenPayload;
  if (payload.exp <= nowSeconds) {
    throw new Error('Token expired.');
  }

  return payload;
}
