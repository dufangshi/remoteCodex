import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  Folder,
  FolderOpen,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';

import type {
  AgentRuntimeStatusDto,
  ThreadArtifactDto,
  ThreadDetailDto,
} from '@remote-codex/shared';
import type {
  ThreadWorkspaceAdapter,
  ThreadWorkspaceFilePreview,
} from '../../adapters';
import type { PluginContextValue } from '../../plugins/plugin-context';
import {
  IMAGE_EXTENSIONS,
  PDF_EXTENSIONS,
  collectAncestorPaths,
  collectWorkspaceItems,
  extensionOf,
  findFirstPreviewNode,
  findFirstWorkspaceFile,
  flattenWorkspaceNodes,
  hasWorkspacePath,
  workspaceTreeNodeToGraphNode,
  type WorkspaceTreeNode,
} from './workspaceTree';
import {
  GraphWorkspacePreviewPane,
  graphWorkspacePreviewTargetFromNode,
} from './GraphWorkspacePreviewPane';
import { GraphEmptyGarbageDialog } from './GraphEmptyGarbageDialog';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from './GraphResizablePanels';

const PREVIEW_CHUNK_BYTES = 24_000;
const EXPANDED_PATHS_STORAGE_PREFIX = 'remote-codex:graphchat:workspace:expanded:';

const explorerPanelClassName =
  'thread-graph-explorer h-full min-h-0 overflow-hidden rounded-[12px]';
const explorerHeaderClassName =
  'thread-graph-explorer-header flex h-[60px] shrink-0 items-center justify-between border-b px-4';
const explorerHeadingClassName =
  'text-[18px] font-semibold text-slate-900 dark:text-slate-100';
const explorerIconButtonClassName =
  'thread-graph-explorer-icon-button flex h-8 w-8 items-center justify-center rounded-lg border shadow-none transition disabled:cursor-not-allowed disabled:opacity-50';
const collapseGhostButtonClassName =
  'thread-graph-explorer-collapse-button flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#222733] dark:hover:text-slate-100';
const workspaceLabelClassName =
  'thread-graph-workspace-label px-3 pb-1 pt-2 text-[11px] font-semibold tracking-normal text-slate-500 dark:text-slate-400';
const workspaceLoadingClassName =
  'thread-graph-workspace-loading px-4 text-sm text-slate-400 dark:text-slate-500';
const emptyWorkspaceClassName =
  'thread-graph-workspace-empty mx-4 mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500 dark:border-[#303642] dark:bg-[#1b1f29] dark:text-slate-400';

function expandedPathsStorageKey(input: {
  threadId: string;
  workspaceId?: string | null;
}) {
  return `${EXPANDED_PATHS_STORAGE_PREFIX}${input.workspaceId ?? 'workspace'}:${input.threadId}`;
}

function readExpandedPaths(input: {
  threadId: string;
  workspaceId?: string | null;
}) {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(expandedPathsStorageKey(input));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeExpandedPaths(
  input: { threadId: string; workspaceId?: string | null },
  paths: Set<string>,
) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      expandedPathsStorageKey(input),
      JSON.stringify([...paths]),
    );
  } catch {
    // Persisted explorer state is an enhancement; ignore storage failures.
  }
}

function iconForWorkspaceNode(node: WorkspaceTreeNode, expanded: boolean) {
  if (node.kind === 'directory') {
    return expanded ? (
      <FolderOpen className="h-4 w-4 text-slate-500 dark:text-slate-400" />
    ) : (
      <Folder className="h-4 w-4 text-slate-500 dark:text-slate-400" />
    );
  }

  const extension = extensionOf(node.name);
  if (extension === 'zip') {
    return <FileArchive className="h-4 w-4 text-amber-600" />;
  }
  if (
    node.kind === 'file' &&
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)
  ) {
    return <FileImage className="h-4 w-4 text-sky-500" />;
  }
  if (
    node.kind === 'artifact' ||
    ['xyz', 'extxyz', 'cif', 'pdf', 'json', 'ts', 'tsx', 'js', 'jsx', 'md', 'yaml', 'yml', 'py'].includes(
      extension,
    )
  ) {
    return <FileCode2 className="h-4 w-4 text-emerald-600" />;
  }
  return <File className="h-4 w-4 text-slate-400 dark:text-slate-500" />;
}

