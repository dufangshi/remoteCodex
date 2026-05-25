import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

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

function minimalChecklist() {
  return [
    '- [x] D0.01 Already done.',
    '- [ ] S3.04 Finalize AWS staging configuration.',
    '- [ ] S3.05 Add least-privilege Kubernetes credentials.',
    '- [ ] S3.06 Create a real worker Pod from the control plane.',
    '- [ ] R5.10 Deploy sandbox-router in staging.',
    '- [ ] G6.11 Run staging Codex gateway smoke.',
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

describe('phase zero-six evidence tooling', () => {
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
    expect(checklist).toContain('- [ ] R5.10 Deploy sandbox-router in staging.');
    expect(checklist).toContain('- [ ] G6.11 Run staging Codex gateway smoke.');
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
    expect(parsed.readyGroups).toEqual([
      'aws-preflight',
      'runtime-smoke',
      'direct-worker-denial',
      'codex-provider-smoke',
      'claude-provider-smoke',
      'opencode-provider-smoke',
    ]);
    expect(result.stdout).not.toContain('secret-product-jwt-value');
    expect(result.stdout).not.toContain('secret-admin-jwt-value');
  });
});
