import { createContext, type ReactNode } from 'react';

import type {
  ImportPluginInput,
  PluginDto,
  ThreadArtifactDto,
} from '../../../../packages/shared/src/index';
import { builtinFrontendPlugins } from './builtin-plugin-modules';
import type {
  ArtifactRenderContext,
  FrontendPluginModule,
  InlineCodeRenderContext,
  ThreadPanelContribution,
} from './plugin-types';

export interface PluginContextValue {
  plugins: PluginDto[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  importPluginManifest: (input: ImportPluginInput) => Promise<void>;
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  uninstallPlugin: (pluginId: string) => Promise<void>;
  renderArtifact: (context: ArtifactRenderContext) => ReactNode | null;
  renderInlineCode: (context: InlineCodeRenderContext) => ReactNode | null;
  hasRendererForArtifact: (artifact: ThreadArtifactDto) => boolean;
  getThreadPanels: () => ThreadPanelContribution[];
}

export function mergePluginState(
  modules: FrontendPluginModule[],
  serverPlugins: PluginDto[],
): PluginDto[] {
  const byId = new Map(serverPlugins.map((plugin) => [plugin.id, plugin]));
  const merged: PluginDto[] = modules.map((module) => ({
    ...module.manifest,
    enabled: byId.get(module.manifest.id)?.enabled ?? true,
    source: byId.get(module.manifest.id)?.source ?? 'builtin',
  }));
  const moduleIds = new Set(modules.map((module) => module.manifest.id));
  for (const plugin of serverPlugins) {
    if (!moduleIds.has(plugin.id)) {
      merged.push(plugin);
    }
  }
  return merged;
}

function createDefaultPluginContext(): PluginContextValue {
  const plugins = mergePluginState(builtinFrontendPlugins, []);
  const enabledModules = builtinFrontendPlugins;
  return {
    plugins,
    loading: false,
    error: null,
    async refresh() {},
    async importPluginManifest() {},
    async setPluginEnabled() {},
    async uninstallPlugin() {},
    renderArtifact: () => null,
    renderInlineCode: () => null,
    hasRendererForArtifact: () => false,
    getThreadPanels: () =>
      enabledModules.flatMap((module) => module.threadPanels ?? []),
  };
}

export const PluginContext = createContext<PluginContextValue>(createDefaultPluginContext());
