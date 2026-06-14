import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { RegisteredPlugin } from '../../../../packages/plugin-runtime/src/index';
import { terminalPluginManifest } from '../../../../packages/plugin-terminal/src/index';

const require = createRequire(import.meta.url);
const xyzViewerPluginManifest = JSON.parse(
  fs.readFileSync(require.resolve('@remote-codex/plugin-xyz-viewer/plugin.json'), 'utf8'),
) as RegisteredPlugin['manifest'];

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
