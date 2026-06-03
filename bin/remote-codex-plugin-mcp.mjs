#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const MOLECULE_ARTIFACT_TYPE = 'chemistry.molecule3d';
const HARNESS_RUN_ARTIFACT_TYPE = 'elagente.harness.run';
const HARNESS_FILE_ARTIFACT_TYPE = 'elagente.harness.artifact';
const XYZ_VIEWER_PLUGIN_ID = 'remote-codex.xyz-viewer';
const HARNESS_MODULES = ['estructural', 'quntur', 'farmaco'];
const HARNESS_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ELAGENTE_HARNESS_PLUGIN_ID = 'remote-codex.elagente-harness';
const MOLECULE_FORMATS = ['xyz', 'extxyz', 'pdb', 'cif'];

class WorkerHarnessApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isFiniteNumberToken(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function looksLikeXyzMolecule(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const atomCount = Number(lines[0]);
  if (!Number.isInteger(atomCount) || atomCount <= 0 || atomCount > 100000) {
    return false;
  }

  const atomLines = lines.slice(2);
  if (atomLines.length < atomCount) {
    return false;
  }

  return atomLines.slice(0, atomCount).every((line) => {
    const parts = line.split(/\s+/);
    return (
      parts.length >= 4 &&
      /^([A-Za-z][A-Za-z]?|\d+)$/.test(parts[0] ?? '') &&
      isFiniteNumberToken(parts[1]) &&
      isFiniteNumberToken(parts[2]) &&
      isFiniteNumberToken(parts[3])
    );
  });
}

function looksLikePdbMolecule(content) {
  return content.split(/\r?\n/).some((line) => /^(ATOM|HETATM)\s+/i.test(line));
}

function looksLikeCifMolecule(content) {
  return /\bdata_[^\s]*/i.test(content) && /_atom_site\./i.test(content);
}

function looksLikeMoleculeStructure(content, format) {
  switch (format) {
    case 'xyz':
    case 'extxyz':
      return looksLikeXyzMolecule(content);
    case 'pdb':
      return looksLikePdbMolecule(content);
    case 'cif':
      return looksLikeCifMolecule(content);
    default:
      return false;
  }
}

function pluginEnabled(pluginId) {
  const enabledIds = process.env.REMOTE_CODEX_ENABLED_PLUGIN_IDS;
  if (!enabledIds) {
    return true;
  }
  return enabledIds.split(',').map((entry) => entry.trim()).filter(Boolean).includes(pluginId);
}

function harnessConfig() {
  const baseUrl = process.env.ELAGENTE_HARNESS_BASE_URL?.replace(/\/+$/, '');
  const apiKey = process.env.INACT_X_APP_KEY;
  const chemistryToolsEnabled = process.env.REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED === 'true';
  return {
    configured: Boolean(baseUrl && apiKey),
    chemistryToolsEnabled,
    baseUrl: baseUrl ?? null,
    apiKey: apiKey ?? null,
  };
}

function envFlag(name) {
  const raw = process.env[name];
  return typeof raw === 'string' && ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function redactHarnessKey(value) {
  const apiKey = process.env.INACT_X_APP_KEY;
  return apiKey ? String(value).replaceAll(apiKey, '[redacted]') : String(value);
}

function isRemoteCodexWorkerRuntime() {
  return process.env.REMOTE_CODEX_RUNTIME_ROLE === 'worker' || Boolean(process.env.REMOTE_CODEX_SANDBOX_ID);
}

function workerHarnessApiBaseUrl() {
  const explicit = process.env.REMOTE_CODEX_WORKER_API_BASE_URL?.replace(/\/+$/, '');
  if (explicit) {
    return explicit;
  }
  if (isRemoteCodexWorkerRuntime()) {
    return `http://127.0.0.1:${process.env.PORT ?? '8787'}`;
  }
  return null;
}

function directHarnessFallbackAllowed() {
  if (!workerHarnessApiBaseUrl()) {
    return true;
  }
  return envFlag('REMOTE_CODEX_ALLOW_DIRECT_HARNESS_FALLBACK') && !isRemoteCodexWorkerRuntime();
}

function workerHarnessUnavailableError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return new WorkerHarnessApiError(
    `Remote Codex worker Harness API is unavailable and direct Harness fallback is disabled: ${redactHarnessKey(message)}`,
  );
}

function requireHarnessConfig() {
  const config = harnessConfig();
  if (!config.baseUrl || !config.apiKey) {
    throw new Error('ElAgenteHarness is not configured for this worker.');
  }
  return config;
}

function requireHarnessToolName(tool) {
  const normalized = tool.trim();
  if (!HARNESS_TOOL_NAME_PATTERN.test(normalized)) {
    throw new Error(`Unsupported Harness tool name: ${tool}`);
  }
  return normalized;
}

function envString(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function harnessRemoteCodexContext({ estimatedComputeUnits, estimatedCostUsd } = {}) {
  const context = {
    ...(envString('REMOTE_CODEX_WORKSPACE_ID') ? { workspaceId: envString('REMOTE_CODEX_WORKSPACE_ID') } : {}),
    ...(envString('REMOTE_CODEX_SESSION_ID') ? { sessionId: envString('REMOTE_CODEX_SESSION_ID') } : {}),
    ...(envString('REMOTE_CODEX_THREAD_ID') ? { threadId: envString('REMOTE_CODEX_THREAD_ID') } : {}),
    ...(envString('REMOTE_CODEX_TURN_ID') ? { turnId: envString('REMOTE_CODEX_TURN_ID') } : {}),
    ...(estimatedComputeUnits !== undefined ? { estimatedComputeUnits } : {}),
    ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
  };
  return Object.keys(context).length > 0 ? context : null;
}

export function buildHarnessInvokeWorkerInputForTest(input, estimates = {}) {
  const context = harnessRemoteCodexContext(estimates);
  return context
    ? {
        ...input,
        _remoteCodexContext: context,
      }
    : input;
}

async function fetchHarness(path, init = {}) {
  const config = requireHarnessConfig();
  const headers = new Headers(init.headers);
  headers.set('x-api-key', config.apiKey);
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `ElAgenteHarness request failed with status ${response.status}: ${redactHarnessKey(text).trim()}`,
    );
  }
  if (!text.trim()) {
    return { text: '' };
  }
  try {
    return { payload: JSON.parse(text) };
  } catch {
    return { text };
  }
}

