export const XYZ_MOLECULE_ARTIFACT_TYPE = 'chemistry.molecule3d';

export interface XyzViewerPluginManifest {
  id: 'remote-codex.xyz-viewer';
  name: string;
  version: string;
  description: string;
  remoteCodex: string;
  capabilities: {
    artifactTypes: Array<{
      type: typeof XYZ_MOLECULE_ARTIFACT_TYPE;
      title: string;
      fileExtensions: string[];
    }>;
    timelineRenderers: Array<typeof XYZ_MOLECULE_ARTIFACT_TYPE>;
    threadPanels: Array<{
      id: string;
      label: string;
      artifactTypes: Array<typeof XYZ_MOLECULE_ARTIFACT_TYPE>;
    }>;
    modelHints: Array<{
      id: string;
      text: string;
    }>;
    mcpServers: Array<{
      id: string;
      name: string;
      command: string;
      args: string[];
    }>;
    frontend: {
      entry: string;
      style: string;
    };
  };
}

export const xyzViewerPluginManifest: XyzViewerPluginManifest = {
  id: 'remote-codex.xyz-viewer',
  name: 'XYZ Molecule Viewer',
  version: '0.1.0',
  description:
    'A draft built-in plugin for previewing xyz, extxyz, cif, and pdb molecular structures with 3Dmol.js.',
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
    frontend: {
      entry: './dist/index.js',
      style: './src/styles.css',
    },
  },
};
