import { useMemo, useState, type ReactNode } from 'react';

import {
  xyzViewerPluginManifest,
  type MoleculeViewerSnapshot,
} from '../../../../packages/plugin-xyz-viewer/src/index';
import { XyzMoleculeViewer } from '../../../../packages/plugin-xyz-viewer/src/frontend';
import '../../../../packages/plugin-xyz-viewer/src/styles.css';
import { looksLikeMoleculeStructure } from '../../../../packages/plugin-runtime/src/index';
import type {
  PluginManifestDto,
  ThreadArtifactDto,
} from '../../../../packages/shared/src/index';

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

export interface FrontendPluginModule {
  manifest: PluginManifestDto;
  renderArtifact?: (context: ArtifactRenderContext) => ReactNode;
  inlineCodeRenderers?: Array<{
    languages: string[];
    render: (context: InlineCodeRenderContext) => ReactNode | null;
  }>;
}

function isMoleculeViewerSnapshot(value: unknown): value is MoleculeViewerSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<MoleculeViewerSnapshot>;
  return Array.isArray(record.content);
}

function XyzArtifactRenderer({
  artifact,
  expanded,
  onToggleExpanded,
}: ArtifactRenderContext) {
  const source = isMoleculeViewerSnapshot(artifact.payload)
    ? artifact.payload
    : null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-sm font-medium text-[var(--theme-fg)]">
            {artifact.title}
          </span>
          <span className="mt-1 block text-xs text-[var(--theme-fg-muted)]">
            {artifact.summaryText ?? artifact.type}
          </span>
        </span>
        <span className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--theme-fg-muted)]">
          {expanded ? 'Hide' : 'Open'}
        </span>
      </button>
      {expanded && source && (
        <div className="h-[min(56vh,34rem)] min-h-[26rem]">
          <XyzMoleculeViewer
            source={source}
            moleculeId={artifact.id}
            title={artifact.title}
          />
        </div>
      )}
      {expanded && !source && (
        <pre className="max-h-80 overflow-auto rounded-[0.9rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] p-3 text-xs text-[var(--theme-fg-soft)]">
          {JSON.stringify(artifact.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

function normalizedMoleculeFormat(language: string) {
  return language.trim().toLowerCase() === 'extxyz'
    ? 'xyz'
    : language.trim().toLowerCase();
}

function InlineXyzRenderer({
  code,
  isIncomplete,
  language,
}: InlineCodeRenderContext) {
  const [expanded, setExpanded] = useState(true);
  const [sourceOpen, setSourceOpen] = useState(false);
  const format = normalizedMoleculeFormat(language);
  const source = useMemo(
    () => ({
      content: [code.endsWith('\n') ? code : `${code}\n`],
      format,
      name: `${format.toUpperCase()} structure`,
      uuid: `inline:${format}:${code.length}`,
    }),
    [code, format],
  );

  if (isIncomplete || !looksLikeMoleculeStructure(code, format)) {
    return null;
  }

  return (
    <div className="my-3 overflow-hidden rounded-[1rem] border border-[var(--theme-border)] bg-[var(--theme-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--theme-border)] px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--theme-fg)]">
            {format.toUpperCase()} molecule
          </p>
          <p className="mt-0.5 text-xs text-[var(--theme-fg-muted)]">
            Rendered from message source
          </p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setSourceOpen((current) => !current)}
            className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--theme-fg-muted)] transition hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]"
          >
            {sourceOpen ? 'Hide source' : 'Source'}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--theme-fg-muted)] transition hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]"
          >
            {expanded ? 'Collapse' : 'Open'}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="h-[min(52vh,32rem)] min-h-[24rem]">
          <XyzMoleculeViewer
            source={source}
            moleculeId={source.uuid}
            title={`${format.toUpperCase()} molecule`}
          />
        </div>
      )}
      {sourceOpen && (
        <pre className="max-h-96 overflow-auto border-t border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-3 text-xs leading-5 text-[var(--theme-fg-soft)]">
          {code}
        </pre>
      )}
    </div>
  );
}

export const builtinFrontendPlugins: FrontendPluginModule[] = [
  {
    manifest: xyzViewerPluginManifest,
    renderArtifact: (context) => <XyzArtifactRenderer {...context} />,
    inlineCodeRenderers: [
      {
        languages: ['xyz', 'extxyz', 'cif', 'pdb'],
        render: (context) => <InlineXyzRenderer {...context} />,
      },
    ],
  },
];