async function readResponsePayload(response, errorPrefix) {
  const text = await response.text();
  if (!response.ok) {
    throw new WorkerHarnessApiError(
      `${errorPrefix} request failed with status ${response.status}: ${redactHarnessKey(text).trim()}`,
      response.status,
    );
  }
  if (!text.trim()) {
    return { text: '' };
  }
  try {
    return { payload: JSON.parse(text) };
  } catch {
    return { text };
  }
}

async function fetchWorkerHarness(path, init = {}) {
  const baseUrl = workerHarnessApiBaseUrl();
  if (!baseUrl) {
    throw new Error('Remote Codex worker Harness API is not available in this process.');
  }

  const headers = new Headers(init.headers);
  const workerToken = process.env.REMOTE_CODEX_WORKER_AUTH_TOKEN;
  if (workerToken) {
    headers.set('x-remote-codex-worker-token', workerToken);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  return readResponsePayload(response, 'Remote Codex worker Harness API');
}

async function fetchPreferredHarness(workerPath, directPath, init = {}) {
  if (workerHarnessApiBaseUrl()) {
    try {
      return await fetchWorkerHarness(workerPath, init);
    } catch (error) {
      if (error instanceof WorkerHarnessApiError) {
        throw error;
      }
      if (!directHarnessFallbackAllowed()) {
        throw workerHarnessUnavailableError(error);
      }
    }
  }
  return fetchHarness(directPath, init);
}

function mcpJsonText(value) {
  return JSON.stringify(value, null, 2);
}

function mcpTextResult(text, structuredContent) {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function mcpErrorResult(error) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: redactHarnessKey(error instanceof Error ? error.message : String(error)),
      },
    ],
  };
}

