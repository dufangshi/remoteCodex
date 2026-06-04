import {
  appendArtifactItemsToTurns,
  ManifestArtifactExtractor,
  parsePluginManifest,
  PluginRegistry,
} from '../../../../packages/plugin-runtime/src/index';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ImportPluginInput,
  ThreadHistoryItemDetailDto,
  PluginMcpServerDto,
  PluginDto,
  PluginManifestDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../../../packages/shared/src/index';
import type {
  PersistedPluginSettings,
  PluginSettingsStore,
} from './plugin-settings-store';

const MANAGED_CODEX_MCP_BEGIN =
  '# BEGIN remote-codex managed plugin MCP servers';
const MANAGED_CODEX_MCP_END =
  '# END remote-codex managed plugin MCP servers';

function jsonString(value: string) {
  return JSON.stringify(value);
}

function normalizeManagedCommand(server: PluginMcpServerDto, repoRoot: string) {
  if (server.name === 'remote_codex_plugins') {
    return {
      command: process.execPath,
      args: [path.join(repoRoot, 'bin', 'remote-codex-plugin-mcp.mjs')],
    };
  }

  return {
    command: server.command,
    args: server.args ?? [],
  };
}

function stripManagedCodexMcpBlock(content: string) {
  const pattern = new RegExp(
    `\\n?${MANAGED_CODEX_MCP_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MANAGED_CODEX_MCP_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
    'g',
  );
  return content.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function buildManagedCodexMcpBlock(servers: PluginMcpServerDto[], repoRoot: string) {
  if (servers.length === 0) {
    return '';
  }

  const lines = [
    MANAGED_CODEX_MCP_BEGIN,
    '# This block is generated from enabled Remote Codex plugins.',
  ];
  for (const server of servers) {
    const normalized = normalizeManagedCommand(server, repoRoot);
    lines.push(
      '',
      `[mcp_servers.${server.name}]`,
      `command = ${jsonString(normalized.command)}`,
      `args = ${JSON.stringify(normalized.args)}`,
    );

    const envEntries = Object.entries(server.env ?? {});
    if (envEntries.length > 0) {
      lines.push(`[mcp_servers.${server.name}.env]`);
      for (const [key, value] of envEntries) {
        lines.push(`${key} = ${jsonString(value)}`);
      }
    }
  }
  lines.push(MANAGED_CODEX_MCP_END);
  return lines.join('\n');
}

function upsertManagedCodexMcpBlock(
  content: string,
  servers: PluginMcpServerDto[],
  repoRoot: string,
) {
  const stripped = stripManagedCodexMcpBlock(content);
  const managedBlock = buildManagedCodexMcpBlock(servers, repoRoot);
  if (!managedBlock) {
    return stripped ? `${stripped}\n` : '';
  }
  return `${stripped ? `${stripped}\n\n` : ''}${managedBlock}\n`;
}

export class PluginService {
  private settings: PersistedPluginSettings = {
    enabled: {},
    imported: [],
  };

  constructor(
    private readonly registry: PluginRegistry,
    private readonly settingsStore?: PluginSettingsStore,
  ) {
    this.loadPersistedSettings();
  }

  listPlugins(): PluginDto[] {
    return this.registry.list();
  }

  getPlugin(pluginId: string): PluginDto | null {
    return this.registry.get(pluginId);
  }

  setPluginEnabled(pluginId: string, enabled: boolean): PluginDto {
    const plugin = this.registry.setEnabled(pluginId, enabled);
    this.settings.enabled[pluginId] = enabled;
    this.persistSettings();
    return plugin;
  }

  modelContextPrompt(): string | null {
    const hints = this.registry.enabledManifests().flatMap(
      (manifest) => manifest.capabilities.modelHints ?? [],
    );
    const text = hints.map((hint) => hint.text.trim()).filter(Boolean).join('\n');
    return text || null;
  }

  enabledMcpServers(): PluginMcpServerDto[] {
    const byName = new Map<string, PluginMcpServerDto & { pluginIds: string[] }>();
    for (const manifest of this.registry.enabledManifests()) {
      for (const server of manifest.capabilities.mcpServers ?? []) {
        const existing = byName.get(server.name);
        if (existing) {
          byName.set(server.name, {
            ...existing,
            env: {
              ...(existing.env ?? {}),
              ...(server.env ?? {}),
            },
            pluginIds: [...existing.pluginIds, manifest.id],
          });
        } else {
          byName.set(server.name, {
            ...server,
            pluginIds: [manifest.id],
          });
        }
      }
    }

    return [...byName.values()].map(({ pluginIds, ...server }) => ({
      ...server,
      env: {
        ...(server.env ?? {}),
        REMOTE_CODEX_ENABLED_PLUGIN_IDS: [...new Set(pluginIds)].sort().join(','),
      },
    }));
  }

  async syncManagedCodexMcpConfig(input: {
    codexHome?: string | null;
    repoRoot: string;
  }) {
    if (!input.codexHome) {
      return;
    }

    const configPath = path.join(input.codexHome, 'config.toml');
    let current = '';
    try {
      current = await fs.readFile(configPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const next = upsertManagedCodexMcpBlock(
      current,
      this.enabledMcpServers(),
      input.repoRoot,
    );
    if (next === current) {
      return;
    }

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, next, 'utf8');
  }

  importPlugin(input: ImportPluginInput): PluginDto {
    const manifestInput = input.manifest ?? this.parseManifestJson(input.manifestJson);
    const manifest = parsePluginManifest(manifestInput);
    const enabled = input.enabled ?? true;
    const existing = this.registry.getRegistered(manifest.id);
    if (existing && existing.source !== 'imported') {
      throw new Error(`Built-in plugin cannot be replaced: ${manifest.id}`);
    }

    this.registerImportedManifest(manifest, enabled);

    const existingIndex = this.settings.imported.findIndex(
      (entry) => entry.id === manifest.id,
    );
    if (existingIndex >= 0) {
      this.settings.imported[existingIndex] = manifest;
    } else {
      this.settings.imported.push(manifest);
    }
    this.settings.enabled[manifest.id] = enabled;
    this.persistSettings();

    const plugin = this.registry.get(manifest.id);
    if (!plugin) {
      throw new Error(`Plugin import failed: ${manifest.id}`);
    }
    return plugin;
  }

  enrichTurnsWithArtifacts(input: {
    threadId: string;
    workspacePath: string;
    turns: ThreadTurnDto[];
    deferredDetails?: Map<string, ThreadHistoryItemDetailDto>;
  }): ThreadTurnDto[] {
    const manifests = this.registry.enabledManifests();
    if (manifests.length === 0) {
      return input.turns;
    }

    const turnsForExtraction = input.deferredDetails
      ? materializeDeferredDetailsForArtifactExtraction(
          input.turns,
          input.deferredDetails,
        )
      : input.turns;

    const enrichedTurns = appendArtifactItemsToTurns(
      turnsForExtraction,
      new ManifestArtifactExtractor(manifests),
      {
        threadId: input.threadId,
        workspacePath: input.workspacePath,
        now: new Date().toISOString(),
      },
    );
    return turnsForExtraction === input.turns
      ? enrichedTurns
      : restoreOriginalNonArtifactItems(enrichedTurns, input.turns);
  }

  private loadPersistedSettings() {
    if (!this.settingsStore) {
      return;
    }

    this.settings = this.settingsStore.load();
    for (const manifest of this.settings.imported) {
      this.registerImportedManifest(
        manifest,
        this.settings.enabled[manifest.id] ?? true,
      );
    }

    for (const [pluginId, enabled] of Object.entries(this.settings.enabled)) {
      if (this.registry.get(pluginId)) {
        this.registry.setEnabled(pluginId, enabled);
      }
    }
  }

  private registerImportedManifest(
    manifest: PluginManifestDto,
    enabled: boolean,
  ) {
    if (this.registry.get(manifest.id)) {
      const existing = this.registry.getRegistered(manifest.id);
      if (existing?.source === 'imported') {
        this.registry.updateImported({
          manifest,
          enabledByDefault: enabled,
          source: 'imported',
        });
      } else {
        this.registry.setEnabled(manifest.id, enabled);
      }
      return;
    }

    this.registry.register({
      manifest,
      enabledByDefault: enabled,
      source: 'imported',
    });
  }

  private persistSettings() {
    this.settingsStore?.save(this.settings);
  }

  private parseManifestJson(manifestJson: string | undefined) {
    if (!manifestJson?.trim()) {
      throw new Error('Plugin import requires a manifest object or manifestJson string.');
    }

    return JSON.parse(manifestJson);
  }
}

function restoreOriginalNonArtifactItems(
  enrichedTurns: ThreadTurnDto[],
  originalTurns: ThreadTurnDto[],
): ThreadTurnDto[] {
  const originalItemsByTurnId = new Map(
    originalTurns.map((turn) => [
      turn.id,
      new Map(turn.items.map((item) => [item.id, item])),
    ]),
  );

  return enrichedTurns.map((turn) => {
    const originalItems = originalItemsByTurnId.get(turn.id);
    if (!originalItems) {
      return turn;
    }

    return {
      ...turn,
      items: turn.items.map((item) =>
        item.kind === 'artifact' ? item : originalItems.get(item.id) ?? item,
      ),
    };
  });
}

function materializeDeferredDetailsForArtifactExtraction(
  turns: ThreadTurnDto[],
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto[] {
  if (deferredDetails.size === 0) {
    return turns;
  }

  return turns.map((turn) => {
    let changed = false;
    const items = turn.items.map((item): ThreadHistoryItemDto => {
      if (!item.hasDeferredDetail || item.detailText) {
        return item;
      }

      const detail = deferredDetails.get(item.id);
      if (!detail?.text) {
        return item;
      }

      changed = true;
      return {
        ...item,
        detailText: detail.text,
      };
    });

    return changed
      ? {
          ...turn,
          items,
        }
      : turn;
  });
}
