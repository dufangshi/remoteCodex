import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { AgentProviderId, AgentRuntimeRegistry } from '../../../packages/agent-runtime/src/index';
import {
  AgentRuntimeStatusDto,
  ApplyProviderHostConfigArchiveResultDto,
  CreateProviderHostConfigArchiveInput,
  ProviderHostConfigArchiveDto,
  ProviderHostFileDto,
  ProviderHostFileNameDto,
  RenameProviderHostConfigArchiveInput,
  UpdateProviderHostFileInput,
} from '../../../packages/shared/src/index';

interface ArchiveIndex {
  archives: ProviderHostConfigArchiveDto[];
}

type ProviderHomeMap = Partial<Record<AgentProviderId, string>>;

function providerError(message: string, statusCode = 404) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function resolveProviderHostFilePath(providerHome: string, name: ProviderHostFileNameDto) {
  return path.join(providerHome, name);
}

function resolveArchiveRoot(providerHome: string) {
  return path.join(providerHome, 'supervisor-config-archives');
}

function resolveArchiveIndexPath(providerHome: string) {
  return path.join(resolveArchiveRoot(providerHome), 'index.json');
}

function resolveArchivePath(providerHome: string, archiveId: string) {
  return path.join(resolveArchiveRoot(providerHome), archiveId);
}

function defaultArchiveLabel(createdAt: string) {
  return `Backup ${createdAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`;
}

async function readArchiveIndex(providerHome: string): Promise<ArchiveIndex> {
  try {
    const raw = await fs.readFile(resolveArchiveIndexPath(providerHome), 'utf8');
    const parsed = JSON.parse(raw) as ArchiveIndex;
    return {
      archives: Array.isArray(parsed.archives) ? parsed.archives : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    return { archives: [] };
  }
}

async function writeArchiveIndex(providerHome: string, index: ArchiveIndex) {
  const root = resolveArchiveRoot(providerHome);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    resolveArchiveIndexPath(providerHome),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
  );
}

async function findArchiveOrThrow(providerHome: string, id: string) {
  const index = await readArchiveIndex(providerHome);
  const archive = index.archives.find((entry) => entry.id === id);

  if (!archive) {
    throw providerError('Config archive not found.');
  }

  return { index, archive };
}

function runtimeStatusDto(status: ReturnType<ReturnType<AgentRuntimeRegistry['get']>['getStatus']>): AgentRuntimeStatusDto {
  return {
    state: status.state,
    transport: status.transport,
    lastStartedAt: status.lastStartedAt,
    lastError: status.lastError,
    restartCount: status.restartCount,
  };
}

export class ProviderHostConfigService {
  constructor(
    private readonly agentRuntimes: AgentRuntimeRegistry,
    private readonly providerHomes: ProviderHomeMap,
  ) {}

  private runtime(provider: AgentProviderId) {
    const runtime = this.agentRuntimes.getOptional(provider);
    if (!runtime) {
      throw providerError(`Agent runtime provider is not configured: ${provider}`);
    }
    return runtime;
  }

  private providerHome(provider: AgentProviderId) {
    const home = this.providerHomes[provider];
    if (!home) {
      throw providerError('This backend does not expose host config files.');
    }
    return home;
  }

  private hostFileNames(provider: AgentProviderId) {
    const runtime = this.runtime(provider);
    if (!runtime.capabilities.management.hostConfigFiles) {
      throw providerError('This backend does not expose host config files.');
    }
    return runtime.managementSchema.hostConfigFiles.map((file) => file.name);
  }

  private assertHostFile(provider: AgentProviderId, name: string) {
    const fileNames = this.hostFileNames(provider);
    if (!fileNames.includes(name)) {
      throw providerError('Host config file is not exposed by this backend.', 400);
    }
    return name;
  }

  private archiveFileNames(provider: AgentProviderId) {
    const runtime = this.runtime(provider);
    if (!runtime.managementSchema.configArchives) {
      throw providerError('This backend does not support config archives.');
    }
    return this.hostFileNames(provider);
  }

