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
  try {
    const result = await execFileAsync('pnpm', ['exec', 'tsx', script, ...args], {
      cwd: repoRoot,
      timeout: 30_000,
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
});
