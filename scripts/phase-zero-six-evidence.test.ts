import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { redactSecretText } from './secret-redaction.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function runScript(script: string, args: string[] = []) {
  return runScriptWithEnv(script, args);
}

async function runScriptWithEnv(
  script: string,
  args: string[] = [],
  env: Record<string, string | undefined> = {},
) {
  try {
    const result = await execFileAsync('pnpm', ['exec', 'tsx', script, ...args], {
      cwd: repoRoot,
      timeout: 30_000,
      env: {
        ...process.env,
        ...env,
      },
    });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const commandError = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: commandError.code ?? 1,
      stdout: commandError.stdout ?? '',
      stderr: commandError.stderr ?? '',
    };
  }
}

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'phase-zero-six-evidence-test-'));
}

async function fakeAwsKubectlBin(root: string) {
  const binDir = path.join(root, 'bin');
  await mkdir(binDir, { recursive: true });
  const awsPath = path.join(binDir, 'aws');
  const kubectlPath = path.join(binDir, 'kubectl');
  await writeFile(
    awsPath,
    [
      '#!/usr/bin/env node',
      'const args = process.argv.slice(2);',
      "if (args.join(' ') === 'sts get-caller-identity') {",
      '  console.log(JSON.stringify({ Account: "123456789012" }));',
      '  process.exit(0);',
      '}',
      "if (args[0] === 'eks' && args[1] === 'describe-cluster') {",
      '  console.log(JSON.stringify({ cluster: { resourcesVpcConfig: { vpcId: "vpc-123", subnetIds: ["subnet-1"], securityGroupIds: ["sg-1"] } } }));',
      '  process.exit(0);',
      '}',
      "if (args[0] === 'eks' && args[1] === 'describe-fargate-profile') {",
      '  console.log(JSON.stringify({ fargateProfile: { podExecutionRoleArn: "arn:aws:iam::123456789012:role/remote-codex-sandbox-manager" } }));',
      '  process.exit(0);',
      '}',
      'console.error(`unexpected aws args: ${args.join(" ")}`);',
      'process.exit(2);',
      '',
    ].join('\n'),
  );
  await writeFile(
    kubectlPath,
    [
      '#!/usr/bin/env node',
      'const args = process.argv.slice(2);',
      "if (args[0] === 'auth' && args[1] === 'can-i') {",
      "  if (args.includes('--all-namespaces') || args.includes('kube-system')) {",
      "    console.log('no');",
      '  } else {',
      "    console.log('yes');",
      '  }',
      '  process.exit(0);',
      '}',
      'console.error(`unexpected kubectl args: ${args.join(" ")}`);',
      'process.exit(2);',
      '',
    ].join('\n'),
  );
  await Promise.all([
    chmod(awsPath, 0o755),
    chmod(kubectlPath, 0o755),
  ]);
  return binDir;
}

