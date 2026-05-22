import type {
  PluginDto,
  PluginManifestDto,
} from '../../shared/src/index';
import type { RegisteredPlugin } from './types';

export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly enabled = new Map<string, boolean>();

  constructor(plugins: RegisteredPlugin[] = []) {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  register(plugin: RegisteredPlugin) {
    if (this.plugins.has(plugin.manifest.id)) {
      throw new Error(`Plugin is already registered: ${plugin.manifest.id}`);
    }
    this.plugins.set(plugin.manifest.id, plugin);
    this.enabled.set(plugin.manifest.id, plugin.enabledByDefault ?? true);
  }

  updateImported(plugin: RegisteredPlugin) {
    const existing = this.plugins.get(plugin.manifest.id);
    if (existing && existing.source !== 'imported') {
      throw new Error(`Built-in plugin cannot be replaced: ${plugin.manifest.id}`);
    }

    this.plugins.set(plugin.manifest.id, {
      ...plugin,
      source: 'imported',
    });
    this.enabled.set(plugin.manifest.id, plugin.enabledByDefault ?? true);
  }

  list(): PluginDto[] {
    return [...this.plugins.values()].map((plugin) =>
      this.toDto(plugin.manifest),
    );
  }

  get(pluginId: string): PluginDto | null {
    const plugin = this.plugins.get(pluginId);
    return plugin ? this.toDto(plugin.manifest) : null;
  }

  getManifest(pluginId: string): PluginManifestDto | null {
    return this.plugins.get(pluginId)?.manifest ?? null;
  }

  getRegistered(pluginId: string): RegisteredPlugin | null {
    return this.plugins.get(pluginId) ?? null;
  }

  isEnabled(pluginId: string) {
    return this.enabled.get(pluginId) ?? false;
  }

  setEnabled(pluginId: string, enabled: boolean): PluginDto {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin is not registered: ${pluginId}`);
    }

    this.enabled.set(pluginId, enabled);
    return this.toDto(plugin.manifest);
  }

  enabledManifests(): PluginManifestDto[] {
    return [...this.plugins.values()]
      .filter((plugin) => this.isEnabled(plugin.manifest.id))
      .map((plugin) => plugin.manifest);
  }

  private toDto(manifest: PluginManifestDto): PluginDto {
    return {
      ...manifest,
      enabled: this.isEnabled(manifest.id),
      source: this.plugins.get(manifest.id)?.source ?? 'builtin',
    };
  }
}
