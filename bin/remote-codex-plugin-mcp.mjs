#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const MOLECULE_ARTIFACT_TYPE = 'chemistry.molecule3d';
const XYZ_VIEWER_PLUGIN_ID = 'remote-codex.xyz-viewer';

function isFiniteNumberToken(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function looksLikeXyzMolecule(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const atomCount = Number(lines[0]);
  if (!Number.isInteger(atomCount) || atomCount <= 0 || atomCount > 100000) {
    return false;
  }

  const atomLines = lines.slice(2);
  if (atomLines.length < atomCount) {
    return false;
  }

  return atomLines.slice(0, atomCount).every((line) => {
    const parts = line.split(/\s+/);
    return (
      parts.length >= 4 &&
      /^([A-Za-z][A-Za-z]?|\d+)$/.test(parts[0] ?? '') &&
      isFiniteNumberToken(parts[1]) &&
      isFiniteNumberToken(parts[2]) &&
      isFiniteNumberToken(parts[3])
    );
  });
}

function looksLikePdbMolecule(content) {
  return content.split(/\r?\n/).some((line) => /^(ATOM|HETATM)\s+/i.test(line));
}

function looksLikeCifMolecule(content) {
  return /\bdata_[^\s]*/i.test(content) && /_atom_site\./i.test(content);
}

function looksLikeMoleculeStructure(content, format) {
  switch (format) {
    case 'xyz':
    case 'extxyz':
      return looksLikeXyzMolecule(content);
    case 'pdb':
      return looksLikePdbMolecule(content);
    case 'cif':
      return looksLikeCifMolecule(content);
    default:
      return false;
  }
}

function pluginEnabled(pluginId) {
  const enabledIds = process.env.REMOTE_CODEX_ENABLED_PLUGIN_IDS;
  if (!enabledIds) {
    return true;
  }
  return enabledIds.split(',').map((entry) => entry.trim()).filter(Boolean).includes(pluginId);
}

const server = new McpServer({
  name: 'remote-codex-plugin-mcp',
  title: 'Remote Codex Plugin MCP',
  version: '0.1.0',
});

if (pluginEnabled(XYZ_VIEWER_PLUGIN_ID)) {
  server.registerTool(
    'remote_codex_render_molecule',
    {
      title: 'Render 3D Molecule',
      description:
        'Create a Remote Codex 3D molecule artifact from valid xyz, extxyz, cif, or pdb content. Use this when the user asks for a renderable molecular structure. Do not invent coordinates unless the user explicitly asks you to generate an example.',
      inputSchema: {
        title: z.string().trim().min(1).describe('Short display title for the molecule.'),
        format: z.enum(['xyz', 'extxyz', 'cif', 'pdb']).describe('Molecular source format.'),
        content: z.string().trim().min(1).describe('Raw molecule source text in the selected format.'),
        summaryText: z.string().trim().optional().describe('Optional short summary shown in the timeline.'),
        sourceDescription: z.string().trim().optional().describe('Optional note about where the coordinates came from.'),
      },
    },
    async ({ title, format, content, summaryText, sourceDescription }) => {
      if (!looksLikeMoleculeStructure(content, format)) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unable to create molecule artifact: content does not look like valid ${format} data.`,
            },
          ],
        };
      }

      const artifact = {
        type: 'remote-codex.artifact',
        artifactType: MOLECULE_ARTIFACT_TYPE,
        title,
        summaryText: summaryText ?? sourceDescription ?? `${format.toUpperCase()} molecule`,
        payload: {
          format,
          content: [content],
          name: title,
          sourceDescription: sourceDescription ?? null,
        },
      };

      const artifactJson = JSON.stringify(artifact, null, 2);
      return {
        content: [
          {
            type: 'text',
            text: [
              `Created a 3D molecule artifact for ${title}.`,
              '',
              '```remote-codex-artifact',
              artifactJson,
              '```',
            ].join('\n'),
          },
        ],
        structuredContent: {
          pluginId: XYZ_VIEWER_PLUGIN_ID,
          artifactType: MOLECULE_ARTIFACT_TYPE,
          title,
          format,
        },
      };
    },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await server.connect(new StdioServerTransport());
}
