import { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

import {
  type AgentRuntime,
  isAgentRuntimeEnabled,
} from '../../../../packages/agent-runtime/src/index';
import {
  AgentBackendDto,
  AgentBackendIdDto,
  defaultAgentBackendId,
  ModelOptionDto,
  ReasoningEffortDto,
} from '../../../../packages/shared/src/index';
import { agentBackendIdSchema } from '../provider-schemas';

const providerParamSchema = z.object({
  provider: agentBackendIdSchema,
});
const installActionSchema = z.object({
  action: z.enum(['install', 'update']),
});
const npmManagedPackageNames: Partial<Record<AgentBackendIdDto, string[]>> = {
  codex: ['@openai/codex'],
  claude: ['@anthropic-ai/claude-code', '@anthropic-ai/claude-agent-sdk'],
  opencode: ['opencode-ai', '@opencode-ai/sdk'],
};

function providerNotConfigured(provider: AgentBackendIdDto) {
  const error = new Error(`Agent runtime provider is not configured: ${provider}`);
  (error as Error & { statusCode?: number }).statusCode = 404;
  return error;
}

function runtimeDto(app: FastifyInstance, provider: AgentBackendIdDto): AgentBackendDto {
  const runtime = app.services.agentRuntimes.getOptional(provider);
  if (!runtime) {
    throw providerNotConfigured(provider);
  }
  const installation = {
    ...runtime.installation,
  };
  return {
    provider: runtime.provider,
    displayName: runtime.displayName,
    description: runtime.description,
    enabled: isAgentRuntimeEnabled({ ...runtime, installation }),
    isDefault: provider === defaultAgentBackendId,
    status: runtime.getStatus(),
    capabilities: runtime.capabilities,
    managementSchema: runtime.managementSchema,
    installation,
  };
}

export async function registerAgentRuntimeRoutes(app: FastifyInstance) {
  app.get('/api/agent-runtimes', async () => {
    await refreshBackendInstallations(app);
    return app.services.agentRuntimes
      .list()
      .map((runtime) => {
        const installation = runtime.installation;
        return {
          ...runtime,
          enabled: isAgentRuntimeEnabled({ ...runtime, installation }),
          installation,
        };
      }) satisfies AgentBackendDto[];
  });

  app.get('/api/agent-runtimes/:provider/status', async (request) => {
    const { provider } = providerParamSchema.parse(request.params);
    return runtimeDto(app, provider);
  });

  app.post('/api/agent-runtimes/:provider/restart', async (request) => {
    const { provider } = providerParamSchema.parse(request.params);
    const runtime = app.services.agentRuntimes.getOptional(provider);
    if (!runtime) {
      throw providerNotConfigured(provider);
    }
    await runtime.stop();
    await runtime.start();
    return runtimeDto(app, provider);
  });

  app.post('/api/agent-runtimes/:provider/install', async (request) => {
    const { provider } = providerParamSchema.parse(request.params);
    const { action } = installActionSchema.parse(request.body ?? {});
    const runtime = app.services.agentRuntimes.getOptional(provider);
    if (!runtime) {
      throw providerNotConfigured(provider);
    }
    const command = action === 'install'
      ? runtime.installation.installCommand
      : runtime.installation.updateCommand;
    if (!command) {
      const error = new Error(`${runtime.displayName} does not support ${action}.`);
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    runtime.installation.busy = true;
    runtime.installation.lastError = null;
    try {
      const beforeUpdate = action === 'update'
        ? await activeCommandSnapshot(app, runtime)
        : null;
      const result = await runShellCommand(command);
      if (result.code !== 0) {
        runtime.installation.lastError = commandFailureMessage(command, result);
        const error = new Error(runtime.installation.lastError);
        (error as Error & { statusCode?: number; details?: Record<string, unknown> }).statusCode = 500;
        (error as Error & { details?: Record<string, unknown> }).details = {
          command,
          exitCode: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
        };
        throw error;
      }
      runtime.installation.busy = false;
      await runtime.stop();
      await runtime.start();
      await refreshBackendInstallation(app, runtime);
      const updateWarning = beforeUpdate
        ? await updatePathWarning(app, runtime, beforeUpdate, command)
        : null;
      if (updateWarning) {
        runtime.installation.lastError = updateWarning;
      }
      return runtimeDto(app, provider);
    } finally {
      runtime.installation.busy = false;
    }
  });

  app.get('/api/agent-runtimes/:provider/models', async (request) => {
    const { provider } = providerParamSchema.parse(request.params);
    const runtime = app.services.agentRuntimes.getOptional(provider);
    if (!runtime) {
      throw providerNotConfigured(provider);
    }
    return (await runtime.listModels()).map((model) => ({
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      isDefault: model.isDefault,
      hidden: model.hidden,
      supportsPerformanceMode: model.supportsPerformanceMode === true,
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((entry) => ({
        reasoningEffort: entry.reasoningEffort as ReasoningEffortDto,
        description: entry.description,
      })),
      defaultReasoningEffort: model.defaultReasoningEffort as ReasoningEffortDto | null,
    })) satisfies ModelOptionDto[];
  });

  app.post('/api/agent-runtimes/:provider/build-restart', async (request) => {
    const { provider } = providerParamSchema.parse(request.params);
    const runtime = app.services.agentRuntimes.getOptional(provider);
    if (!runtime) {
      throw providerNotConfigured(provider);
    }
    if (!runtime.managementSchema.buildRestart) {
      const error = new Error('This backend does not support build and restart.');
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    const launched = await app.services.serviceLifecycle.launchBuildRestart();

    return {
      status: 'launched',
      pid: launched.pid,
      message: 'Build and restart launched.',
    };
  });
}

async function refreshBackendInstallations(app: FastifyInstance) {
  await Promise.all(app.services.agentRuntimes.all().map((runtime) =>
    refreshBackendInstallation(app, runtime),
  ));
}

async function refreshBackendInstallation(
  app: FastifyInstance,
  runtime: AgentRuntime,
) {
  if (runtime.installation.busy) {
    return;
  }

  if (runtime.provider === 'codex') {
    const command = app.services.config.agentProviders.codex.command;
    const [cliVersion, latestVersion] = await Promise.all([
      commandVersion(command, ['--version']),
      latestPackageVersion('@openai/codex'),
    ]);
    runtime.installation.installed = Boolean(cliVersion);
    runtime.installation.installedVersion = cliVersion;
    runtime.installation.latestVersion = latestVersion;
    runtime.installation.lastError = cliVersion
      ? null
      : `Codex command is not available: ${command}`;
    return;
  }

  if (runtime.provider === 'claude') {
    const command = app.services.config.agentProviders.claude.command;
    const [cliVersion, sdkVersion, latestCliVersion] = await Promise.all([
      commandVersion(command, ['--version']),
      installedPackageVersion('@anthropic-ai/claude-agent-sdk'),
      latestPackageVersion('@anthropic-ai/claude-code'),
    ]);
    runtime.installation.installed = Boolean(cliVersion && sdkVersion);
    runtime.installation.installedVersion = cliVersion
      ? sdkVersion
        ? `${cliVersion} (SDK ${sdkVersion})`
        : cliVersion
      : sdkVersion
        ? `SDK ${sdkVersion}`
        : null;
    runtime.installation.latestVersion = latestCliVersion;
    runtime.installation.lastError = cliVersion && sdkVersion
      ? null
      : [
          cliVersion ? null : `Claude Code command is not available: ${command}`,
          sdkVersion ? null : 'Claude Code Agent SDK is not installed.',
        ].filter(Boolean).join(' ');
    return;
  }

  if (runtime.provider === 'opencode') {
    const command = app.services.config.agentProviders.opencode.command;
    const [cliVersion, latestVersion, sdkVersion] = await Promise.all([
      commandVersion(command, ['--version']),
      latestPackageVersion('opencode-ai'),
      installedPackageVersion('@opencode-ai/sdk'),
    ]);
    runtime.installation.installed = Boolean(cliVersion && sdkVersion);
    runtime.installation.installedVersion = cliVersion
      ? sdkVersion
        ? `${cliVersion} (SDK ${sdkVersion})`
        : cliVersion
      : sdkVersion
        ? `SDK ${sdkVersion}`
        : null;
    runtime.installation.latestVersion = latestVersion;
    runtime.installation.lastError = cliVersion && sdkVersion
      ? null
      : [
          cliVersion ? null : `OpenCode command is not available: ${command}`,
          sdkVersion ? null : 'OpenCode SDK is not installed.',
        ].filter(Boolean).join(' ');
  }
}

async function installedPackageVersion(packageName: string) {
  const globalRoot = await npmGlobalRoot();
  if (globalRoot) {
    const global = await packageVersionFromPath(path.join(globalRoot, packageName, 'package.json'));
    if (global) {
      return global;
    }
  }
  return packageVersionFromNode(packageName);
}

async function activeCommandSnapshot(app: FastifyInstance, runtime: AgentRuntime) {
  const command = runtimeCommand(app, runtime.provider);
  if (!command) {
    return null;
  }

  const [commandPath, version] = await Promise.all([
    commandPathFor(command),
    commandVersion(command, ['--version']),
  ]);
  return { command, commandPath, version };
}

async function updatePathWarning(
  app: FastifyInstance,
  runtime: AgentRuntime,
  before: NonNullable<Awaited<ReturnType<typeof activeCommandSnapshot>>>,
  command: string,
) {
  const after = await activeCommandSnapshot(app, runtime);
  if (!after?.version || !before.version || after.version !== before.version) {
    return null;
  }

  const latest = runtime.installation.latestVersion;
  if (!latest || versionStringContains(runtime.installation.installedVersion, latest)) {
    return null;
  }

  const npmBin = await npmGlobalBin();
  const managedPackages = npmManagedPackageNames[runtime.provider] ?? [];
  return [
    `${runtime.displayName} update command completed, but the active command still reports ${after.version}.`,
    after.commandPath ? `Active command: ${after.commandPath}.` : `Active command: ${after.command}.`,
    npmBin ? `npm global bin: ${npmBin}.` : null,
    managedPackages.length > 0
      ? `The update command manages ${managedPackages.join(', ')}; check PATH or set the configured command to the updated executable.`
      : null,
    `Command: ${command}`,
  ].filter(Boolean).join(' ');
}

function runtimeCommand(app: FastifyInstance, provider: AgentBackendIdDto) {
  switch (provider) {
    case 'codex':
      return app.services.config.agentProviders.codex.command;
    case 'claude':
      return app.services.config.agentProviders.claude.command;
    case 'opencode':
      return app.services.config.agentProviders.opencode.command;
  }
}

function versionStringContains(installedVersion: string | null, latestVersion: string) {
  return Boolean(installedVersion && latestVersion && installedVersion.includes(latestVersion));
}

async function packageVersionFromNode(packageName: string) {
  return packageVersionFromPath(path.resolve('node_modules', packageName, 'package.json'));
}

async function packageVersionFromPath(packageJsonPath: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

async function latestPackageVersion(packageName: string) {
  const result = await runShellCommand(`npm view ${shellQuote(packageName)} version`, 4_000);
  return result.code === 0 ? firstLine(result.stdout) : null;
}

async function npmGlobalRoot() {
  const result = await runShellCommand('npm root -g', 3_000);
  return result.code === 0 ? firstLine(result.stdout) : null;
}

async function npmGlobalBin() {
  const result = await runShellCommand('npm bin -g', 3_000);
  if (result.code === 0) {
    return firstLine(result.stdout);
  }

  const prefix = await npmGlobalPrefix();
  return prefix ? path.join(prefix, 'bin') : null;
}

async function npmGlobalPrefix() {
  const result = await runShellCommand('npm prefix -g', 3_000);
  return result.code === 0 ? firstLine(result.stdout) : null;
}

async function commandPathFor(command: string) {
  if (path.isAbsolute(command)) {
    return command;
  }
  const result = await runShellCommand(`command -v ${shellQuote(command)}`, 3_000);
  return result.code === 0 ? firstLine(result.stdout) : null;
}

async function commandVersion(command: string, args: string[]) {
  const result = await runShellCommand(
    [shellQuote(command), ...args.map(shellQuote)].join(' '),
    3_000,
  );
  return result.code === 0 ? firstLine(result.stdout || result.stderr) : null;
}

function firstLine(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandFailureMessage(
  command: string,
  result: { code: number | null; stdout: string; stderr: string },
) {
  const output = firstLine(result.stderr) ?? firstLine(result.stdout);
  return output
    ? `${command} failed: ${output}`
    : `${command} failed with exit code ${result.code ?? 'unknown'}.`;
}

function runShellCommand(command: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}>;
function runShellCommand(command: string, timeoutMs: number): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}>;
function runShellCommand(command: string, timeoutMs = 0): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ code, stdout, stderr });
    };
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          stderr = stderr || `${command} timed out.`;
          child.kill('SIGTERM');
          finish(124);
        }, timeoutMs)
      : null;
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      finish(code);
    });
    child.on('error', (error) => {
      stderr = error.message;
      finish(1);
    });
  });
}
