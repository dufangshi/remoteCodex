export interface QuotaUser {
  quotaProfile: string;
}

export interface UsageSummary {
  requestCount: number;
  costUsd: number;
}

export interface QuotaDenial {
  reason: 'route_tokens_disabled' | 'llm_request_quota_exceeded' | 'llm_spend_quota_exceeded';
  quotaProfile: string;
  limit: number;
  used: number;
}

export interface QuotaDecision {
  allowed: boolean;
  denial?: QuotaDenial;
}

interface QuotaProfile {
  id: string;
  routeTokensEnabled: boolean;
  maxLlmRequests: number | null;
  maxLlmSpendUsd: number | null;
}

const quotaProfiles: Record<string, QuotaProfile> = {
  disabled: {
    id: 'disabled',
    routeTokensEnabled: false,
    maxLlmRequests: 0,
    maxLlmSpendUsd: 0,
  },
  developer: {
    id: 'developer',
    routeTokensEnabled: true,
    maxLlmRequests: 10_000,
    maxLlmSpendUsd: 25,
  },
  pro: {
    id: 'pro',
    routeTokensEnabled: true,
    maxLlmRequests: 100_000,
    maxLlmSpendUsd: 250,
  },
  unlimited: {
    id: 'unlimited',
    routeTokensEnabled: true,
    maxLlmRequests: null,
    maxLlmSpendUsd: null,
  },
};

const disabledProfile = quotaProfiles.disabled!;

function profileForUser(user: QuotaUser) {
  return quotaProfiles[user.quotaProfile] ?? disabledProfile;
}

export function checkRouteTokenQuota(user: QuotaUser, usage: UsageSummary): QuotaDecision {
  const profile = profileForUser(user);
  if (!profile.routeTokensEnabled) {
    return {
      allowed: false,
      denial: {
        reason: 'route_tokens_disabled',
        quotaProfile: profile.id,
        limit: 0,
        used: 0,
      },
    };
  }

  if (profile.maxLlmRequests !== null && usage.requestCount >= profile.maxLlmRequests) {
    return {
      allowed: false,
      denial: {
        reason: 'llm_request_quota_exceeded',
        quotaProfile: profile.id,
        limit: profile.maxLlmRequests,
        used: usage.requestCount,
      },
    };
  }

  if (profile.maxLlmSpendUsd !== null && usage.costUsd >= profile.maxLlmSpendUsd) {
    return {
      allowed: false,
      denial: {
        reason: 'llm_spend_quota_exceeded',
        quotaProfile: profile.id,
        limit: profile.maxLlmSpendUsd,
        used: usage.costUsd,
      },
    };
  }

  return { allowed: true };
}
