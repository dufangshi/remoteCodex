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
  PluginMcpServerDto,
  PluginDto,
  PluginManifestDto,
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
const MAX_REMOTE_MANIFEST_BYTES = 1024 * 1024;

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
      lines.push('[mcp_servers.' + server.name + '.env]');
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

function normalizeManifestUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Plugin manifest URL is invalid.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Plugin manifest URL must use https.');
  }

  if (url.hostname === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo] = parts;
      if (parts[2] === 'blob' && parts[3]) {
        const branch = parts[3];
        const filePath = parts.slice(4).join('/') || 'plugin.json';
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
      }

      if (parts.length === 2 || parts[2] === 'tree') {
        const branch = parts[3] ?? 'main';
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/plugin.json`;
      }
    }
  }

  return url.toString();
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
    if (hints.length === 0) {
      return null;
    }
    return hints.map((hint) => hint.text.trim()).filter(Boolean).join('\n');
  }

  enabledMcpServers(): PluginMcpServerDto[] {
    const byName = new Map<string, PluginMcpServerDto & { pluginIds: string[] }>();
    for (const manifest of this.registry.enabledManifests()) {
      for (const server of manifest.capabilities.mcpServers ?? []) {
        const existing = byName.get(server.name);
        if (existing) {
          existing.pluginIds.push(manifest.id);
          byName.set(server.name, {
            ...existing,
            env: {
              ...(existing.env ?? {}),
              ...(server.env ?? {}),
            },
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

  async importPlugin(input: ImportPluginInput): Promise<PluginDto> {
    const manifestInput =
      input.manifest ??
      (input.manifestUrl
        ? await this.fetchManifestUrl(input.manifestUrl)
        : this.parseManifestJson(input.manifestJson));
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

  uninstallPlugin(pluginId: string): PluginDto {
    const removed = this.registry.unregisterImported(pluginId);
    this.settings.imported = this.settings.imported.filter(
      (manifest) => manifest.id !== pluginId,
    );
    delete this.settings.enabled[pluginId];
    this.persistSettings();
    return removed;
  }

  enrichTurnsWithArtifacts(input: {
    threadId: string;
    workspacePath: string;
    turns: ThreadTurnDto[];
  }): ThreadTurnDto[] {
    const manifests = this.registry.enabledManifests();
    if (manifests.length === 0) {
      return input.turns;
    }

    return appendArtifactItemsToTurns(
      input.turns,
      new ManifestArtifactExtractor(manifests),
      {
        threadId: input.threadId,
        workspacePath: input.workspacePath,
        now: new Date().toISOString(),
      },
    );
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
      throw new Error(
        'Plugin import requires a manifest object, manifestJson string, or manifestUrl.',
      );
    }

    return JSON.parse(manifestJson);
  }

  private async fetchManifestUrl(manifestUrl: string) {
    const url = normalizeManifestUrl(manifestUrl);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Plugin manifest URL returned HTTP ${response.status}.`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Plugin manifest URL returned an unreadable response.');
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        totalBytes += value.byteLength;
        if (totalBytes > MAX_REMOTE_MANIFEST_BYTES) {
          throw new Error('Plugin manifest URL response is too large.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const text = new TextDecoder().decode(Buffer.concat(chunks));
    return JSON.parse(text);
  }
}
