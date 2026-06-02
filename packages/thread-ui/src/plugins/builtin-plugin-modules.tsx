import {
  xyzViewerPluginManifest,
} from '@remote-codex/plugin-xyz-viewer';
import { terminalPluginManifest } from '@remote-codex/plugin-terminal';
import type { FrontendPluginModule } from './plugin-types';
import {
  InlineXyzRenderer,
  XyzArtifactRenderer,
} from './xyz-plugin-renderers';

export const builtinFrontendPlugins: FrontendPluginModule[] = [
  {
    manifest: terminalPluginManifest,
    threadPanels: [
      {
        id: 'terminal',
        kind: 'terminal',
        label: 'Terminal',
      },
    ],
  },
  {
    manifest: xyzViewerPluginManifest,
    renderArtifact: (context) => <XyzArtifactRenderer {...context} />,
    inlineCodeRenderers: [
      {
        languages: ['xyz', 'extxyz', 'cif', 'pdb'],
        render: (context) => <InlineXyzRenderer {...context} />,
      },
    ],
  },
];
