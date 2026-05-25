import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildControlPlaneApp } from '../apps/control-plane-api/src/app';
import { createSignedToken } from '../packages/shared/src/index';

const authSecret = 'local-production-auth-smoke-secret';
const issuer = 'https://auth.local-smoke.example.test';
const audience = 'remote-codex-control-plane';

function token(input: {
  sub: string;
  iss?: string;
  aud?: string | string[];
  exp: number;
  nbf?: number;
}) {
  return createSignedToken(
    {
      sub: input.sub,
      iss: input.iss ?? issuer,
      aud: input.aud ?? audience,
      exp: input.exp,
      ...(input.nbf !== undefined ? { nbf: input.nbf } : {}),
    },
    authSecret,
  );
}

async function expectStatus(input: {
  name: string;
  app: ReturnType<typeof buildControlPlaneApp>;
  bearer: string;
  expectedStatus: number;
}) {
  const response = await input.app.inject({
    method: 'POST',
    url: '/api/me/bootstrap',
    headers: {
      authorization: `Bearer ${input.bearer}`,
    },
    payload: {
      email: `${input.name}@example.test`,
      displayName: input.name,
    },
  });
  if (response.statusCode !== input.expectedStatus) {
    throw new Error(
      `${input.name} expected ${input.expectedStatus}, got ${response.statusCode}: ${response.body}`,
    );
  }
  return response;
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-production-auth-smoke-'));
  const app = buildControlPlaneApp({
    env: {
      NODE_ENV: 'test',
      CONTROL_PLANE_DATABASE_URL: path.join(tempDir, 'control-plane.sqlite'),
      CONTROL_PLANE_AUTH_MODE: 'jwt',
      CONTROL_PLANE_AUTH_JWT_SECRET: authSecret,
      CONTROL_PLANE_AUTH_JWT_PROVIDER: 'jwt-compatible-smoke',
      CONTROL_PLANE_AUTH_JWT_ISSUER: issuer,
      CONTROL_PLANE_AUTH_JWT_AUDIENCE: audience,
      CONTROL_PLANE_AUTH_JWT_CLOCK_SKEW_SECONDS: '30',
      CONTROL_PLANE_JWT_SECRET: 'local-production-auth-route-token-secret',
      SANDBOX_ROUTER_BASE_URL: 'http://127.0.0.1:8791',
    },
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const valid = await expectStatus({
      name: 'valid-jwt-user',
      app,
      bearer: token({
        sub: 'valid-jwt-user',
        exp: now + 300,
      }),
      expectedStatus: 200,
    });
    const validUser = valid.json().user;
    if (
      validUser.authProvider !== 'jwt-compatible-smoke' ||
      validUser.authSubject !== 'valid-jwt-user'
    ) {
      throw new Error(`Valid JWT mapped to unexpected user identity: ${valid.body}`);
    }

    await expectStatus({
      name: 'expired-jwt-user',
      app,
      bearer: token({
        sub: 'expired-jwt-user',
        exp: now - 120,
      }),
      expectedStatus: 401,
    });

    await expectStatus({
      name: 'wrong-issuer-jwt-user',
      app,
      bearer: token({
        sub: 'wrong-issuer-jwt-user',
        iss: 'https://wrong-issuer.example.test',
        exp: now + 300,
      }),
      expectedStatus: 401,
    });

    await expectStatus({
      name: 'wrong-audience-jwt-user',
      app,
      bearer: token({
        sub: 'wrong-audience-jwt-user',
        aud: 'wrong-audience',
        exp: now + 300,
      }),
      expectedStatus: 401,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          provider: 'jwt-compatible-smoke',
          issuer,
          audience,
          acceptedSubject: validUser.authSubject,
          rejected: ['expired', 'wrong_issuer', 'wrong_audience'],
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
