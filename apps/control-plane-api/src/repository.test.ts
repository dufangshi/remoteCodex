import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDatabase, runMigrations } from '../../../packages/db/src/index';
import { ControlPlaneRepository } from './repository';

function createRepository(name: string) {
  const databaseUrl = path.join(
    os.tmpdir(),
    `remote-codex-control-plane-repository-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  runMigrations(databaseUrl);
  const database = createDatabase(databaseUrl);
  return {
    database,
    repository: new ControlPlaneRepository(database.db),
  };
}

describe('ControlPlaneRepository Harness records', () => {
  it('persists Harness users, sandbox keys, rotation, revocation, usage, and non-secret audit metadata', () => {
    const { database, repository } = createRepository('harness-lifecycle');
    try {
      const user = repository.upsertUser({
        authProvider: 'dev',
        authSubject: 'harness-user',
        email: 'harness-user@example.test',
        displayName: 'Harness User',
      });
      const sandbox = repository.ensureSandboxForUser(user.id, {
        image: 'remote-codex-worker:test',
        region: 'local',
        resourceProfile: 'standard',
        s3PrefixBase: 's3://remote-codex-test',
      });

      const harnessUser = repository.upsertHarnessUser({
        userId: user.id,
        provider: 'elagente-harness',
        externalUserId: 'remote-codex:user:harness-user',
      });
      const secondHarnessUser = repository.upsertHarnessUser({
        userId: user.id,
        provider: 'elagente-harness',
        externalUserId: 'remote-codex:user:harness-user-new',
      });
      expect(secondHarnessUser).toEqual(harnessUser);
      expect(repository.getHarnessUserForUser({
        userId: user.id,
        provider: 'elagente-harness',
      })).toEqual(harnessUser);

      const createdKey = repository.upsertHarnessKey({
        userId: user.id,
        sandboxId: sandbox.id,
        provider: 'elagente-harness',
        externalKeyId: 'remote-codex:sandbox:initial',
        keyCiphertext: null,
        secretName: 'remote-codex-harness-app-keys',
        secretKey: sandbox.id,
      });
      const duplicateKey = repository.upsertHarnessKey({
        userId: user.id,
        sandboxId: sandbox.id,
        provider: 'elagente-harness',
        externalKeyId: 'remote-codex:sandbox:duplicate',
      });
      expect(duplicateKey).toEqual(createdKey);
      expect(repository.getHarnessKeyForSandbox(sandbox.id)).toMatchObject({
        id: createdKey.id,
        status: 'active',
        externalKeyId: 'remote-codex:sandbox:initial',
        secretName: 'remote-codex-harness-app-keys',
        secretKey: sandbox.id,
      });

      const rotatedKey = repository.updateHarnessKeyRotation({
        sandboxId: sandbox.id,
        provider: 'elagente-harness',
        externalKeyId: 'remote-codex:sandbox:rotated',
        keyCiphertext: null,
        secretName: 'remote-codex-harness-app-keys',
        secretKey: sandbox.id,
      });
      expect(rotatedKey).toMatchObject({
        id: createdKey.id,
        status: 'active',
        externalKeyId: 'remote-codex:sandbox:rotated',
        revokedAt: null,
      });
      expect(rotatedKey?.rotatedAt).toEqual(expect.any(String));

      const usage = repository.recordHarnessUsageEvent({
        userId: user.id,
        sandboxId: sandbox.id,
        workspaceId: null,
        sessionId: null,
        provider: 'elagente-harness',
        module: 'farmaco',
        tool: 'generate_ligand_xyz',
        runId: 'run-1',
        jobId: 'job-1',
        externalEventId: 'event-1',
        computeUnits: 2,
        costUsd: 0.25,
        status: 'ok',
        metadata: { resultStatus: 'ok' },
        occurredAt: '2026-06-03T00:00:00.000Z',
      });
      const duplicateUsage = repository.recordHarnessUsageEvent({
        userId: user.id,
        sandboxId: sandbox.id,
        provider: 'elagente-harness',
        module: 'farmaco',
        externalEventId: 'event-1',
      });
      expect(duplicateUsage).toEqual(usage);
      expect(repository.harnessUsageSummaryForUser(user.id)).toMatchObject({
        eventCount: 1,
        computeUnits: 2,
        costUsd: 0.25,
      });
      expect(repository.listHarnessUsageEventsForUser(user.id, 10)).toHaveLength(1);

      const revokedKey = repository.revokeHarnessKey({
        sandboxId: sandbox.id,
        provider: 'elagente-harness',
      });
      expect(revokedKey).toMatchObject({
        id: createdKey.id,
        status: 'revoked',
        externalKeyId: 'remote-codex:sandbox:rotated',
      });
      expect(revokedKey?.revokedAt).toEqual(expect.any(String));

      const audits = repository.listAuditLogs({});
      expect(audits.map((audit) => audit.action)).toEqual(
        expect.arrayContaining([
          'harness_key.created',
          'harness_key.rotated',
          'harness.usage_recorded',
          'harness_key.revoked',
        ]),
      );
      const serializedAudits = JSON.stringify(audits);
      expect(serializedAudits).toContain('remote-codex-harness-app-keys');
      expect(serializedAudits).toContain(sandbox.id);
      expect(serializedAudits).not.toContain('harness-api-key-secret');
      expect(serializedAudits).not.toContain('INACT_X_APP_KEY');
    } finally {
      database.sqlite.close();
    }
  });
});
