import type {
  PluginManifestDto,
  ThreadArtifactDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../shared/src/index';
import type {
  ArtifactExtractionContext,
  ArtifactExtractionResult,
  ArtifactExtractor,
} from './types';

const artifactFenceLanguages = new Set(['artifact', 'remote-codex-artifact']);

interface FencedBlock {
  language: string;
  content: string;
}

function stableArtifactId(input: {
  turnId: string;
  itemId: string;
  pluginId: string;
  artifactType: string;
  index: number;
}) {
  return [
    'artifact',
    input.pluginId.replace(/[^a-zA-Z0-9_-]+/g, '-'),
    input.artifactType.replace(/[^a-zA-Z0-9_-]+/g, '-'),
    input.turnId.replace(/[^a-zA-Z0-9_-]+/g, '-'),
    input.itemId.replace(/[^a-zA-Z0-9_-]+/g, '-'),
    input.index,
  ].join(':');
}

function artifactItemFromArtifact(
  artifact: ThreadArtifactDto,
  sourceItem: ThreadHistoryItemDto,
  sequenceOffset: number,
): ThreadHistoryItemDto {
  return {
    id: artifact.id,
    kind: 'artifact',
    text: artifact.title,
    previewText: artifact.summaryText ?? artifact.title,
    sequence:
      sourceItem.sequence === null || sourceItem.sequence === undefined
        ? null
        : sourceItem.sequence + sequenceOffset,
    sourceTurnId: artifact.sourceTurnId ?? null,
    artifact,
  };
}

function maybeParseArtifactPayload(value: unknown): {
  artifactType: string;
  title?: string | null;
  summaryText?: string | null;
  payload: unknown;
} | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = record.type === 'remote-codex.artifact'
    ? record.artifactType
    : record.artifactType ?? record.type;
  if (typeof type !== 'string' || !type.trim()) {
    return null;
  }

  return {
    artifactType: type,
    title: typeof record.title === 'string' ? record.title : null,
    summaryText: typeof record.summaryText === 'string' ? record.summaryText : null,
    payload: record.payload ?? record,
  };
}

function findFencedBlocks(text: string, languages: Set<string>): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const opener = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opener) {
      continue;
    }

    const marker = opener[1] ?? '';
    const markerChar = marker[0] ?? '`';
    const markerLength = marker.length;
    const language = (opener[2] ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const contentLines: string[] = [];

    index += 1;
    while (index < lines.length) {
      const closeLine = lines[index] ?? '';
      const closePattern = new RegExp(`^ {0,3}\\${markerChar}{${markerLength},}\\s*$`);
      if (closePattern.test(closeLine)) {
        break;
      }
      contentLines.push(closeLine);
      index += 1;
    }

    if (languages.has(language)) {
      blocks.push({
        language,
        content: contentLines.join('\n').trim(),
      });
    }
  }

  return blocks;
}

function isFiniteNumberToken(value: string | undefined) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

export function looksLikeXyzMolecule(content: string) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const atomCount = Number(lines[0]);
  if (!Number.isInteger(atomCount) || atomCount <= 0 || atomCount > 100_000) {
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

export function looksLikePdbMolecule(content: string) {
  return content
    .split(/\r?\n/)
    .some((line) => /^(ATOM|HETATM)\s+/i.test(line));
}

export function looksLikeCifMolecule(content: string) {
  return /\bdata_[^\s]*/i.test(content) && /_atom_site\./i.test(content);
}

export function looksLikeMoleculeStructure(content: string, format: string) {
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

export class ManifestArtifactExtractor implements ArtifactExtractor {
  constructor(private readonly manifests: PluginManifestDto[]) {}

  extractFromTurn(
    turn: ThreadTurnDto,
    context: ArtifactExtractionContext,
  ): ArtifactExtractionResult[] {
    const results: ArtifactExtractionResult[] = [];
    for (const item of turn.items) {
      const artifacts = this.extractFromItem(turn, item, context);
      if (artifacts.length > 0) {
        results.push({ sourceItem: item, artifacts });
      }
    }
    return results;
  }

  private extractFromItem(
    turn: ThreadTurnDto,
    item: ThreadHistoryItemDto,
    context: ArtifactExtractionContext,
  ): ThreadArtifactDto[] {
    const extractableText = [item.text, item.detailText ?? '']
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join('\n\n');
    if (item.kind === 'artifact' || !extractableText) {
      return [];
    }

    const artifacts: ThreadArtifactDto[] = [];
    artifacts.push(...this.extractJsonArtifacts(turn, item, context, extractableText));
    return artifacts;
  }

  private extractJsonArtifacts(
    turn: ThreadTurnDto,
    item: ThreadHistoryItemDto,
    context: ArtifactExtractionContext,
    text: string,
  ): ThreadArtifactDto[] {
    const artifacts: ThreadArtifactDto[] = [];
    for (const block of findFencedBlocks(text, artifactFenceLanguages)) {
      if (!block.content) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(block.content);
      } catch {
        continue;
      }

      const payload = maybeParseArtifactPayload(parsed);
      if (!payload || !this.hasArtifactType(payload.artifactType)) {
        continue;
      }

      artifacts.push({
        id: stableArtifactId({
          turnId: turn.id,
          itemId: item.id,
          pluginId: this.pluginIdForArtifactType(payload.artifactType) ?? 'unknown',
          artifactType: payload.artifactType,
          index: artifacts.length,
        }),
        pluginId: this.pluginIdForArtifactType(payload.artifactType) ?? 'unknown',
        type: payload.artifactType,
        title: payload.title ?? 'Plugin artifact',
        summaryText: payload.summaryText ?? null,
        payload: payload.payload,
        sourceTurnId: turn.id,
        sourceItemId: item.id,
        createdAt: context.now,
      });
    }
    return artifacts;
  }

  private hasArtifactType(artifactType: string) {
    return this.pluginIdForArtifactType(artifactType) !== null;
  }

  private pluginIdForArtifactType(artifactType: string) {
    for (const manifest of this.manifests) {
      if (
        manifest.capabilities.artifactTypes.some(
          (entry) => entry.type === artifactType,
        )
      ) {
        return manifest.id;
      }
    }
    return null;
  }
}

export function appendArtifactItemsToTurns(
  turns: ThreadTurnDto[],
  extractor: ArtifactExtractor,
  context: ArtifactExtractionContext,
): ThreadTurnDto[] {
  return turns.map((turn) => {
    const extractionResults = extractor.extractFromTurn(turn, context);
    if (extractionResults.length === 0) {
      return turn;
    }

    const artifactItemsBySourceItemId = new Map<string, ThreadHistoryItemDto[]>();
    for (const result of extractionResults) {
      artifactItemsBySourceItemId.set(
        result.sourceItem.id,
        result.artifacts.map((artifact, index) =>
          artifactItemFromArtifact(artifact, result.sourceItem, (index + 1) / 100),
        ),
      );
    }

    const items: ThreadHistoryItemDto[] = [];
    const existingIds = new Set(turn.items.map((item) => item.id));
    for (const item of turn.items) {
      items.push(item);
      const artifactItems = artifactItemsBySourceItemId.get(item.id) ?? [];
      for (const artifactItem of artifactItems) {
        if (!existingIds.has(artifactItem.id)) {
          items.push(artifactItem);
          existingIds.add(artifactItem.id);
        }
      }
    }

    return {
      ...turn,
      items,
    };
  });
}