  async readFile(provider: AgentProviderId, name: string): Promise<ProviderHostFileDto> {
    const providerHome = this.providerHome(provider);
    const fileName = this.assertHostFile(provider, name);
    const filePath = resolveProviderHostFilePath(providerHome, fileName);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      return {
        name: fileName,
        path: filePath,
        exists: true,
        content,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      return {
        name: fileName,
        path: filePath,
        exists: false,
        content: '',
      };
    }
  }

  async updateFile(
    provider: AgentProviderId,
    name: string,
    input: UpdateProviderHostFileInput,
  ): Promise<ProviderHostFileDto> {
    const providerHome = this.providerHome(provider);
    const fileName = this.assertHostFile(provider, name);
    const filePath = resolveProviderHostFilePath(providerHome, fileName);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.content, 'utf8');

    return this.readFile(provider, fileName);
  }

  async listArchives(provider: AgentProviderId): Promise<ProviderHostConfigArchiveDto[]> {
    const runtime = this.runtime(provider);
    if (!runtime.managementSchema.configArchives) {
      return [];
    }
    const index = await readArchiveIndex(this.providerHome(provider));
    return index.archives;
  }

  async createArchive(
    provider: AgentProviderId,
    input: CreateProviderHostConfigArchiveInput,
  ): Promise<ProviderHostConfigArchiveDto> {
    const providerHome = this.providerHome(provider);
    const fileNames = this.archiveFileNames(provider);
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const archivePath = resolveArchivePath(providerHome, id);
    const files = Object.fromEntries(
      fileNames.map((name) => [
        name,
        {
          name,
          exists: false,
        },
      ]),
    ) as ProviderHostConfigArchiveDto['files'];

    await fs.mkdir(archivePath, { recursive: true });

    for (const name of fileNames) {
      const hostFile = await this.readFile(provider, name);
      files[name] = {
        name,
        exists: hostFile.exists,
      };
      if (hostFile.exists) {
        await fs.writeFile(path.join(archivePath, name), hostFile.content, 'utf8');
      }
    }

    const archive: ProviderHostConfigArchiveDto = {
      id,
      label: input.label ?? defaultArchiveLabel(createdAt),
      createdAt,
      updatedAt: createdAt,
      files,
    };
    const index = await readArchiveIndex(providerHome);
    await writeArchiveIndex(providerHome, {
      archives: [archive, ...index.archives],
    });

    return archive;
  }

  async renameArchive(
    provider: AgentProviderId,
    id: string,
    input: RenameProviderHostConfigArchiveInput,
  ): Promise<ProviderHostConfigArchiveDto> {
    const providerHome = this.providerHome(provider);
    this.archiveFileNames(provider);
    const { index, archive } = await findArchiveOrThrow(providerHome, id);
    const updated: ProviderHostConfigArchiveDto = {
      ...archive,
      label: input.label,
      updatedAt: new Date().toISOString(),
    };

    await writeArchiveIndex(providerHome, {
      archives: index.archives.map((entry) => (entry.id === id ? updated : entry)),
    });

    return updated;
  }

  async applyArchive(
    provider: AgentProviderId,
    id: string,
  ): Promise<ApplyProviderHostConfigArchiveResultDto> {
    const runtime = this.runtime(provider);
    const providerHome = this.providerHome(provider);
    const fileNames = this.archiveFileNames(provider);
    const { archive } = await findArchiveOrThrow(providerHome, id);
    const archivePath = resolveArchivePath(providerHome, archive.id);

    await fs.mkdir(providerHome, { recursive: true });
    for (const name of fileNames) {
      const hostPath = resolveProviderHostFilePath(providerHome, name);
      if (archive.files[name]?.exists) {
        const content = await fs.readFile(path.join(archivePath, name), 'utf8');
        await fs.writeFile(hostPath, content, 'utf8');
      } else {
        await fs.rm(hostPath, { force: true });
      }
    }

    await runtime.stop();
    await runtime.start();

    return {
      archive,
      status: runtimeStatusDto(runtime.getStatus()),
    };
  }
}
