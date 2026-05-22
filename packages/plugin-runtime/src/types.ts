import type {
  PluginDto,
  PluginManifestDto,
  ThreadArtifactDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../shared/src/index';

export type RemoteCodexPluginManifest = PluginManifestDto;

export interface RegisteredPlugin {
  manifest: RemoteCodexPluginManifest;
  enabledByDefault?: boolean;
  source?: 'builtin' | 'imported';
}

export interface PluginRegistrySnapshot {
  plugins: PluginDto[];
}

export interface ArtifactExtractionContext {
  threadId: string;
  workspacePath: string;
  now: string;
}

export interface ArtifactExtractionResult {
  sourceItem: ThreadHistoryItemDto;
  artifacts: ThreadArtifactDto[];
}

export interface ArtifactExtractor {
  extractFromTurn(
    turn: ThreadTurnDto,
    context: ArtifactExtractionContext,
  ): ArtifactExtractionResult[];
}
