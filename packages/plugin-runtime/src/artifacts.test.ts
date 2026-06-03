import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

const elagenteHarnessManifest: PluginManifestDto = {
  id: 'remote-codex.elagente-harness',
  name: 'ElAgente Harness Tools',
  version: '0.1.0',
  description: 'Test Harness manifest',
  remoteCodex: '^0.11.0',
  capabilities: {
    artifactTypes: [
      {
        type: 'elagente.harness.run',
        title: 'ElAgente Harness Run',
      },
      {
        type: 'elagente.harness.artifact',
        title: 'ElAgente Harness Artifact',
      },
    ],
    timelineRenderers: [],
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
        title: 'Water',
        type: 'chemistry.molecule3d',
      },
    });
  });

  it('extracts ElAgenteHarness run artifact payloads into timeline items', () => {
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
            text: 'harness_invoke_tool',
            detailText: [
              'Result',
              '',
              '```remote-codex-artifact',
              JSON.stringify({
                type: 'remote-codex.artifact',
                artifactType: 'elagente.harness.run',
                title: 'farmaco submit_docking_job run run-123',
                summaryText: 'status: running, artifacts: 1',
                payload: {
                  module: 'farmaco',
                  tool: 'submit_docking_job',
                  runId: 'run-123',
                  jobId: 'job-123',
                  status: 'running',
                  artifactRefs: [
                    {
                      title: 'farmaco_artifacts.zip',
                      path: 'farmaco_artifacts.zip',
                      downloadUrl:
                        '/api/sandbox/harness/modules/farmaco/runs/run-123/download.zip',
                    },
                  ],
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
      new ManifestArtifactExtractor([elagenteHarnessManifest]),
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
        pluginId: 'remote-codex.elagente-harness',
        type: 'elagente.harness.run',
        title: 'farmaco submit_docking_job run run-123',
        summaryText: 'status: running, artifacts: 1',
        payload: {
          module: 'farmaco',
          tool: 'submit_docking_job',
          runId: 'run-123',
          jobId: 'job-123',
          status: 'running',
        },
      },
    });
  });

  it('formats ElAgenteHarness MCP invoke results with generic artifact fences', async () => {
    const mcpModule = await import(
      pathToFileURL(
        path.resolve(process.cwd(), '../../bin/remote-codex-plugin-mcp.mjs'),
      ).href
    );
    const formatted = mcpModule.formatHarnessInvokeToolResultForTest(
      {
        payload: {
          run_id: 'run-123',
          job_id: 'job-123',
          status: 'running',
          artifacts: [
            {
              title: 'farmaco_artifacts.zip',
              path: 'farmaco_artifacts.zip',
            },
          ],
        },
      },
      'farmaco',
      'submit_docking_job',
    );

    expect(formatted.artifacts).toEqual([
      {
        artifactType: 'elagente.harness.run',
        title: 'farmaco submit_docking_job run run-123',
      },
    ]);
    expect(formatted.text).toContain('```remote-codex-artifact');
    expect(formatted.text).toContain('"artifactType": "elagente.harness.run"');
    expect(formatted.text).toContain(
      '"/api/sandbox/harness/modules/farmaco/runs/run-123/download.zip"',
    );
    expect(formatted.text).not.toContain('INACT_X_APP_KEY');
  });

  it('adds non-secret Remote Codex attribution to ElAgenteHarness worker invoke payloads', async () => {
    const mcpModule = await import(
      pathToFileURL(
        path.resolve(process.cwd(), '../../bin/remote-codex-plugin-mcp.mjs'),
      ).href
    );
    const previous = {
      workspaceId: process.env.REMOTE_CODEX_WORKSPACE_ID,
      sessionId: process.env.REMOTE_CODEX_SESSION_ID,
      threadId: process.env.REMOTE_CODEX_THREAD_ID,
      turnId: process.env.REMOTE_CODEX_TURN_ID,
    };
    process.env.REMOTE_CODEX_WORKSPACE_ID = '00000000-0000-4000-8000-000000000004';
    process.env.REMOTE_CODEX_SESSION_ID = '00000000-0000-4000-8000-000000000005';
    process.env.REMOTE_CODEX_THREAD_ID = 'thread-1';
    process.env.REMOTE_CODEX_TURN_ID = 'turn-1';

    try {
      const payload = mcpModule.buildHarnessInvokeWorkerInputForTest(
        { smiles: 'CCO' },
        { estimatedComputeUnits: 2.5, estimatedCostUsd: 0.12 },
      );

      expect(payload).toEqual({
        smiles: 'CCO',
        _remoteCodexContext: {
          workspaceId: '00000000-0000-4000-8000-000000000004',
          sessionId: '00000000-0000-4000-8000-000000000005',
          threadId: 'thread-1',
          turnId: 'turn-1',
          estimatedComputeUnits: 2.5,
          estimatedCostUsd: 0.12,
        },
      });
      expect(JSON.stringify(payload)).not.toContain('INACT_X_APP_KEY');
    } finally {
      if (previous.workspaceId === undefined) {
        delete process.env.REMOTE_CODEX_WORKSPACE_ID;
      } else {
        process.env.REMOTE_CODEX_WORKSPACE_ID = previous.workspaceId;
      }
      if (previous.sessionId === undefined) {
        delete process.env.REMOTE_CODEX_SESSION_ID;
      } else {
        process.env.REMOTE_CODEX_SESSION_ID = previous.sessionId;
      }
      if (previous.threadId === undefined) {
        delete process.env.REMOTE_CODEX_THREAD_ID;
      } else {
        process.env.REMOTE_CODEX_THREAD_ID = previous.threadId;
      }
      if (previous.turnId === undefined) {
        delete process.env.REMOTE_CODEX_TURN_ID;
      } else {
        process.env.REMOTE_CODEX_TURN_ID = previous.turnId;
      }
    }
  });

  it('recognizes standalone benzene xyz content for inline renderers', () => {
    expect(looksLikeMoleculeStructure(benzeneXyz, 'xyz')).toBe(true);
    expect(looksLikeMoleculeStructure('文件内容...', 'xyz')).toBe(false);
    expect(looksLikeMoleculeStructure('...', 'xyz')).toBe(false);
  });
});
