import type { RelayHostedSandboxReconciliationDto } from '../../../packages/shared/src/index';
import type { RelayServerConfig } from './config';
import type { HostedSandboxProvider } from './hosted-sandbox-provider';
import { RelayStore, RelayStoreError } from './relay-store';

export class HostedSandboxReconciler {
  private latest: RelayHostedSandboxReconciliationDto = emptyReport();
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<RelayHostedSandboxReconciliationDto> | null = null;

  constructor(
    private readonly store: RelayStore,
    private readonly provider: HostedSandboxProvider,
    private readonly config: RelayServerConfig['hostedSandbox'],
  ) {}

  start() {
    if (this.timer || this.config.provider === 'disabled') return;
    void this.run();
    this.timer = setInterval(
      () => void this.run(),
      this.config.reconcileIntervalMs,
    );
    this.timer.unref?.();
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  read() {
    return this.latest;
  }

  run(): Promise<RelayHostedSandboxReconciliationDto> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performAudit().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async deleteOrphanInstance(id: string) {
    const report = await this.run();
    if (!report.orphanInstances.some((instance) => instance.id === id)) {
      throw new RelayStoreError(
        409,
        'conflict',
        'The instance is no longer an orphan.',
      );
    }
    await this.provider.delete(id, `relay-orphan-instance-delete-${id}`);
    return this.performAudit();
  }

  async deleteOrphanCredential(credentialRef: string) {
    const report = await this.run();
    if (
      !report.orphanCredentials.some(
        (credential) => credential.credentialRef === credentialRef,
      )
    ) {
      throw new RelayStoreError(
        409,
        'conflict',
        'The credential is no longer an orphan.',
      );
    }
    await this.provider.deleteCredential(
      credentialRef,
      `relay-orphan-credential-delete-${credentialRef}`,
    );
    return this.performAudit();
  }

  private async performAudit(): Promise<RelayHostedSandboxReconciliationDto> {
    try {
      const expected = this.store.listHostedProviderRecords();
      const inventory = await this.provider.inventory();
      const expectedIds = new Set(expected.map((record) => record.id));
      const expectedCredentials = new Set(
        expected.map((record) => record.credentialRef),
      );
      const instanceIds = new Set(
        inventory.instances.map((instance) => instance.id),
      );
      const credentialRefs = new Set(
        inventory.credentials.map((credential) => credential.credentialRef),
      );
      const orphanInstances = inventory.instances.filter(
        (instance) => !expectedIds.has(instance.id),
      );
      const orphanCredentials = inventory.credentials.filter(
        (credential) => !expectedCredentials.has(credential.credentialRef),
      );
      const missingInstanceSandboxIds = expected
        .filter((record) => !instanceIds.has(record.id))
        .map((record) => record.id);
      const missingCredentialSandboxIds = expected
        .filter((record) => !credentialRefs.has(record.credentialRef))
        .map((record) => record.id);
      const hasIssues =
        orphanInstances.length > 0 ||
        orphanCredentials.length > 0 ||
        missingInstanceSandboxIds.length > 0 ||
        missingCredentialSandboxIds.length > 0;
      this.latest = {
        status: hasIssues ? 'issues' : 'healthy',
        checkedAt: inventory.checkedAt,
        errorCode: null,
        missingInstanceSandboxIds,
        missingCredentialSandboxIds,
        orphanInstances,
        orphanCredentials,
        orphanSnapshotCount: orphanInstances.reduce(
          (count, instance) => count + instance.snapshots.length,
          0,
        ),
      };
    } catch {
      this.latest = {
        ...emptyReport(),
        status: 'unavailable',
        checkedAt: new Date().toISOString(),
        errorCode: 'hosted_inventory_unavailable',
      };
    }
    return this.latest;
  }
}

function emptyReport(): RelayHostedSandboxReconciliationDto {
  return {
    status: 'never_run',
    checkedAt: null,
    errorCode: null,
    missingInstanceSandboxIds: [],
    missingCredentialSandboxIds: [],
    orphanInstances: [],
    orphanCredentials: [],
    orphanSnapshotCount: 0,
  };
}
