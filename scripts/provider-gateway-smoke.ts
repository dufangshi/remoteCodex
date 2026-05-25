import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { redactedSlice, redactSecretText } from './secret-redaction.js';

const execFileAsync = promisify(execFile);

type Provider = 'codex' | 'claude' | 'opencode';

interface SmokeResult {
  ok: boolean;
  provider: Provider;
  gatewayUsageRecorded: boolean;
  rootKeysAbsent: boolean;
  workerConfigUsesGateway: boolean;
  requestId?: string | null;
  details: Record<string, unknown>;
}

const rawRootKeyNames = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'MISTRAL_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
];

const configPaths: Record<Provider, (env: NodeJS.ProcessEnv) => string> = {
  codex: (env) => path.join(env.CODEX_HOME?.trim() || path.join(home(env), '.codex'), 'config.toml'),
  claude: (env) => path.join(env.CLAUDE_HOME?.trim() || path.join(home(env), '.claude'), 'settings.json'),
  opencode: (env) => path.join(env.OPENCODE_HOME?.trim() || path.join(home(env), '.opencode'), 'opencode.json'),
};

function home(env: NodeJS.ProcessEnv) {
  return env.HOME?.trim() || os.homedir();
}

function providerFromArg(): Provider {
  const provider = process.argv.slice(2).find((argument) => argument !== '--');
  if (provider === 'codex' || provider === 'claude' || provider === 'opencode') {
    return provider;
  }
  throw new Error('Usage: provider-gateway-smoke.ts <codex|claude|opencode>');
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseJsonArrayEnv(name: string) {
  const value = envValue(name);
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`${name} must be a JSON string array.`);
  }
  return parsed as string[];
}

function parseJsonObjectEnv(name: string) {
  const value = envValue(name);
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

async function readProviderConfig(provider: Provider) {
  const filePath = envValue('PROVIDER_GATEWAY_SMOKE_CONFIG_PATH') ?? configPaths[provider](process.env);
  try {
    return {
      filePath,
      content: await readFile(filePath, 'utf8'),
      readError: null,
    };
  } catch (error) {
    return {
      filePath,
      content: '',
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function configUsesGateway(input: {
  provider: Provider;
  configContent: string;
  gatewayBaseUrl: string | null;
}) {
  if (!input.configContent) {
    return false;
  }
  const expectedBase = input.gatewayBaseUrl?.replace(/\/+$/, '') ?? '';
  const hasGatewayBase = expectedBase ? input.configContent.includes(expectedBase) : true;
  if (input.provider === 'codex') {
    return hasGatewayBase && input.configContent.includes('REMOTE_CODEX_LLM_GATEWAY_TOKEN');
  }
  if (input.provider === 'claude') {
    return hasGatewayBase && input.configContent.includes('ANTHROPIC_BASE_URL');
  }
  return hasGatewayBase && input.configContent.includes('{env:REMOTE_CODEX_LLM_GATEWAY_TOKEN}');
}

function rootKeysAbsent(configContent: string) {
  const leakedEnvNames = rawRootKeyNames.filter((name) => Boolean(process.env[name]?.trim()));
  const leakedConfigNames = rawRootKeyNames.filter((name) => configContent.includes(name));
  return {
    ok: leakedEnvNames.length === 0 && leakedConfigNames.length === 0,
    leakedEnvNames,
    leakedConfigNames,
  };
}

async function runProviderCommand() {
  const command = parseJsonArrayEnv('PROVIDER_GATEWAY_SMOKE_COMMAND_JSON');
  if (!command) {
    return {
      ran: false,
      ok: envValue('PROVIDER_GATEWAY_SMOKE_ASSUME_COMMAND_OK') === '1',
      stdout: '',
      stderr: '',
      parsedStdout: null,
      error: null,
    };
  }

  try {
    const [binary, ...args] = command;
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout: Number(process.env.PROVIDER_GATEWAY_SMOKE_TIMEOUT_MS ?? 120_000),
      env: process.env,
      cwd: envValue('PROVIDER_GATEWAY_SMOKE_CWD') ?? process.cwd(),
    });
    return {
      ran: true,
      ok: true,
      stdout: redactedSlice(stdout),
      stderr: redactedSlice(stderr),
      parsedStdout: parseOptionalJson(stdout),
      error: null,
    };
  } catch (error) {
    return {
      ran: true,
      ok: false,
      stdout: '',
      stderr: '',
      parsedStdout: null,
      error: redactSecretText(error instanceof Error ? error.message : String(error)),
    };
  }
}

function parseOptionalJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function gatewayUsageRecorded(commandResult: Awaited<ReturnType<typeof runProviderCommand>>) {
  if (envValue('PROVIDER_GATEWAY_SMOKE_USAGE_RECORDED') === '1') {
    return true;
  }
  const usageEvidence = parseJsonObjectEnv('PROVIDER_GATEWAY_SMOKE_USAGE_EVIDENCE_JSON');
  if (usageEvidence?.gatewayUsageRecorded === true) {
    return true;
  }
  if (commandResult.parsedStdout?.gatewayUsageRecorded === true) {
    return true;
  }
  return false;
}

async function main() {
  const provider = providerFromArg();
  const gatewayBaseUrl = envValue('REMOTE_CODEX_LLM_GATEWAY_BASE_URL');
  const config = await readProviderConfig(provider);
  const commandResult = await runProviderCommand();
  const rootKeyCheck = rootKeysAbsent(config.content);
  const workerConfigUsesGateway = configUsesGateway({
    provider,
    configContent: config.content,
    gatewayBaseUrl,
  });
  const usageRecorded = gatewayUsageRecorded(commandResult);
  const requestId =
    envValue('PROVIDER_GATEWAY_SMOKE_REQUEST_ID') ??
    (typeof commandResult.parsedStdout?.requestId === 'string'
      ? commandResult.parsedStdout.requestId
      : null);

  const result: SmokeResult = {
    ok: commandResult.ok && usageRecorded && rootKeyCheck.ok && workerConfigUsesGateway,
    provider,
    gatewayUsageRecorded: usageRecorded,
    rootKeysAbsent: rootKeyCheck.ok,
    workerConfigUsesGateway,
    requestId,
    details: {
      commandRan: commandResult.ran,
      commandOk: commandResult.ok,
      commandError: commandResult.error,
      commandStdout: commandResult.stdout,
      commandStderr: commandResult.stderr,
      providerConfigPath: config.filePath,
      providerConfigReadError: config.readError,
      gatewayBaseUrlConfigured: Boolean(gatewayBaseUrl),
      leakedEnvNames: rootKeyCheck.leakedEnvNames,
      leakedConfigNames: rootKeyCheck.leakedConfigNames,
    },
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
