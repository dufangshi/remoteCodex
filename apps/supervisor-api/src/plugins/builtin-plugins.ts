import type { RegisteredPlugin } from '../../../../packages/plugin-runtime/src/index';
import { terminalPluginManifest } from '../../../../packages/plugin-terminal/src/index';
import { xyzViewerPluginManifest } from '../../../../packages/plugin-xyz-viewer/src/manifest';

export const builtinPlugins: RegisteredPlugin[] = [
  {
    manifest: terminalPluginManifest,
    enabledByDefault: true,
  },
  {
    manifest: xyzViewerPluginManifest,
    enabledByDefault: true,
  },
];