async function withFakeStagingServers(
  handler: (input: { controlPlaneBaseUrl: string; directWorkerBaseUrl: string }) => Promise<void>,
) {
  const state = {
    sandboxStarted: false,
    sandboxStopped: false,
  };
  const directWorker = http.createServer((request, response) => {
    if (request.url === '/api/worker/metadata') {
      response.writeHead(403, { 'content-type': 'text/plain' });
      response.end('forbidden without worker token');
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  const directWorkerBaseUrl = await listen(directWorker);

  let controlPlaneBaseUrlValue = '';
  const controlPlane = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    function json(body: unknown, status = 200) {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    }
    if (request.method === 'POST' && url.pathname === '/api/me/bootstrap') {
      json({
        user: { id: 'user-smoke' },
        sandbox: { id: 'sandbox-smoke', state: 'stopped' },
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/sandbox/start') {
      state.sandboxStarted = true;
      json({
        sandbox: {
          id: 'sandbox-smoke',
          state: 'running',
          image: 'remote-codex-worker:staging',
          resourceProfile: 'fargate-small',
          routerBaseUrl: '',
          workerServiceName: 'worker-svc',
          k8sNamespace: 'remote-codex-sandboxes',
          k8sPodName: 'worker-pod',
          startupProgress: 'ready',
        },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/sandbox/health') {
      json({
        sandbox: {
          id: 'sandbox-smoke',
          state: state.sandboxStopped ? 'stopped' : state.sandboxStarted ? 'running' : 'stopped',
          lastSeenAt: '2026-05-25T12:00:00.000Z',
          statusReason: 'ready',
          routerBaseUrl: '',
          workerServiceName: 'worker-svc',
          k8sNamespace: 'remote-codex-sandboxes',
          k8sPodName: 'worker-pod',
          startupProgress: 'ready',
        },
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/projects') {
      json({ project: { id: 'project-smoke' } });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/projects/project-smoke/workspaces') {
      json({ workspace: { id: 'workspace-smoke' } });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/workspaces/workspace-smoke/sessions') {
      json({ session: { id: 'session-smoke' } });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/sandboxes/sandbox-smoke/route-token') {
      json({
        token: 'route-token',
        sandboxId: 'sandbox-smoke',
        routerBaseUrl: controlPlaneBaseUrlValue,
        expiresAt: '2026-05-25T12:05:00.000Z',
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/healthz') {
      json({ ok: true, role: 'sandbox-router' });
      return;
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/api/sandboxes/sandbox-smoke/api/worker/metadata'
    ) {
      json({
        role: 'worker',
        sandboxId: 'sandbox-smoke',
        userId: 'user-smoke',
        managementRoutesEnabled: false,
        requestDiagnostics: {
          authorizationHeaderPresent: false,
          workerTokenHeaderPresent: true,
        },
      });
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found', path: url.pathname }));
  });
  const controlPlaneBaseUrl = await listen(controlPlane);
  controlPlaneBaseUrlValue = controlPlaneBaseUrl;

  try {
    await handler({ controlPlaneBaseUrl, directWorkerBaseUrl });
  } finally {
    await Promise.all([closeServer(controlPlane), closeServer(directWorker)]);
  }
}

async function withFailingRouteTokenServer(
  handler: (input: { controlPlaneBaseUrl: string }) => Promise<void>,
) {
  const state = {
    sandboxStarted: false,
  };
  const controlPlane = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    function json(body: unknown, status = 200) {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    }
    if (request.method === 'POST' && url.pathname === '/api/me/bootstrap') {
      json({
        user: { id: 'user-smoke' },
        sandbox: { id: 'sandbox-smoke', state: 'stopped' },
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/sandbox/start') {
      state.sandboxStarted = true;
      json({
        sandbox: {
          id: 'sandbox-smoke',
          state: 'running',
          image: 'remote-codex-worker:staging',
          resourceProfile: 'fargate-small',
          workerServiceName: 'worker-svc',
          k8sNamespace: 'remote-codex-sandboxes',
          k8sPodName: 'worker-pod',
          startupProgress: 'ready',
        },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/sandbox/health') {
      json({
        sandbox: {
          id: 'sandbox-smoke',
          state: state.sandboxStarted ? 'running' : 'stopped',
          lastSeenAt: '2026-05-25T12:00:00.000Z',
          statusReason: 'ready',
          workerServiceName: 'worker-svc',
          k8sNamespace: 'remote-codex-sandboxes',
          k8sPodName: 'worker-pod',
          startupProgress: 'ready',
        },
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/projects') {
      json({ project: { id: 'project-smoke' } });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/projects/project-smoke/workspaces') {
      json({ workspace: { id: 'workspace-smoke' } });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/workspaces/workspace-smoke/sessions') {
      json({ session: { id: 'session-smoke' } });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/sandboxes/sandbox-smoke/route-token') {
      json({ error: 'router_unavailable' }, 500);
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found', path: url.pathname }));
  });
  const controlPlaneBaseUrl = await listen(controlPlane);

  try {
    await handler({ controlPlaneBaseUrl });
  } finally {
    await closeServer(controlPlane);
  }
}

function listen(server: http.Server) {
  return new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP server address.');
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function minimalChecklist() {
  return [
    '- [x] D0.01 Already done.',
    '- [ ] S3.04 Finalize AWS staging configuration.',
    '- [ ] S3.05 Add least-privilege Kubernetes credentials.',
    '- [ ] S3.06 Create a real worker Pod from the control plane.',
    '- [ ] S3.07 Stop a real worker Pod from the control plane.',
    '- [ ] S3.08 Add idempotent lifecycle smoke.',
    '- [ ] R5.10 Deploy sandbox-router in staging.',
    '- [ ] R5.11 Add direct-worker-denial proof.',
    '- [ ] R5.12 Add browser-to-router-to-worker smoke.',
    '- [ ] G6.11 Run staging Codex gateway smoke.',
    '- [ ] G6.12 Run staging Claude Code gateway smoke.',
    '- [ ] G6.13 Run staging OpenCode gateway smoke.',
  ].join('\n');
}

function completeAwsEvidence() {
  return {
    generatedAt: '2026-05-25T12:00:00.000Z',
    reviewedBy: 'operator@example.test',
    reviewSource: 'synthetic test evidence',
    aws: {
      accountId: '123456789012',
      region: 'us-east-1',
      eksClusterName: 'remote-codex-staging',
      namespace: 'remote-codex-sandboxes',
      fargateProfileName: 'sandbox-workers',
      vpcId: 'vpc-123',
      subnetIds: ['subnet-1'],
      securityGroupIds: ['sg-1'],
      serviceAccountName: 'remote-codex-sandbox-manager',
      workerImageRepository: 'example/remote-codex-worker',
      workerImageTag: 'sha-abc123',
      logGroupNames: ['/aws/eks/remote-codex-staging'],
      awsAccessSmokePassed: true,
      configReviewed: true,
    },
    kubernetesCredentials: {
      authMode: 'aws-iam',
      roleArn: 'arn:aws:iam::123456789012:role/remote-codex-sandbox-manager',
      serviceAccountName: 'remote-codex-sandbox-manager',
      namespace: 'remote-codex-sandboxes',
      noClusterAdmin: true,
      noWildcardVerbs: true,
      noWildcardResources: true,
      namespaceScoped: true,
      ownedResourceSelector: {
        'remote-codex.dev/cleanup-scope': 'sandbox-worker',
      },
      canI: [
        ...['create', 'get', 'list', 'watch', 'patch', 'delete'].map((verb) => ({
          verb,
          resource: 'pods',
          namespace: 'remote-codex-sandboxes',
          allowed: true,
        })),
        ...['create', 'get', 'list', 'delete'].map((verb) => ({
          verb,
          resource: 'services',
          namespace: 'remote-codex-sandboxes',
          allowed: true,
        })),
      ],
      forbiddenCanI: [
        { verb: '*', resource: '*', namespace: '*', allowed: false },
        { verb: 'delete', resource: 'namespaces', namespace: '*', allowed: false },
      ],
      credentialReviewPassed: true,
    },
  };
}

function completeStagingSmokeEvidence() {
  return {
    ok: true,
    generatedAt: '2026-05-25T12:30:00.000Z',
    controlPlaneBaseUrl: 'https://control-plane.example.test',
    steps: [
      {
        name: 'start_sandbox',
        ok: true,
        details: {
          sandboxId: 'sandbox-smoke',
          state: 'running',
          image: 'remote-codex-worker:sha-abc123',
        },
      },
      {
        name: 'sandbox_ready',
        ok: true,
        details: {
          sandboxId: 'sandbox-smoke',
          state: 'running',
          k8sPodName: 'worker-pod',
          workerServiceName: 'worker-service',
          k8sNamespace: 'remote-codex-sandboxes',
        },
      },
      {
        name: 'admin_sandbox_runtime_detail',
        ok: true,
        details: {
          sandboxId: 'sandbox-smoke',
          runtimeState: 'running',
          k8sPodName: 'worker-pod',
          workerServiceName: 'worker-service',
          k8sNamespace: 'remote-codex-sandboxes',
        },
      },
      {
        name: 'stop_sandbox',
        ok: true,
        details: {
          sandboxId: 'sandbox-smoke',
          state: 'stopping',
          finalHealthState: 'stopped',
          stopConverged: true,
        },
      },
      {
        name: 'idempotent_lifecycle',
        ok: true,
        details: {
          sandboxId: 'sandbox-smoke',
          firstStartState: 'running',
          secondStartState: 'running',
          restartState: 'running',
        },
      },
      {
        name: 'issue_route_token',
        ok: true,
        details: {
          sandboxId: 'sandbox-smoke',
          routerBaseUrl: 'https://router.example.test',
        },
      },
      {
        name: 'router_health',
        ok: true,
        details: {
          routerBaseUrl: 'https://router.example.test',
          role: 'sandbox-router',
          status: 200,
        },
      },
      {
        name: 'browser_to_router_to_worker',
        ok: true,
        details: {
          role: 'worker',
          sandboxId: 'sandbox-smoke',
          userId: 'user-smoke',
          requestDiagnostics: {
            authorizationHeaderPresent: false,
            workerTokenHeaderPresent: true,
          },
        },
      },
      {
        name: 'direct_worker_denial',
        ok: true,
        details: {
          status: 403,
          acceptedStatuses: [401, 403],
        },
      },
      ...[
        ['codex_gateway_smoke', 'codex'],
        ['claude_gateway_smoke', 'claude'],
        ['opencode_gateway_smoke', 'opencode'],
      ].map(([name, provider]) => ({
        name,
        ok: true,
        details: {
          parsedStdout: {
            ok: true,
            provider,
            gatewayUsageRecorded: true,
            rootKeysAbsent: true,
            workerConfigUsesGateway: true,
            requestId: `${provider}-request-id`,
          },
        },
      })),
    ],
  };
}

describe('phase zero-six evidence tooling', () => {
  it('redacts obvious secrets before evidence stdout is stored', () => {
    const raw = [
      'Authorization: Bearer eyJaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbb.cccccccccccccccccc',
      'openai sk-testsecretvalue1234567890',
      'anthropic sk-ant-testsecretvalue1234567890',
      'aws AKIAABCDEFGHIJKLMNOP',
      'github ghp_abcdefghijklmnopqrstuvwxyz',
    ].join('\n');
    const redacted = redactSecretText(raw);

    expect(redacted).toContain('Bearer [REDACTED]');
    expect(redacted).toContain('[REDACTED_OPENAI_KEY]');
    expect(redacted).toContain('[REDACTED_ANTHROPIC_KEY]');
    expect(redacted).toContain('[REDACTED_AWS_ACCESS_KEY]');
    expect(redacted).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(redacted).not.toContain('eyJaaaaaaaaaaaaaaaa');
    expect(redacted).not.toContain('sk-testsecretvalue1234567890');
    expect(redacted).not.toContain('sk-ant-testsecretvalue1234567890');
    expect(redacted).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(redacted).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
  });

  it('refuses to apply checklist changes without ready evidence', async () => {
    const dir = await tempDir();
    const checklistPath = path.join(dir, 'checklist.md');
    await writeFile(checklistPath, minimalChecklist());

    const result = await runScript('scripts/verify-phase-zero-six-evidence.ts', [
      '--checklist',
      checklistPath,
      '--apply-ready',
    ]);
    const parsed = JSON.parse(result.stdout);
    const checklist = await readFile(checklistPath, 'utf8');

    expect(result.exitCode).toBe(1);
    expect(parsed.apply.applied).toBe(false);
    expect(parsed.readyToCheck).toHaveLength(0);
    expect(checklist).toContain('- [ ] S3.04 Finalize AWS staging configuration.');
  });

  it('applies only ready checklist boxes from AWS preflight evidence', async () => {
    const dir = await tempDir();
    const checklistPath = path.join(dir, 'checklist.md');
    const awsPath = path.join(dir, 'aws.json');
    await writeFile(checklistPath, minimalChecklist());
    await writeFile(awsPath, JSON.stringify(completeAwsEvidence(), null, 2));

    const result = await runScript('scripts/verify-phase-zero-six-evidence.ts', [
      '--checklist',
      checklistPath,
      '--aws-preflight',
      awsPath,
      '--apply-ready',
    ]);
    const parsed = JSON.parse(result.stdout);
    const checklist = await readFile(checklistPath, 'utf8');

    expect(result.exitCode).toBe(0);
    expect(parsed.apply.applied).toBe(true);
    expect(parsed.apply.appliedItems).toEqual(['S3.04', 'S3.05']);
    expect(checklist).toContain('- [x] S3.04 Finalize AWS staging configuration.');
    expect(checklist).toContain('- [x] S3.05 Add least-privilege Kubernetes credentials.');
    expect(checklist).toContain('- [ ] S3.06 Create a real worker Pod from the control plane.');
    expect(checklist).toContain('- [ ] S3.07 Stop a real worker Pod from the control plane.');
    expect(checklist).toContain('- [ ] S3.08 Add idempotent lifecycle smoke.');
    expect(checklist).toContain('- [ ] R5.10 Deploy sandbox-router in staging.');
    expect(checklist).toContain('- [ ] R5.11 Add direct-worker-denial proof.');
    expect(checklist).toContain('- [ ] R5.12 Add browser-to-router-to-worker smoke.');
    expect(checklist).toContain('- [ ] G6.11 Run staging Codex gateway smoke.');
    expect(checklist).toContain('- [ ] G6.12 Run staging Claude Code gateway smoke.');
    expect(checklist).toContain('- [ ] G6.13 Run staging OpenCode gateway smoke.');
  });

  it('applies all remaining phase zero-six boxes from complete AWS and staging evidence', async () => {
    const dir = await tempDir();
    const checklistPath = path.join(dir, 'checklist.md');
    const awsPath = path.join(dir, 'aws.json');
    const stagingPath = path.join(dir, 'staging.json');
    await writeFile(checklistPath, minimalChecklist());
    await writeFile(awsPath, JSON.stringify(completeAwsEvidence(), null, 2));
    await writeFile(stagingPath, JSON.stringify(completeStagingSmokeEvidence(), null, 2));

    const result = await runScript('scripts/verify-phase-zero-six-evidence.ts', [
      '--checklist',
      checklistPath,
      '--aws-preflight',
      awsPath,
      '--staging-smoke',
      stagingPath,
      '--apply-ready',
    ]);
    const parsed = JSON.parse(result.stdout);
    const checklist = await readFile(checklistPath, 'utf8');

    expect(result.exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.apply.applied).toBe(true);
    expect(parsed.apply.appliedItems).toEqual([
      'S3.04',
      'S3.05',
      'S3.06',
      'S3.07',
      'S3.08',
      'R5.10',
      'R5.11',
      'R5.12',
      'G6.11',
      'G6.12',
      'G6.13',
    ]);
    expect(parsed.readyToCheck.map((entry: { item: string }) => entry.item)).toEqual(
      parsed.apply.appliedItems,
    );
    expect(parsed.stillMissing).toEqual([]);
    for (const item of parsed.apply.appliedItems as string[]) {
      expect(checklist).toContain(`- [x] ${item} `);
    }
  });

  it('fails artifact safety scan when evidence files contain obvious secrets', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'safe.json'), JSON.stringify({ ok: true }));
    await writeFile(
      path.join(dir, 'leak.json'),
      JSON.stringify({
        ok: true,
        Authorization: 'Bearer eyJaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbb.cccccccccccccccccc',
      }),
    );

    const result = await runScript('scripts/verify-phase-zero-six-artifacts-safe.ts', ['--dir', dir]);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.findings.map((finding: { kind: string }) => finding.kind)).toContain('bearer_token');
    expect(parsed.findings.map((finding: { kind: string }) => finding.kind)).toContain('jwt_value');
  });

  it('scans shell env artifacts for obvious secrets while allowing placeholders', async () => {
    const safeDir = await tempDir();
    await writeFile(
      path.join(safeDir, 'phase-zero-six.env.sh'),
      [
        "export STAGING_PRODUCT_JWT='<staging-product-jwt>'",
        "export AWS_STAGING_REVIEWED_BY='operator@example.com'",
        '',
      ].join('\n'),
    );
    const safeResult = await runScript('scripts/verify-phase-zero-six-artifacts-safe.ts', [
      '--dir',
      safeDir,
    ]);
    const safeParsed = JSON.parse(safeResult.stdout);

    expect(safeResult.exitCode).toBe(0);
    expect(safeParsed.ok).toBe(true);
    expect(safeParsed.scannedFiles).toContain(path.join(safeDir, 'phase-zero-six.env.sh'));

    const leakingDir = await tempDir();
    await writeFile(
      path.join(leakingDir, 'phase-zero-six.env.sh'),
      "export STAGING_PRODUCT_JWT='Bearer eyJaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbb.cccccccccccccccccc'\n",
    );
    const leakingResult = await runScript('scripts/verify-phase-zero-six-artifacts-safe.ts', [
      '--dir',
      leakingDir,
    ]);
    const leakingParsed = JSON.parse(leakingResult.stdout);

    expect(leakingResult.exitCode).toBe(1);
    expect(leakingParsed.ok).toBe(false);
    expect(leakingParsed.findings.map((finding: { kind: string }) => finding.kind)).toContain('bearer_token');
    expect(leakingParsed.findings.map((finding: { kind: string }) => finding.kind)).toContain('jwt_value');
  });

  it('allows phase evidence artifact paths while still flagging long secret-like values', async () => {
    const safeDir = await tempDir();
    await writeFile(
      path.join(safeDir, 'summary.json'),
      JSON.stringify({
        artifacts: {
          envReadiness: '.temp/phase-zero-six-evidence/latest-local-template-check/env-readiness.json',
          envTemplate: '.temp/phase-zero-six-evidence/latest-local-template-check/phase-zero-six.env.sh',
          absoluteEnvReadiness: path.join(safeDir, '.temp/phase-zero-six-evidence/latest/env-readiness.json'),
          testArtifact: path.join(safeDir, 'artifact-secret-scan.json'),
          inputArtifactSecretScan: path.join(safeDir, 'artifact-secret-scan-input.json'),
          outputArtifactSecretScan: path.join(safeDir, 'artifact-secret-scan-output.json'),
          postApplyArtifactSecretScan: path.join(safeDir, 'artifact-secret-scan-post-apply.json'),
          finalArtifactSecretScan: path.join(safeDir, 'artifact-secret-scan-final.json'),
        },
        scannedFiles: [
          path.join(safeDir, 'aws-staging-preflight-verification.json'),
        ],
      }),
    );
    const safeResult = await runScript('scripts/verify-phase-zero-six-artifacts-safe.ts', [
      '--dir',
      safeDir,
    ]);
    const safeParsed = JSON.parse(safeResult.stdout);

    expect(safeResult.exitCode).toBe(0);
    expect(safeParsed.ok).toBe(true);

    const leakingDir = await tempDir();
    await writeFile(
      path.join(leakingDir, 'summary.json'),
      JSON.stringify({
        value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    );
    const leakingResult = await runScript('scripts/verify-phase-zero-six-artifacts-safe.ts', [
      '--dir',
      leakingDir,
    ]);
    const leakingParsed = JSON.parse(leakingResult.stdout);

    expect(leakingResult.exitCode).toBe(1);
    expect(leakingParsed.findings.map((finding: { kind: string }) => finding.kind)).toContain('long_secret_like_value');
  });

  it('reports env readiness without printing secret values', async () => {
    const result = await runScriptWithEnv(
      'scripts/verify-phase-zero-six-env-ready.ts',
      [],
      {
        STAGING_CONTROL_PLANE_BASE_URL: 'https://control-plane.example.test',
        STAGING_PRODUCT_JWT: 'secret-product-jwt-value',
        STAGING_ADMIN_JWT: 'secret-admin-jwt-value',
      },
    );
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.secretSafety.valuesPrinted).toBe(false);
    expect(result.stdout).toContain('STAGING_PRODUCT_JWT');
    expect(result.stdout).toContain('STAGING_ADMIN_JWT');
    expect(parsed.itemReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: 'S3.06',
          groupId: 'runtime-smoke',
          envReady: false,
          missingEnv: expect.arrayContaining([
            'STAGING_IDEMPOTENT_LIFECYCLE_SMOKE=true',
            'STAGING_STOP_SANDBOX_AFTER_SMOKE=true',
          ]),
          nextEvidenceCommand: 'pnpm collect:phase-zero-six-evidence -- --output-dir ./.temp/phase-zero-six-evidence/<run-id>',
        }),
        expect.objectContaining({
          item: 'G6.11',
          groupId: 'codex-provider-smoke',
          envReady: false,
        }),
      ]),
    );
    expect(parsed.nextCommands.collectEvidence).toBe(
      'pnpm collect:phase-zero-six-evidence -- --output-dir ./.temp/phase-zero-six-evidence/<run-id>',
    );
    expect(parsed.missingEnvExportTemplate).toEqual(
      expect.arrayContaining([
        "# runtime-smoke\nexport STAGING_IDEMPOTENT_LIFECYCLE_SMOKE='true'",
        "# runtime-smoke\nexport STAGING_STOP_SANDBOX_AFTER_SMOKE='true'",
      ]),
    );
    expect(result.stdout).not.toContain('secret-product-jwt-value');
    expect(result.stdout).not.toContain('secret-admin-jwt-value');
  });

  it('writes a placeholder env template without leaking current secret values', async () => {
    const dir = await tempDir();
    const templatePath = path.join(dir, 'phase-zero-six.env.sh');
    const result = await runScriptWithEnv(
      'scripts/verify-phase-zero-six-env-ready.ts',
      ['--write-env-template', templatePath],
      {
        STAGING_CONTROL_PLANE_BASE_URL: 'https://control-plane.example.test',
        STAGING_PRODUCT_JWT: 'secret-product-jwt-value',
        STAGING_ADMIN_JWT: 'secret-admin-jwt-value',
      },
    );
    const parsed = JSON.parse(result.stdout);
    const template = await readFile(templatePath, 'utf8');

    expect(result.exitCode).toBe(1);
    expect(parsed.envTemplatePath).toBe(templatePath);
    expect(template).toContain('Phase 0-6 staging evidence environment template');
    expect(template).toContain('# runtime-smoke: Runtime staging smoke for S3.06-S3.08 and R5.10/R5.12');
    expect(template).toContain("export STAGING_IDEMPOTENT_LIFECYCLE_SMOKE='true'");
    expect(template).toContain("export AWS_STAGING_REVIEWED_BY='operator@example.com'");
    expect(template).not.toContain('secret-product-jwt-value');
    expect(template).not.toContain('secret-admin-jwt-value');
    expect(result.stdout).not.toContain('secret-product-jwt-value');
    expect(result.stdout).not.toContain('secret-admin-jwt-value');
  });

  it('marks all phase zero-six env groups ready when required env names are set', async () => {
    const result = await runScriptWithEnv(
      'scripts/verify-phase-zero-six-env-ready.ts',
      [],
      {
        AWS_STAGING_REVIEWED_BY: 'operator@example.test',
        AWS_STAGING_EKS_CLUSTER_NAME: 'remote-codex-staging',
        AWS_STAGING_K8S_NAMESPACE: 'remote-codex-sandboxes',
        AWS_STAGING_FARGATE_PROFILE_NAME: 'sandbox-workers',
        AWS_STAGING_K8S_SERVICE_ACCOUNT: 'remote-codex-sandbox-manager',
        AWS_STAGING_WORKER_IMAGE_REPOSITORY: 'example/remote-codex-worker',
        AWS_STAGING_WORKER_IMAGE_TAG: 'sha-abc123',
        AWS_STAGING_LOG_GROUP_NAMES: '/aws/eks/remote-codex-staging',
        AWS_STAGING_CONFIG_REVIEWED: 'true',
        AWS_STAGING_CREDENTIAL_REVIEW_PASSED: 'true',
        STAGING_CONTROL_PLANE_BASE_URL: 'https://control-plane.example.test',
        STAGING_PRODUCT_JWT: 'secret-product-jwt-value',
        STAGING_ADMIN_JWT: 'secret-admin-jwt-value',
        STAGING_IDEMPOTENT_LIFECYCLE_SMOKE: '1',
        STAGING_STOP_SANDBOX_AFTER_SMOKE: '1',
        STAGING_DIRECT_WORKER_BASE_URL: 'https://worker.example.test',
        STAGING_CODEX_GATEWAY_SMOKE_COMMAND_JSON: '["echo","codex"]',
        STAGING_CLAUDE_GATEWAY_SMOKE_COMMAND_JSON: '["echo","claude"]',
        STAGING_OPENCODE_GATEWAY_SMOKE_COMMAND_JSON: '["echo","opencode"]',
      },
    );
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.notReadyGroups).toEqual([]);
    expect(parsed.missingEnvExportTemplate).toEqual([]);
    expect(parsed.readyGroups).toEqual([
      'aws-preflight',
      'runtime-smoke',
      'direct-worker-denial',
      'codex-provider-smoke',
      'claude-provider-smoke',
      'opencode-provider-smoke',
    ]);
    expect(parsed.itemReadiness.every((entry: { envReady: boolean }) => entry.envReady)).toBe(true);
    expect(parsed.itemReadiness.map((entry: { item: string }) => entry.item)).toEqual([
      'S3.04',
      'S3.05',
      'S3.06',
      'S3.07',
      'S3.08',
      'R5.10',
      'R5.12',
      'R5.11',
      'G6.11',
      'G6.12',
      'G6.13',
    ]);
    expect(result.stdout).not.toContain('secret-product-jwt-value');
    expect(result.stdout).not.toContain('secret-admin-jwt-value');
  });

  it('accepts private router-only worker denial readiness without a public worker URL', async () => {
    const result = await runScriptWithEnv(
      'scripts/verify-phase-zero-six-env-ready.ts',
      [],
      {
        STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY: 'operator@example.test',
        STAGING_DIRECT_WORKER_NETWORK_MODE: 'private',
        STAGING_DIRECT_WORKER_INGRESS_POLICY: 'router-only',
        STAGING_DIRECT_WORKER_PRIVATE_PROOF: 'eks private service has no public ingress',
      },
    );
    const parsed = JSON.parse(result.stdout);
    const directGroup = parsed.groups.find((group: { id: string }) =>
      group.id === 'direct-worker-denial',
    );

    expect(directGroup.ready).toBe(true);
    expect(directGroup.missingEnv).toEqual([]);
    expect(directGroup.presentEnvNamesOnly).toEqual([
      'STAGING_DIRECT_WORKER_INGRESS_POLICY',
      'STAGING_DIRECT_WORKER_NETWORK_MODE',
      'STAGING_DIRECT_WORKER_PRIVATE_PROOF',
      'STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY',
    ]);
    expect(result.stdout).not.toContain('eks private service has no public ingress');
  });

  it('accepts private router-only direct worker denial evidence for R5.11', async () => {
    const dir = await tempDir();
    const stagingPath = path.join(dir, 'staging.json');
    const evidence = completeStagingSmokeEvidence();
    evidence.steps = evidence.steps.filter((step) => step.name !== 'direct_worker_denial');
    const steps = evidence.steps as Array<{
      name: string;
      ok: boolean;
      details?: Record<string, unknown>;
    }>;
    steps.push({
      name: 'direct_worker_private_denial',
      ok: true,
      details: {
        reviewedBy: 'operator@example.test',
        networkMode: 'private',
        ingressPolicy: 'router-only',
        proof: 'EKS worker service is ClusterIP-only and reachable only through sandbox-router.',
      },
    });
    await writeFile(stagingPath, JSON.stringify(evidence, null, 2));

    const result = await runScript('scripts/verify-staging-phase-one-evidence.ts', [stagingPath]);
    const parsed = JSON.parse(result.stdout);
    const r511 = parsed.results.find((entry: { item: string }) => entry.item === 'R5.11');

    expect(result.exitCode).toBe(0);
    expect(r511.readyToCheck).toBe(true);
    expect(r511.matchedSteps).toEqual(['direct_worker_private_denial']);
  });

  it('checks only AWS preflight env when staging smoke is skipped', async () => {
    const result = await runScriptWithEnv(
      'scripts/verify-phase-zero-six-env-ready.ts',
      ['--skip-staging-smoke'],
      {
        AWS_STAGING_REVIEWED_BY: 'operator@example.test',
        AWS_STAGING_EKS_CLUSTER_NAME: 'remote-codex-staging',
        AWS_STAGING_K8S_NAMESPACE: 'remote-codex-sandboxes',
        AWS_STAGING_FARGATE_PROFILE_NAME: 'sandbox-workers',
        AWS_STAGING_K8S_SERVICE_ACCOUNT: 'remote-codex-sandbox-manager',
        AWS_STAGING_WORKER_IMAGE_REPOSITORY: 'example/remote-codex-worker',
        AWS_STAGING_WORKER_IMAGE_TAG: 'sha-abc123',
        AWS_STAGING_LOG_GROUP_NAMES: '/aws/eks/remote-codex-staging',
        AWS_STAGING_CONFIG_REVIEWED: 'true',
        AWS_STAGING_CREDENTIAL_REVIEW_PASSED: 'true',
      },
    );
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.skippedStagingSmoke).toBe(true);
    expect(parsed.readyGroups).toEqual(['aws-preflight']);
    expect(parsed.notReadyGroups).toEqual([]);
    expect(parsed.groups.map((group: { id: string }) => group.id)).toEqual(['aws-preflight']);
    expect(parsed.itemReadiness.map((entry: { item: string }) => entry.item)).toEqual(['S3.04', 'S3.05']);
    expect(parsed.nextCommands.collectEvidence).toBe(
      'pnpm collect:phase-zero-six-evidence -- --output-dir ./.temp/phase-zero-six-evidence/<run-id> --skip-staging-smoke',
    );
    expect(parsed.nextCommands.writeEnvTemplate).toBe(
      'pnpm verify:phase-zero-six-env-ready -- --skip-staging-smoke --write-env-template ./.temp/phase-zero-six-evidence/aws-preflight.env.sh',
    );
  });

  it('stops bundle collection after env readiness failure unless forced', async () => {
    const dir = await tempDir();
    const result = await runScriptWithEnv(
      'scripts/run-phase-zero-six-staging-evidence.ts',
      [
        '--output-dir',
        dir,
      ],
      {
        STAGING_PRODUCT_JWT: 'secret-product-jwt-value',
      },
    );
    const parsed = JSON.parse(result.stdout);
    const files = await readdir(dir);
    const template = await readFile(path.join(dir, 'phase-zero-six.env.sh'), 'utf8');
    const operatorReport = await readFile(path.join(dir, 'operator-report.txt'), 'utf8');
    const releaseReview = JSON.parse(await readFile(path.join(dir, 'release-review.json'), 'utf8'));

    expect(result.exitCode).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.stoppedAfterEnvReadiness).toBe(true);
    expect(parsed.artifactScanPassed).toBe(true);
    expect(parsed.envReadiness.notReadyGroups).toEqual([
      'aws-preflight',
      'runtime-smoke',
      'direct-worker-denial',
      'codex-provider-smoke',
      'claude-provider-smoke',
      'opencode-provider-smoke',
    ]);
    expect(parsed.envReadiness.groups[0]).toEqual(expect.objectContaining({
      id: 'aws-preflight',
      items: ['S3.04', 'S3.05'],
      ready: false,
    }));
    expect(parsed.envReadiness.itemReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: 'S3.04',
          groupId: 'aws-preflight',
          envReady: false,
        }),
        expect.objectContaining({
          item: 'G6.13',
          groupId: 'opencode-provider-smoke',
          envReady: false,
        }),
      ]),
    );
    expect(parsed.envReadiness.nextCommands.collectEvidence).toBe(
      'pnpm collect:phase-zero-six-evidence -- --output-dir ./.temp/phase-zero-six-evidence/<run-id>',
    );
    expect(parsed.nextSteps.fillEnvTemplate).toContain(path.join(dir, 'phase-zero-six.env.sh'));
    expect(parsed.nextSteps.verifyEnvReadiness).toBe('pnpm verify:phase-zero-six-env-ready');
    expect(parsed.nextSteps.rerunBundle).toContain(`--output-dir ${dir}`);
    expect(parsed.artifacts.envReadiness).toBe(path.join(dir, 'env-readiness.json'));
    expect(parsed.artifacts.envTemplate).toBe(path.join(dir, 'phase-zero-six.env.sh'));
    expect(parsed.artifacts.artifactSecretScan).toBe(path.join(dir, 'artifact-secret-scan.json'));
    expect(parsed.artifacts.operatorReport).toBe(path.join(dir, 'operator-report.txt'));
    expect(parsed.artifacts.releaseReview).toBe(path.join(dir, 'release-review.json'));
    expect(parsed.artifacts.finalArtifactSecretScan).toBe(path.join(dir, 'artifact-secret-scan-final.json'));
    expect(parsed.finalArtifactScanPassed).toBe(true);
    expect(parsed.artifacts.awsPreflight).toBeNull();
    expect(files.sort()).toEqual([
      'artifact-secret-scan-final.json',
      'artifact-secret-scan.json',
      'env-readiness.json',
      'operator-report.txt',
      'phase-zero-six.env.sh',
      'release-review.json',
      'summary.json',
    ]);
    expect(parsed.results.map((entry: { name: string }) => entry.name)).toEqual([
      'verify_phase_zero_six_env_ready',
      'verify_phase_zero_six_artifacts_safe',
      'verify_phase_zero_six_final_artifacts_safe',
    ]);
    expect(template).toContain('Phase 0-6 staging evidence environment template');
    expect(template).not.toContain('secret-product-jwt-value');
    expect(operatorReport).toContain('Remote Codex Phase 0-6 Evidence Operator Report');
    expect(operatorReport).toContain('S3.04 [aws-preflight]: envReady=false');
    expect(operatorReport).toContain('G6.13 [opencode-provider-smoke]: envReady=false');
    expect(operatorReport).not.toContain('secret-product-jwt-value');
    expect(releaseReview.ok).toBe(false);
    expect(releaseReview.phaseZeroSixComplete).toBe(false);
    expect(releaseReview.envReadiness.notReadyGroups).toEqual([
      'aws-preflight',
      'runtime-smoke',
      'direct-worker-denial',
      'codex-provider-smoke',
      'claude-provider-smoke',
      'opencode-provider-smoke',
    ]);
    expect(JSON.stringify(releaseReview)).not.toContain('secret-product-jwt-value');
    expect(result.stdout).not.toContain('secret-product-jwt-value');
  });

  it('force mode continues bundle collection after env readiness failure', async () => {
    const dir = await tempDir();
    const result = await runScriptWithEnv(
      'scripts/run-phase-zero-six-staging-evidence.ts',
      [
        '--output-dir',
        dir,
        '--skip-staging-smoke',
        '--force',
      ],
      {
        AWS_STAGING_PREFLIGHT_SKIP_COMMANDS: '1',
      },
    );
    const parsed = JSON.parse(result.stdout);
    const files = await readdir(dir);

    expect(result.exitCode).toBe(1);
    expect(parsed.stoppedAfterEnvReadiness).toBe(false);
    expect(files).toContain('env-readiness.json');
    expect(files).toContain('aws-staging-preflight.json');
    expect(files).toContain('aws-staging-preflight-verification.json');
    expect(files).toContain('phase-zero-six-verification.json');
    expect(files).toContain('artifact-secret-scan.json');
    expect(files).toContain('summary.json');
  });

  it('treats partial bundle evidence as successful without claiming phase zero-six complete', async () => {
    const dir = await tempDir();
    const fakeBin = await fakeAwsKubectlBin(dir);
    const checklistPath = path.join(dir, 'checklist.md');
    await writeFile(checklistPath, minimalChecklist());

    const result = await runScriptWithEnv(
      'scripts/run-phase-zero-six-staging-evidence.ts',
      [
        '--output-dir',
        dir,
        '--skip-staging-smoke',
        '--apply-ready',
        '--checklist',
        checklistPath,
      ],
      {
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
        AWS_STAGING_REVIEWED_BY: 'operator@example.test',
        AWS_STAGING_REGION: 'us-east-1',
        AWS_STAGING_EKS_CLUSTER_NAME: 'remote-codex-staging',
        AWS_STAGING_K8S_NAMESPACE: 'remote-codex-sandboxes',
        AWS_STAGING_FARGATE_PROFILE_NAME: 'sandbox-workers',
        AWS_STAGING_K8S_SERVICE_ACCOUNT: 'remote-codex-sandbox-manager',
        AWS_STAGING_WORKER_IMAGE_REPOSITORY: 'example/remote-codex-worker',
        AWS_STAGING_WORKER_IMAGE_TAG: 'sha-abc123',
        AWS_STAGING_LOG_GROUP_NAMES: '/aws/eks/remote-codex-staging',
        AWS_STAGING_CONFIG_REVIEWED: 'true',
        AWS_STAGING_CREDENTIAL_REVIEW_PASSED: 'true',
        AWS_STAGING_K8S_AUTH_MODE: 'aws-iam',
      },
    );
    const parsed = JSON.parse(result.stdout);
    const checklist = await readFile(checklistPath, 'utf8');
    const files = await readdir(dir);

    expect(result.exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.phaseZeroSixComplete).toBe(false);
    expect(parsed.checklistReadiness.readyToCheck.map((entry: { item: string }) => entry.item)).toEqual([
      'S3.04',
      'S3.05',
    ]);
    expect(parsed.checklistReadiness.checkedButContradicted).toEqual([]);
    expect(parsed.applySkippedReason).toBeNull();
    expect(
      parsed.results.find((entry: { name: string }) => entry.name === 'verify_phase_zero_six_evidence'),
    ).toMatchObject({
      ok: true,
      rawOk: false,
      parsedOk: false,
    });
    expect(
      parsed.results.find((entry: { name: string }) => entry.name === 'verify_phase_zero_six_evidence_apply'),
    ).toMatchObject({
      ok: true,
      rawOk: false,
      parsedOk: false,
    });
    expect(
      parsed.results.find((entry: { name: string }) =>
        entry.name === 'verify_phase_zero_six_post_apply_artifacts_safe'),
    ).toMatchObject({
      ok: true,
      rawOk: true,
      parsedOk: true,
    });
    expect(parsed.postApplyScanPassed).toBe(true);
    expect(parsed.artifacts.phaseZeroSixApply).toBe(path.join(dir, 'phase-zero-six-apply.json'));
    expect(parsed.artifacts.postApplyArtifactSecretScan).toBe(path.join(dir, 'artifact-secret-scan-post-apply.json'));
    expect(parsed.artifacts.operatorReport).toBe(path.join(dir, 'operator-report.txt'));
    expect(parsed.artifacts.releaseReview).toBe(path.join(dir, 'release-review.json'));
    expect(parsed.artifacts.finalArtifactSecretScan).toBe(path.join(dir, 'artifact-secret-scan-final.json'));
    expect(parsed.finalArtifactScanPassed).toBe(true);
    expect(files).toContain('phase-zero-six-apply.json');
    expect(files).toContain('artifact-secret-scan-post-apply.json');
    expect(files).toContain('artifact-secret-scan-final.json');
    expect(files).toContain('operator-report.txt');
    expect(files).toContain('release-review.json');
    expect(checklist).toContain('- [x] S3.04 Finalize AWS staging configuration.');
    expect(checklist).toContain('- [x] S3.05 Add least-privilege Kubernetes credentials.');
    expect(checklist).toContain('- [ ] S3.06 Create a real worker Pod from the control plane.');
  });

  it('applies reviewed artifacts without rerunning live collection or smoke commands', async () => {
    const evidenceDir = await tempDir();
    const applyDir = await tempDir();
    const checklistPath = path.join(applyDir, 'checklist.md');
    await writeFile(checklistPath, minimalChecklist());
    await writeFile(
      path.join(evidenceDir, 'env-readiness.json'),
      JSON.stringify({
        ok: true,
        readyGroups: ['aws-preflight'],
        notReadyGroups: [],
        groups: [{
          id: 'aws-preflight',
          items: ['S3.04', 'S3.05'],
          ready: true,
          missingEnv: [],
          missingRecommendedEnv: [],
        }],
      }),
    );
    await writeFile(
      path.join(evidenceDir, 'aws-staging-preflight.json'),
      JSON.stringify(completeAwsEvidence(), null, 2),
    );

    const result = await runScript(
      'scripts/run-phase-zero-six-staging-evidence.ts',
      [
        '--from-output-dir',
        evidenceDir,
        '--output-dir',
        applyDir,
        '--skip-staging-smoke',
        '--apply-ready',
        '--checklist',
        checklistPath,
      ],
    );
    const parsed = JSON.parse(result.stdout);
    const checklist = await readFile(checklistPath, 'utf8');
    const commandNames = parsed.results.map((entry: { name: string }) => entry.name);

    expect(result.exitCode).toBe(0);
    expect(parsed.reuseExistingArtifacts).toBe(true);
    expect(parsed.fromOutputDir).toBe(evidenceDir);
    expect(parsed.checklistReadiness.readyToCheck.map((entry: { item: string }) => entry.item)).toEqual([
      'S3.04',
      'S3.05',
    ]);
    expect(parsed.checklistReadiness.checkedButContradicted).toEqual([]);
    expect(commandNames).not.toContain('verify_phase_zero_six_env_ready');
    expect(commandNames).not.toContain('collect_aws_staging_preflight_evidence');
    expect(commandNames).not.toContain('run_staging_phase_one_smoke');
    expect(commandNames).toEqual([
      'verify_aws_staging_preflight_evidence',
      'verify_phase_zero_six_evidence',
      'verify_phase_zero_six_input_artifacts_safe',
      'verify_phase_zero_six_output_artifacts_safe',
      'verify_phase_zero_six_evidence_apply',
      'verify_phase_zero_six_post_apply_artifacts_safe',
      'verify_phase_zero_six_final_artifacts_safe',
    ]);
    expect(parsed.envReadiness.readyGroups).toEqual(['aws-preflight']);
    expect(parsed.artifacts.awsPreflight).toBe(path.join(evidenceDir, 'aws-staging-preflight.json'));
    expect(parsed.artifacts.artifactSecretScan).toBeNull();
    expect(parsed.artifacts.inputArtifactSecretScan).toBe(path.join(applyDir, 'artifact-secret-scan-input.json'));
    expect(parsed.artifacts.outputArtifactSecretScan).toBe(path.join(applyDir, 'artifact-secret-scan-output.json'));
    expect(parsed.artifacts.postApplyArtifactSecretScan).toBe(path.join(applyDir, 'artifact-secret-scan-post-apply.json'));
    expect(parsed.postApplyScanPassed).toBe(true);
    expect(checklist).toContain('- [x] S3.04 Finalize AWS staging configuration.');
    expect(checklist).toContain('- [x] S3.05 Add least-privilege Kubernetes credentials.');
  });

  it('reports missing reviewed artifact files before running reuse verifiers', async () => {
    const evidenceDir = await tempDir();
    const applyDir = await tempDir();
    await writeFile(
      path.join(evidenceDir, 'env-readiness.json'),
      JSON.stringify({
        ok: false,
        readyGroups: [],
        notReadyGroups: ['aws-preflight'],
        groups: [{
          id: 'aws-preflight',
          items: ['S3.04', 'S3.05'],
          ready: false,
          missingEnv: ['AWS_STAGING_REVIEWED_BY'],
          missingRecommendedEnv: [],
        }],
      }),
    );

    const result = await runScript(
      'scripts/run-phase-zero-six-staging-evidence.ts',
      [
        '--from-output-dir',
        evidenceDir,
        '--output-dir',
        applyDir,
        '--apply-ready',
      ],
    );
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(parsed.reason).toBe('Reviewed artifact reuse requested, but required evidence files are missing.');
    expect(parsed.missingEvidenceFiles).toEqual([
      path.join(evidenceDir, 'aws-staging-preflight.json'),
      path.join(evidenceDir, 'staging-phase-one-smoke.json'),
    ]);
    expect(parsed.results).toEqual([
      expect.objectContaining({
        name: 'verify_phase_zero_six_final_artifacts_safe',
        ok: true,
      }),
    ]);
    expect(parsed.finalArtifactScanPassed).toBe(true);
    expect(parsed.envReadiness.notReadyGroups).toEqual(['aws-preflight']);
    expect(parsed.envReadiness.itemReadiness).toEqual([]);
    expect(parsed.nextSteps.rerunBundle).toContain(`--from-output-dir ${evidenceDir}`);
  });

  it('does not apply checklist changes when bundle artifact scan fails', async () => {
    const dir = await tempDir();
    const checklistPath = path.join(dir, 'checklist.md');
    await writeFile(checklistPath, minimalChecklist());

    const result = await runScriptWithEnv(
      'scripts/run-phase-zero-six-staging-evidence.ts',
      [
        '--output-dir',
        dir,
        '--skip-staging-smoke',
        '--force',
        '--apply-ready',
        '--checklist',
        checklistPath,
      ],
      {
        AWS_STAGING_PREFLIGHT_SKIP_COMMANDS: '1',
        AWS_STAGING_REVIEWED_BY: 'operator@example.test',
        AWS_STAGING_ACCOUNT_ID: '123456789012',
        AWS_STAGING_REGION: 'us-east-1',
        AWS_STAGING_EKS_CLUSTER_NAME: 'remote-codex-staging',
        AWS_STAGING_K8S_NAMESPACE: 'remote-codex-sandboxes',
        AWS_STAGING_FARGATE_PROFILE_NAME: 'sandbox-workers',
        AWS_STAGING_K8S_SERVICE_ACCOUNT: 'remote-codex-sandbox-manager',
        AWS_STAGING_WORKER_IMAGE_REPOSITORY: 'example/remote-codex-worker',
        AWS_STAGING_WORKER_IMAGE_TAG: 'sha-abc123',
        AWS_STAGING_LOG_GROUP_NAMES: '/aws/eks/remote-codex-staging',
        AWS_STAGING_CONFIG_REVIEWED: 'true',
        AWS_STAGING_CREDENTIAL_REVIEW_PASSED: 'true',
        AWS_STAGING_K8S_AUTH_MODE: 'aws-iam',
        AWS_STAGING_K8S_ROLE_ARN: 'arn:aws:iam::123456789012:role/remote-codex-sandbox-manager',
        AWS_STAGING_VPC_ID: 'vpc-123',
        AWS_STAGING_SUBNET_IDS: 'subnet-1',
        AWS_STAGING_SECURITY_GROUP_IDS: 'sg-1',
        AWS_STAGING_ENVIRONMENT: 'Bearer eyJaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbb.cccccccccccccccccc',
      },
    );
    const parsed = JSON.parse(result.stdout);
    const checklist = await readFile(checklistPath, 'utf8');
    const files = await readdir(dir);

    expect(result.exitCode).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.applySkippedReason).toBe('Artifact secret scan failed; checklist apply was not run.');
    expect(parsed.artifacts.phaseZeroSixApply).toBeNull();
    expect(files).not.toContain('phase-zero-six-apply.json');
    expect(checklist).toContain('- [ ] S3.04 Finalize AWS staging configuration.');
    expect(checklist).toContain('- [ ] S3.05 Add least-privilege Kubernetes credentials.');
  });

  it('records direct worker denial when direct worker returns non-json 403', async () => {
    await withFakeStagingServers(async ({ controlPlaneBaseUrl, directWorkerBaseUrl }) => {
      const result = await runScriptWithEnv(
        'scripts/staging-phase-one-smoke.ts',
        [],
        {
          STAGING_CONTROL_PLANE_BASE_URL: controlPlaneBaseUrl,
          STAGING_PRODUCT_JWT: 'secret-product-jwt-value',
          STAGING_DIRECT_WORKER_BASE_URL: directWorkerBaseUrl,
        },
      );
      const parsed = JSON.parse(result.stdout);
      const directStep = parsed.steps.find((step: { name: string }) =>
        step.name === 'direct_worker_denial',
      );

      expect(result.exitCode).toBe(0);
      expect(directStep).toMatchObject({
        name: 'direct_worker_denial',
        ok: true,
        details: {
          status: 403,
          acceptedStatuses: [401, 403],
        },
      });
      expect(result.stdout).not.toContain('forbidden without worker token');
      expect(result.stdout).not.toContain('secret-product-jwt-value');
    });
  });

  it('prints partial staging smoke steps when the smoke aborts mid-run', async () => {
    await withFailingRouteTokenServer(async ({ controlPlaneBaseUrl }) => {
      const result = await runScriptWithEnv(
        'scripts/staging-phase-one-smoke.ts',
        [],
        {
          STAGING_CONTROL_PLANE_BASE_URL: controlPlaneBaseUrl,
          STAGING_PRODUCT_JWT: 'secret-product-jwt-value',
        },
      );
      const parsed = JSON.parse(result.stderr);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain('expected 200, got 500');
      expect(parsed.controlPlaneBaseUrl).toBe(controlPlaneBaseUrl);
      expect(parsed.steps.map((step: { name: string }) => step.name)).toEqual([
        'bootstrap_user_and_sandbox',
        'start_sandbox',
        'sandbox_health',
        'sandbox_ready',
        'create_project_workspace_session',
      ]);
      expect(result.stderr).not.toContain('secret-product-jwt-value');
    });
  });

  it('redacts provider command output in provider gateway smoke evidence', async () => {
    const dir = await tempDir();
    const configPath = path.join(dir, 'config.toml');
    const commandPath = path.join(dir, 'provider-command.mjs');
    await writeFile(
      configPath,
      [
        'base_url = "https://gateway.example.test"',
        'token_env = "REMOTE_CODEX_LLM_GATEWAY_TOKEN"',
      ].join('\n'),
    );
    await writeFile(
      commandPath,
      [
        'console.log("Bearer eyJaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbb.cccccccccccccccccc");',
        'console.error("sk-testsecretvalue1234567890");',
      ].join('\n'),
    );

    const result = await runScriptWithEnv(
      'scripts/provider-gateway-smoke.ts',
      ['codex'],
      {
        PROVIDER_GATEWAY_SMOKE_CONFIG_PATH: configPath,
        PROVIDER_GATEWAY_SMOKE_COMMAND_JSON: JSON.stringify(['node', commandPath]),
        PROVIDER_GATEWAY_SMOKE_USAGE_RECORDED: '1',
        REMOTE_CODEX_LLM_GATEWAY_BASE_URL: 'https://gateway.example.test',
      },
    );
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.details.commandStdout).toContain('Bearer [REDACTED]');
    expect(parsed.details.commandStderr).toContain('[REDACTED_OPENAI_KEY]');
    expect(result.stdout).not.toContain('eyJaaaaaaaaaaaaaaaa');
    expect(result.stdout).not.toContain('sk-testsecretvalue1234567890');
  });

  it('keeps redacted provider command output when provider gateway smoke command fails', async () => {
    const dir = await tempDir();
    const configPath = path.join(dir, 'config.toml');
    const commandPath = path.join(dir, 'provider-command-fails.mjs');
    await writeFile(
      configPath,
      [
        'base_url = "https://gateway.example.test"',
        'token_env = "REMOTE_CODEX_LLM_GATEWAY_TOKEN"',
      ].join('\n'),
    );
    await writeFile(
      commandPath,
      [
        'console.log("Bearer eyJaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbb.cccccccccccccccccc");',
        'console.error("sk-testsecretvalue1234567890");',
        'process.exit(9);',
      ].join('\n'),
    );

    const result = await runScriptWithEnv(
      'scripts/provider-gateway-smoke.ts',
      ['codex'],
      {
        PROVIDER_GATEWAY_SMOKE_CONFIG_PATH: configPath,
        PROVIDER_GATEWAY_SMOKE_COMMAND_JSON: JSON.stringify(['node', commandPath]),
        PROVIDER_GATEWAY_SMOKE_USAGE_RECORDED: '1',
        REMOTE_CODEX_LLM_GATEWAY_BASE_URL: 'https://gateway.example.test',
      },
    );
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.details.commandStdout).toContain('Bearer [REDACTED]');
    expect(parsed.details.commandStderr).toContain('[REDACTED_OPENAI_KEY]');
    expect(parsed.details.commandError).toContain('Command failed');
    expect(result.stdout).not.toContain('eyJaaaaaaaaaaaaaaaa');
    expect(result.stdout).not.toContain('sk-testsecretvalue1234567890');
  });

  it('records failed provider command as a redacted staging smoke step', async () => {
    const dir = await tempDir();
    const commandPath = path.join(dir, 'failing-provider-command.mjs');
    await writeFile(
      commandPath,
      [
        'console.log("Bearer eyJaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbb.cccccccccccccccccc");',
        'console.error("sk-testsecretvalue1234567890");',
        'process.exit(7);',
      ].join('\n'),
    );

    await withFakeStagingServers(async ({ controlPlaneBaseUrl }) => {
      const result = await runScriptWithEnv(
        'scripts/staging-phase-one-smoke.ts',
        [],
        {
          STAGING_CONTROL_PLANE_BASE_URL: controlPlaneBaseUrl,
          STAGING_PRODUCT_JWT: 'secret-product-jwt-value',
          STAGING_CODEX_GATEWAY_SMOKE_COMMAND_JSON: JSON.stringify(['node', commandPath]),
        },
      );
      const parsed = JSON.parse(result.stdout);
      const providerStep = parsed.steps.find((step: { name: string }) =>
        step.name === 'codex_gateway_smoke',
      );

      expect(result.exitCode).toBe(1);
      expect(parsed.ok).toBe(false);
      expect(providerStep).toMatchObject({
        name: 'codex_gateway_smoke',
        ok: false,
      });
      expect(providerStep.details.stdout).toContain('Bearer [REDACTED]');
      expect(providerStep.details.stderr).toContain('[REDACTED_OPENAI_KEY]');
      expect(providerStep.details.commandError).toContain('Command failed');
      expect(result.stdout).not.toContain('eyJaaaaaaaaaaaaaaaa');
      expect(result.stdout).not.toContain('sk-testsecretvalue1234567890');
      expect(result.stdout).not.toContain('secret-product-jwt-value');
    });
  });
});