function resultPayloadObject(result) {
  if (result?.payload && typeof result.payload === 'object') {
    return result.payload;
  }
  return result && typeof result === 'object' ? result : {};
}

function stringValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function numberValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function recordValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function arrayValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function stringArrayValue(value) {
  if (typeof value === 'string' && value.trim()) {
    return [value];
  }
  if (Array.isArray(value)) {
    const entries = value.filter((entry) => typeof entry === 'string' && entry.trim());
    return entries.length > 0 ? entries : null;
  }
  return null;
}

function moleculeCandidateFromRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const explicitFormat = stringValue(record, ['format', 'fileFormat', 'file_format', 'structureFormat', 'structure_format']);
  const formatFromExtension = stringValue(record, ['extension', 'fileExtension', 'file_extension'])
    ?.replace(/^\./, '')
    .toLowerCase();
  const format = (explicitFormat ?? formatFromExtension ?? '').toLowerCase();
  const content =
    stringArrayValue(record.content) ??
    stringArrayValue(record.contents) ??
    stringArrayValue(record.data) ??
    stringArrayValue(record.structure);
  if (MOLECULE_FORMATS.includes(format) && content?.some((entry) => looksLikeMoleculeStructure(entry, format))) {
    return {
      format,
      content,
      title: stringValue(record, ['title', 'name', 'filename', 'fileName']),
      sourceDescription: stringValue(record, ['sourceDescription', 'source_description', 'description']),
    };
  }

  for (const candidateFormat of MOLECULE_FORMATS) {
    const fieldContent = stringArrayValue(record[candidateFormat]) ??
      stringArrayValue(record[`${candidateFormat}_content`]) ??
      stringArrayValue(record[`${candidateFormat}Content`]);
    if (fieldContent?.some((entry) => looksLikeMoleculeStructure(entry, candidateFormat))) {
      return {
        format: candidateFormat,
        content: fieldContent,
        title: stringValue(record, ['title', 'name', 'filename', 'fileName']),
        sourceDescription: stringValue(record, ['sourceDescription', 'source_description', 'description']),
      };
    }
  }
  return null;
}

function harnessMoleculeArtifacts(result, module, tool) {
  const payload = resultPayloadObject(result);
  const records = [payload];
  for (const key of ['artifact', 'artifacts', 'file', 'files', 'result', 'results', 'outputs']) {
    const value = payload?.[key];
    if (Array.isArray(value)) {
      records.push(...value);
    } else if (value && typeof value === 'object') {
      records.push(value);
    }
  }

  const artifacts = [];
  for (const record of records) {
    const molecule = moleculeCandidateFromRecord(record);
    if (!molecule) {
      continue;
    }
    const title = molecule.title ?? `${module}/${tool} molecule`;
    artifacts.push({
      type: 'remote-codex.artifact',
      artifactType: MOLECULE_ARTIFACT_TYPE,
      title,
      summaryText: molecule.sourceDescription ?? `${molecule.format.toUpperCase()} structure from ElAgenteHarness ${module}/${tool}`,
      payload: {
        format: molecule.format,
        content: molecule.content,
        name: title,
        sourceDescription: molecule.sourceDescription ?? `ElAgenteHarness ${module}/${tool}`,
      },
    });
  }
  return artifacts;
}

function normalizeHarnessArtifactRef(record, module, runId) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const path = stringValue(record, ['path', 'filePath', 'file_path', 'filename', 'fileName', 'name']);
  const title = stringValue(record, ['title', 'label', 'name', 'filename', 'fileName']) ?? path ?? 'Harness artifact';
  return {
    title,
    path,
    type: stringValue(record, ['type', 'artifactType', 'artifact_type', 'format', 'extension']),
    mimeType: stringValue(record, ['mimeType', 'mime_type', 'contentType', 'content_type']),
    sizeBytes: numberValue(record, ['sizeBytes', 'size_bytes', 'bytes']),
    downloadUrl: stringValue(record, ['downloadUrl', 'download_url', 'url', 'href']) ??
      (runId ? `/api/sandbox/harness/modules/${encodeURIComponent(module)}/runs/${encodeURIComponent(runId)}/download.zip` : null),
  };
}

