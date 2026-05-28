import { describe, expect, it } from 'vitest';

import { loadControlPlaneConfig } from './config';

describe('control plane config', () => {
  it('loads jwt auth validation settings', () => {
    const config = loadControlPlaneConfig({
      NODE_ENV: 'test',
      CONTROL_PLANE_DATABASE_URL: ':memory:',
      CONTROL_PLANE_AUTH_MODE: 'jwt',
      CONTROL_PLANE_AUTH_JWT_SECRET: 'production-auth-test-secret',
      CONTROL_PLANE_AUTH_JWT_PROVIDER: 'test-jwt',
      CONTROL_PLANE_AUTH_JWT_ISSUER: 'https://issuer.example.test',
      CONTROL_PLANE_AUTH_JWT_AUDIENCE: 'remote-codex',
      CONTROL_PLANE_AUTH_JWT_CLOCK_SKEW_SECONDS: '45',
      LLM_GATEWAY_BASE_URL: 'https://llm-gateway.example.test',
      LLM_GATEWAY_PROVIDER: 'custom-compatible',
      LLM_GATEWAY_TOKEN_SECRET_NAME: 'remote-codex-gateway-tokens',
      LLM_GATEWAY_STATIC_TOKEN_SECRET_KEY: 'sub2api-api-key',
      LLM_GATEWAY_ADMIN_BASE_URL: 'https://llm-gateway-admin.example.test',
      LLM_GATEWAY_ADMIN_TOKEN: 'gateway-admin-token',
      SANDBOX_DEFAULT_RESOURCE_PROFILE: 'large',
      SANDBOX_WORKER_ENABLED_AGENT_PROVIDERS: 'codex',
      ELAGENTE_HARNESS_BASE_URL: 'https://harness.example.test',
      ELAGENTE_HARNESS_APP_KEY_SECRET_NAME: 'remote-codex-harness-app-keys',
      REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
    });

    expect(config.authMode).toBe('jwt');
    expect(config.authJwtSecret).toBe('production-auth-test-secret');
    expect(config.authJwtProvider).toBe('test-jwt');
    expect(config.authJwtIssuer).toBe('https://issuer.example.test');
    expect(config.authJwtAudience).toBe('remote-codex');
    expect(config.authJwtClockSkewSeconds).toBe(45);
    expect(config.llmGatewayBaseUrl).toBe('https://llm-gateway.example.test');
    expect(config.llmGatewayProvider).toBe('custom-compatible');
    expect(config.llmGatewayTokenSecretName).toBe('remote-codex-gateway-tokens');
    expect(config.llmGatewayStaticTokenSecretKey).toBe('sub2api-api-key');
    expect(config.llmGatewayAdminBaseUrl).toBe('https://llm-gateway-admin.example.test');
    expect(config.llmGatewayAdminToken).toBe('gateway-admin-token');
    expect(config.sandboxDefaultResourceProfile).toBe('large');
    expect(config.sandboxWorkerEnabledAgentProviders).toBe('codex');
    expect(config.harnessBaseUrl).toBe('https://harness.example.test');
    expect(config.harnessAppKeySecretName).toBe('remote-codex-harness-app-keys');
    expect(config.chemistryToolsEnabled).toBe(true);
  });

  it('defaults the gateway provider to sub2api', () => {
    const config = loadControlPlaneConfig({
      NODE_ENV: 'test',
      CONTROL_PLANE_DATABASE_URL: ':memory:',
    });

    expect(config.llmGatewayProvider).toBe('sub2api');
    expect(config.sandboxWorkerEnabledAgentProviders).toBe('codex');
  });

  it('requires a harness base URL when chemistry tools are enabled', () => {
    expect(() =>
      loadControlPlaneConfig({
        NODE_ENV: 'test',
        CONTROL_PLANE_DATABASE_URL: ':memory:',
        REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
      }),
    ).toThrow('ELAGENTE_HARNESS_BASE_URL is required when chemistry tools are enabled.');
  });
});