function WorkspaceTreeRow({
  depth,
  expandedPaths,
  node,
  onDownload,
  onSelect,
  onToggle,
  selectedNodeId,
}: {
  depth: number;
  expandedPaths: Set<string>;
  node: WorkspaceTreeNode;
  onDownload?: ((node: WorkspaceTreeNode) => void) | undefined;
  onSelect: (nodeId: string) => void;
  onToggle: (path: string) => void;
  selectedNodeId: string | null;
}) {
  const isDirectory = node.kind === 'directory';
  const expanded =
    isDirectory && (node.path === '' || expandedPaths.has(node.path));
  const selected = selectedNodeId === node.id;
  const paddingLeft = `${depth * 0.75 + 0.5}rem`;

  if (isDirectory) {
    return (
      <div>
        <div className="thread-graph-tree-row group flex items-center text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#222733] dark:hover:text-slate-100">
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left sm:min-h-0 sm:py-1.5"
            style={{ paddingLeft }}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
            )}
            {iconForWorkspaceNode(node, expanded)}
            <span className="truncate">{node.name}</span>
          </button>
          {onDownload ? (
            <button
              type="button"
              onClick={() => onDownload(node)}
              className="thread-graph-tree-action mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-slate-900 sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 dark:text-slate-500 dark:hover:bg-[#1d222c] dark:hover:text-slate-100"
              title={node.path ? `Download ${node.name}` : 'Download workspace'}
              aria-label={
                node.path ? `Download ${node.name}` : 'Download workspace'
              }
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {expanded ? (
          <div>
            {node.children.map((child) => (
              <WorkspaceTreeRow
                key={child.id}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                node={child}
                {...(onDownload ? { onDownload } : {})}
                onSelect={onSelect}
                onToggle={onToggle}
                selectedNodeId={selectedNodeId}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`thread-graph-tree-row group flex items-center text-sm transition ${
        selected
          ? 'is-selected'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#222733] dark:hover:text-slate-100'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left sm:min-h-0 sm:py-1.5"
        style={{ paddingLeft: `${depth * 0.75 + 2.2}rem` }}
      >
        {iconForWorkspaceNode(node, false)}
        <span className="truncate">{node.name}</span>
      </button>
      {onDownload && node.kind === 'file' ? (
        <button
          type="button"
          onClick={() => onDownload(node)}
          className={`thread-graph-tree-action mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 ${
            selected
              ? 'is-selected'
              : 'text-slate-400 hover:bg-white hover:text-slate-900 dark:text-slate-500 dark:hover:bg-[#1d222c] dark:hover:text-slate-100'
          }`}
          title={`Download ${node.name}`}
          aria-label={`Download ${node.name}`}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function LiveWorkspaceSection({
  liveNodes,
  onSelect,
  selectedNodeId,
}: {
  liveNodes: WorkspaceTreeNode[];
  onSelect: (nodeId: string) => void;
  selectedNodeId: string | null;
}) {
  if (liveNodes.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-slate-200 py-2 dark:border-[#2a2f3a]">
      <div className="thread-graph-workspace-label px-3 pb-1 text-[11px] font-semibold tracking-normal text-slate-500 dark:text-slate-400">
        Live
      </div>
      <div className="space-y-0.5">
        {liveNodes.map((node) => {
          const selected = selectedNodeId === node.id;
          return (
            <button
              key={node.id}
              type="button"
              data-testid="live-molecule-item"
              data-molecule-id={node.artifact?.id ?? node.id}
              onClick={() => onSelect(node.id)}
              className={`thread-graph-tree-row flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-sm transition sm:min-h-0 sm:py-1.5 ${
                selected
                  ? 'is-selected'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#222733] dark:hover:text-slate-100'
              }`}
            >
              <FileCode2
                className={`h-4 w-4 shrink-0 ${
                  selected
                    ? 'text-current'
                    : 'text-emerald-600 dark:text-emerald-300'
                }`}
              />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceExplorerPanel({
  canEmptyGarbage,
  canUpload,
  onCollapse,
  expandedPaths,
  loading,
  onDownload,
  onEmptyGarbage,
  onRefresh,
  onSelect,
  onToggle,
  onUpload,
  selectedNodeId,
  tree,
  liveNodes,
}: {
  canEmptyGarbage?: boolean;
  canUpload?: boolean;
  onCollapse?: (() => void) | undefined;
  expandedPaths: Set<string>;
  loading?: boolean;
  onDownload?: ((node: WorkspaceTreeNode) => void) | undefined;
  onEmptyGarbage?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
  onSelect: (nodeId: string) => void;
  onToggle: (path: string) => void;
  onUpload?: () => void;
  selectedNodeId: string | null;
  tree: WorkspaceTreeNode;
  liveNodes?: WorkspaceTreeNode[];
}) {
  const visibleTree = useMemo(
    () => ({
      ...tree,
      children: tree.children.filter((node) => node.path !== 'live'),
    }),
    [tree],
  );

  return (
    <aside className={`${explorerPanelClassName} flex flex-col`}>
      <div className={explorerHeaderClassName}>
        <div className="min-w-0">
          <h2 className={explorerHeadingClassName}>Explorer</h2>
        </div>
        <div className="flex items-center gap-1">
          {onCollapse ? (
            <button
              type="button"
              data-testid="collapse-explorer"
              onClick={onCollapse}
              className={collapseGhostButtonClassName}
              title="Collapse Explorer"
              aria-label="Collapse Explorer"
            >
              <ChevronsLeft className="h-4 w-4" />
              <span className="sr-only">Collapse Explorer</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onUpload}
            disabled={!canUpload}
            className={explorerIconButtonClassName}
            title={
              canUpload
                ? 'Upload file'
                : 'Upload is unavailable for this workspace'
            }
            aria-label="Upload file"
          >
            <Upload className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className={explorerIconButtonClassName}
            title="Refresh workspace"
            aria-label="Refresh workspace"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onEmptyGarbage ? (
            <button
              type="button"
              onClick={onEmptyGarbage}
              disabled={!canEmptyGarbage}
              className={explorerIconButtonClassName}
              title={
                canEmptyGarbage
                  ? 'Empty garbage'
                  : 'Garbage controls are unavailable'
              }
              aria-label="Empty garbage"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <LiveWorkspaceSection
          liveNodes={liveNodes ?? []}
          onSelect={onSelect}
          selectedNodeId={selectedNodeId}
        />
        <div className={workspaceLabelClassName}>Workspace</div>
        {loading ? <p className={workspaceLoadingClassName}>Loading workspace...</p> : null}
        <WorkspaceTreeRow
          depth={0}
          expandedPaths={expandedPaths}
          node={visibleTree}
          {...(onDownload ? { onDownload } : {})}
          onSelect={onSelect}
          onToggle={onToggle}
          selectedNodeId={selectedNodeId}
        />
        {visibleTree.children.length === 0 ? (
          <p className={emptyWorkspaceClassName}>
            This workspace is empty. Agent tool runs execute inside the thread
            workspace, so files should appear here as the session works.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

export function GraphWorkspaceExplorer({
  activeView,
  detail,
  artifacts,
  plugins,
  status,
  workspaceAdapter,
}: {
  activeView: 'chat' | 'shell';
  detail: ThreadDetailDto;
  artifacts: ThreadArtifactDto[];
  plugins: PluginContextValue;
  status: AgentRuntimeStatusDto | null;
  workspaceAdapter?: ThreadWorkspaceAdapter | null;
}) {
  const [adapterTree, setAdapterTree] = useState<WorkspaceTreeNode | null>(null);
  const fallbackTree = useMemo(
    () =>
      workspaceAdapter && adapterTree
        ? null
        : collectWorkspaceItems(detail, artifacts, status, activeView),
    [activeView, adapterTree, artifacts, detail, status, workspaceAdapter],
  );
  const tree =
    adapterTree ??
    fallbackTree ??
    collectWorkspaceItems(detail, artifacts, status, activeView);
  const nodeMap = useMemo(() => flattenWorkspaceNodes(tree), [tree]);
  const liveNodes = useMemo(
    () => tree.children.find((node) => node.path === 'live')?.children ?? [],
    [tree],
  );
  const firstSelectableNode = findFirstPreviewNode(tree);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    () => firstSelectableNode?.id ?? null,
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () =>
      new Set([
        '',
        'artifacts',
        'thread-events',
        'live',
        ...collectAncestorPaths(firstSelectableNode?.path ?? ''),
      ]),
  );
  const [collapsedPanel, setCollapsedPanel] = useState<
    'explorer' | 'viewer' | null
  >(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showGarbageDialog, setShowGarbageDialog] = useState(false);
  const [garbageFiles, setGarbageFiles] = useState<string[]>([]);
  const [previewFile, setPreviewFile] =
    useState<ThreadWorkspaceFilePreview | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceChangeTimerRef = useRef<number | null>(null);
  const activeNode =
    (selectedNodeId ? nodeMap.get(selectedNodeId) : null) ??
    firstSelectableNode ??
    null;
  const workspaceIdentity = {
    threadId: detail.thread.id,
    workspaceId: detail.workspace.id ?? detail.thread.workspaceId ?? null,
  };

  useEffect(() => {
    setExpandedPaths(
      new Set([
        '',
        'artifacts',
        'thread-events',
        'live',
        ...readExpandedPaths(workspaceIdentity),
        ...collectAncestorPaths(firstSelectableNode?.path ?? ''),
      ]),
    );
    // firstSelectableNode should only seed state for this identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceIdentity.threadId, workspaceIdentity.workspaceId]);

  useEffect(() => {
    return () => {
      if (workspaceChangeTimerRef.current !== null) {
        window.clearTimeout(workspaceChangeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobileViewport(mediaQuery.matches);
    update();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }
    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  async function refreshWorkspaceTree(preferredPath?: string | null) {
    if (!workspaceAdapter) {
      return;
    }
    setLoadingTree(true);
    setWorkspaceError(null);
    try {
      const nextTree = workspaceTreeNodeToGraphNode(
        await workspaceAdapter.listTree(workspaceIdentity),
      );
      setAdapterTree(nextTree);
      const firstFile = findFirstWorkspaceFile(nextTree);
      setSelectedNodeId((current) => {
        const currentNode = current ? nodeMap.get(current) : null;
        if (preferredPath && hasWorkspacePath(nextTree, preferredPath)) {
          return `workspace:${preferredPath}`;
        }
        if (currentNode?.path && hasWorkspacePath(nextTree, currentNode.path)) {
          return `workspace:${currentNode.path}`;
        }
        return firstFile?.id ?? current;
      });
      setWorkspaceVersion((version) => version + 1);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to load workspace',
      );
      setAdapterTree(null);
    } finally {
      setLoadingTree(false);
    }
  }

  useEffect(() => {
    setAdapterTree(null);
    setPreviewFile(null);
    setImageUrl(null);
    setPdfUrl(null);
    setWorkspaceError(null);
    void refreshWorkspaceTree();
    // nodeMap is intentionally omitted; refreshWorkspaceTree uses current
    // selection opportunistically and should not refetch just because tree maps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspaceAdapter,
    detail.thread.id,
    detail.workspace.id,
    detail.thread.workspaceId,
  ]);

  useEffect(() => {
    if (!workspaceAdapter?.subscribeWorkspaceChanged) {
      return;
    }
    const unsubscribe = workspaceAdapter.subscribeWorkspaceChanged(
      workspaceIdentity,
      () => {
        if (workspaceChangeTimerRef.current !== null) {
          window.clearTimeout(workspaceChangeTimerRef.current);
        }
        workspaceChangeTimerRef.current = window.setTimeout(() => {
          workspaceChangeTimerRef.current = null;
          void refreshWorkspaceTree(activeNode?.path ?? null);
        }, 240);
      },
    );
    return () => {
      if (workspaceChangeTimerRef.current !== null) {
        window.clearTimeout(workspaceChangeTimerRef.current);
        workspaceChangeTimerRef.current = null;
      }
      unsubscribe?.();
    };
    // refreshWorkspaceTree intentionally uses the current selected path as a
    // best-effort preferred target when the external workspace changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspaceAdapter,
    workspaceIdentity.threadId,
    workspaceIdentity.workspaceId,
    activeNode?.path,
  ]);

  useEffect(() => {
    const selectedPathCandidate =
      workspaceAdapter && activeNode?.kind === 'file' ? activeNode.path : null;
    if (!selectedPathCandidate) {
      setPreviewFile(null);
      setImageUrl(null);
      setPdfUrl(null);
      return;
    }
    const selectedPath = selectedPathCandidate;

    let cancelled = false;
    let objectUrl: string | null = null;
    async function loadPreview() {
      if (!workspaceAdapter) {
        return;
      }
      setPreviewLoading(true);
      setWorkspaceError(null);
      setPreviewFile(null);
      setImageUrl(null);
      setPdfUrl(null);
      try {
        const extension = extensionOf(selectedPath);
        const rawUrl = workspaceAdapter.getRawFileUrl?.({
          ...workspaceIdentity,
          path: selectedPath,
        });
        if (rawUrl && IMAGE_EXTENSIONS.has(extension)) {
          if (!cancelled) {
            setImageUrl(rawUrl);
          }
          return;
        }
        if (rawUrl && PDF_EXTENSIONS.has(extension)) {
          if (!cancelled) {
            setPdfUrl(rawUrl);
          }
          return;
        }
        const file = await workspaceAdapter.readFile({
          ...workspaceIdentity,
          path: selectedPath,
          limit: PREVIEW_CHUNK_BYTES,
        });
        if (!cancelled) {
          setPreviewFile(file);
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(
            error instanceof Error ? error.message : 'Failed to read file',
          );
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }
    void loadPreview();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceAdapter, activeNode?.id, workspaceVersion]);

  async function handleLoadMore() {
    if (!workspaceAdapter || !previewFile?.truncated) {
      return;
    }
    setLoadingMore(true);
    try {
      const chunk = await workspaceAdapter.readFile({
        ...workspaceIdentity,
        path: previewFile.path,
        offset: previewFile.nextOffset,
        limit: PREVIEW_CHUNK_BYTES,
      });
      setPreviewFile((current) =>
        current
          ? {
              ...current,
              content: current.content + chunk.content,
              truncated: chunk.truncated,
              nextOffset: chunk.nextOffset,
              size: chunk.size,
            }
          : current,
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!workspaceAdapter?.uploadFile || !file) {
      return;
    }
    setLoadingTree(true);
    setWorkspaceError(null);
    try {
      const result = await workspaceAdapter.uploadFile({
        ...workspaceIdentity,
        path: file.name,
        file,
      });
      const preferredPath =
        result.kind === 'archive' ? result.paths[0] ?? null : result.file.path;
      await refreshWorkspaceTree(preferredPath);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to upload file',
      );
    } finally {
      setLoadingTree(false);
    }
  }

  function handleDownload(node: WorkspaceTreeNode) {
    void workspaceAdapter?.downloadNode?.({
      ...workspaceIdentity,
      path: node.path,
      kind: node.kind === 'directory' ? 'directory' : 'file',
    });
  }

  async function handleOpenGarbage() {
    if (!workspaceAdapter?.emptyGarbage) {
      return;
    }
    setWorkspaceError(null);
    if (!workspaceAdapter.listGarbage) {
      setGarbageFiles([]);
      setShowGarbageDialog(true);
      return;
    }
    try {
      const files = await workspaceAdapter.listGarbage(workspaceIdentity);
      setGarbageFiles(files.map((file) => `garbage/${file}`));
    } catch (error) {
      setGarbageFiles([]);
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to list garbage files',
      );
    } finally {
      setShowGarbageDialog(true);
    }
  }

  async function handleConfirmEmptyGarbage() {
    if (!workspaceAdapter?.emptyGarbage) {
      return;
    }
    setShowGarbageDialog(false);
    setWorkspaceError(null);
    try {
      await workspaceAdapter.emptyGarbage(workspaceIdentity);
      await refreshWorkspaceTree(activeNode?.path ?? null);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to empty garbage',
      );
    }
  }

  const explorerActions = {
    ...(workspaceAdapter?.downloadNode
      ? { onDownload: handleDownload }
      : {}),
    ...(workspaceAdapter?.emptyGarbage
      ? { onEmptyGarbage: handleOpenGarbage }
      : {}),
    ...(workspaceAdapter
      ? { onRefresh: () => void refreshWorkspaceTree(activeNode?.path ?? null) }
      : {}),
    ...(workspaceAdapter?.uploadFile
      ? { onUpload: () => fileInputRef.current?.click() }
      : {}),
  };

  function toggleDirectory(path: string) {
    if (!path) {
      return;
    }
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      writeExpandedPaths(workspaceIdentity, next);
      return next;
    });
  }

  const explorerPanel = (
    <WorkspaceExplorerPanel
      canEmptyGarbage={Boolean(workspaceAdapter?.emptyGarbage)}
      canUpload={Boolean(workspaceAdapter?.uploadFile)}
      {...(!isMobileViewport
        ? { onCollapse: () => setCollapsedPanel('explorer') }
        : {})}
      expandedPaths={expandedPaths}
      loading={loadingTree}
      {...explorerActions}
      onSelect={(nodeId) => {
        setSelectedNodeId(nodeId);
      }}
      onToggle={toggleDirectory}
      selectedNodeId={activeNode?.id ?? null}
      tree={tree}
      liveNodes={liveNodes}
    />
  );

  const viewerPanel = (
    <GraphWorkspacePreviewPane
      error={workspaceError}
      imageUrl={imageUrl}
      loadingMore={loadingMore}
      onLoadMore={handleLoadMore}
      {...(!isMobileViewport
        ? { onCollapse: () => setCollapsedPanel('viewer') }
        : {})}
      pdfUrl={pdfUrl}
      previewFile={previewFile}
      previewLoading={previewLoading}
      plugins={plugins}
      selectedTarget={graphWorkspacePreviewTargetFromNode(activeNode)}
    />
  );

  if (collapsedPanel === 'explorer') {
    return (
      <div
        data-testid="workspace-panel"
        className="relative h-full min-h-0 w-full overflow-hidden p-2"
      >
        <button
          type="button"
          data-testid="expand-explorer"
          onClick={() => setCollapsedPanel(null)}
          className="thread-graph-panel-expand-fab left-3"
          title="Expand Explorer"
          aria-label="Expand Explorer"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
        {viewerPanel}
      </div>
    );
  }

  if (collapsedPanel === 'viewer') {
    return (
      <div
        data-testid="workspace-panel"
        className="relative h-full min-h-0 w-full overflow-hidden p-2"
      >
        {explorerPanel}
        <button
          type="button"
          data-testid="expand-viewer"
          onClick={() => setCollapsedPanel(null)}
          className="thread-graph-panel-expand-fab right-3"
          title="Expand Viewer"
          aria-label="Expand Viewer"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="workspace-panel"
      className="flex h-full min-h-0 w-full overflow-hidden bg-transparent p-2"
    >
      {showGarbageDialog ? (
        <GraphEmptyGarbageDialog
          files={garbageFiles}
          onCancel={() => setShowGarbageDialog(false)}
          onConfirm={() => void handleConfirmEmptyGarbage()}
        />
      ) : null}
      {isMobileViewport ? (
        <div className="thread-graph-workspace-mobile-stack flex h-full min-h-0 w-full flex-col">
          <div className="thread-graph-workspace-mobile-explorer h-[34%] min-h-[11rem] shrink-0 overflow-hidden border-b">
            {explorerPanel}
          </div>
          <div className="thread-graph-workspace-mobile-viewer min-h-0 flex-1 overflow-hidden">
            {viewerPanel}
          </div>
        </div>
      ) : (
        <ResizablePanelGroup
          direction="horizontal"
          className="thread-graph-workspace-resizable"
        >
          <ResizablePanel defaultSize={33} minSize={20}>
            <div className="thread-graph-workspace-explorer-pane h-full min-h-0 overflow-hidden">
            {explorerPanel}
            </div>
          </ResizablePanel>
          <ResizableHandle className="thread-graph-workspace-resize-handle w-2 bg-transparent after:w-px after:bg-slate-200/80 after:transition-colors hover:after:bg-slate-300 dark:after:bg-[#303642] dark:hover:after:bg-[#475063]" />
          <ResizablePanel defaultSize={67} minSize={30}>
            <div className="thread-graph-workspace-viewer-pane h-full min-h-0 overflow-hidden">
            {viewerPanel}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => void handleUpload(event)}
      />
    </div>
  );
}
