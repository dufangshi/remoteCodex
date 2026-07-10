import type { CommandRunner } from './command-runner';
import type { IncusHostAgentConfig } from './config';
import {
  instanceName,
  snapshotNameSchema,
  validateResources,
  type HostedInstanceResources,
} from './instance-policy';

export interface IncusInstanceStatus {
  id: string;
  name: string;
  status: string;
  statusCode: number | null;
}

export interface GuestProvisionInput {
  relayServerUrl: string;
  relayAgentToken: string;
  openaiApiKey: string;
  localAdminUsername: string;
}

export class IncusCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

export class IncusClient {
  constructor(
    private readonly config: IncusHostAgentConfig,
    private readonly runner: CommandRunner,
  ) {}

  async capability() {
    const version = await this.run(['version']);
    await this.run(['project', 'show', this.config.project]);
    return {
      available: true,
      project: this.config.project,
      imageVersion: this.config.imageVersion,
      incusVersion: version.stdout.trim(),
      limits: {
        maxCpu: this.config.maxCpu,
        maxMemoryMiB: this.config.maxMemoryMiB,
        maxDiskGiB: this.config.maxDiskGiB,
      },
    };
  }

  async create(
    id: string,
    imageVersion: string,
    resources: HostedInstanceResources,
  ): Promise<IncusInstanceStatus> {
    if (imageVersion !== this.config.imageVersion) {
      throw new Error('Requested image version is not allowed.');
    }
    const selected = validateResources(this.config, resources);
    const name = instanceName(this.config, id);
    const existing = await this.statusOrNull(id);
    if (existing) {
      return existing;
    }
    await this.run([
      'init',
      this.config.imageSource,
      name,
      '--vm',
      '--config',
      `limits.cpu=${selected.cpuCount}`,
      '--config',
      `limits.memory=${selected.memoryMiB}MiB`,
      '--device',
      `root,size=${selected.diskGiB}GiB`,
    ]);
    return this.status(id);
  }

  async status(id: string): Promise<IncusInstanceStatus> {
    const name = instanceName(this.config, id);
    const result = await this.run(['list', name, '--format=json']);
    const instances = JSON.parse(result.stdout) as Array<{
      status?: string;
      status_code?: number;
    }>;
    const parsed = instances[0];
    if (!parsed) {
      throw new IncusCommandError('Incus instance was not found.', 1);
    }
    return {
      id,
      name,
      status: parsed.status ?? 'Unknown',
      statusCode:
        typeof parsed.status_code === 'number' ? parsed.status_code : null,
    };
  }

  async start(id: string): Promise<IncusInstanceStatus> {
    const current = await this.status(id);
    if (current.status.toLowerCase() !== 'running') {
      await this.run(['start', current.name]);
    }
    return this.status(id);
  }

  async stop(id: string): Promise<IncusInstanceStatus> {
    const current = await this.status(id);
    if (current.status.toLowerCase() !== 'stopped') {
      await this.run(['stop', current.name, '--timeout', '120']);
    }
    return this.status(id);
  }

  async snapshot(
    id: string,
    snapshotName: string,
  ): Promise<{ id: string; name: string }> {
    const name = instanceName(this.config, id);
    const safeSnapshotName = snapshotNameSchema.parse(snapshotName);
    await this.run(['snapshot', 'create', name, safeSnapshotName, '--reuse']);
    return { id, name: safeSnapshotName };
  }

  async restoreSnapshot(
    id: string,
    snapshotName: string,
  ): Promise<IncusInstanceStatus> {
    const current = await this.status(id);
    if (current.status.toLowerCase() !== 'stopped') {
      throw new Error('The instance must be stopped before snapshot restore.');
    }
    const safeSnapshotName = snapshotNameSchema.parse(snapshotName);
    await this.run(['snapshot', 'restore', current.name, safeSnapshotName]);
    return this.status(id);
  }

  async provision(
    id: string,
    provision: GuestProvisionInput,
  ): Promise<{ id: string; provisioned: true }> {
    const current = await this.status(id);
    if (current.status.toLowerCase() !== 'running') {
      throw new Error('The instance must be running before provisioning.');
    }
    await this.run(
      ['exec', current.name, '--', '/usr/local/sbin/remote-codex-provision'],
      `${JSON.stringify(provision)}\n`,
    );
    return { id, provisioned: true };
  }

  async delete(id: string): Promise<{ id: string; deleted: boolean }> {
    const current = await this.statusOrNull(id);
    if (!current) {
      return { id, deleted: false };
    }
    await this.run(['delete', current.name, '--force']);
    return { id, deleted: true };
  }

  private async statusOrNull(id: string) {
    try {
      return await this.status(id);
    } catch (error) {
      if (error instanceof IncusCommandError && error.exitCode !== 0) {
        return null;
      }
      throw error;
    }
  }

  private async run(args: readonly string[], stdin?: string) {
    const result = await this.runner.run(
      this.config.incusBinary,
      ['--force-local', '--project', this.config.project, ...args],
      this.config.commandTimeoutMs,
      stdin,
    );
    if (result.exitCode !== 0) {
      throw new IncusCommandError('Incus operation failed.', result.exitCode);
    }
    return result;
  }
}
