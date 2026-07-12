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
  openaiApiKey?: string;
  codexFiles?: { configToml: string; authJson: string };
  localAdminUsername: string;
  codexConfig?: {
    modelProvider: string;
    model: string;
    reviewModel: string;
    reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
    baseUrl: string;
    wireApi: 'responses';
    requiresOpenaiAuth: boolean;
    disableResponseStorage: boolean;
    networkAccess: 'enabled' | 'disabled';
    goals: boolean;
  };
}

export interface IncusManagedInventory {
  instances: Array<{
    id: string;
    status: string;
    snapshots: string[];
  }>;
}

const defaultCodexConfig: NonNullable<GuestProvisionInput['codexConfig']> = {
  modelProvider: 'OpenAI',
  model: 'gpt-5.4',
  reviewModel: 'gpt-5.4',
  reasoningEffort: 'medium',
  baseUrl: 'https://api.openai.com/v1',
  wireApi: 'responses',
  requiresOpenaiAuth: true,
  disableResponseStorage: true,
  networkAccess: 'enabled',
  goals: true,
};

export class IncusCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

export class IncusClient {
  private capacityQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: IncusHostAgentConfig,
    private readonly runner: CommandRunner,
  ) {}

  async capability() {
    const version = await this.run(['version']);
    await this.run(['project', 'show', this.config.project]);
    const managed = await this.listManaged();
    return {
      available: true,
      project: this.config.project,
      imageVersion: this.config.imageVersion,
      incusVersion: version.stdout.trim(),
      limits: {
        maxCpu: this.config.maxCpu,
        maxMemoryMiB: this.config.maxMemoryMiB,
        maxDiskGiB: this.config.maxDiskGiB,
        maxInstances: this.config.maxInstances,
        maxRunningInstances: this.config.maxRunningInstances,
      },
      capacity: {
        totalInstances: managed.length,
        runningInstances: managed.filter(
          (instance) => instance.status.toLowerCase() === 'running',
        ).length,
      },
    };
  }

  async inventory(): Promise<IncusManagedInventory> {
    const managed = await this.listManaged();
    return {
      instances: await Promise.all(
        managed.map(async (instance) => {
          const snapshots = await this.run([
            'snapshot',
            'list',
            instance.name,
            '--format=json',
          ]);
          return {
            id: instance.name.slice(this.config.instancePrefix.length),
            status: instance.status,
            snapshots: (
              JSON.parse(snapshots.stdout) as Array<{ name?: string }>
            )
              .map((snapshot) => snapshot.name)
              .filter((name): name is string => typeof name === 'string'),
          };
        }),
      ),
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
    return this.withCapacityLock(async () => {
      const selected = validateResources(this.config, resources);
      const name = instanceName(this.config, id);
      const existing = await this.statusOrNull(id);
      if (existing) {
        return existing;
      }
      const managed = await this.listManaged();
      if (managed.length >= this.config.maxInstances) {
        throw new Error('The hosted instance capacity limit has been reached.');
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
    });
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
    return this.withCapacityLock(async () => {
      const current = await this.status(id);
      if (current.status.toLowerCase() !== 'running') {
        const running = (await this.listManaged()).filter(
          (instance) => instance.status.toLowerCase() === 'running',
        );
        if (running.length >= this.config.maxRunningInstances) {
          throw new Error(
            'The hosted running instance limit has been reached.',
          );
        }
        await this.run(['start', current.name]);
      }
      return this.status(id);
    });
  }

  async stop(id: string): Promise<IncusInstanceStatus> {
    const current = await this.status(id);
    if (current.status.toLowerCase() !== 'stopped') {
      // Incus' ACPI stop request is not reliable on every KVM host/image
      // combination. Ask systemd inside the guest to power off first so the
      // supervisor gets its normal SIGTERM/SQLite shutdown path, then let
      // Incus wait for the VM transition. A bounded force-stop is only the
      // final fallback when the guest cannot complete a graceful shutdown.
      await this.runBestEffort([
        'exec',
        current.name,
        '--',
        'systemctl',
        'poweroff',
      ]);
      const afterPoweroff = await this.status(id);
      if (afterPoweroff.status.toLowerCase() === 'stopped') {
        return afterPoweroff;
      }
      try {
        await this.run(['stop', current.name, '--timeout', '120']);
      } catch {
        const afterGrace = await this.status(id);
        if (afterGrace.status.toLowerCase() !== 'stopped') {
          await this.run(['stop', current.name, '--force']);
        }
      }
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
    await this.waitForGuestAgent(current.name);
    // The guest agent is reachable before first-boot cloud-init has finished.
    // Wait for cloud-init so provisioning cannot race guest initialization.
    await this.run([
      'exec',
      current.name,
      '--',
      'cloud-init',
      'status',
      '--wait',
    ]);
    // Keep existing VMs compatible when the provisioning contract evolves.
    // The helper contains no credentials; secrets still travel only on stdin.
    await this.run([
      'file',
      'push',
      this.config.guestProvisionScript,
      `${current.name}/usr/local/sbin/remote-codex-provision`,
      '--mode=0700',
      '--uid=0',
      '--gid=0',
    ]);
    await this.run(
      ['exec', current.name, '--', '/usr/local/sbin/remote-codex-provision'],
      `${JSON.stringify({
        ...provision,
        codexConfig: provision.codexConfig ?? defaultCodexConfig,
      })}\n`,
    );
    return { id, provisioned: true };
  }

  async readCodexFiles(id: string) {
    const current = await this.requireRunningInstance(id);
    const [config, auth] = await Promise.all([
      this.run([
        'exec',
        current.name,
        '--',
        'cat',
        '/home/remote-codex/.codex/config.toml',
      ]),
      this.run([
        'exec',
        current.name,
        '--',
        'cat',
        '/home/remote-codex/.codex/auth.json',
      ]),
    ]);
    return { configToml: config.stdout, authJson: auth.stdout };
  }

  async writeCodexFiles(
    id: string,
    files: { configToml: string; authJson: string },
  ) {
    const current = await this.requireRunningInstance(id);
    await this.run(
      [
        'exec',
        current.name,
        '--',
        'sh',
        '-c',
        `set -eu; umask 077; payload=$(mktemp); config=$(mktemp /home/remote-codex/.codex/.config.toml.XXXXXX); auth=$(mktemp /home/remote-codex/.codex/.auth.json.XXXXXX); trap 'rm -f "$payload" "$config" "$auth"' EXIT; cat >"$payload"; jq -j .configToml "$payload" >"$config"; jq -j .authJson "$payload" >"$auth"; chown remote-codex:remote-codex "$config" "$auth"; chmod 0600 "$config" "$auth"; mv "$config" /home/remote-codex/.codex/config.toml; mv "$auth" /home/remote-codex/.codex/auth.json`,
      ],
      JSON.stringify(files),
    );
    return { id, updated: true };
  }

  async delete(id: string): Promise<{ id: string; deleted: boolean }> {
    const current = await this.statusOrNull(id);
    if (!current) {
      return { id, deleted: false };
    }
    await this.run(['delete', current.name, '--force']);
    return { id, deleted: true };
  }

  private async requireRunningInstance(id: string) {
    const current = await this.status(id);
    if (current.status.toLowerCase() !== 'running') {
      throw new Error('The instance must be running to manage backend files.');
    }
    await this.waitForGuestAgent(current.name);
    return current;
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

  private async listManaged() {
    const result = await this.run(['list', '--format=json']);
    const prefix = this.config.instancePrefix;
    const managedName = new RegExp(
      `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
      'i',
    );
    return (
      JSON.parse(result.stdout) as Array<{ name?: string; status?: string }>
    )
      .filter(
        (instance): instance is { name: string; status?: string } =>
          typeof instance.name === 'string' && managedName.test(instance.name),
      )
      .map((instance) => ({
        name: instance.name,
        status: instance.status ?? 'Unknown',
      }));
  }

  private async withCapacityLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.capacityQueue;
    let release: () => void = () => {};
    this.capacityQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
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

  private async runBestEffort(args: readonly string[]) {
    try {
      await this.runner.run(
        this.config.incusBinary,
        ['--force-local', '--project', this.config.project, ...args],
        Math.min(this.config.commandTimeoutMs, 30_000),
      );
    } catch {
      // A guest poweroff can close the Incus exec channel before it returns.
      // The authoritative result is the instance status checked by stop().
    }
  }

  private async waitForGuestAgent(instance: string) {
    const args = [
      '--force-local',
      '--project',
      this.config.project,
      'exec',
      instance,
      '--',
      'true',
    ];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const result = await this.runner.run(
          this.config.incusBinary,
          args,
          Math.min(this.config.commandTimeoutMs, 10_000),
        );
        if (result.exitCode === 0) {
          return;
        }
      } catch {
        // The VM can be Running before incus-agent has connected.
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error('The guest agent did not become ready for provisioning.');
  }
}
