import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

interface Finding {
  file: string;
  kind: string;
  path?: string;
  preview?: string;
}

const sensitiveKeyPattern =
  /(api[_-]?key|secret|token|jwt|authorization|password|credential|private[_-]?key|app[_-]?key)/i;

const allowedSensitiveKeys = new Set([
  'acceptedStatuses',
  'authMode',
  'awsPreflight',
  'credentialReviewPassed',
  'envJsonEnv',
  'envOverrideKeys',
  'gatewayBaseUrlConfigured',
  'gatewayUsageRecorded',
  'providerConfigPath',
  'providerConfigReadError',
  'rootKeysAbsent',
  'skippedStagingSmoke',
  'stagingSmoke',
  'workerConfigUsesGateway',
]);

const secretValuePatterns: Array<[string, RegExp]> = [
  ['bearer_token', /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ['jwt_value', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['openai_key', /sk-[A-Za-z0-9_-]{20,}/],
  ['anthropic_key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['aws_access_key', /AKIA[0-9A-Z]{16}/],
  ['github_token', /gh[pousr]_[A-Za-z0-9_]{20,}/],
  ['long_secret_like_value', /[A-Za-z0-9+/=_-]{64,}/],
];

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function preview(value: string) {
  return value.length > 32 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

async function listJsonFiles(root: string): Promise<string[]> {
  const entries = await readdir(root);
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(root, entry);
    const entryStat = await stat(filePath);
    if (entryStat.isFile() && entry.endsWith('.json')) {
      files.push(filePath);
    }
  }
  return files.sort();
}

function scanJsonValue(input: {
  file: string;
  value: unknown;
  path: string;
  findings: Finding[];
}) {
  if (Array.isArray(input.value)) {
    input.value.forEach((entry, index) => {
      scanJsonValue({
        ...input,
        value: entry,
        path: `${input.path}[${index}]`,
      });
    });
    return;
  }

  if (input.value && typeof input.value === 'object') {
    for (const [key, value] of Object.entries(input.value)) {
      const nextPath = input.path ? `${input.path}.${key}` : key;
      if (sensitiveKeyPattern.test(key) && !allowedSensitiveKeys.has(key)) {
        const stringValue = typeof value === 'string' ? value.trim() : '';
        if (stringValue.length > 0 && !stringValue.startsWith('<') && stringValue !== 'REDACTED') {
          input.findings.push({
            file: input.file,
            kind: 'sensitive_key_with_value',
            path: nextPath,
            preview: preview(stringValue),
          });
        }
      }
      scanJsonValue({
        ...input,
        value,
        path: nextPath,
      });
    }
    return;
  }

  if (typeof input.value !== 'string') {
    return;
  }

  for (const [kind, pattern] of secretValuePatterns) {
    const match = input.value.match(pattern);
    if (match?.[0]) {
      input.findings.push({
        file: input.file,
        kind,
        path: input.path,
        preview: preview(match[0]),
      });
    }
  }
}

async function main() {
  const dir = argValue('--dir');
  if (!dir) {
    throw new Error('--dir is required.');
  }
  const files = await listJsonFiles(dir);
  const findings: Finding[] = [];

  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      findings.push({
        file,
        kind: 'invalid_json',
        preview: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    scanJsonValue({
      file,
      value: parsed,
      path: '',
      findings,
    });
  }

  console.log(JSON.stringify({
    ok: findings.length === 0,
    generatedAt: new Date().toISOString(),
    dir,
    scannedFiles: files,
    findingCount: findings.length,
    findings,
  }, null, 2));

  if (findings.length > 0) {
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
