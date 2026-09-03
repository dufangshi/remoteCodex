import type {
  AgentBackendDto,
  AgentBackendIdDto,
  AgentBackendInstallationDto,
} from '../../../../packages/shared/src/index';
import {
  agentBackendIds,
  agentBackendMetadata,
  defaultAgentBackendId,
} from '../../../../packages/shared/src/index';
import { ApiError } from '../lib/api';
import type { AgentBackendId, ThemeMode } from './AppShellNavContext';

function menuItemClassName(active = false) {
  return `flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition ${
    active
      ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-strong)]'
      : 'text-[var(--theme-fg-soft)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]'
  }`;
}

const themeOptions: Array<{
  value: ThemeMode;
  label: string;
  description: string;
}> = [
  {
    value: 'light',
    label: 'Light',
    description: 'Always use the bright theme.',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Always use the dark theme.',
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow the operating system appearance.',
  },
];

const emptyManagementSchema: AgentBackendDto['managementSchema'] = {
  hostConfigFiles: [],
  toolboxItems: [],
  hookCommandTemplates: [],
  providerConfigFormat: 'none',
  mcpConfigFormat: 'none',
  configArchives: false,
  buildRestart: false,
};

const backendInstallationFallbacks: Record<
  AgentBackendIdDto,
  Pick<
    AgentBackendInstallationDto,
    'packageName' | 'installCommand' | 'updateCommand'
  >
> = {
  codex: {
    packageName: '@openai/codex',
    installCommand: null,
    updateCommand: 'npm install -g @openai/codex@latest',
  },
  claude: {
    packageName: '@anthropic-ai/claude-agent-sdk',
    installCommand:
      'npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk',
    updateCommand:
      'npm install -g @anthropic-ai/claude-code@latest @anthropic-ai/claude-agent-sdk@latest',
  },
  opencode: {
    packageName: 'opencode-ai',
    installCommand: 'npm install -g opencode-ai @opencode-ai/sdk',
    updateCommand: 'npm install -g opencode-ai@latest @opencode-ai/sdk@latest',
  },
  acp: {
    packageName: null,
    installCommand: null,
    updateCommand: null,
  },
};

function unavailableInstallation(
  provider: AgentBackendIdDto,
): AgentBackendInstallationDto {
  const fallback = backendInstallationFallbacks[provider];
  return {
    packageName: fallback.packageName,
    installed: provider === 'codex',
    installedVersion: null,
    latestVersion: null,
    installCommand: fallback.installCommand,
    updateCommand: fallback.updateCommand,
    busy: false,
    lastError: null,
  };
}

function unavailableBackend(
  provider: AgentBackendIdDto,
  displayName: string,
): AgentBackendDto {
  const descriptorUnavailable = provider === 'acp'
    ? 'This device supervisor does not advertise ACP. Update and restart Remote Codex, or add acp to REMOTE_CODEX_ENABLED_AGENT_PROVIDERS.'
    : 'Backend descriptor is not available.';
  return {
    provider,
    displayName,
    description: `${displayName} backend descriptor is not available.`,
    enabled: false,
    isDefault: provider === defaultAgentBackendId,
    status: {
      state: 'stopped',
      transport: agentBackendMetadata[provider].defaultTransport,
      lastStartedAt: null,
      lastError: descriptorUnavailable,
      restartCount: 0,
    },
    capabilities: {
      sessions: {
        list: false,
        read: false,
        resume: false,
        importLocal: false,
      },
      turns: {
        start: false,
        streamInput: false,
        steer: false,
        interrupt: false,
        compact: false,
      },
      branching: {
        fork: false,
        hardRollback: false,
        resumeAt: false,
        rewindFiles: false,
      },
      controls: {
        planMode: false,
        permissionRequests: false,
        sandboxMode: false,
        performanceMode: false,
        goals: false,
      },
      management: {
        models: false,
        mcpStatus: false,
        skills: false,
        hooks: false,
        hookTrust: false,
        hostConfigFiles: false,
        providerSettings: false,
      },
      usage: {
        contextWindow: false,
        tokenUsage: false,
        costUsd: false,
      },
    },
    managementSchema: emptyManagementSchema,
    installation: unavailableInstallation(provider),
  };
}

function normalizeBackendDescriptor(backend: AgentBackendDto): AgentBackendDto {
  const installation =
    backend.installation ?? unavailableInstallation(backend.provider);
  return {
    ...backend,
    installation: {
      ...unavailableInstallation(backend.provider),
      ...installation,
    },
  };
}

const fallbackBackends: AgentBackendDto[] = [
  ...agentBackendIds.map((provider) =>
    unavailableBackend(provider, agentBackendMetadata[provider].displayName),
  ),
];

function fallbackManagementSchema(provider: AgentBackendId) {
  return (
    fallbackBackends.find((backend) => backend.provider === provider)
      ?.managementSchema ?? emptyManagementSchema
  );
}

function formatArchiveDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function apiErrorMessage(error: ApiError) {
  const details = error.payload.details;
  const detailText =
    typeof details?.stderr === 'string' && details.stderr.trim()
      ? details.stderr.trim()
      : typeof details?.stdout === 'string' && details.stdout.trim()
        ? details.stdout.trim()
        : null;
  return detailText ? `${error.message}\n${detailText}` : error.message;
}

function defaultProviderHostFileState(name: string) {
  return {
    path: name,
    exists: false,
    originalContent: '',
    draftContent: '',
    loading: false,
    saving: false,
    error: null as string | null,
    saveMessage: null as string | null,
  };
}

export {
  apiErrorMessage,
  defaultProviderHostFileState,
  emptyManagementSchema,
  fallbackBackends,
  fallbackManagementSchema,
  formatArchiveDate,
  menuItemClassName,
  normalizeBackendDescriptor,
  themeOptions,
  unavailableBackend,
  unavailableInstallation,
};
