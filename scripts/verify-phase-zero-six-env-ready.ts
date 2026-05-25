interface EnvRequirement {
  id: string;
  description: string;
  names: string[];
  mode?: 'all' | 'any';
  kind?: 'present' | 'truthy';
  example?: string;
}

interface EnvGroup {
  id: string;
  title: string;
  items: string[];
  required: EnvRequirement[];
  recommended?: EnvRequirement[];
  warnings?: string[];
  readinessOverride?: (input: {
    missingRequired: EnvRequirement[];
    presentEnvNamesOnly: string[];
  }) => {
    ready: boolean;
    missingRequired: EnvRequirement[];
    presentEnvNamesOnly?: string[];
  };
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function envTruthy(name: string) {
  const value = envValue(name)?.toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function requirementSatisfied(requirement: EnvRequirement) {
  const mode = requirement.mode ?? (requirement.names.length > 1 ? 'any' : 'all');
  const kind = requirement.kind ?? 'present';
  const checks = requirement.names.map((name) => (
    kind === 'truthy' ? envTruthy(name) : Boolean(envValue(name))
  ));
  return mode === 'all' ? checks.every(Boolean) : checks.some(Boolean);
}

function requirementLabel(requirement: EnvRequirement) {
  const separator = (requirement.mode ?? (requirement.names.length > 1 ? 'any' : 'all')) === 'all'
    ? ' + '
    : ' | ';
  const suffix = requirement.kind === 'truthy' ? '=true' : '';
  return `${requirement.names.join(separator)}${suffix}`;
}

function canonicalEnvName(requirement: EnvRequirement) {
  return requirement.names[0] ?? requirement.id;
}

function placeholderValue(requirement: EnvRequirement) {
  if (requirement.kind === 'truthy') {
    return 'true';
  }
  return requirement.example ?? `<${requirement.id}>`;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function exportLine(requirement: EnvRequirement) {
  return `export ${canonicalEnvName(requirement)}=${shellQuote(placeholderValue(requirement))}`;
}

function presentNames(requirements: EnvRequirement[]) {
  return requirements.flatMap((requirement) =>
    requirement.names.filter((name) => (
      requirement.kind === 'truthy' ? envTruthy(name) : Boolean(envValue(name))
    )),
  );
}

const groups: EnvGroup[] = [
  {
    id: 'aws-preflight',
    title: 'AWS staging preflight for S3.04 and S3.05',
    items: ['S3.04', 'S3.05'],
    required: [
      {
        id: 'reviewer',
        description: 'Operator identity for AWS staging config review.',
        names: ['AWS_STAGING_REVIEWED_BY'],
        example: 'operator@example.com',
      },
      {
        id: 'cluster',
        description: 'Staging EKS cluster name.',
        names: ['AWS_STAGING_EKS_CLUSTER_NAME', 'SANDBOX_EKS_CLUSTER_NAME'],
        example: 'remote-codex-staging',
      },
      {
        id: 'namespace',
        description: 'Sandbox Kubernetes namespace.',
        names: ['AWS_STAGING_K8S_NAMESPACE', 'SANDBOX_K8S_NAMESPACE'],
        example: 'remote-codex-sandboxes',
      },
      {
        id: 'fargate-profile',
        description: 'EKS Fargate profile name.',
        names: ['AWS_STAGING_FARGATE_PROFILE_NAME'],
        example: 'sandbox-workers',
      },
      {
        id: 'service-account',
        description: 'Kubernetes service account used by sandbox manager.',
        names: ['AWS_STAGING_K8S_SERVICE_ACCOUNT', 'SANDBOX_K8S_SERVICE_ACCOUNT'],
        example: 'remote-codex-sandbox-manager',
      },
      {
        id: 'worker-image-repository',
        description: 'Worker image repository expected in staging.',
        names: ['AWS_STAGING_WORKER_IMAGE_REPOSITORY', 'SANDBOX_WORKER_IMAGE_REPOSITORY'],
        example: '<account-id>.dkr.ecr.<region>.amazonaws.com/remote-codex-worker',
      },
      {
        id: 'worker-image-tag',
        description: 'Immutable worker image tag expected in staging.',
        names: ['AWS_STAGING_WORKER_IMAGE_TAG', 'SANDBOX_WORKER_IMAGE_TAG'],
        example: 'sha-<git-sha>',
      },
      {
        id: 'log-groups',
        description: 'CloudWatch log groups used for staging evidence.',
        names: ['AWS_STAGING_LOG_GROUP_NAMES'],
        example: '/aws/eks/remote-codex-staging,/aws/eks/remote-codex-worker',
      },
      {
        id: 'config-reviewed',
        description: 'Operator confirmation that AWS staging config was reviewed.',
        names: ['AWS_STAGING_CONFIG_REVIEWED'],
        kind: 'truthy',
      },
      {
        id: 'credential-review',
        description: 'Operator confirmation that Kubernetes credentials are least privilege.',
        names: ['AWS_STAGING_CREDENTIAL_REVIEW_PASSED'],
        kind: 'truthy',
      },
    ],
    recommended: [
      {
        id: 'region',
        description: 'AWS region; collector falls back to SANDBOX_AWS_REGION, AWS_REGION, then us-east-1.',
        names: ['AWS_STAGING_REGION', 'SANDBOX_AWS_REGION', 'AWS_REGION'],
        example: 'us-east-1',
      },
      {
        id: 'account',
        description: 'AWS account id; collector can also discover it via aws sts.',
        names: ['AWS_STAGING_ACCOUNT_ID'],
        example: '123456789012',
      },
      {
        id: 'vpc',
        description: 'VPC id; collector can also discover it from the EKS cluster.',
        names: ['AWS_STAGING_VPC_ID'],
        example: 'vpc-xxxxxxxx',
      },
      {
        id: 'subnets',
        description: 'Subnet ids; collector can also discover them from the EKS cluster.',
        names: ['AWS_STAGING_SUBNET_IDS', 'SANDBOX_SUBNET_IDS'],
        example: 'subnet-aaa,subnet-bbb',
      },
      {
        id: 'security-groups',
        description: 'Security group ids; collector can also discover them from the EKS cluster.',
        names: ['AWS_STAGING_SECURITY_GROUP_IDS', 'SANDBOX_SECURITY_GROUP_IDS'],
        example: 'sg-xxxxxxxx',
      },
      {
        id: 'k8s-role',
        description: 'IAM role ARN used by the Kubernetes credential path.',
        names: ['AWS_STAGING_K8S_ROLE_ARN', 'AWS_ROLE_ARN'],
        example: 'arn:aws:iam::<account-id>:role/remote-codex-sandbox-manager',
      },
    ],
    warnings: [
      'The AWS preflight collector still needs working aws and kubectl credentials; env readiness does not prove CLI access.',
    ],
  },
  {
    id: 'runtime-smoke',
    title: 'Runtime staging smoke for S3.06-S3.08 and R5.10/R5.12',
    items: ['S3.06', 'S3.07', 'S3.08', 'R5.10', 'R5.12'],
    required: [
      {
        id: 'control-plane-url',
        description: 'Staging control-plane API base URL.',
        names: ['STAGING_CONTROL_PLANE_BASE_URL'],
        example: 'https://remote-codex-control-plane-staging.example.com',
      },
      {
        id: 'product-token',
        description: 'Product JWT for the staging smoke user.',
        names: ['STAGING_PRODUCT_JWT'],
        example: '<staging-product-jwt>',
      },
      {
        id: 'admin-token',
        description: 'Admin JWT needed for runtime Pod identity proof.',
        names: ['STAGING_ADMIN_JWT'],
        example: '<staging-admin-jwt>',
      },
      {
        id: 'idempotent-smoke',
        description: 'Enable repeated start/restart proof for S3.08.',
        names: ['STAGING_IDEMPOTENT_LIFECYCLE_SMOKE'],
        kind: 'truthy',
      },
      {
        id: 'stop-after-smoke',
        description: 'Enable stop convergence proof for S3.07.',
        names: ['STAGING_STOP_SANDBOX_AFTER_SMOKE'],
        kind: 'truthy',
      },
    ],
    recommended: [
      {
        id: 'smoke-email',
        description: 'Stable email for the staging smoke user.',
        names: ['STAGING_SMOKE_EMAIL'],
        example: 'phase-one-smoke@example.com',
      },
      {
        id: 'ready-timeout',
        description: 'Sandbox readiness timeout for slower EKS Fargate starts.',
        names: ['STAGING_SANDBOX_READY_TIMEOUT_MS'],
        example: '900000',
      },
      {
        id: 'stop-timeout',
        description: 'Sandbox stop timeout for slower EKS Fargate termination.',
        names: ['STAGING_SANDBOX_STOP_TIMEOUT_MS'],
        example: '900000',
      },
    ],
  },
  {
    id: 'direct-worker-denial',
    title: 'Direct worker denial proof for R5.11',
    items: ['R5.11'],
    required: [
      {
        id: 'direct-worker-url',
        description: 'Worker base URL used to prove direct access is denied, or private-network proof env when no worker public endpoint exists.',
        names: [
          'STAGING_DIRECT_WORKER_BASE_URL',
          'STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY',
          'STAGING_DIRECT_WORKER_NETWORK_MODE',
          'STAGING_DIRECT_WORKER_INGRESS_POLICY',
          'STAGING_DIRECT_WORKER_PRIVATE_PROOF',
        ],
        mode: 'any',
        example: 'https://<direct-worker-endpoint>',
      },
    ],
    readinessOverride(input) {
      const directUrlReady = Boolean(envValue('STAGING_DIRECT_WORKER_BASE_URL'));
      const privateProofReady =
        Boolean(envValue('STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY')) &&
        envValue('STAGING_DIRECT_WORKER_NETWORK_MODE') === 'private' &&
        envValue('STAGING_DIRECT_WORKER_INGRESS_POLICY') === 'router-only' &&
        Boolean(envValue('STAGING_DIRECT_WORKER_PRIVATE_PROOF'));
      const privateNames = [
        'STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY',
        'STAGING_DIRECT_WORKER_NETWORK_MODE',
        'STAGING_DIRECT_WORKER_INGRESS_POLICY',
        'STAGING_DIRECT_WORKER_PRIVATE_PROOF',
      ].filter((name) => Boolean(envValue(name)));
      return {
        ready: directUrlReady || privateProofReady,
        missingRequired: directUrlReady || privateProofReady ? [] : input.missingRequired,
        presentEnvNamesOnly: Array.from(new Set([
          ...input.presentEnvNamesOnly,
          ...privateNames,
        ])).sort(),
      };
    },
    warnings: [
      'When workers are public, set STAGING_DIRECT_WORKER_BASE_URL and capture a 401/403 direct request. When workers are private by design, set STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY, STAGING_DIRECT_WORKER_NETWORK_MODE=private, STAGING_DIRECT_WORKER_INGRESS_POLICY=router-only, and STAGING_DIRECT_WORKER_PRIVATE_PROOF.',
    ],
  },
  {
    id: 'codex-provider-smoke',
    title: 'Codex gateway staging smoke for G6.11',
    items: ['G6.11'],
    required: [
      {
        id: 'codex-command',
        description: 'Codex provider smoke command.',
        names: ['STAGING_CODEX_GATEWAY_SMOKE_COMMAND_JSON', 'STAGING_CODEX_GATEWAY_SMOKE_COMMAND'],
        example: '["pnpm","exec","tsx","scripts/provider-gateway-smoke.ts","codex"]',
      },
    ],
    recommended: [
      {
        id: 'codex-env',
        description: 'Provider-specific env overrides for the Codex smoke helper.',
        names: ['STAGING_CODEX_GATEWAY_SMOKE_COMMAND_ENV_JSON'],
        example: '{"PROVIDER_GATEWAY_SMOKE_COMMAND_JSON":"[\\"codex\\",\\"exec\\",\\"--\\",\\"echo\\",\\"gateway smoke\\"]","PROVIDER_GATEWAY_SMOKE_USAGE_RECORDED":"1"}',
      },
    ],
  },
  {
    id: 'claude-provider-smoke',
    title: 'Claude Code gateway staging smoke for G6.12',
    items: ['G6.12'],
    required: [
      {
        id: 'claude-command',
        description: 'Claude Code provider smoke command.',
        names: ['STAGING_CLAUDE_GATEWAY_SMOKE_COMMAND_JSON', 'STAGING_CLAUDE_GATEWAY_SMOKE_COMMAND'],
        example: '["pnpm","exec","tsx","scripts/provider-gateway-smoke.ts","claude"]',
      },
    ],
    recommended: [
      {
        id: 'claude-env',
        description: 'Provider-specific env overrides for the Claude Code smoke helper.',
        names: ['STAGING_CLAUDE_GATEWAY_SMOKE_COMMAND_ENV_JSON'],
        example: '{"PROVIDER_GATEWAY_SMOKE_COMMAND_JSON":"[\\"claude\\",\\"-p\\",\\"gateway smoke\\"]","PROVIDER_GATEWAY_SMOKE_USAGE_RECORDED":"1"}',
      },
    ],
  },
  {
    id: 'opencode-provider-smoke',
    title: 'OpenCode gateway staging smoke for G6.13',
    items: ['G6.13'],
    required: [
      {
        id: 'opencode-command',
        description: 'OpenCode provider smoke command.',
        names: ['STAGING_OPENCODE_GATEWAY_SMOKE_COMMAND_JSON', 'STAGING_OPENCODE_GATEWAY_SMOKE_COMMAND'],
        example: '["pnpm","exec","tsx","scripts/provider-gateway-smoke.ts","opencode"]',
      },
    ],
    recommended: [
      {
        id: 'opencode-env',
        description: 'Provider-specific env overrides for the OpenCode smoke helper.',
        names: ['STAGING_OPENCODE_GATEWAY_SMOKE_COMMAND_ENV_JSON'],
        example: '{"PROVIDER_GATEWAY_SMOKE_COMMAND_JSON":"[\\"opencode\\",\\"run\\",\\"gateway smoke\\"]","PROVIDER_GATEWAY_SMOKE_USAGE_RECORDED":"1"}',
      },
    ],
  },
];

function evaluateGroup(group: EnvGroup) {
  const missingRequired = group.required.filter((requirement) => !requirementSatisfied(requirement));
  const missingRecommended = (group.recommended ?? [])
    .filter((requirement) => !requirementSatisfied(requirement));
  const requiredEnv = group.required.map(requirementLabel);
  const recommendedEnv = (group.recommended ?? []).map(requirementLabel);
  const presentEnvNamesOnly = Array.from(new Set([
    ...presentNames(group.required),
    ...presentNames(group.recommended ?? []),
  ])).sort();
  const missingRequiredTemplate = missingRequired.map(exportLine);
  const missingRecommendedTemplate = missingRecommended.map(exportLine);
  const override = group.readinessOverride?.({
    missingRequired,
    presentEnvNamesOnly,
  });
  const effectiveMissingRequired = override?.missingRequired ?? missingRequired;
  const effectivePresentEnvNamesOnly = override?.presentEnvNamesOnly ?? presentEnvNamesOnly;

  return {
    id: group.id,
    title: group.title,
    items: group.items,
    ready: override?.ready ?? missingRequired.length === 0,
    requiredEnv,
    missingEnv: effectiveMissingRequired.map(requirementLabel),
    recommendedEnv,
    missingRecommendedEnv: missingRecommended.map(requirementLabel),
    missingRequiredExportTemplate: effectiveMissingRequired.map(exportLine),
    missingRecommendedExportTemplate: missingRecommendedTemplate,
    presentEnvNamesOnly: effectivePresentEnvNamesOnly,
    warnings: group.warnings ?? [],
  };
}

function main() {
  const evaluatedGroups = groups.map(evaluateGroup);
  const readyGroups = evaluatedGroups
    .filter((group) => group.ready)
    .map((group) => group.id);
  const notReadyGroups = evaluatedGroups
    .filter((group) => !group.ready)
    .map((group) => group.id);

  console.log(JSON.stringify({
    ok: notReadyGroups.length === 0,
    generatedAt: new Date().toISOString(),
    readyGroups,
    notReadyGroups,
    groups: evaluatedGroups,
    missingEnvExportTemplate: evaluatedGroups.flatMap((group) =>
      group.missingRequiredExportTemplate.map((line) => `# ${group.id}\n${line}`),
    ),
    missingRecommendedEnvExportTemplate: evaluatedGroups.flatMap((group) =>
      group.missingRecommendedExportTemplate.map((line) => `# ${group.id}\n${line}`),
    ),
    secretSafety: {
      valuesPrinted: false,
      note: 'This report prints environment variable names only; it never prints JWTs, API keys, tokens, or command JSON values.',
    },
  }, null, 2));

  if (notReadyGroups.length > 0) {
    process.exitCode = 1;
  }
}

main();
