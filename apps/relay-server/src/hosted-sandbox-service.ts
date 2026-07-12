import crypto from 'node:crypto';

import type {
  RelayHostedCodexFilesDto,
  RelayHostedSandboxDetailDto,
  RelayHostedCodexConfigDto,
  RelayHostedSandboxOperationDto,
} from '../../../packages/shared/src/index';
import type { RelayServerConfig } from './config';
import {
  HostedSandboxProviderError,
  type HostedSandboxProvider,
} from './hosted-sandbox-provider';
import { RelayStore, RelayStoreError } from './relay-store';

export class HostedSandboxService {
  private readonly running = new Map<string, Promise<void>>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: RelayStore,
    private readonly provider: HostedSandboxProvider,
    private readonly config: RelayServerConfig['hostedSandbox'],
  ) {}

  list() {
    return this.store.listHostedSandboxes();
  }

  detail(id: string) {
    const detail = this.store.getHostedSandboxDetail(id);
    if (!detail) {
      throw new RelayStoreError(
        404,
        'not_found',
        'Hosted sandbox was not found.',
      );
    }
    return detail;
  }

  async create(input: {
    createdByAdminUserId: string;
    assignedUserIds: string[];
    deviceName: string;
    imageVersion: string;
    resources: { cpuCount: number; memoryMiB: number; diskGiB: number };
    codexFiles: RelayHostedCodexFilesDto;
  }): Promise<{
    sandbox: RelayHostedSandboxDetailDto;
    operation: RelayHostedSandboxOperationDto;
  }> {
    this.requireConfiguredRelayUrl();
    const requestId = crypto.randomUUID();
    const credentialRef = await this.provider.createCodexCredential(
      input.codexFiles,
      `relay-credential-${requestId}`,
    );
    try {
      const created = this.store.createHostedSandboxRequested({
        createdByAdminUserId: input.createdByAdminUserId,
        assignedUserIds: input.assignedUserIds,
        deviceName: input.deviceName,
        imageVersion: input.imageVersion,
        resources: input.resources,
        credentialRef,
      });
      this.schedule(created.sandbox.id, created.operation.id);
      return {
        sandbox: created.sandbox,
        operation: created.operation,
      };
    } catch (error) {
      await this.provider
        .deleteCredential(
          credentialRef,
          `relay-credential-compensate-${requestId}`,
        )
        .catch(() => undefined);
      throw error;
    }
  }

  updateMembers(id: string, userIds: string[]) {
    return this.store.setHostedSandboxMembers(id, userIds);
  }

  readCodexFiles(id: string) {
    this.detail(id);
    return this.provider.readCodexFiles(id);
  }

  async writeCodexFiles(id: string, files: RelayHostedCodexFilesDto) {
    this.detail(id);
    await this.provider.writeCodexFiles(
      id,
      files,
      `relay-codex-files-${crypto.randomUUID()}`,
    );
    return { updated: true };
  }

  retry(id: string) {
    this.detail(id);
    const operation = this.store.createHostedOperation(id, 'create');
    this.store.updateHostedSandboxStatus(id, 'requested');
    this.schedule(id, operation.id);
    return operation;
  }

  start(id: string) {
    const detail = this.detail(id);
    this.store.recordHostedUserActivity(
      detail.deviceId,
      this.config.idleTimeoutMs,
    );
    const operation = this.store.createHostedOperation(id, 'start');
    this.scheduleLifecycle(id, operation, async () => {
      this.store.updateHostedSandboxStatus(id, 'starting');
      await this.provider.start(
        id,
        `relay-sandbox-start-action-${operation.id}`,
      );
      this.store.updateHostedSandboxStatus(id, 'starting');
    });
    return operation;
  }

  stop(id: string) {
    this.detail(id);
    const operation = this.store.createHostedOperation(id, 'stop');
    this.scheduleLifecycle(id, operation, async () => {
      this.store.updateHostedSandboxStatus(id, 'stopping');
      await this.provider.stop(id, `relay-sandbox-stop-action-${operation.id}`);
      this.store.updateHostedSandboxStatus(id, 'stopped');
    });
    return operation;
  }

  snapshot(id: string, name: string) {
    this.detail(id);
    const operation = this.store.createHostedOperation(id, 'snapshot');
    this.scheduleLifecycle(id, operation, () =>
      this.provider.snapshot(
        id,
        name,
        `relay-sandbox-snapshot-${operation.id}`,
      ),
    );
    return operation;
  }

  delete(id: string) {
    const context = this.store.getHostedProvisionContext(id);
    if (!context) {
      throw new RelayStoreError(
        404,
        'not_found',
        'Hosted sandbox was not found.',
      );
    }
    const operation = this.store.createHostedOperation(id, 'delete');
    this.scheduleLifecycle(
      id,
      operation,
      async () => {
        this.store.updateHostedSandboxStatus(id, 'deleting');
        await this.provider.delete(id, `relay-sandbox-delete-${operation.id}`);
        await this.provider.deleteCredential(
          context.credentialRef,
          `relay-credential-delete-${operation.id}`,
        );
        this.store.updateHostedOperation(operation.id, 'succeeded');
        this.store.deleteHostedSandboxRecord(id);
      },
      { operationCompletesInside: true },
    );
    return operation;
  }

  async rotateCredential(id: string, openaiApiKey: string) {
    const context = this.store.getHostedProvisionContext(id);
    if (!context) {
      throw new RelayStoreError(
        404,
        'not_found',
        'Hosted sandbox was not found.',
      );
    }
    if (this.running.has(id)) {
      throw new RelayStoreError(
        409,
        'conflict',
        'Another Hosted supervisor VM operation is already running.',
      );
    }
    const relayServerUrl = this.requireConfiguredRelayUrl();
    const operation = this.store.createHostedOperation(id, 'rotate_credential');
    let credentialRef: string;
    try {
      credentialRef = await this.provider.createCredential(
        openaiApiKey,
        `relay-credential-rotate-${operation.id}`,
      );
    } catch {
      this.store.updateHostedOperation(operation.id, 'failed', {
        code: 'hosted_sandbox_rotate_credential_failed',
        message: 'Hosted supervisor VM credential rotation failed.',
      });
      throw new RelayStoreError(
        502,
        'service_unavailable',
        'Hosted supervisor VM credential rotation failed.',
      );
    }
    this.scheduleLifecycle(id, operation, async () => {
      await this.provider.provision(
        {
          id,
          relayServerUrl,
          relayAgentToken: context.deviceToken,
          credentialRef,
          codexConfig: context.codexConfig,
        },
        `relay-sandbox-reprovision-${operation.id}`,
      );
      const previousRef = this.store.replaceHostedCredentialRef(
        id,
        credentialRef,
      );
      await this.provider.deleteCredential(
        previousRef,
        `relay-credential-retire-${operation.id}`,
      );
    });
    return operation;
  }

  reconcilePending() {
    for (const id of this.store.listHostedSandboxesNeedingReconciliation()) {
      const detail = this.store.getHostedSandboxDetail(id);
      const operation =
        detail?.operations.find((candidate) => candidate.action === 'create') ??
        this.store.createHostedOperation(id, 'create');
      this.schedule(id, operation.id);
    }
    this.restoreIdleTimers();
  }

  close() {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
  }

  markOnline(deviceId: string) {
    this.store.markHostedDeviceOnline(deviceId);
    const sandbox = this.store.getHostedSandboxByDeviceId(deviceId);
    if (!sandbox) return;
    const armed = this.store.armHostedIdleDeadline(
      sandbox.id,
      this.config.idleTimeoutMs,
    );
    if (armed?.idleDeadlineAt) {
      this.scheduleIdleTimer(armed.id, armed.idleDeadlineAt);
    }
  }

  recordUserActivity(deviceId: string) {
    const sandbox = this.store.recordHostedUserActivity(
      deviceId,
      this.config.idleTimeoutMs,
    );
    if (!sandbox) return { hosted: false, waking: false };
    if (sandbox.idleDeadlineAt && sandbox.status === 'online') {
      this.scheduleIdleTimer(sandbox.id, sandbox.idleDeadlineAt);
    }
    if (sandbox.status === 'stopped') {
      this.start(sandbox.id);
      return { hosted: true, waking: true };
    }
    return {
      hosted: true,
      waking: ['requested', 'creating', 'starting', 'provisioning'].includes(
        sandbox.status,
      ),
    };
  }

  wakeIfStopped(deviceId: string) {
    const sandbox = this.store.getHostedSandboxByDeviceId(deviceId);
    if (!sandbox) return { hosted: false, waking: false };
    if (sandbox.status === 'stopped') {
      this.start(sandbox.id);
      return { hosted: true, waking: true };
    }
    return {
      hosted: true,
      waking: ['requested', 'creating', 'starting', 'provisioning'].includes(
        sandbox.status,
      ),
    };
  }

  recordTurnActivity(input: {
    deviceId: string;
    threadId: string;
    turnId: string;
    kind: 'turn_started' | 'turn_terminal';
  }) {
    const sandbox = this.store.recordHostedTurnActivity({
      ...input,
      idleTimeoutMs: this.config.idleTimeoutMs,
    });
    if (!sandbox) return;
    if (sandbox.activeTurnCount > 0) {
      this.clearIdleTimer(sandbox.id);
    } else if (sandbox.idleDeadlineAt && sandbox.status === 'online') {
      this.scheduleIdleTimer(sandbox.id, sandbox.idleDeadlineAt);
    }
  }

  private schedule(sandboxId: string, operationId: string) {
    if (this.running.has(sandboxId)) {
      return;
    }
    const promise = this.runCreateSaga(sandboxId, operationId).finally(() => {
      this.running.delete(sandboxId);
    });
    this.running.set(sandboxId, promise);
  }

  private scheduleLifecycle(
    sandboxId: string,
    operation: RelayHostedSandboxOperationDto,
    action: () => Promise<void>,
    options: { operationCompletesInside?: boolean } = {},
  ) {
    if (this.running.has(sandboxId)) {
      throw new RelayStoreError(
        409,
        'conflict',
        'Another Hosted supervisor VM operation is already running.',
      );
    }
    const promise = (async () => {
      try {
        this.store.updateHostedOperation(operation.id, 'running');
        await action();
        if (!options.operationCompletesInside) {
          this.store.updateHostedOperation(operation.id, 'succeeded');
        }
      } catch {
        const error = {
          code: `hosted_sandbox_${operation.action}_failed`,
          message: `Hosted supervisor VM ${operation.action} failed.`,
        };
        this.store.updateHostedOperation(operation.id, 'failed', error);
        this.store.updateHostedSandboxStatus(sandboxId, 'error', {
          errorCode: error.code,
          errorMessage: error.message,
        });
      }
    })().finally(() => this.running.delete(sandboxId));
    this.running.set(sandboxId, promise);
  }

  private restoreIdleTimers() {
    for (const candidate of this.store.listHostedIdleDeadlines()) {
      const normalized = this.store.armHostedIdleDeadline(
        candidate.id,
        this.config.idleTimeoutMs,
      );
      if (normalized?.idleDeadlineAt && normalized.status === 'online') {
        this.scheduleIdleTimer(normalized.id, normalized.idleDeadlineAt);
      }
    }
  }

  private scheduleIdleTimer(sandboxId: string, deadlineAt: string) {
    this.clearIdleTimer(sandboxId);
    const delay = Math.max(0, new Date(deadlineAt).getTime() - Date.now());
    const timer = setTimeout(() => {
      this.idleTimers.delete(sandboxId);
      void this.handleIdleDeadline(sandboxId);
    }, delay);
    timer.unref?.();
    this.idleTimers.set(sandboxId, timer);
  }

  private clearIdleTimer(sandboxId: string) {
    const timer = this.idleTimers.get(sandboxId);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(sandboxId);
  }

  private async handleIdleDeadline(sandboxId: string) {
    if (this.running.has(sandboxId)) return;
    const candidate = this.store
      .listHostedIdleDeadlines()
      .find((entry) => entry.id === sandboxId);
    if (
      !candidate ||
      !this.store.claimHostedIdleStop(
        sandboxId,
        candidate.generation,
        new Date(),
      )
    ) {
      return;
    }
    const operation = this.store.createHostedOperation(sandboxId, 'stop');
    this.scheduleLifecycle(sandboxId, operation, async () => {
      await this.provider.stop(
        sandboxId,
        `relay-sandbox-idle-stop-${operation.id}`,
      );
      this.store.updateHostedSandboxStatus(sandboxId, 'stopped');
    });
  }

  private async runCreateSaga(sandboxId: string, operationId: string) {
    try {
      const context = this.store.getHostedProvisionContext(sandboxId);
      if (!context) {
        throw new Error('Hosted sandbox provision context is unavailable.');
      }
      const relayServerUrl = this.requireConfiguredRelayUrl();
      this.store.updateHostedOperation(operationId, 'running');
      this.store.updateHostedSandboxStatus(sandboxId, 'creating');
      const instance = await this.provider.create(
        {
          id: sandboxId,
          imageVersion: context.sandbox.imageVersion,
          resources: context.sandbox.resources,
        },
        `relay-sandbox-create-${sandboxId}`,
      );
      this.store.updateHostedSandboxStatus(sandboxId, 'starting', {
        providerInstanceId: instance.name,
      });
      await this.provider.start(sandboxId, `relay-sandbox-start-${sandboxId}`);
      this.store.updateHostedSandboxStatus(sandboxId, 'provisioning');
      await this.provider.provision(
        {
          id: sandboxId,
          relayServerUrl,
          relayAgentToken: context.deviceToken,
          credentialRef: context.credentialRef,
          codexConfig: context.codexConfig,
        },
        `relay-sandbox-provision-${sandboxId}`,
      );
      this.store.updateHostedOperation(operationId, 'succeeded');
      this.store.updateHostedSandboxStatus(sandboxId, 'starting');
    } catch (caught) {
      const detail =
        caught instanceof HostedSandboxProviderError &&
        caught.code === 'running_instance_limit_reached'
          ? caught.message
          : null;
      const error = {
        code: 'hosted_sandbox_create_failed',
        message: detail
          ? `Hosted supervisor VM creation failed: ${detail}`
          : 'Hosted supervisor VM creation failed.',
      };
      this.store.updateHostedOperation(operationId, 'failed', error);
      this.store.updateHostedSandboxStatus(sandboxId, 'error', {
        errorCode: error.code,
        errorMessage: error.message,
      });
    }
  }

  private requireConfiguredRelayUrl() {
    if (!this.config.relayServerUrl) {
      throw new RelayStoreError(
        503,
        'service_unavailable',
        'Hosted supervisor VM relay URL is not configured.',
      );
    }
    return this.config.relayServerUrl;
  }
}
