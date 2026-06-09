import { memo } from 'react';
import { ChevronsRight } from 'lucide-react';

import type { ThreadArtifactDto } from '@remote-codex/shared';
import type { ThreadWorkspaceFilePreview } from '../../adapters';
import type { PluginContextValue } from '../../plugins/plugin-context';
import {
  MOLECULAR_EXTENSIONS,
  buildMoleculePreviewSnapshot,
  extensionOf,
  languageForPath,
  type WorkspaceTreeNode,
} from './workspaceTree';
import { WorkspaceInfoCard } from './GraphWorkspaceCards';
import { GraphMoleculeViewer } from './GraphMoleculeViewer';

export type GraphWorkspacePreviewTarget =
  | { kind: 'live-molecule'; node: WorkspaceTreeNode }
  | { kind: 'workspace-file'; node: WorkspaceTreeNode }
  | { kind: 'artifact'; node: WorkspaceTreeNode }
  | { kind: 'event'; node: WorkspaceTreeNode }
  | { kind: 'meta'; node: WorkspaceTreeNode }
  | null;

function previewTargetTitle(target: GraphWorkspacePreviewTarget) {
  if (!target) {
    return null;
  }
  return target.node.path || target.node.name || null;
}

export function graphWorkspacePreviewTargetFromNode(
  node: WorkspaceTreeNode | null,
): GraphWorkspacePreviewTarget {
  if (!node) {
    return null;
  }

  switch (node.kind) {
    case 'live-artifact':
      return { kind: 'live-molecule', node };
    case 'file':
      return { kind: 'workspace-file', node };
    case 'artifact':
      return { kind: 'artifact', node };
    case 'event':
      return { kind: 'event', node };
    case 'meta':
      return { kind: 'meta', node };
    case 'directory':
      return null;
  }
}

const GraphWorkspaceCodePreview = memo(function GraphWorkspaceCodePreview({
  content,
}: {
  content: string;
}) {
  return (
    <div className="thread-graph-code-preview min-h-0 flex-1 overflow-auto">
      <pre className="thread-graph-plain-code-preview">
        <code>{content}</code>
      </pre>
    </div>
  );
});

