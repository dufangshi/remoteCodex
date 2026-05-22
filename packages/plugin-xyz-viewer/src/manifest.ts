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
    frontend: {
      entry: './dist/index.js',
      style: './src/styles.css',
    },
  },
};
