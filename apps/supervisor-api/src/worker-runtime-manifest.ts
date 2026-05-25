import fs from 'node:fs';

export interface WorkerRuntimeManifest {
  imageVersion?: string;
  gitSha?: string;
  generatedAt?: string;
  runtimes: Record<string, {
    package: string;
    version: string;
  }>;
}

function isRuntimeEntry(value: unknown): value is { package: string; version: string } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { package?: unknown }).package === 'string' &&
      typeof (value as { version?: unknown }).version === 'string',
  );
}

export function readWorkerRuntimeManifest(pathname: string | null): WorkerRuntimeManifest | null {
  if (!pathname || !fs.existsSync(pathname)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(pathname, 'utf8')) as {
    imageVersion?: unknown;
    gitSha?: unknown;
    generatedAt?: unknown;
    runtimes?: unknown;
  };
  const runtimes: WorkerRuntimeManifest['runtimes'] = {};
  if (parsed.runtimes && typeof parsed.runtimes === 'object') {
    for (const [key, value] of Object.entries(parsed.runtimes)) {
      if (isRuntimeEntry(value)) {
        runtimes[key] = {
          package: value.package,
          version: value.version,
        };
      }
    }
  }

  const manifest: WorkerRuntimeManifest = { runtimes };
  if (typeof parsed.imageVersion === 'string') {
    manifest.imageVersion = parsed.imageVersion;
  }
  if (typeof parsed.gitSha === 'string') {
    manifest.gitSha = parsed.gitSha;
  }
  if (typeof parsed.generatedAt === 'string') {
    manifest.generatedAt = parsed.generatedAt;
  }
  return manifest;
}
