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

  it('extracts artifact payloads from tool call detail text', () => {
    const turns: ThreadTurnDto[] = [
      {
        id: 'turn-1',
        startedAt: '2026-05-22T00:00:00.000Z',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'tool-1',
            kind: 'toolCall',
            text: 'remote_codex_render_molecule',
            detailText: [
              'Result',
              '',
              '```remote-codex-artifact',
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
    expect(enriched[0]?.items[1]).toMatchObject({
      kind: 'artifact',
      artifact: {
        pluginId: 'remote-codex.xyz-viewer',
        type: 'chemistry.molecule3d',
        title: 'Water',
      },
    });
  });

  it('extracts artifact payloads from JSON-encoded MCP tool result text', () => {
    const artifactPayload = {
      type: 'remote-codex.artifact',
      artifactType: 'chemistry.molecule3d',
      title: 'Water',
      payload: {
        format: 'xyz',
        content: [waterXyz],
      },
    };
    const turns: ThreadTurnDto[] = [
      {
        id: 'turn-1',
        startedAt: '2026-05-22T00:00:00.000Z',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'tool-1',
            kind: 'toolCall',
            text: 'remote_codex_plugins/remote_codex_render_molecule',
            detailText: [
              'remote_codex_plugins/remote_codex_render_molecule',
              'Status: completed',
              '',
              'Result',
              JSON.stringify({
                output: {
                  content: [
                    {
                      type: 'text',
                      text: [
                        'Created a 3D molecule artifact for Water.',
                        '',
                        '```remote-codex-artifact',
                        JSON.stringify(artifactPayload),
                        '```',
                      ].join('\n'),
                    },
                  ],
                },
              }),
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
    expect(enriched[0]?.items[1]).toMatchObject({
      kind: 'artifact',
      artifact: {
        pluginId: 'remote-codex.xyz-viewer',
        type: 'chemistry.molecule3d',
        title: 'Water',
      },
    });
  });

  it('does not scan arbitrary large tool text as JSON fragments', () => {
    const turns: ThreadTurnDto[] = [
      {
        id: 'turn-1',
        startedAt: '2026-05-22T00:00:00.000Z',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'tool-1',
            kind: 'toolCall',
            text: 'large noisy tool output',
            detailText: Array.from({ length: 20_000 }, (_, index) => `{${index}}`).join('\n'),
            sequence: 1,
          },
        ],
      },
    ];

    const startedAt = performance.now();
    const enriched = appendArtifactItemsToTurns(
      turns,
      new ManifestArtifactExtractor([xyzViewerManifest]),
      {
        threadId: 'thread-1',
        workspacePath: '/tmp',
        now: '2026-05-22T00:00:00.000Z',
      },
    );

    expect(enriched[0]?.items).toHaveLength(1);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it('does not extract artifacts from JSON-encoded results for unrelated tools', () => {
    const artifactPayload = {
      type: 'remote-codex.artifact',
      artifactType: 'chemistry.molecule3d',
      title: 'Water',
      payload: {
        format: 'xyz',
        content: [waterXyz],
      },
    };
    const turns: ThreadTurnDto[] = [
      {
        id: 'turn-1',
        startedAt: '2026-05-22T00:00:00.000Z',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'tool-1',
            kind: 'toolCall',
            text: 'other_mcp_server/other_tool',
            detailText: [
              'other_mcp_server/other_tool',
              'Status: completed',
              '',
              'Result',
              JSON.stringify({
                output: {
                  content: [
                    {
                      type: 'text',
                      text: [
                        'This should stay inside the unrelated tool details.',
                        '',
                        '```remote-codex-artifact',
                        JSON.stringify(artifactPayload),
                        '```',
                      ].join('\n'),
                    },
                  ],
                },
              }),
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

    expect(enriched[0]?.items).toHaveLength(1);
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
