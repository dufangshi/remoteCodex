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

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 fill-current"
    >
      <path d="M2 3.25h12v1.5H2Zm0 4h12v1.5H2Zm0 4h12v1.5H2Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 fill-current"
    >
      <path d="M3.22 2.47 8 7.25l4.78-4.78 1.06 1.06L9.06 8.31l4.78 4.78-1.06 1.06L8 9.37l-4.78 4.78-1.06-1.06 4.78-4.78-4.78-4.78 1.06-1.06Z" />
    </svg>
  );
}

function menuItemClassName(disabled = false) {
  return `flex w-full items-center rounded-[0.95rem] px-3 py-2 text-left text-sm transition ${
    disabled
      ? 'cursor-not-allowed bg-[var(--theme-muted)] text-[var(--theme-fg-muted)]'
      : 'text-[var(--theme-fg)] hover:bg-[var(--theme-hover)]'
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
      lastError: 'Backend descriptor is not available.',
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
  CloseIcon,
  MenuIcon,
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
