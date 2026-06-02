import { useMemo, useState } from 'react';

import {
  type MoleculeViewerSnapshot,
} from '@remote-codex/plugin-xyz-viewer';
import { XyzMoleculeViewer } from '@remote-codex/plugin-xyz-viewer/frontend';
import '@remote-codex/plugin-xyz-viewer/styles.css';
import { looksLikeMoleculeStructure } from '@remote-codex/plugin-runtime';
import type {
  ArtifactRenderContext,
  InlineCodeRenderContext,
} from './plugin-types';

function isMoleculeViewerSnapshot(value: unknown): value is MoleculeViewerSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<MoleculeViewerSnapshot>;
  return Array.isArray(record.content);
}

function normalizedMoleculeFormat(language: string) {
  return language.trim().toLowerCase() === 'extxyz'
    ? 'xyz'
    : language.trim().toLowerCase();
}

export function XyzArtifactRenderer({
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

export function InlineXyzRenderer({
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
