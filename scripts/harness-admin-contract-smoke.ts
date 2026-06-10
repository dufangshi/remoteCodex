interface JsonObject {
  [key: string]: unknown;
}

interface StepResult {
  name: string;
  ok: boolean;
  status?: number;
  details?: JsonObject;
}

const DEFAULT_BASE_URL = 'https://elagenteharness-production.up.railway.app';

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && !/<[^>]+>/.test(value) ? value : null;
}

function requiredEnv(name: string) {
  const value = envValue(name);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function baseUrl() {
  return (envValue('ELAGENTE_HARNESS_ADMIN_BASE_URL') ??
    envValue('ELAGENTE_HARNESS_BASE_URL') ??
    DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function smokeExternalId() {
  return envValue('HARNESS_ADMIN_SMOKE_EXTERNAL_ID') ??
    `remote-codex:smoke:${Date.now()}`;
}

function redactedBody(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactedBody);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (['apiKey', 'api_key', 'key', 'token', 'secret'].includes(key)) {
      output[key] = entry ? '[redacted]' : entry;
      continue;
    }
    output[key] = redactedBody(entry);
  }
  return output;
}

async function request(input: {
  path: string;
  method?: string;
  adminKey?: string;
  body?: unknown;
}) {
  const response = await fetch(`${baseUrl()}${input.path}`, {
    method: input.method ?? 'GET',
    headers: {
      ...(input.adminKey ? { 'x-admin-key': input.adminKey } : {}),
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text.trim().startsWith('{')) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return {
    status: response.status,
    ok: response.ok,
    text,
    json,
  };
}

function objectBody(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected JSON object, got ${JSON.stringify(value)}`);
  }
  return value as JsonObject;
}

function responseBodyObject(response: Awaited<ReturnType<typeof request>>) {
  return response.json && typeof response.json === 'object' && !Array.isArray(response.json)
    ? response.json as JsonObject
    : null;
}

function failureDetails(response: Awaited<ReturnType<typeof request>>) {
  return {
    text: response.text.trim().slice(0, 500),
    body: redactedBody(response.json) as JsonObject,
  };
}

function requireStringField(body: JsonObject, field: string) {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Expected response field ${field} to be a non-empty string.`);
  }
  return value;
}

function requireBooleanField(body: JsonObject, field: string) {
  const value = body[field];
  if (typeof value !== 'boolean') {
    throw new Error(`Expected response field ${field} to be boolean.`);
  }
  return value;
}

function step(input: StepResult) {
  return input;
}

async function unauthenticatedRouteProbe(path: string, method: string, body?: unknown): Promise<StepResult> {
  const response = await request({ path, method, body });
  return step({
    name: `unauthenticated ${method} ${path}`,
    ok: response.status === 401 && /X-Admin-Key required/i.test(response.text),
    status: response.status,
    details: {
      expectedStatus: 401,
      message: response.text.trim(),
    },
  });
}

async function main() {
  const adminKey = requiredEnv('ELAGENTE_HARNESS_ADMIN_KEY');
  const externalId = smokeExternalId();
  const externalUserId = envValue('HARNESS_ADMIN_SMOKE_EXTERNAL_USER_ID') ??
    'remote-codex:user:harness-admin-smoke';
  const payload = {
    externalId,
    externalUserId,
    sandboxId: externalId.split(':').at(-1) ?? externalId,
    userId: externalUserId.split(':').at(-1) ?? externalUserId,
    name: 'remote-codex-harness-admin-smoke',
    kind: 'agent',
    email: 'harness-admin-smoke@example.test',
    description: 'Remote Codex Harness admin contract smoke',
  };

  const steps: StepResult[] = [];
  steps.push(await unauthenticatedRouteProbe('/admin/members/ensure', 'POST', { externalId }));
  steps.push(await unauthenticatedRouteProbe('/admin/usage/export?limit=1', 'GET'));

  const first = await request({
    path: '/admin/members/ensure',
    method: 'POST',
    adminKey,
    body: payload,
  });
  const firstBody = responseBodyObject(first);
  const firstExternalKeyId = firstBody ? requireStringField(firstBody, 'externalKeyId') : null;
  const firstApiKey = firstBody ? requireStringField(firstBody, 'apiKey') : null;
  const firstCreated = firstBody ? requireBooleanField(firstBody, 'created') : null;
  steps.push(step({
    name: 'authenticated ensure creates or returns member',
    ok: first.status === 200 && firstExternalKeyId === externalId && Boolean(firstApiKey),
    status: first.status,
    details: firstBody ? {
      created: firstCreated,
      externalKeyId: firstExternalKeyId,
      externalUserId: firstBody.externalUserId,
      apiKeyPresent: Boolean(firstApiKey),
      body: redactedBody(firstBody) as JsonObject,
    } : failureDetails(first),
  }));
  if (!firstBody || !firstExternalKeyId || !firstApiKey || first.status !== 200) {
    const ok = steps.every((entry) => entry.ok);
    console.log(JSON.stringify({
      ok,
      baseUrl: baseUrl(),
      externalId,
      steps,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const second = await request({
    path: '/admin/members/ensure',
    method: 'POST',
    adminKey,
    body: payload,
  });
  const secondBody = objectBody(second.json);
  steps.push(step({
    name: 'authenticated ensure is idempotent',
    ok: second.status === 200 &&
      requireStringField(secondBody, 'externalKeyId') === firstExternalKeyId &&
      requireStringField(secondBody, 'apiKey') === firstApiKey &&
      requireBooleanField(secondBody, 'created') === false,
    status: second.status,
    details: {
      created: secondBody.created,
      externalKeyId: secondBody.externalKeyId,
      apiKeyPresent: Boolean(secondBody.apiKey),
      body: redactedBody(secondBody) as JsonObject,
    },
  }));

  const reconcile = await request({
    path: '/admin/members/reconcile',
    method: 'POST',
    adminKey,
    body: {
      externalKeyId: firstExternalKeyId,
      externalUserId,
    },
  });
  const reconcileBody = objectBody(reconcile.json);
  steps.push(step({
    name: 'authenticated reconcile returns existing external key',
    ok: reconcile.status === 200 &&
      requireStringField(reconcileBody, 'externalKeyId') === firstExternalKeyId,
    status: reconcile.status,
    details: redactedBody(reconcileBody) as JsonObject,
  }));

  const rekey = await request({
    path: `/admin/members/${encodeURIComponent(firstExternalKeyId)}/rekey`,
    method: 'POST',
    adminKey,
  });
  const rekeyBody = objectBody(rekey.json);
  const rekeyApiKey = requireStringField(rekeyBody, 'apiKey');
  steps.push(step({
    name: 'authenticated rekey returns a new key',
    ok: rekey.status === 200 &&
      requireStringField(rekeyBody, 'externalKeyId') === firstExternalKeyId &&
      rekeyApiKey !== firstApiKey,
    status: rekey.status,
    details: {
      externalKeyId: rekeyBody.externalKeyId,
      apiKeyPresent: Boolean(rekeyApiKey),
      keyChanged: rekeyApiKey !== firstApiKey,
      body: redactedBody(rekeyBody) as JsonObject,
    },
  }));

  const usage = await request({
    path: '/admin/usage/export?limit=10',
    adminKey,
  });
  const usageBody = objectBody(usage.json);
  steps.push(step({
    name: 'authenticated usage export returns Remote Codex shape',
    ok: usage.status === 200 &&
      Array.isArray(usageBody.events) &&
      Object.prototype.hasOwnProperty.call(usageBody, 'nextCursor'),
    status: usage.status,
    details: {
      eventCount: Array.isArray(usageBody.events) ? usageBody.events.length : null,
      nextCursorPresent: Object.prototype.hasOwnProperty.call(usageBody, 'nextCursor'),
      body: redactedBody(usageBody) as JsonObject,
    },
  }));

  const revoke = await request({
    path: `/admin/members/${encodeURIComponent(firstExternalKeyId)}/revoke`,
    method: 'POST',
    adminKey,
  });
  const revokeBody = objectBody(revoke.json);
  steps.push(step({
    name: 'authenticated revoke marks key revoked',
    ok: revoke.status === 200 && revokeBody.status === 'revoked',
    status: revoke.status,
    details: redactedBody(revokeBody) as JsonObject,
  }));

  const ok = steps.every((entry) => entry.ok);
  console.log(JSON.stringify({
    ok,
    baseUrl: baseUrl(),
    externalId,
    steps,
  }, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
