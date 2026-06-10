import type { RuntimeConfig } from '../../../packages/config/src/index';

export type HarnessModule = 'estructural' | 'quntur' | 'farmaco';

const HARNESS_MODULES: HarnessModule[] = ['estructural', 'quntur', 'farmaco'];
const HARNESS_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const HARNESS_RUN_ID_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const MOLECULE_ARTIFACT_TYPES = new Set(['xyz', 'extxyz', 'pdb', 'cif']);

interface HarnessPayloadResult {
  payload?: unknown;
  text?: string;
}

export interface NormalizedHarnessRun {
  module: HarnessModule;
  runId: string;
  jobId: string | null;
  tool: string | null;
  status: string | null;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  artifactCount: number | null;
  artifactRefs: Array<{
    title: string;
    path: string | null;
    type: string | null;
    downloadUrl: string | null;
  }>;
}

export interface NormalizedHarnessArtifact {
  module: HarnessModule;
  runId: string;
  title: string;
  path: string | null;
  type: string | null;
  format: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
  previewKind: 'molecule' | 'file';
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null, fields: string[]) {
  if (!record) {
    return null;
  }
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function numberField(record: Record<string, unknown> | null, fields: string[]) {
  if (!record) {
    return null;
  }
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function arrayField(record: Record<string, unknown> | null, fields: string[]) {
  if (!record) {
    return null;
  }
  for (const field of fields) {
    const value = record[field];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function payloadItems(payload: unknown, fields: string[]) {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = recordFrom(payload);
  return arrayField(record, fields) ?? (record ? [record] : []);
}

function artifactPreviewKind(type: string | null, format: string | null, path: string | null): 'molecule' | 'file' {
  const candidates = [
    type,
    format,
    path?.split('.').pop() ?? null,
  ].map((value) => value?.trim().toLowerCase()).filter(Boolean);
  return candidates.some((value) => MOLECULE_ARTIFACT_TYPES.has(value!)) ? 'molecule' : 'file';
}

function normalizeArtifactRef(value: unknown) {
  const record = recordFrom(value);
  const path = stringField(record, ['path', 'filePath', 'file_path', 'filename', 'fileName', 'name']);
  const type = stringField(record, ['type', 'artifactType', 'artifact_type', 'format', 'extension']);
  const title = stringField(record, ['title', 'label', 'name', 'filename', 'fileName']) ?? path ?? 'artifact';
  return {
    title,
    path,
    type,
    downloadUrl: stringField(record, ['downloadUrl', 'download_url', 'url', 'href']),
  };
}

function normalizeRun(module: HarnessModule, value: unknown): NormalizedHarnessRun | null {
  const record = recordFrom(value);
  if (!record) {
    return null;
  }
  const runId = stringField(record, ['runId', 'run_id', 'id']);
  if (!runId) {
    return null;
  }
  const artifacts = arrayField(record, ['artifacts', 'artifactRefs', 'artifact_refs', 'files', 'outputs']) ?? [];
  const tool = stringField(record, ['tool', 'toolName', 'tool_name', 'workflow', 'workflowName', 'workflow_name']);
  return {
    module,
    runId,
    jobId: stringField(record, ['jobId', 'job_id', 'computeJobId', 'compute_job_id']),
    tool,
    status: stringField(record, ['status', 'state']),
    title: stringField(record, ['title', 'name', 'label']) ?? (tool ? `${tool} ${runId}` : `${module} run ${runId}`),
    createdAt: stringField(record, ['createdAt', 'created_at', 'startedAt', 'started_at']),
    updatedAt: stringField(record, ['updatedAt', 'updated_at', 'completedAt', 'completed_at', 'finishedAt', 'finished_at']),
    artifactCount: numberField(record, ['artifactCount', 'artifact_count']) ?? (artifacts.length > 0 ? artifacts.length : null),
    artifactRefs: artifacts.map(normalizeArtifactRef),
  };
}

function normalizeArtifact(module: HarnessModule, runId: string, value: unknown): NormalizedHarnessArtifact | null {
  const record = recordFrom(value);
  if (!record) {
    return null;
  }
  const path = stringField(record, ['path', 'filePath', 'file_path', 'filename', 'fileName', 'name']);
  const type = stringField(record, ['type', 'artifactType', 'artifact_type']);
  const format = stringField(record, ['format', 'fileFormat', 'file_format', 'extension']) ?? type;
  const title = stringField(record, ['title', 'label', 'name', 'filename', 'fileName']) ?? path ?? `${module} artifact`;
  return {
    module,
    runId,
    title,
    path,
    type,
    format,
    mimeType: stringField(record, ['mimeType', 'mime_type', 'contentType', 'content_type']),
    sizeBytes: numberField(record, ['sizeBytes', 'size_bytes', 'bytes']),
    downloadUrl: stringField(record, ['downloadUrl', 'download_url', 'url', 'href']),
    previewKind: artifactPreviewKind(type, format, path),
  };
}

function normalizeRuns(module: HarnessModule, result: HarnessPayloadResult) {
  const runs = payloadItems(result.payload, ['runs', 'items', 'results']).map((item) => normalizeRun(module, item)).filter(Boolean);
  return { runs };
}

function normalizeRunDetail(module: HarnessModule, result: HarnessPayloadResult) {
  return { run: normalizeRun(module, result.payload) };
}

function normalizeArtifacts(module: HarnessModule, runId: string, result: HarnessPayloadResult) {
  const artifacts = payloadItems(result.payload, ['artifacts', 'items', 'files', 'outputs']).map((item) => normalizeArtifact(module, runId, item)).filter(Boolean);
  return { artifacts };
}

export class WorkerHarnessClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: RuntimeConfig,
    input: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
  ) {
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.env = input.env ?? process.env;
  }

  private readonly env: NodeJS.ProcessEnv;

  configured() {
    return {
      enabled: this.config.harnessEnabled,
      baseUrl: this.config.harnessBaseUrl,
      keyPresent: Boolean(this.env.INACT_X_APP_KEY),
      chemistryToolsEnabled: this.config.chemistryToolsEnabled,
      modules: HARNESS_MODULES,
    };
  }

  async health() {
    const config = this.requireHarnessConfig();
    const response = await this.fetchImpl(`${config.baseUrl}/health`);
    const text = await response.text();
    if (!response.ok) {
      throw this.errorFromResponse(response, text);
    }
    return {
      status: text.trim() || 'ok',
    };
  }

  async me() {
    return this.fetchText('/members/.me');
  }

  async home() {
    return this.fetchPayload('/');
  }

  async help(moduleName: string) {
    const module = this.requireModule(moduleName);
    return this.fetchText(`/${module}/.help`);
  }

  async listTools(moduleName: string) {
    const module = this.requireModule(moduleName);
    return this.fetchPayload(`/${module}/tools`);
  }

  async listRuns(moduleName: string) {
    const module = this.requireModule(moduleName);
    const result = await this.fetchPayload(`/${module}/runs`);
    return {
      ...result,
      normalized: normalizeRuns(module, result),
    };
  }

  async runDetail(moduleName: string, runId: string) {
    const module = this.requireModule(moduleName);
    const id = this.requireRunId(runId);
    const result = await this.fetchPayload(`/${module}/runs/${encodeURIComponent(id)}`);
    return {
      ...result,
      normalized: normalizeRunDetail(module, result),
    };
  }

  async runArtifacts(moduleName: string, runId: string) {
    const module = this.requireModule(moduleName);
    const id = this.requireRunId(runId);
    const result = await this.fetchPayload(`/${module}/runs/${encodeURIComponent(id)}/artifacts`);
    return {
      ...result,
      normalized: normalizeArtifacts(module, id, result),
    };
  }

  async downloadRunArtifacts(moduleName: string, runId: string) {
    const module = this.requireModule(moduleName);
    const id = this.requireRunId(runId);
    return this.fetchBinary(`/${module}/runs/${encodeURIComponent(id)}/download.zip`);
  }

  async invoke(moduleName: string, toolName: string, input: Record<string, unknown>) {
    const module = this.requireModule(moduleName);
    const tool = this.requireToolName(toolName);
    return this.fetchPayload(`/${module}/tools/${tool}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  }

  private requireModule(moduleName: string): HarnessModule {
    if (HARNESS_MODULES.includes(moduleName as HarnessModule)) {
      return moduleName as HarnessModule;
    }
    throw new Error(`Unsupported Harness module: ${moduleName}`);
  }

  private requireToolName(toolName: string) {
    const normalized = toolName.trim();
    if (!HARNESS_TOOL_NAME_PATTERN.test(normalized)) {
      throw new Error(`Unsupported Harness tool name: ${toolName}`);
    }
    return normalized;
  }

  private requireRunId(runId: string) {
    const normalized = runId.trim();
    if (!HARNESS_RUN_ID_PATTERN.test(normalized)) {
      throw new Error(`Unsupported Harness run id: ${runId}`);
    }
    return normalized;
  }

  private requireHarnessConfig() {
    const baseUrl = this.config.harnessBaseUrl?.replace(/\/+$/, '');
    const apiKey = this.env.INACT_X_APP_KEY;
    if (!this.config.harnessEnabled || !baseUrl || !apiKey) {
      throw new Error('ElAgenteHarness is not configured for this worker.');
    }
    return { baseUrl, apiKey };
  }

  private async fetchText(path: string) {
    const config = this.requireHarnessConfig();
    const response = await this.fetchImpl(`${config.baseUrl}${path}`, {
      headers: {
        'x-api-key': config.apiKey,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw this.errorFromResponse(response, text);
    }
    return { text };
  }

  private async fetchPayload(path: string, init: RequestInit = {}) {
    const config = this.requireHarnessConfig();
    const headers = new Headers(init.headers);
    headers.set('x-api-key', config.apiKey);
    const response = await this.fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const text = await response.text();
    if (!response.ok) {
      throw this.errorFromResponse(response, text);
    }
    try {
      return { payload: JSON.parse(text) };
    } catch {
      return { text };
    }
  }

  private async fetchBinary(path: string) {
    const config = this.requireHarnessConfig();
    const response = await this.fetchImpl(`${config.baseUrl}${path}`, {
      headers: {
        'x-api-key': config.apiKey,
      },
    });
    if (!response.ok) {
      throw this.errorFromResponse(response, await response.text());
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      contentDisposition: response.headers.get('content-disposition'),
    };
  }

  private errorFromResponse(response: Response, text: string) {
    return new Error(
      `ElAgenteHarness request failed with status ${response.status}: ${this.redact(text).trim()}`,
    );
  }

  private redact(value: string) {
    const apiKey = this.env.INACT_X_APP_KEY;
    return apiKey ? value.replaceAll(apiKey, '[redacted]') : value;
  }
}
