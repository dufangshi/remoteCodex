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
      CONTROL_PLANE_PRODUCT_SESSION_SECRET: 'product-session-test-secret',
      CONTROL_PLANE_PRODUCT_SESSION_TTL_SECONDS: '3600',
      CONTROL_PLANE_PUBLIC_BASE_URL: 'https://control.example.test',
      CONTROL_PLANE_FRONTEND_BASE_URL: 'https://frontend.example.test',
      CONTROL_PLANE_GOOGLE_CLIENT_ID: 'google-client',
      CONTROL_PLANE_GOOGLE_CLIENT_SECRET: 'google-secret',
      CONTROL_PLANE_GITHUB_CLIENT_ID: 'github-client',
      CONTROL_PLANE_GITHUB_CLIENT_SECRET: 'github-secret',
      LLM_GATEWAY_BASE_URL: 'https://llm-gateway.example.test',
      LLM_GATEWAY_PROVIDER: 'custom-compatible',
      LLM_GATEWAY_TOKEN_SECRET_NAME: 'remote-codex-gateway-tokens',
      LLM_GATEWAY_STATIC_TOKEN_SECRET_KEY: 'sub2api-api-key',
      LLM_GATEWAY_STATIC_TOKEN: 'gateway-static-token',
      LLM_GATEWAY_ADMIN_BASE_URL: 'https://llm-gateway-admin.example.test',
      LLM_GATEWAY_ADMIN_TOKEN: 'gateway-admin-token',
      LLM_GATEWAY_GROUP_ID: '42',
      LLM_GATEWAY_USER_BALANCE: '1.5',
      LLM_GATEWAY_MIN_USER_BALANCE: '100',
      LLM_GATEWAY_REFILL_USER_BALANCE: '1000',
      SANDBOX_DEFAULT_RESOURCE_PROFILE: 'large',
      SANDBOX_WORKER_ENABLED_AGENT_PROVIDERS: 'codex',
      CONTROL_PLANE_BUILD_SHA: 'abc123',
      ELAGENTE_HARNESS_BASE_URL: 'https://harness.example.test',
      ELAGENTE_HARNESS_PROVIDER: 'custom-harness',
      ELAGENTE_HARNESS_APP_KEY_SECRET_NAME: 'remote-codex-harness-app-keys',
      ELAGENTE_HARNESS_ADMIN_BASE_URL: 'https://harness-admin.example.test',
      ELAGENTE_HARNESS_ADMIN_KEY: 'harness-admin-key',
      ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK: 'false',
      REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
    });

    expect(config.authMode).toBe('jwt');
    expect(config.authJwtSecret).toBe('production-auth-test-secret');
    expect(config.authJwtProvider).toBe('test-jwt');
    expect(config.authJwtIssuer).toBe('https://issuer.example.test');
    expect(config.authJwtAudience).toBe('remote-codex');
    expect(config.authJwtClockSkewSeconds).toBe(45);
    expect(config.productSessionSecret).toBe('product-session-test-secret');
    expect(config.productSessionTtlSeconds).toBe(3600);
    expect(config.publicBaseUrl).toBe('https://control.example.test');
    expect(config.frontendBaseUrl).toBe('https://frontend.example.test');
    expect(config.googleClientId).toBe('google-client');
    expect(config.googleClientSecret).toBe('google-secret');
    expect(config.githubClientId).toBe('github-client');
    expect(config.githubClientSecret).toBe('github-secret');
    expect(config.llmGatewayBaseUrl).toBe('https://llm-gateway.example.test');
    expect(config.llmGatewayProvider).toBe('custom-compatible');
    expect(config.llmGatewayTokenSecretName).toBe(
      'remote-codex-gateway-tokens',
    );
    expect(config.llmGatewayStaticTokenSecretKey).toBe('sub2api-api-key');
    expect(config.llmGatewayStaticToken).toBe('gateway-static-token');
    expect(config.llmGatewayAdminBaseUrl).toBe(
      'https://llm-gateway-admin.example.test',
    );
    expect(config.llmGatewayAdminToken).toBe('gateway-admin-token');
    expect(config.llmGatewayGroupId).toBe(42);
    expect(config.llmGatewayUserBalance).toBe(1.5);
    expect(config.llmGatewayMinUserBalance).toBe(100);
    expect(config.llmGatewayRefillUserBalance).toBe(1000);
    expect(config.sandboxDefaultResourceProfile).toBe('large');
    expect(config.sandboxWorkerEnabledAgentProviders).toBe('codex');
    expect(config.buildSha).toBe('abc123');
    expect(config.harnessBaseUrl).toBe('https://harness.example.test');
    expect(config.harnessProvider).toBe('custom-harness');
    expect(config.harnessAppKeySecretName).toBe(
      'remote-codex-harness-app-keys',
    );
    expect(config.harnessAdminBaseUrl).toBe(
      'https://harness-admin.example.test',
    );
    expect(config.harnessAdminKey).toBe('harness-admin-key');
    expect(config.harnessLegacyAdminFallback).toBe(false);
    expect(config.chemistryToolsEnabled).toBe(true);
  });

  it('defaults the gateway provider to sub2api', () => {
    const config = loadControlPlaneConfig({
      NODE_ENV: 'test',
      CONTROL_PLANE_DATABASE_URL: ':memory:',
    });

    expect(config.llmGatewayProvider).toBe('sub2api');
    expect(config.sandboxWorkerEnabledAgentProviders).toBe('codex');
    expect(config.harnessLegacyAdminFallback).toBe(true);
  });

  it('parses Harness legacy admin fallback truthy values', () => {
    const config = loadControlPlaneConfig({
      NODE_ENV: 'test',
      CONTROL_PLANE_DATABASE_URL: ':memory:',
      ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK: 'yes',
    });

    expect(config.harnessLegacyAdminFallback).toBe(true);
  });

  it('allows local supervisor web dev and debug origins by default', () => {
    const config = loadControlPlaneConfig({
      NODE_ENV: 'test',
      CONTROL_PLANE_DATABASE_URL: ':memory:',
    });

    expect(config.corsAllowedOrigins.has('http://127.0.0.1:5173')).toBe(true);
    expect(config.corsAllowedOrigins.has('http://localhost:5173')).toBe(true);
    expect(config.corsAllowedOrigins.has('https://debug.lnz-study.com')).toBe(
      true,
    );
  });

  it('requires a harness base URL when chemistry tools are enabled', () => {
    expect(() =>
      loadControlPlaneConfig({
        NODE_ENV: 'test',
        CONTROL_PLANE_DATABASE_URL: ':memory:',
        REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
      }),
    ).toThrow(
      'ELAGENTE_HARNESS_BASE_URL is required when chemistry tools are enabled.',
    );
  });

  it('rejects gateway refill balance below the minimum threshold', () => {
    expect(() =>
      loadControlPlaneConfig({
        NODE_ENV: 'test',
        CONTROL_PLANE_DATABASE_URL: ':memory:',
        LLM_GATEWAY_MIN_USER_BALANCE: '100',
        LLM_GATEWAY_REFILL_USER_BALANCE: '50',
      }),
    ).toThrow(
      'LLM_GATEWAY_REFILL_USER_BALANCE must be greater than or equal to LLM_GATEWAY_MIN_USER_BALANCE.',
    );
  });
});
