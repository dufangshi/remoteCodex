import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  ApplyCodexHostConfigArchiveResultDto,
  CodexHostConfigArchiveDto,
  CodexHostFileDto,
  CodexHostFileNameDto,
  CodexStatusDto,
  CreateCodexHostConfigArchiveInput,
  HealthDto,
  RenameCodexHostConfigArchiveInput,
  RuntimeConfigDto,
  UpdateCodexHostFileInput,
  VersionDto
} from '../../../../packages/shared/src/index';

const codexHostFileNameSchema = z.enum(['config.toml', 'auth.json']);
const codexHostFileNames = codexHostFileNameSchema.options;
const updateCodexHostFileSchema = z.object({
  content: z.string(),
});
const archiveIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const createCodexHostConfigArchiveSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
});
const renameCodexHostConfigArchiveSchema = z.object({
  label: z.string().trim().min(1).max(120),
});

interface ArchiveIndex {
  archives: CodexHostConfigArchiveDto[];
}

function resolveCodexHostFilePath(codexHome: string, name: CodexHostFileNameDto) {
  return path.join(codexHome, name);
}

function resolveArchiveRoot(codexHome: string) {
  return path.join(codexHome, 'supervisor-config-archives');
}

function resolveArchiveIndexPath(codexHome: string) {
  return path.join(resolveArchiveRoot(codexHome), 'index.json');
}

function resolveArchivePath(codexHome: string, archiveId: string) {
  return path.join(resolveArchiveRoot(codexHome), archiveId);
}

function codexStatusDto(app: FastifyInstance): CodexStatusDto {
  const status = app.services.codexManager.getStatus();

  return {
    state: status.state,
    transport: status.transport,
    lastStartedAt: status.lastStartedAt,
    lastError: status.lastError,
    restartCount: status.restartCount,
  };
}

function defaultArchiveLabel(createdAt: string) {
  return `Backup ${createdAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`;
}

async function readCodexHostFile(
  codexHome: string,
  name: CodexHostFileNameDto,
): Promise<CodexHostFileDto> {
  const filePath = resolveCodexHostFilePath(codexHome, name);

  try {
    const content = await fs.readFile(filePath, 'utf8');
    return {
      name,
      path: filePath,
      exists: true,
      content,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    return {
      name,
      path: filePath,
      exists: false,
      content: '',
    };
  }
}

async function readArchiveIndex(codexHome: string): Promise<ArchiveIndex> {
  try {
    const raw = await fs.readFile(resolveArchiveIndexPath(codexHome), 'utf8');
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

async function writeArchiveIndex(codexHome: string, index: ArchiveIndex) {
  const root = resolveArchiveRoot(codexHome);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    resolveArchiveIndexPath(codexHome),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
  );
}

async function findArchiveOrThrow(codexHome: string, id: string) {
  const index = await readArchiveIndex(codexHome);
  const archive = index.archives.find((entry) => entry.id === id);

  if (!archive) {
    const error = new Error('Config archive not found.');
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }

  return { index, archive };
}

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString()
    } satisfies HealthDto;
  });

  app.get('/api/version', async () => {
    return {
      name: app.services.config.appName,
      version: app.services.config.appVersion
    } satisfies VersionDto;
  });

  app.get('/api/config/runtime', async () => {
    return {
      appName: app.services.config.appName,
      appVersion: app.services.config.appVersion,
      host: app.services.config.host,
      port: app.services.config.port,
      workspaceRoot: app.services.config.workspaceRoot,
      environment: app.services.config.nodeEnv
    } satisfies RuntimeConfigDto;
  });

  app.get('/api/config/codex-files/:name', async (request) => {
    const params = z
      .object({
        name: codexHostFileNameSchema,
      })
      .parse(request.params);

    return readCodexHostFile(app.services.config.codexHome, params.name);
  });

  app.patch('/api/config/codex-files/:name', async (request) => {
    const params = z
      .object({
        name: codexHostFileNameSchema,
      })
      .parse(request.params);
    const body = updateCodexHostFileSchema.parse(request.body);
    const input: UpdateCodexHostFileInput = {
      content: body.content,
    };
    const filePath = resolveCodexHostFilePath(app.services.config.codexHome, params.name);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.content, 'utf8');

    return readCodexHostFile(app.services.config.codexHome, params.name);
  });

  app.get('/api/config/codex-archives', async () => {
    const index = await readArchiveIndex(app.services.config.codexHome);
    return index.archives;
  });

  app.post('/api/config/codex-archives', async (request) => {
    const body: CreateCodexHostConfigArchiveInput = {};
    const parsedBody = createCodexHostConfigArchiveSchema.parse(request.body ?? {});
    if (parsedBody.label !== undefined) {
      body.label = parsedBody.label;
    }
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const archivePath = resolveArchivePath(app.services.config.codexHome, id);
    const files = Object.fromEntries(
      codexHostFileNames.map((name) => [
        name,
        {
          name,
          exists: false,
        },
      ]),
    ) as CodexHostConfigArchiveDto['files'];

    await fs.mkdir(archivePath, { recursive: true });

    for (const name of codexHostFileNames) {
      const hostFile = await readCodexHostFile(app.services.config.codexHome, name);
      files[name] = {
        name,
        exists: hostFile.exists,
      };
      if (hostFile.exists) {
        await fs.writeFile(path.join(archivePath, name), hostFile.content, 'utf8');
      }
    }

    const archive: CodexHostConfigArchiveDto = {
      id,
      label: body.label ?? defaultArchiveLabel(createdAt),
      createdAt,
      updatedAt: createdAt,
      files,
    };
    const index = await readArchiveIndex(app.services.config.codexHome);
    await writeArchiveIndex(app.services.config.codexHome, {
      archives: [archive, ...index.archives],
    });

    return archive;
  });

  app.patch('/api/config/codex-archives/:id', async (request) => {
    const params = z
      .object({
        id: archiveIdSchema,
      })
      .parse(request.params);
    const body = renameCodexHostConfigArchiveSchema.parse(
      request.body,
    ) satisfies RenameCodexHostConfigArchiveInput;
    const { index, archive } = await findArchiveOrThrow(
      app.services.config.codexHome,
      params.id,
    );
    const updated: CodexHostConfigArchiveDto = {
      ...archive,
      label: body.label,
      updatedAt: new Date().toISOString(),
    };

    await writeArchiveIndex(app.services.config.codexHome, {
      archives: index.archives.map((entry) => (entry.id === params.id ? updated : entry)),
    });

    return updated;
  });

  app.post('/api/config/codex-archives/:id/apply', async (request) => {
    const params = z
      .object({
        id: archiveIdSchema,
      })
      .parse(request.params);
    const { archive } = await findArchiveOrThrow(
      app.services.config.codexHome,
      params.id,
    );
    const archivePath = resolveArchivePath(app.services.config.codexHome, archive.id);

    await fs.mkdir(app.services.config.codexHome, { recursive: true });
    for (const name of codexHostFileNames) {
      const hostPath = resolveCodexHostFilePath(app.services.config.codexHome, name);
      if (archive.files[name]?.exists) {
        const content = await fs.readFile(path.join(archivePath, name), 'utf8');
        await fs.writeFile(hostPath, content, 'utf8');
      } else {
        await fs.rm(hostPath, { force: true });
      }
    }

    await app.services.codexManager.stop();
    await app.services.codexManager.start();

    return {
      archive,
      status: codexStatusDto(app),
    } satisfies ApplyCodexHostConfigArchiveResultDto;
  });
}
