import type { PluginManifestDto } from '../../../../packages/shared/src/index';

const XYZ_MOLECULE_ARTIFACT_TYPE = 'chemistry.molecule3d';

export const xyzViewerPluginManifest: PluginManifestDto = {
  id: 'remote-codex.xyz-viewer',
  name: 'XYZ Molecule Viewer',
  version: '0.1.0',
  description:
    'A built-in plugin for previewing xyz, extxyz, cif, and pdb molecular structures.',
  remoteCodex: '^0.11.0',
  capabilities: {
    artifactTypes: [
      {
        type: XYZ_MOLECULE_ARTIFACT_TYPE,
        title: '3D Molecule',
        fileExtensions: ['xyz', 'extxyz', 'cif', 'pdb'],
      },
    ],
    timelineRenderers: [XYZ_MOLECULE_ARTIFACT_TYPE],
    threadPanels: [
      {
        id: 'xyz-viewer',
        label: 'Molecules',
        artifactTypes: [XYZ_MOLECULE_ARTIFACT_TYPE],
      },
    ],
    modelHints: [
      {
        id: 'render-molecule',
        text:
          'XYZ Molecule Viewer is enabled. When outputting a molecular structure, you must call remote_codex_render_molecule; do not output plain xyz, pdb, cif, or extxyz text. Do not invent coordinates unless asked for an example.',
      },
    ],
    mcpServers: [
      {
        id: 'remote-codex-plugin-mcp',
        name: 'remote_codex_plugins',
        command: 'node',
        args: ['bin/remote-codex-plugin-mcp.mjs'],
      },
    ],
  },
};
