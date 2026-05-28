import fs from 'node:fs/promises';
import path from 'node:path';

import type { RuntimeConfig } from '../../../packages/config/src/index';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function joinUrl(base: string, suffix: string) {
  return `${trimTrailingSlash(base)}${suffix}`;
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

async function writePrivateFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

export async function configureWorkerProviderGateway(config: RuntimeConfig) {
  if (
    config.runtimeRole !== 'worker' ||
    !config.llmGatewayBaseUrl ||
    !config.llmGatewayToken
  ) {
    return;
  }

  const codexBaseUrl = trimTrailingSlash(config.llmGatewayBaseUrl);
  const openAiBaseUrl = joinUrl(config.llmGatewayBaseUrl, '/v1');
  const anthropicBaseUrl = joinUrl(config.llmGatewayBaseUrl, '/anthropic');
  process.env.REMOTE_CODEX_LLM_GATEWAY_TOKEN = config.llmGatewayToken;
  process.env.ANTHROPIC_AUTH_TOKEN = config.llmGatewayToken;
  process.env.ANTHROPIC_BASE_URL = anthropicBaseUrl;

  if (config.agentProviders.codex.enabled) {
    await writePrivateFile(
      path.join(config.agentProviders.codex.home, 'config.toml'),
      [
        'model_provider = "sub2api"',
        'forced_login_method = "api"',
        'sandbox_mode = "workspace-write"',
        'approval_policy = "never"',
        '',
        '[model_providers.sub2api]',
        'name = "sub2api"',
        `base_url = ${tomlString(codexBaseUrl)}`,
        'wire_api = "responses"',
        'requires_openai_auth = true',
        '',
      ].join('\n'),
    );

    await writePrivateFile(
      path.join(config.agentProviders.codex.home, 'auth.json'),
      `${JSON.stringify(
        {
          OPENAI_API_KEY: config.llmGatewayToken,
        },
        null,
        2,
      )}\n`,
    );
  }

  if (config.agentProviders.claude.enabled) {
    await writePrivateFile(
      path.join(config.agentProviders.claude.home, 'settings.json'),
      `${JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: anthropicBaseUrl,
            CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
          },
        },
        null,
        2,
      )}\n`,
    );
  }

  if (config.agentProviders.opencode.enabled) {
    await writePrivateFile(
      path.join(config.agentProviders.opencode.home, 'opencode.json'),
      `${JSON.stringify(
        {
          provider: {
            'remote-openai': {
              npm: '@ai-sdk/openai-compatible',
              name: 'Remote OpenAI',
              options: {
                baseURL: openAiBaseUrl,
                apiKey: '{env:REMOTE_CODEX_LLM_GATEWAY_TOKEN}',
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
  }
}