function harnessRunFromPayload(payload, module, tool) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const normalizedRun = recordValue(payload.normalized, ['run']) ??
    (Array.isArray(payload.normalized?.runs) ? payload.normalized.runs[0] : null);
  const source = normalizedRun && typeof normalizedRun === 'object' ? normalizedRun : payload;
  const runId = stringValue(source, ['runId', 'run_id', 'id']) ??
    stringValue(payload, ['runId', 'run_id']);
  const jobId = stringValue(source, ['jobId', 'job_id', 'computeJobId', 'compute_job_id']) ??
    stringValue(payload, ['jobId', 'job_id', 'computeJobId', 'compute_job_id']);
  if (!runId && !jobId) {
    return null;
  }
  const sourceTool = stringValue(source, ['tool', 'toolName', 'tool_name', 'workflow', 'workflowName', 'workflow_name']) ?? tool;
  const status = stringValue(source, ['status', 'state']) ?? stringValue(payload, ['status', 'state']);
  const artifactRefs = arrayValue(source, ['artifactRefs', 'artifact_refs', 'artifacts', 'files', 'outputs']) ??
    arrayValue(payload, ['artifactRefs', 'artifact_refs', 'artifacts', 'files', 'outputs']) ??
    [];
  const title = stringValue(source, ['title', 'name', 'label']) ??
    `${module}${sourceTool ? ` ${sourceTool}` : ''} ${runId ? `run ${runId}` : `job ${jobId}`}`;
  return {
    module,
    tool: sourceTool,
    runId,
    jobId,
    status,
    title,
    createdAt: stringValue(source, ['createdAt', 'created_at', 'startedAt', 'started_at']),
    updatedAt: stringValue(source, ['updatedAt', 'updated_at', 'completedAt', 'completed_at', 'finishedAt', 'finished_at']),
    artifactRefs: artifactRefs
      .map((entry) => normalizeHarnessArtifactRef(entry, module, runId))
      .filter(Boolean),
    downloadUrl: runId
      ? `/api/sandbox/harness/modules/${encodeURIComponent(module)}/runs/${encodeURIComponent(runId)}/download.zip`
      : null,
  };
}

function harnessGenericArtifacts(result, module, tool) {
  const payload = resultPayloadObject(result);
  const run = harnessRunFromPayload(payload, module, tool);
  const artifacts = [];
  if (run) {
    artifacts.push({
      type: 'remote-codex.artifact',
      artifactType: HARNESS_RUN_ARTIFACT_TYPE,
      title: run.title,
      summaryText: [
        run.status ? `status: ${run.status}` : null,
        run.artifactRefs.length > 0 ? `artifacts: ${run.artifactRefs.length}` : null,
      ].filter(Boolean).join(', ') || `ElAgenteHarness ${module}${tool ? `/${tool}` : ''} run`,
      payload: run,
    });
  }

  const normalizedArtifacts = arrayValue(payload.normalized, ['artifacts']) ?? [];
  for (const entry of normalizedArtifacts) {
    const artifact = normalizeHarnessArtifactRef(entry, module, run?.runId ?? stringValue(entry, ['runId', 'run_id']));
    if (!artifact) {
      continue;
    }
    artifacts.push({
      type: 'remote-codex.artifact',
      artifactType: HARNESS_FILE_ARTIFACT_TYPE,
      title: artifact.title,
      summaryText: artifact.path ?? artifact.type ?? `ElAgenteHarness ${module} artifact`,
      payload: {
        module,
        tool,
        runId: run?.runId ?? stringValue(entry, ['runId', 'run_id']),
        ...artifact,
      },
    });
  }
  return artifacts;
}

function appendArtifactFences(text, artifacts) {
  if (artifacts.length === 0) {
    return text;
  }
  return [
    text,
    '',
    ...artifacts.flatMap((artifact) => [
      '```remote-codex-artifact',
      JSON.stringify(artifact, null, 2),
      '```',
      '',
    ]),
  ].join('\n').trimEnd();
}

