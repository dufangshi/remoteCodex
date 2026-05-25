import { readFile } from 'node:fs/promises';

export interface AwsPreflightCheckResult {
  item: string;
  title: string;
  readyToCheck: boolean;
  reason: string;
  requiredEvidence: string[];
  matchedEvidence: string[];
}

export interface CanIResult {
  verb?: string;
  resource?: string;
  namespace?: string;
  allowed?: boolean;
}

export interface AwsStagingPreflightEvidence {
  generatedAt?: string;
  reviewedBy?: string;
  reviewSource?: string;
  aws?: {
    accountId?: string;
    region?: string;
    eksClusterName?: string;
    namespace?: string;
    fargateProfileName?: string;
    vpcId?: string;
    subnetIds?: string[];
    securityGroupIds?: string[];
    serviceAccountName?: string;
    workerImageRepository?: string;
    workerImageTag?: string;
    logGroupNames?: string[];
    awsAccessSmokePassed?: boolean;
    configReviewed?: boolean;
  };
  kubernetesCredentials?: {
    authMode?: string;
    roleArn?: string;
    serviceAccountName?: string;
    namespace?: string;
    noClusterAdmin?: boolean;
    noWildcardVerbs?: boolean;
    noWildcardResources?: boolean;
    namespaceScoped?: boolean;
    ownedResourceSelector?: Record<string, string>;
    canI?: CanIResult[];
    forbiddenCanI?: CanIResult[];
    credentialReviewPassed?: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readInput() {
  const path = process.argv.slice(2).find((argument) => argument !== '--');
  if (path && path !== '-') {
    return readFile(path, 'utf8');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function parseAwsStagingPreflightEvidence(input: string): AwsStagingPreflightEvidence {
  const parsed = JSON.parse(input) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('AWS staging preflight evidence must be a JSON object.');
  }
  return parsed as AwsStagingPreflightEvidence;
}

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasList(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.every(hasText);
}

function ready(input: Omit<AwsPreflightCheckResult, 'readyToCheck'>): AwsPreflightCheckResult {
  return {
    ...input,
    readyToCheck: true,
  };
}

function notReady(input: Omit<AwsPreflightCheckResult, 'readyToCheck'>): AwsPreflightCheckResult {
  return {
    ...input,
    readyToCheck: false,
  };
}

function verifyS304(evidence: AwsStagingPreflightEvidence): AwsPreflightCheckResult {
  const aws = evidence.aws ?? {};
  const requiredEvidence = [
    'reviewedBy and generatedAt identify the staging config review',
    'aws.accountId and aws.region are present',
    'aws.eksClusterName, aws.namespace, aws.fargateProfileName, and aws.serviceAccountName are present',
    'aws.vpcId, aws.subnetIds, and aws.securityGroupIds are present',
    'aws.workerImageRepository and aws.workerImageTag are present',
    'aws.logGroupNames is present',
    'aws.awsAccessSmokePassed is true',
    'aws.configReviewed is true',
  ];
  const checks = [
    hasText(evidence.reviewedBy),
    hasText(evidence.generatedAt),
    hasText(aws.accountId),
    hasText(aws.region),
    hasText(aws.eksClusterName),
    hasText(aws.namespace),
    hasText(aws.fargateProfileName),
    hasText(aws.serviceAccountName),
    hasText(aws.vpcId),
    hasList(aws.subnetIds),
    hasList(aws.securityGroupIds),
    hasText(aws.workerImageRepository),
    hasText(aws.workerImageTag),
    hasList(aws.logGroupNames),
    aws.awsAccessSmokePassed === true,
    aws.configReviewed === true,
  ];
  const matchedEvidence = [
    ...(hasText(evidence.reviewedBy) ? ['reviewedBy'] : []),
    ...(hasText(evidence.generatedAt) ? ['generatedAt'] : []),
    ...(hasText(aws.accountId) ? ['aws.accountId'] : []),
    ...(hasText(aws.region) ? ['aws.region'] : []),
    ...(hasText(aws.eksClusterName) ? ['aws.eksClusterName'] : []),
    ...(hasText(aws.namespace) ? ['aws.namespace'] : []),
    ...(hasText(aws.fargateProfileName) ? ['aws.fargateProfileName'] : []),
    ...(hasText(aws.serviceAccountName) ? ['aws.serviceAccountName'] : []),
    ...(hasText(aws.vpcId) ? ['aws.vpcId'] : []),
    ...(hasList(aws.subnetIds) ? ['aws.subnetIds'] : []),
    ...(hasList(aws.securityGroupIds) ? ['aws.securityGroupIds'] : []),
    ...(hasText(aws.workerImageRepository) ? ['aws.workerImageRepository'] : []),
    ...(hasText(aws.workerImageTag) ? ['aws.workerImageTag'] : []),
    ...(hasList(aws.logGroupNames) ? ['aws.logGroupNames'] : []),
    ...(aws.awsAccessSmokePassed === true ? ['aws.awsAccessSmokePassed'] : []),
    ...(aws.configReviewed === true ? ['aws.configReviewed'] : []),
  ];

  return checks.every(Boolean)
    ? ready({
        item: 'S3.04',
        title: 'Finalize AWS staging configuration.',
        reason: 'AWS staging configuration review evidence is complete.',
        requiredEvidence,
        matchedEvidence,
      })
    : notReady({
        item: 'S3.04',
        title: 'Finalize AWS staging configuration.',
        reason: 'AWS staging configuration review evidence is incomplete.',
        requiredEvidence,
        matchedEvidence,
      });
}

function canIAllows(canI: CanIResult[] | undefined, verb: string, resource: string, namespace: string) {
  return Boolean(canI?.some((entry) =>
    entry.verb === verb &&
    entry.resource === resource &&
    entry.namespace === namespace &&
    entry.allowed === true,
  ));
}

function verifyS305(evidence: AwsStagingPreflightEvidence): AwsPreflightCheckResult {
  const awsNamespace = evidence.aws?.namespace;
  const credentials = evidence.kubernetesCredentials ?? {};
  const namespace = credentials.namespace ?? awsNamespace ?? '';
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
  const requiredEvidence = [
    'kubernetesCredentials.authMode identifies the deployment credential path',
    'kubernetesCredentials.namespace matches the sandbox namespace',
    'kubernetesCredentials.serviceAccountName or roleArn is present',
    'kubernetesCredentials.noClusterAdmin is true',
    'kubernetesCredentials.noWildcardVerbs is true',
    'kubernetesCredentials.noWildcardResources is true',
    'kubernetesCredentials.namespaceScoped is true',
    'kubernetesCredentials.ownedResourceSelector identifies Remote Codex-owned workers',
    'kubernetesCredentials.canI allows required pod/service lifecycle verbs in the sandbox namespace',
    'kubernetesCredentials.forbiddenCanI records denied cluster-admin or cross-namespace checks',
    'kubernetesCredentials.credentialReviewPassed is true',
  ];
  const canIReady =
    hasText(namespace) &&
    requiredCanI.every(([verb, resource]) => canIAllows(credentials.canI, verb, resource, namespace));
  const hasForbiddenProof =
    Array.isArray(credentials.forbiddenCanI) &&
    credentials.forbiddenCanI.length > 0 &&
    credentials.forbiddenCanI.every((entry) => entry.allowed === false);
  const hasSelector =
    isRecord(credentials.ownedResourceSelector) &&
    Object.keys(credentials.ownedResourceSelector).length > 0;
  const checks = [
    hasText(credentials.authMode),
    hasText(namespace),
    credentials.namespace === awsNamespace,
    hasText(credentials.serviceAccountName) || hasText(credentials.roleArn),
    credentials.noClusterAdmin === true,
    credentials.noWildcardVerbs === true,
    credentials.noWildcardResources === true,
    credentials.namespaceScoped === true,
    hasSelector,
    canIReady,
    hasForbiddenProof,
    credentials.credentialReviewPassed === true,
  ];
  const matchedEvidence = [
    ...(hasText(credentials.authMode) ? ['kubernetesCredentials.authMode'] : []),
    ...(hasText(namespace) ? ['kubernetesCredentials.namespace'] : []),
    ...(credentials.namespace === awsNamespace ? ['namespace match'] : []),
    ...(hasText(credentials.serviceAccountName) ? ['kubernetesCredentials.serviceAccountName'] : []),
    ...(hasText(credentials.roleArn) ? ['kubernetesCredentials.roleArn'] : []),
    ...(credentials.noClusterAdmin === true ? ['kubernetesCredentials.noClusterAdmin'] : []),
    ...(credentials.noWildcardVerbs === true ? ['kubernetesCredentials.noWildcardVerbs'] : []),
    ...(credentials.noWildcardResources === true ? ['kubernetesCredentials.noWildcardResources'] : []),
    ...(credentials.namespaceScoped === true ? ['kubernetesCredentials.namespaceScoped'] : []),
    ...(hasSelector ? ['kubernetesCredentials.ownedResourceSelector'] : []),
    ...(canIReady ? ['kubernetesCredentials.canI'] : []),
    ...(hasForbiddenProof ? ['kubernetesCredentials.forbiddenCanI'] : []),
    ...(credentials.credentialReviewPassed === true
      ? ['kubernetesCredentials.credentialReviewPassed']
      : []),
  ];

  return checks.every(Boolean)
    ? ready({
        item: 'S3.05',
        title: 'Add least-privilege Kubernetes credentials.',
        reason: 'Kubernetes credential review evidence is complete and denies broad access.',
        requiredEvidence,
        matchedEvidence,
      })
    : notReady({
        item: 'S3.05',
        title: 'Add least-privilege Kubernetes credentials.',
        reason: 'Kubernetes credential review evidence is incomplete or too broad.',
        requiredEvidence,
        matchedEvidence,
      });
}

export function evaluateAwsStagingPreflightEvidence(
  evidence: AwsStagingPreflightEvidence,
): AwsPreflightCheckResult[] {
  return [verifyS304(evidence), verifyS305(evidence)];
}

async function main() {
  const input = await readInput();
  const evidence = parseAwsStagingPreflightEvidence(input);
  const results = evaluateAwsStagingPreflightEvidence(evidence);
  const readyItems = results.filter((result) => result.readyToCheck).map((result) => result.item);
  const notReadyItems = results.filter((result) => !result.readyToCheck).map((result) => result.item);

  console.log(JSON.stringify({
    ok: notReadyItems.length === 0,
    generatedAt: new Date().toISOString(),
    evidenceGeneratedAt: evidence.generatedAt ?? null,
    reviewSource: evidence.reviewSource ?? null,
    readyItems,
    notReadyItems,
    results,
  }, null, 2));
}

if (process.argv[1]?.match(/verify-aws-staging-preflight-evidence\.(ts|js)$/)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exit(1);
  });
}
