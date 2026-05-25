import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface CanIResult {
  verb: string;
  resource: string;
  namespace: string;
  allowed: boolean;
}

interface CommandError {
  command: string;
  message: string;
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function envBoolean(name: string) {
  const value = envValue(name);
  return value === '1' || value === 'true' || value === 'yes';
}

function commaList(value: string | null) {
  return value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

async function runJsonCommand(command: string, args: string[], errors: CommandError[]) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: Number(process.env.AWS_STAGING_PREFLIGHT_COMMAND_TIMEOUT_MS ?? 30_000),
      env: process.env,
    });
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    errors.push({
      command: [command, ...args].join(' '),
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function runTextCommand(command: string, args: string[], errors: CommandError[]) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: Number(process.env.AWS_STAGING_PREFLIGHT_COMMAND_TIMEOUT_MS ?? 30_000),
      env: process.env,
    });
    return stdout.trim();
  } catch (error) {
    errors.push({
      command: [command, ...args].join(' '),
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringFromRecord(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : null;
}

function stringListFromRecord(value: unknown, key: string) {
  return isRecord(value) && Array.isArray(value[key])
    ? value[key].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

async function collectAwsIdentity(input: {
  skipCommands: boolean;
  errors: CommandError[];
}) {
  if (input.skipCommands) {
    return null;
  }
  return runJsonCommand('aws', ['sts', 'get-caller-identity'], input.errors);
}

async function collectEksCluster(input: {
  clusterName: string | null;
  region: string;
  skipCommands: boolean;
  errors: CommandError[];
}) {
  if (input.skipCommands || !input.clusterName) {
    return null;
  }
  return runJsonCommand(
    'aws',
    ['eks', 'describe-cluster', '--name', input.clusterName, '--region', input.region],
    input.errors,
  );
}

async function collectFargateProfile(input: {
  clusterName: string | null;
  profileName: string | null;
  region: string;
  skipCommands: boolean;
  errors: CommandError[];
}) {
  if (input.skipCommands || !input.clusterName || !input.profileName) {
    return null;
  }
  return runJsonCommand(
    'aws',
    [
      'eks',
      'describe-fargate-profile',
      '--cluster-name',
      input.clusterName,
      '--fargate-profile-name',
      input.profileName,
      '--region',
      input.region,
    ],
    input.errors,
  );
}

async function collectCanI(input: {
  verb: string;
  resource: string;
  namespace: string;
  skipCommands: boolean;
  errors: CommandError[];
}) {
  if (input.skipCommands || !input.namespace) {
    return {
      verb: input.verb,
      resource: input.resource,
      namespace: input.namespace,
      allowed: false,
    };
  }
  const output = await runTextCommand(
    'kubectl',
    ['auth', 'can-i', input.verb, input.resource, '-n', input.namespace],
    input.errors,
  );
  return {
    verb: input.verb,
    resource: input.resource,
    namespace: input.namespace,
    allowed: output === 'yes',
  };
}

async function collectForbiddenCanI(input: {
  verb: string;
  resource: string;
  namespace: string;
  allNamespaces?: boolean;
  skipCommands: boolean;
  errors: CommandError[];
}) {
  if (input.skipCommands) {
    return {
      verb: input.verb,
      resource: input.resource,
      namespace: input.allNamespaces ? '*' : input.namespace,
      allowed: true,
    };
  }
  const namespaceArgs = input.allNamespaces
    ? ['--all-namespaces']
    : ['-n', input.namespace];
  const output = await runTextCommand(
    'kubectl',
    ['auth', 'can-i', input.verb, input.resource, ...namespaceArgs],
    input.errors,
  );
  return {
    verb: input.verb,
    resource: input.resource,
    namespace: input.allNamespaces ? '*' : input.namespace,
    allowed: output === 'yes',
  };
}

async function main() {
  const errors: CommandError[] = [];
  const skipCommands = envBoolean('AWS_STAGING_PREFLIGHT_SKIP_COMMANDS');
  const region =
    envValue('AWS_STAGING_REGION') ??
    envValue('SANDBOX_AWS_REGION') ??
    envValue('AWS_REGION') ??
    'us-east-1';
  const clusterName =
    envValue('AWS_STAGING_EKS_CLUSTER_NAME') ?? envValue('SANDBOX_EKS_CLUSTER_NAME');
  const namespace =
    envValue('AWS_STAGING_K8S_NAMESPACE') ??
    envValue('SANDBOX_K8S_NAMESPACE') ??
    'remote-codex-sandboxes';
  const fargateProfileName = envValue('AWS_STAGING_FARGATE_PROFILE_NAME');
  const serviceAccountName =
    envValue('AWS_STAGING_K8S_SERVICE_ACCOUNT') ?? envValue('SANDBOX_K8S_SERVICE_ACCOUNT');

  const [identity, cluster, fargateProfile] = await Promise.all([
    collectAwsIdentity({ skipCommands, errors }),
    collectEksCluster({ clusterName, region, skipCommands, errors }),
    collectFargateProfile({ clusterName, profileName: fargateProfileName, region, skipCommands, errors }),
  ]);

  const clusterBody = isRecord(cluster) && isRecord(cluster.cluster) ? cluster.cluster : null;
  const vpcConfig = isRecord(clusterBody?.resourcesVpcConfig)
    ? clusterBody.resourcesVpcConfig
    : null;
  const profileBody =
    isRecord(fargateProfile) && isRecord(fargateProfile.fargateProfile)
      ? fargateProfile.fargateProfile
      : null;
  const roleArn =
    envValue('AWS_STAGING_K8S_ROLE_ARN') ??
    envValue('AWS_ROLE_ARN') ??
    stringFromRecord(profileBody, 'podExecutionRoleArn') ??
    '';

  const requiredCanI = [
    ['create', 'pods'],
    ['get', 'pods'],
    ['list', 'pods'],
    ['watch', 'pods'],
    ['patch', 'pods'],
    ['delete', 'pods'],
    ['create', 'services'],
    ['get', 'services'],
    ['list', 'services'],
    ['delete', 'services'],
  ] as const;
  const canI: CanIResult[] = [];
  for (const [verb, resource] of requiredCanI) {
    canI.push(await collectCanI({ verb, resource, namespace, skipCommands, errors }));
  }
  const forbiddenCanI = [
    await collectForbiddenCanI({
      verb: '*',
      resource: '*',
      namespace,
      allNamespaces: true,
      skipCommands,
      errors,
    }),
    await collectForbiddenCanI({
      verb: 'delete',
      resource: 'namespaces',
      namespace,
      allNamespaces: true,
      skipCommands,
      errors,
    }),
    await collectForbiddenCanI({
      verb: 'get',
      resource: 'secrets',
      namespace: 'kube-system',
      skipCommands,
      errors,
    }),
  ];

  const evidence = {
    generatedAt: new Date().toISOString(),
    reviewedBy: envValue('AWS_STAGING_REVIEWED_BY') ?? '',
    reviewSource: skipCommands
      ? 'environment-only collection; AWS_STAGING_PREFLIGHT_SKIP_COMMANDS=1'
      : 'aws CLI, kubectl auth can-i, and deployment env review',
    aws: {
      accountId:
        envValue('AWS_STAGING_ACCOUNT_ID') ??
        stringFromRecord(identity, 'Account') ??
        '',
      region,
      eksClusterName: clusterName ?? '',
      namespace,
      fargateProfileName: fargateProfileName ?? '',
      vpcId:
        envValue('AWS_STAGING_VPC_ID') ??
        stringFromRecord(vpcConfig, 'vpcId') ??
        '',
      subnetIds:
        commaList(envValue('AWS_STAGING_SUBNET_IDS') ?? envValue('SANDBOX_SUBNET_IDS'))
          .concat(stringListFromRecord(vpcConfig, 'subnetIds'))
          .filter((entry, index, entries) => entries.indexOf(entry) === index),
      securityGroupIds:
        commaList(
          envValue('AWS_STAGING_SECURITY_GROUP_IDS') ?? envValue('SANDBOX_SECURITY_GROUP_IDS'),
        )
          .concat(stringListFromRecord(vpcConfig, 'securityGroupIds'))
          .filter((entry, index, entries) => entries.indexOf(entry) === index),
      serviceAccountName: serviceAccountName ?? '',
      workerImageRepository:
        envValue('AWS_STAGING_WORKER_IMAGE_REPOSITORY') ??
        envValue('SANDBOX_WORKER_IMAGE_REPOSITORY') ??
        '',
      workerImageTag:
        envValue('AWS_STAGING_WORKER_IMAGE_TAG') ??
        envValue('SANDBOX_WORKER_IMAGE_TAG') ??
        '',
      logGroupNames: commaList(envValue('AWS_STAGING_LOG_GROUP_NAMES')),
      awsAccessSmokePassed: !skipCommands && errors.length === 0,
      configReviewed: envBoolean('AWS_STAGING_CONFIG_REVIEWED'),
    },
    kubernetesCredentials: {
      authMode: envValue('AWS_STAGING_K8S_AUTH_MODE') ?? (roleArn ? 'aws-iam' : ''),
      roleArn,
      serviceAccountName: serviceAccountName ?? '',
      namespace,
      noClusterAdmin: forbiddenCanI.every((entry) => entry.allowed === false),
      noWildcardVerbs: forbiddenCanI[0]?.allowed === false,
      noWildcardResources: forbiddenCanI[0]?.allowed === false,
      namespaceScoped: forbiddenCanI.every((entry) => entry.allowed === false),
      ownedResourceSelector: {
        'remote-codex.dev/cleanup-scope': 'sandbox-worker',
        'remote-codex.dev/environment':
          envValue('AWS_STAGING_ENVIRONMENT') ??
          envValue('SANDBOX_ENVIRONMENT') ??
          'staging',
      },
      canI,
      forbiddenCanI,
      credentialReviewPassed: envBoolean('AWS_STAGING_CREDENTIAL_REVIEW_PASSED'),
    },
    collection: {
      skipCommands,
      commandErrors: errors,
    },
  };

  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
