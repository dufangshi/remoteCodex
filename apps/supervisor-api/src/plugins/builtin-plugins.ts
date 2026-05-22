import type { RegisteredPlugin } from '../../../../packages/plugin-runtime/src/index';
import { xyzViewerPluginManifest } from '../../../../packages/plugin-xyz-viewer/src/manifest';

export const builtinPlugins: RegisteredPlugin[] = [
  {
    manifest: xyzViewerPluginManifest,
    enabledByDefault: true,
  },
];
