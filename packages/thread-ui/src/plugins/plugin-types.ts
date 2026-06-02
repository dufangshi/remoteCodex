import type { ReactNode } from 'react';

import type {
  PluginManifestDto,
  ThreadArtifactDto,
} from '@remote-codex/shared';

export interface ArtifactRenderContext {
  artifact: ThreadArtifactDto;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export interface InlineCodeRenderContext {
  code: string;
  isIncomplete: boolean;
  language: string;
  meta?: string;
}

export interface ThreadPanelContribution {
  id: string;
  kind: string;
  label: string;
}

export interface FrontendPluginModule {
  manifest: PluginManifestDto;
  threadPanels?: ThreadPanelContribution[];
  renderArtifact?: (context: ArtifactRenderContext) => ReactNode;
  inlineCodeRenderers?: Array<{
    languages: string[];
    render: (context: InlineCodeRenderContext) => ReactNode | null;
  }>;
}