export function formatHarnessInvokeToolResultForTest(result, module, tool) {
  const artifacts = [
    ...harnessMoleculeArtifacts(result, module, tool),
    ...harnessGenericArtifacts(result, module, tool),
  ];
  return {
    text: appendArtifactFences(result.text ?? mcpJsonText(result.payload), artifacts),
    artifacts: artifacts.map((artifact) => ({
      artifactType: artifact.artifactType,
      title: artifact.title,
    })),
  };
}

const server = new McpServer({
  name: 'remote-codex-plugin-mcp',
  title: 'Remote Codex Plugin MCP',
  version: '0.1.0',
});

if (pluginEnabled(XYZ_VIEWER_PLUGIN_ID)) {
  server.registerTool(
    'remote_codex_render_molecule',
    {
      title: 'Render 3D Molecule',
      description:
        'Create a Remote Codex 3D molecule artifact from valid xyz, extxyz, cif, or pdb content. Use this when the user asks for a renderable molecular structure. Do not invent coordinates unless the user explicitly asks you to generate an example.',
      inputSchema: {
        title: z.string().trim().min(1).describe('Short display title for the molecule.'),
        format: z.enum(['xyz', 'extxyz', 'cif', 'pdb']).describe('Molecular source format.'),
        content: z.string().trim().min(1).describe('Raw molecule source text in the selected format.'),
        summaryText: z.string().trim().optional().describe('Optional short summary shown in the timeline.'),
        sourceDescription: z.string().trim().optional().describe('Optional note about where the coordinates came from.'),
      },
    },
    async ({ title, format, content, summaryText, sourceDescription }) => {
      if (!looksLikeMoleculeStructure(content, format)) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unable to create molecule artifact: content does not look like valid ${format} data.`,
            },
          ],
        };
      }

      const artifact = {
        type: 'remote-codex.artifact',
        artifactType: MOLECULE_ARTIFACT_TYPE,
        title,
        summaryText: summaryText ?? sourceDescription ?? `${format.toUpperCase()} molecule`,
        payload: {
          format,
          content: [content],
          name: title,
          sourceDescription: sourceDescription ?? null,
        },
      };

      const artifactJson = JSON.stringify(artifact, null, 2);
      return {
        content: [
          {
            type: 'text',
            text: [
              `Created a 3D molecule artifact for ${title}.`,
              '',
              '```remote-codex-artifact',
              artifactJson,
              '```',
            ].join('\n'),
          },
        ],
        structuredContent: {
          pluginId: XYZ_VIEWER_PLUGIN_ID,
          artifactType: MOLECULE_ARTIFACT_TYPE,
          title,
          format,
        },
      };
    },
  );
}

