import { useEffect, useRef, useState } from 'react';
import { ChevronsRight } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';

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

function GraphWorkspaceCodePreview({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : false,
  );

  useEffect(() => {
    const container = containerRef.current;
    const shell = container?.closest<HTMLElement>('.thread-ui-shell');
    if (!shell) {
      setDark(document.documentElement.classList.contains('dark'));
      return;
    }

    const readShellTheme = () =>
      shell.getAttribute('data-theme-effective') === 'dark' ||
      shell.classList.contains('dark') ||
      shell.classList.contains('thread-ui-theme-dark');

    setDark(readShellTheme());
    const observer = new MutationObserver(() => setDark(readShellTheme()));
    observer.observe(shell, {
      attributeFilter: ['class', 'data-theme-effective'],
      attributes: true,
    });
    return () => observer.disconnect();
  }, []);

  const syntaxTheme = dark ? oneDark : oneLight;

  return (
    <div
      ref={containerRef}
      className="thread-graph-code-preview min-h-0 flex-1 overflow-auto"
    >
      <SyntaxHighlighter
        language={language}
        style={syntaxTheme}
        customStyle={{
          margin: 0,
          minHeight: '100%',
          background: 'transparent',
          padding: '1rem',
        }}
        showLineNumbers
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}

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
      className="thread-graph-viewer flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] bg-[#fcfdff] dark:bg-[#151820]"
      data-preview-target-kind={selectedTarget?.kind ?? 'none'}
    >
      <div className="thread-graph-viewer-header flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#fcfdff] px-3 sm:h-[60px] sm:px-5 dark:border-[#2a2f3a] dark:bg-[#151820]">
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
          <div className="min-h-0 flex-1 overflow-hidden bg-slate-100 dark:bg-[#101217]">
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
            <div className="thread-graph-file-preview-header border-b border-slate-200 px-4 py-3 text-xs uppercase tracking-[0.12em] text-slate-400 dark:border-[#2a2f3a] dark:text-slate-500">
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
              language={fileLanguage || extension || 'text'}
            />
            {previewFile.truncated && onLoadMore ? (
              <div className="thread-graph-file-preview-footer flex justify-center border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#2a2f3a] dark:bg-[#101217]">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="rounded-md bg-slate-100 px-4 py-1.5 text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:bg-[#1d222c] dark:text-slate-300 dark:hover:bg-[#222733]"
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
                language="json"
              />
            </WorkspaceInfoCard>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="thread-graph-file-preview-header border-b border-slate-200 px-4 py-3 text-xs uppercase tracking-[0.12em] text-slate-400 dark:border-[#2a2f3a] dark:text-slate-500">
              {selectedTarget.node.kind}
            </div>
            <GraphWorkspaceCodePreview
              content={
                selectedTarget.node.detail ??
                selectedTarget.node.preview ??
                selectedTarget.node.name
              }
              language={
                selectedTarget.node.kind === 'event' ? 'json' : 'text'
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}
