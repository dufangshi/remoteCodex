import { describe, expect, it } from 'vitest';

import { checkRouteTokenQuota } from './quota';

describe('quota checks', () => {
  it('allows route tokens for users under the developer quota', () => {
    expect(
      checkRouteTokenQuota(
        { quotaProfile: 'developer' },
        {
          requestCount: 99,
          costUsd: 1.5,
        },
      ),
    ).toEqual({ allowed: true });
  });

  it('denies route tokens when the profile disables routing', () => {
    expect(
      checkRouteTokenQuota(
        { quotaProfile: 'disabled' },
        {
          requestCount: 0,
          costUsd: 0,
        },
      ),
    ).toEqual({
      allowed: false,
      denial: {
        reason: 'route_tokens_disabled',
        quotaProfile: 'disabled',
        limit: 0,
        used: 0,
      },
    });
  });

  it('denies route tokens when spend reaches the profile limit', () => {
    expect(
      checkRouteTokenQuota(
        { quotaProfile: 'developer' },
        {
          requestCount: 10,
          costUsd: 25,
        },
      ),
    ).toEqual({
      allowed: false,
      denial: {
        reason: 'llm_spend_quota_exceeded',
        quotaProfile: 'developer',
        limit: 25,
        used: 25,
      },
    });
  });

  it('denies unknown profiles by default', () => {
    expect(
      checkRouteTokenQuota(
        { quotaProfile: 'unknown-profile' },
        {
          requestCount: 0,
          costUsd: 0,
        },
      ),
    ).toMatchObject({
      allowed: false,
      denial: {
        reason: 'route_tokens_disabled',
        quotaProfile: 'disabled',
      },
    });
  });
});

