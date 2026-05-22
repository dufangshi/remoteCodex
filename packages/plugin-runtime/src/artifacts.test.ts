import { describe, expect, it } from 'vitest';

import {
  ManifestArtifactExtractor,
  appendArtifactItemsToTurns,
  looksLikeMoleculeStructure,
} from './artifacts';
import type {
  PluginManifestDto,
  ThreadTurnDto,
} from '../../shared/src/index';

const xyzViewerManifest: PluginManifestDto = {
  id: 'remote-codex.xyz-viewer',
  name: 'XYZ Molecule Viewer',
  version: '0.1.0',
  description: 'Test manifest',
  remoteCodex: '^0.11.0',
  capabilities: {
    artifactTypes: [
      {
        type: 'chemistry.molecule3d',
        title: '3D Molecule',
        fileExtensions: ['xyz'],
      },
    ],
    timelineRenderers: ['chemistry.molecule3d'],
    threadPanels: [],
  },
};

const waterXyz = `3
water
O 0.000000 0.000000 0.000000
H 0.758602 0.000000 0.504284
H 0.758602 0.000000 -0.504284
`;

const benzeneXyz = `12
benzene example
C        0.00000        1.40272        0.00000
H        0.00000        2.49029        0.00000
C       -1.21479        0.70136        0.00000
H       -2.15666        1.24515        0.00000
C       -1.21479       -0.70136        0.00000
H       -2.15666       -1.24515        0.00000
C        0.00000       -1.40272        0.00000
H        0.00000       -2.49029        0.00000
C        1.21479       -0.70136        0.00000
H        2.15666       -1.24515        0.00000
C        1.21479        0.70136        0.00000
H        2.15666        1.24515        0.00000
`;

describe('ManifestArtifactExtractor', () => {
  it('extracts explicit artifact payloads into timeline items', () => {
    const turns: ThreadTurnDto[] = [
      {
        id: 'turn-1',
        startedAt: '2026-05-22T00:00:00.000Z',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'item-1',
            kind: 'agentMessage',
            text: [
              'Here is a water molecule.',
              '',
              '```artifact',
              JSON.stringify({
                type: 'remote-codex.artifact',
                artifactType: 'chemistry.molecule3d',
                title: 'Water',
                payload: {
                  format: 'xyz',
                  content: [waterXyz],
                },
              }),
              '```',
            ].join('\n'),
            sequence: 1,
          },
        ],
      },
    ];

    const enriched = appendArtifactItemsToTurns(
      turns,
      new ManifestArtifactExtractor([xyzViewerManifest]),
      {
        threadId: 'thread-1',
        workspacePath: '/tmp',
        now: '2026-05-22T00:00:00.000Z',
      },
    );

    expect(enriched[0]?.items).toHaveLength(2);
    const artifactItem = enriched[0]?.items[1];
    expect(artifactItem).toMatchObject({
      kind: 'artifact',
      artifact: {
        pluginId: 'remote-codex.xyz-viewer',
        type: 'chemistry.molecule3d',
        payload: {
          format: 'xyz',
          content: [waterXyz],
        },
      },
    });
  });

  it('does not append timeline artifact items for molecule code fences', () => {
    const turns: ThreadTurnDto[] = [
      {
        id: 'turn-1',
        startedAt: '2026-05-22T00:00:00.000Z',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'item-1',
            kind: 'agentMessage',
            text: [
              'Use this shape when asking the agent to render a molecule:',
              '',
              '````markdown',
              '```xyz',
              '文件内容...',
              '```',
              '````',
              '',
              '```xyz',
              '...',
              '```',
              '',
              `\`\`\`xyz\n${waterXyz}\`\`\``,
            ].join('\n'),
            sequence: 1,
          },
        ],
      },
    ];

    const enriched = appendArtifactItemsToTurns(
      turns,
      new ManifestArtifactExtractor([xyzViewerManifest]),
      {
        threadId: 'thread-1',
        workspacePath: '/tmp',
        now: '2026-05-22T00:00:00.000Z',
      },
    );

    const artifactItems = enriched[0]?.items.filter((item) => item.kind === 'artifact') ?? [];
    expect(artifactItems).toHaveLength(0);
  });

  it('recognizes standalone benzene xyz content for inline renderers', () => {
    expect(looksLikeMoleculeStructure(benzeneXyz, 'xyz')).toBe(true);
    expect(looksLikeMoleculeStructure('文件内容...', 'xyz')).toBe(false);
    expect(looksLikeMoleculeStructure('...', 'xyz')).toBe(false);
  });
});
