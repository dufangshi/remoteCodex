import fs from 'node:fs/promises';
import path from 'node:path';

import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  CodexHostFileDto,
  CodexHostFileNameDto,
  HealthDto,
  RuntimeConfigDto,
  UpdateCodexHostFileInput,
  VersionDto
} from '../../../../packages/shared/src/index';

const codexHostFileNameSchema = z.enum(['config.toml', 'auth.json']);
const updateCodexHostFileSchema = z.object({
  content: z.string(),
});

function resolveCodexHostFilePath(codexHome: string, name: CodexHostFileNameDto) {
  return path.join(codexHome, name);
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
}
