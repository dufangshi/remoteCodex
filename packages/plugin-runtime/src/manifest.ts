import type { PluginManifestDto } from '../../shared/src/index';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Plugin manifest field "${field}" must be a non-empty string.`);
  }
  return value.trim();
}

function optionalStringArray(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Plugin manifest field "${field}" must be an array of strings.`);
  }
  return value;
}

function optionalStringRecord(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Plugin manifest field "${field}" must be an object.`);
  }
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== 'string')) {
    throw new Error(`Plugin manifest field "${field}" must contain string values.`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function parsePluginManifest(value: unknown): PluginManifestDto {
  if (!isRecord(value)) {
    throw new Error('Plugin manifest must be an object.');
  }

  const capabilities = value.capabilities;
  if (!isRecord(capabilities)) {
    throw new Error('Plugin manifest field "capabilities" must be an object.');
  }

  const artifactTypes = capabilities.artifactTypes;
  if (!Array.isArray(artifactTypes)) {
    throw new Error('Plugin manifest field "capabilities.artifactTypes" must be an array.');
  }

  const timelineRenderers = optionalStringArray(
    capabilities.timelineRenderers,
    'capabilities.timelineRenderers',
  ) ?? [];

  const threadPanels = capabilities.threadPanels;
  if (threadPanels !== undefined && !Array.isArray(threadPanels)) {
    throw new Error('Plugin manifest field "capabilities.threadPanels" must be an array.');
  }

  const frontend = capabilities.frontend;
  if (frontend !== undefined && !isRecord(frontend)) {
    throw new Error('Plugin manifest field "capabilities.frontend" must be an object.');
  }

  const backend = capabilities.backend;
  if (backend !== undefined && !isRecord(backend)) {
    throw new Error('Plugin manifest field "capabilities.backend" must be an object.');
  }

  const modelHints = capabilities.modelHints;
  if (modelHints !== undefined && !Array.isArray(modelHints)) {
    throw new Error('Plugin manifest field "capabilities.modelHints" must be an array.');
  }

  const mcpServers = capabilities.mcpServers;
  if (mcpServers !== undefined && !Array.isArray(mcpServers)) {
    throw new Error('Plugin manifest field "capabilities.mcpServers" must be an array.');
  }

  return {
    id: assertString(value.id, 'id'),
    name: assertString(value.name, 'name'),
    version: assertString(value.version, 'version'),
    description: assertString(value.description, 'description'),
    remoteCodex: assertString(value.remoteCodex, 'remoteCodex'),
    capabilities: {
      artifactTypes: artifactTypes.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(
            `Plugin manifest field "capabilities.artifactTypes[${index}]" must be an object.`,
          );
        }
        const parsed = {
          type: assertString(entry.type, `capabilities.artifactTypes[${index}].type`),
          title: assertString(entry.title, `capabilities.artifactTypes[${index}].title`),
        };
        const fileExtensions = optionalStringArray(
          entry.fileExtensions,
          `capabilities.artifactTypes[${index}].fileExtensions`,
        );
        return fileExtensions
          ? {
              ...parsed,
              fileExtensions,
            }
          : parsed;
      }),
      timelineRenderers,
      threadPanels: (threadPanels ?? []).map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(
            `Plugin manifest field "capabilities.threadPanels[${index}]" must be an object.`,
          );
        }
        return {
          id: assertString(entry.id, `capabilities.threadPanels[${index}].id`),
          label: assertString(entry.label, `capabilities.threadPanels[${index}].label`),
          artifactTypes: optionalStringArray(
            entry.artifactTypes,
            `capabilities.threadPanels[${index}].artifactTypes`,
          ) ?? [],
        };
      }),
      modelHints: (modelHints ?? []).map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(
            `Plugin manifest field "capabilities.modelHints[${index}]" must be an object.`,
          );
        }
        return {
          id: assertString(entry.id, `capabilities.modelHints[${index}].id`),
          text: assertString(entry.text, `capabilities.modelHints[${index}].text`),
        };
      }),
      mcpServers: (mcpServers ?? []).map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(
            `Plugin manifest field "capabilities.mcpServers[${index}]" must be an object.`,
          );
        }
        const args = optionalStringArray(
          entry.args,
          `capabilities.mcpServers[${index}].args`,
        );
        const env = optionalStringRecord(
          entry.env,
          `capabilities.mcpServers[${index}].env`,
        );
        return {
          id: assertString(entry.id, `capabilities.mcpServers[${index}].id`),
          name: assertString(entry.name, `capabilities.mcpServers[${index}].name`),
          command: assertString(entry.command, `capabilities.mcpServers[${index}].command`),
          ...(args ? { args } : {}),
          ...(env ? { env } : {}),
        };
      }),
      ...(frontend
        ? {
            frontend: {
              ...(typeof frontend.entry === 'string' ? { entry: frontend.entry } : {}),
              ...(typeof frontend.style === 'string' ? { style: frontend.style } : {}),
            },
          }
        : {}),
      ...(backend
        ? {
            backend: {
              ...(typeof backend.entry === 'string' ? { entry: backend.entry } : {}),
            },
          }
        : {}),
    },
  };
}
