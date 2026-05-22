import {
  appendArtifactItemsToTurns,
  ManifestArtifactExtractor,
  parsePluginManifest,
  PluginRegistry,
} from '../../../../packages/plugin-runtime/src/index';
import type {
  ImportPluginInput,
  PluginDto,
  PluginManifestDto,
  ThreadTurnDto,
} from '../../../../packages/shared/src/index';
import type {
  PersistedPluginSettings,
  PluginSettingsStore,
} from './plugin-settings-store';

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
      throw new Error('Plugin import requires a manifest object or manifestJson string.');
    }

    return JSON.parse(manifestJson);
  }
}