export function GraphWorkspacePreviewPane({
  error,
  imageUrl,
  loadingMore,
  onLoadMore,
  onCollapse,
  pdfUrl,
  previewFile,
  previewLoading,
  plugins,
  selectedTarget,
}: {
  error?: string | null;
  imageUrl?: string | null;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onCollapse?: () => void;
  pdfUrl?: string | null;
  previewFile?: ThreadWorkspaceFilePreview | null;
  previewLoading?: boolean;
  plugins: PluginContextValue;
  selectedTarget: GraphWorkspacePreviewTarget;
}) {
  const activeNode = selectedTarget?.node ?? null;
  const renderedArtifact =
    activeNode?.artifact
      ? plugins.renderArtifact({
          artifact: activeNode.artifact,
          expanded: true,
          onToggleExpanded: () => undefined,
        })
      : null;
  const moleculeSnapshot = buildMoleculePreviewSnapshot(previewFile ?? null);
  const fileLanguage =
    previewFile?.language || languageForPath(previewFile?.path ?? '');
  const extension = previewFile ? extensionOf(previewFile.path) : '';
  const title = previewTargetTitle(selectedTarget);
  const selectedFileIsMolecule =
    previewFile !== null && MOLECULAR_EXTENSIONS.has(extension);
  const isLiveArtifactPreview = selectedTarget?.kind === 'live-molecule';
  const isArtifactPreview = Boolean(activeNode?.artifact && renderedArtifact);
  const isMoleculePreview = Boolean(moleculeSnapshot) || isArtifactPreview;

  return (
    <section
      className="thread-graph-viewer flex h-full min-h-0 flex-col overflow-hidden rounded-[12px]"
      data-preview-target-kind={selectedTarget?.kind ?? 'none'}
    >
      <div className="thread-graph-viewer-header flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3 sm:h-[60px] sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-base font-semibold text-slate-900 sm:text-[18px] dark:text-slate-100">
            Viewer
          </h2>
          {title ? (
            <span className="min-w-0 truncate text-sm font-medium text-slate-500 dark:text-slate-400">
              {title}
            </span>
          ) : null}
        </div>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            data-testid="collapse-viewer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#222733] dark:hover:text-slate-100"
            title="Collapse workspace"
            aria-label="Collapse workspace"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}
        {!selectedTarget ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-5 text-center text-sm text-slate-400 dark:text-slate-500">
            Pick a live molecule, workspace file, artifact, or thread event to
            preview it.
          </div>
        ) : selectedTarget.kind === 'workspace-file' && previewLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-5 text-center text-sm text-slate-400 dark:text-slate-500">
            Loading file preview...
          </div>
        ) : selectedTarget.kind === 'workspace-file' && moleculeSnapshot ? (
          <div className="thread-graph-molecule-preview min-h-0 flex-1 overflow-hidden">
            <GraphMoleculeViewer
              source={moleculeSnapshot}
              moleculeId={moleculeSnapshot.uuid ?? selectedTarget.node.path}
              title="PyMOL-style (PDB/CIF)"
            />
          </div>
        ) : selectedTarget.kind === 'workspace-file' && imageUrl ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
            <img
              src={imageUrl}
              alt={selectedTarget.node.path || selectedTarget.node.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : selectedTarget.kind === 'workspace-file' && pdfUrl ? (
          <div className="thread-graph-file-preview-frame min-h-0 flex-1 overflow-hidden">
            <iframe
              src={pdfUrl}
              title={`PDF preview: ${
                selectedTarget.node.path || selectedTarget.node.name
              }`}
              className="h-full w-full border-0"
            />
          </div>
        ) : selectedTarget.kind === 'workspace-file' && previewFile ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="thread-graph-file-preview-header border-b px-4 py-3 text-xs uppercase tracking-[0.12em]">
              {selectedFileIsMolecule
                ? 'molecule'
                : fileLanguage || extension || 'text'} |{' '}
              {previewFile.size.toLocaleString()} bytes
              {previewFile.truncated ? (
                <span className="ml-2 text-amber-500">
                  showing {previewFile.nextOffset.toLocaleString()} bytes
                </span>
              ) : null}
            </div>
            <GraphWorkspaceCodePreview
              content={previewFile.content}
            />
            {previewFile.truncated && onLoadMore ? (
              <div className="thread-graph-file-preview-footer flex justify-center border-t px-4 py-3">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="thread-graph-load-more-button rounded-md px-4 py-1.5 text-xs disabled:opacity-50"
                >
                  {loadingMore
                    ? 'Loading...'
                    : `Load more (${(
                        previewFile.size - previewFile.nextOffset
                      ).toLocaleString()} bytes remaining)`}
                </button>
              </div>
            ) : null}
          </div>
        ) : (selectedTarget.kind === 'live-molecule' ||
            selectedTarget.kind === 'artifact') &&
          selectedTarget.node.artifact ? (
          <div
            className={
              isMoleculePreview || isLiveArtifactPreview
                ? 'min-h-0 flex-1 overflow-hidden'
                : 'min-h-0 flex-1 overflow-auto p-3'
            }
          >
            {renderedArtifact}
          </div>
        ) : selectedTarget.kind === 'meta' ? (
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="grid gap-3">
            <WorkspaceInfoCard label="Workspace Data">
              <GraphWorkspaceCodePreview
                content={selectedTarget.node.detail ?? ''}
              />
            </WorkspaceInfoCard>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="thread-graph-file-preview-header border-b px-4 py-3 text-xs uppercase tracking-[0.12em]">
              {selectedTarget.node.kind}
            </div>
            <GraphWorkspaceCodePreview
              content={
                selectedTarget.node.detail ??
                selectedTarget.node.preview ??
                selectedTarget.node.name
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}
