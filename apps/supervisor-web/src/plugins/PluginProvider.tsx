import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  fetchPlugins,
  importPlugin,
  updatePlugin,
} from '../lib/api';
import type {
  ImportPluginInput,
  PluginDto,
  ThreadArtifactDto,
} from '../../../../packages/shared/src/index';
import {
  builtinFrontendPlugins,
} from './builtin-plugin-modules';
import { PluginContext, mergePluginState, type PluginContextValue } from './plugin-context';
import type {
  ArtifactRenderContext,
  InlineCodeRenderContext,
} from './plugin-types';

export function PluginProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<PluginDto[]>(() =>
    mergePluginState(builtinFrontendPlugins, []),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const serverPlugins = await fetchPlugins();
      setPlugins(mergePluginState(builtinFrontendPlugins, serverPlugins));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load plugins.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPluginEnabled = useCallback(
    async (pluginId: string, enabled: boolean) => {
      const updated = await updatePlugin(pluginId, { enabled });
      setPlugins((current) =>
        current.map((plugin) => (plugin.id === updated.id ? updated : plugin)),
      );
    },
    [],
  );

  const importPluginManifest = useCallback(async (input: ImportPluginInput) => {
    const imported = await importPlugin(input);
    setPlugins((current) => {
      const next = current.filter((plugin) => plugin.id !== imported.id);
      return [...next, imported];
    });
  }, []);

  const enabledModules = useMemo(() => {
    const enabledIds = new Set(
      plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id),
    );
    return builtinFrontendPlugins.filter((module) =>
      enabledIds.has(module.manifest.id),
    );
  }, [plugins]);

  const renderArtifact = useCallback(
    (context: ArtifactRenderContext) => {
      const module = enabledModules.find(
        (entry) =>
          entry.renderArtifact &&
          entry.manifest.capabilities.artifactTypes.some(
            (type) => type.type === context.artifact.type,
          ),
      );
      return module?.renderArtifact?.(context) ?? null;
    },
    [enabledModules],
  );

  const renderInlineCode = useCallback(
    (context: InlineCodeRenderContext) => {
      for (const module of enabledModules) {
        for (const renderer of module.inlineCodeRenderers ?? []) {
          if (!renderer.languages.includes(context.language.trim().toLowerCase())) {
            continue;
          }
          const rendered = renderer.render(context);
          if (rendered) {
            return rendered;
          }
        }
      }
      return null;
    },
    [enabledModules],
  );

  const hasRendererForArtifact = useCallback(
    (artifact: ThreadArtifactDto) =>
      enabledModules.some(
        (entry) =>
          Boolean(entry.renderArtifact) &&
          entry.manifest.capabilities.artifactTypes.some(
            (type) => type.type === artifact.type,
          ),
      ),
    [enabledModules],
  );

  const getThreadPanels = useCallback(
    () => enabledModules.flatMap((module) => module.threadPanels ?? []),
    [enabledModules],
  );

  const value = useMemo<PluginContextValue>(
    () => ({
      plugins,
      loading,
      error,
      refresh,
      importPluginManifest,
      setPluginEnabled,
      renderArtifact,
      renderInlineCode,
      hasRendererForArtifact,
      getThreadPanels,
    }),
    [
      error,
      getThreadPanels,
      hasRendererForArtifact,
      importPluginManifest,
      loading,
      plugins,
      refresh,
      renderArtifact,
      renderInlineCode,
      setPluginEnabled,
    ],
  );

  return (
    <PluginContext.Provider value={value}>
      {children}
    </PluginContext.Provider>
  );
}