if (pluginEnabled(ELAGENTE_HARNESS_PLUGIN_ID)) {
  server.registerTool(
    'harness_status',
    {
      title: 'ElAgenteHarness Status',
      description:
        'Check whether ElAgenteHarness chemistry tools are configured for this sandbox worker.',
      inputSchema: {},
    },
    async () => {
      const config = harnessConfig();
      if (workerHarnessApiBaseUrl()) {
        try {
          const workerStatus = await fetchWorkerHarness('/api/harness/status');
          const status = {
            ...(workerStatus.payload ?? workerStatus),
            source: 'worker-api',
          };
          return mcpTextResult(mcpJsonText(status), status);
        } catch (error) {
          if (error instanceof WorkerHarnessApiError) {
            return mcpErrorResult(error);
          }
          if (!directHarnessFallbackAllowed()) {
            return mcpErrorResult(workerHarnessUnavailableError(error));
          }
        }
      }

      if (!config.configured) {
        const status = {
          enabled: Boolean(config.baseUrl),
          baseUrl: config.baseUrl,
          keyPresent: Boolean(config.apiKey),
          chemistryToolsEnabled: config.chemistryToolsEnabled,
          modules: HARNESS_MODULES,
          health: null,
        };
        return mcpTextResult(mcpJsonText(status), status);
      }

      try {
        const health = await fetchHarness('/health');
        const status = {
          enabled: true,
          baseUrl: config.baseUrl,
          keyPresent: true,
          chemistryToolsEnabled: config.chemistryToolsEnabled,
          modules: HARNESS_MODULES,
          health,
          source: 'direct-harness',
        };
        return mcpTextResult(mcpJsonText(status), status);
      } catch (error) {
        return mcpErrorResult(error);
      }
    },
  );

  server.registerTool(
    'harness_home',
    {
      title: 'ElAgenteHarness Home',
      description:
        'Fetch the ElAgenteHarness root discovery document through the worker-local Harness API.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await fetchPreferredHarness('/api/harness/home', '/');
        return mcpTextResult(result.text ?? mcpJsonText(result.payload), {
          result,
        });
      } catch (error) {
        return mcpErrorResult(error);
      }
    },
  );

  server.registerTool(
    'harness_help',
    {
      title: 'ElAgenteHarness Module Help',
      description: 'Fetch help text for an approved ElAgenteHarness chemistry module.',
      inputSchema: {
        module: z.enum(HARNESS_MODULES).describe('Harness module to inspect.'),
      },
    },
    async ({ module }) => {
      try {
        const result = await fetchPreferredHarness(
          `/api/harness/modules/${encodeURIComponent(module)}/help`,
          `/${module}/.help`,
        );
        return mcpTextResult(result.text ?? mcpJsonText(result.payload), {
          module,
        });
      } catch (error) {
        return mcpErrorResult(error);
      }
    },
  );

  server.registerTool(
    'harness_list_tools',
    {
      title: 'ElAgenteHarness List Tools',
      description: 'List tools advertised by an approved ElAgenteHarness chemistry module.',
      inputSchema: {
        module: z.enum(HARNESS_MODULES).describe('Harness module to inspect.'),
      },
    },
    async ({ module }) => {
      try {
        const result = await fetchPreferredHarness(
          `/api/harness/modules/${encodeURIComponent(module)}/tools`,
          `/${module}/tools`,
        );
        return mcpTextResult(result.text ?? mcpJsonText(result.payload), {
          module,
          result,
        });
      } catch (error) {
        return mcpErrorResult(error);
      }
    },
  );

  server.registerTool(
    'harness_invoke_tool',
    {
      title: 'ElAgenteHarness Invoke Tool',
      description:
        'Invoke an approved ElAgenteHarness JSON tool endpoint. Use harness_help or harness_list_tools first to inspect expected input.',
      inputSchema: {
        module: z.enum(HARNESS_MODULES).describe('Harness module containing the tool.'),
        tool: z.string().trim().regex(HARNESS_TOOL_NAME_PATTERN).describe('Harness tool name.'),
        input: z.record(z.string(), z.unknown()).describe('JSON object sent to the Harness tool.'),
        estimatedComputeUnits: z.number().nonnegative().optional().describe('Optional expected Harness compute units for quota preflight.'),
        estimatedCostUsd: z.number().nonnegative().optional().describe('Optional expected Harness cost in USD for quota preflight.'),
      },
    },
    async ({ module, tool, input, estimatedComputeUnits, estimatedCostUsd }) => {
      try {
        const toolName = requireHarnessToolName(tool);
        const workerInput = buildHarnessInvokeWorkerInputForTest(input, {
          estimatedComputeUnits,
          estimatedCostUsd,
        });
        const result = await fetchPreferredHarness(
          `/api/harness/modules/${encodeURIComponent(module)}/tools/${encodeURIComponent(toolName)}/invoke`,
          `/${module}/tools/${toolName}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify(workerHarnessApiBaseUrl() ? workerInput : input),
          },
        );
        const formatted = formatHarnessInvokeToolResultForTest(result, module, toolName);
        return mcpTextResult(formatted.text, {
          module,
          tool: toolName,
          result,
          artifacts: formatted.artifacts,
        });
      } catch (error) {
        return mcpErrorResult(error);
      }
    },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await server.connect(new StdioServerTransport());
}
