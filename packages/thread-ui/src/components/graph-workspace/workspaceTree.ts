import type {
  AgentRuntimeStatusDto,
  ThreadArtifactDto,
  ThreadDetailDto,
  ThreadHistoryItemDto,
} from '@remote-codex/shared';
import type {
  ThreadWorkspaceFilePreview,
  ThreadWorkspaceTreeNode,
} from '../../adapters';
import type { MoleculeViewerSnapshot } from '@remote-codex/plugin-xyz-viewer';

export type WorkspaceNodeKind =
  | 'directory'
  | 'artifact'
  | 'file'
  | 'live-artifact'
  | 'event'
  | 'meta';

export interface WorkspaceTreeNode {
  id: string;
  name: string;
  path: string;
  kind: WorkspaceNodeKind;
  children: WorkspaceTreeNode[];
  artifact?: ThreadArtifactDto;
  item?: ThreadHistoryItemDto;
  preview?: string;
  detail?: string;
  size?: number;
  workspaceNode?: ThreadWorkspaceTreeNode;
}

export const MOLECULAR_EXTENSIONS = new Set(['xyz', 'extxyz', 'cif', 'pdb']);
export const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
]);
export const PDF_EXTENSIONS = new Set(['pdf']);

export function collectArtifacts(detail: ThreadDetailDto): ThreadArtifactDto[] {
  const artifacts: ThreadArtifactDto[] = [];

  for (const turn of detail.turns) {
    for (const item of turn.items) {
      if (item.kind === 'artifact' && item.artifact) {
        artifacts.push(item.artifact);
      }
    }
  }

  for (const item of detail.liveItems?.items ?? []) {
    if (item.kind === 'artifact' && item.artifact) {
      artifacts.push(item.artifact);
    }
  }

  return artifacts;
}

export function sanitizePathSegment(value: string) {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function extensionOf(path: string) {
  return path.split('.').pop()?.toLowerCase() || '';
}

export function fileNameFromPath(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function workspaceTreeNodeToGraphNode(
  node: ThreadWorkspaceTreeNode,
): WorkspaceTreeNode {
  const kind: WorkspaceNodeKind =
    node.kind === 'directory' ? 'directory' : 'file';
  return {
    id: `workspace:${node.path}`,
    name: node.name,
    path: node.path,
    kind,
    ...(node.size !== undefined ? { size: node.size } : {}),
    workspaceNode: node,
    children: (node.children ?? []).map(workspaceTreeNodeToGraphNode),
  };
}

export function findFirstWorkspaceFile(
  node: WorkspaceTreeNode,
): WorkspaceTreeNode | null {
  if (node.kind === 'file') {
    return node;
  }
  for (const child of node.children) {
    const found = findFirstWorkspaceFile(child);
    if (found) {
      return found;
    }
  }
  return null;
}

export function hasWorkspacePath(
  node: WorkspaceTreeNode | null,
  targetPath: string | null,
): boolean {
  if (!node || !targetPath) {
    return false;
  }
  if (node.path === targetPath) {
    return true;
  }
  return node.children.some((child) => hasWorkspacePath(child, targetPath));
}

export function buildMoleculePreviewSnapshot(
  file: ThreadWorkspaceFilePreview | null,
): MoleculeViewerSnapshot | null {
  if (!file) {
    return null;
  }
  const extension = extensionOf(file.path);
  if (!MOLECULAR_EXTENSIONS.has(extension)) {
    return null;
  }
  return {
    content: [file.content.endsWith('\n') ? file.content : `${file.content}\n`],
    format: extension === 'extxyz' ? 'xyz' : extension,
    name: file.name,
    uuid: file.path,
  };
}

export function buildMoleculePreviewSource(
  file: ThreadWorkspaceFilePreview | null,
): ThreadArtifactDto | null {
  const snapshot = buildMoleculePreviewSnapshot(file);
  if (!file || !snapshot) {
    return null;
  }
  return {
    id: file.path,
    title: file.name,
    pluginId: 'remote-codex.xyz-viewer',
    type: 'chemistry.molecule3d',
    payload: snapshot,
    createdAt: new Date(0).toISOString(),
  };
}

export function languageForPath(path: string) {
  const extension = extensionOf(path);
  if (extension === 'tsx' || extension === 'jsx') {
    return 'tsx';
  }
  if (extension === 'yml') {
    return 'yaml';
  }
  return extension || 'text';
}

export function ensureDirectory(
  root: WorkspaceTreeNode,
  segments: string[],
) {
  let current = root;
  let path = '';
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    let child = current.children.find(
      (node) => node.kind === 'directory' && node.name === segment,
    );
    if (!child) {
      child = {
        id: `dir:${path}`,
        name: segment,
        path,
        kind: 'directory',
        children: [],
      };
      current.children.push(child);
    }
    current = child;
  }
  return current;
}

export function addPathNode(
  root: WorkspaceTreeNode,
  path: string,
  node: WorkspaceTreeNode,
) {
  const segments = path.split('/').filter(Boolean);
  const fileName = segments.pop() ?? node.name;
  const parent = ensureDirectory(root, segments);
  parent.children.push({
    ...node,
    name: node.name || fileName,
    path,
  });
}

export function compareWorkspaceNodes(
  left: WorkspaceTreeNode,
  right: WorkspaceTreeNode,
) {
  if (left.kind === 'directory' && right.kind !== 'directory') {
    return -1;
  }
  if (left.kind !== 'directory' && right.kind === 'directory') {
    return 1;
  }
  return left.name.localeCompare(right.name);
}

export function sortWorkspaceTree(node: WorkspaceTreeNode) {
  node.children.sort(compareWorkspaceNodes);
  for (const child of node.children) {
    sortWorkspaceTree(child);
  }
  return node;
}

export function collectWorkspaceItems(
  detail: ThreadDetailDto,
  artifacts: ThreadArtifactDto[],
  status: AgentRuntimeStatusDto | null,
  activeView: 'chat' | 'shell',
) {
  const root: WorkspaceTreeNode = {
    id: 'root',
    name: detail.workspace.label ?? 'Workspace',
    path: '',
    kind: 'directory',
    children: [],
  };

  const artifactRoot: WorkspaceTreeNode = {
    id: 'artifacts',
    name: 'artifacts',
    path: 'artifacts',
    kind: 'directory',
    children: [],
  };

  for (const artifact of artifacts) {
    const title = artifact.title || artifact.id;
    const safeName = sanitizePathSegment(title) || artifact.id;
    artifactRoot.children.push({
      id: `artifact:${artifact.id}`,
      name: `${safeName}.artifact`,
      path: `artifacts/${safeName}.artifact`,
      kind: 'artifact',
      artifact,
      preview: artifact.summaryText ?? artifact.type,
      detail: JSON.stringify(artifact.payload, null, 2),
      children: [],
    });
  }

  const eventRoot: WorkspaceTreeNode = {
    id: 'thread-events',
    name: 'thread-events',
    path: 'thread-events',
    kind: 'directory',
    children: [],
  };

  const liveRoot: WorkspaceTreeNode = {
    id: 'live',
    name: 'live',
    path: 'live',
    kind: 'directory',
    children: [],
  };

  let sequence = 0;
  const addEventNode = (
    turnId: string,
    item: ThreadHistoryItemDto,
    live = false,
  ) => {
    sequence += 1;
    const label = item.kind.replace(/([A-Z])/g, '-$1').toLowerCase();
    const eventPath = `${live ? 'live' : `thread-events/${turnId}`}/${String(
      sequence,
    ).padStart(3, '0')}-${label}.json`;
    const preview =
      'text' in item && typeof item.text === 'string'
        ? item.text.slice(0, 160)
        : item.kind;
    const artifact =
      item.kind === 'artifact' && item.artifact ? item.artifact : null;
    const node: WorkspaceTreeNode = artifact && live
      ? {
          id: `live-artifact:${artifact.id}`,
          name: artifact.title || artifact.id,
          path: eventPath,
          kind: 'live-artifact',
          artifact,
          item,
          preview: artifact.summaryText ?? artifact.type,
          detail: JSON.stringify(artifact.payload, null, 2),
          children: [],
        }
      : {
      id: `event:${item.id}`,
      name: fileNameFromPath(eventPath),
      path: eventPath,
      kind: 'event',
      item,
      preview,
      detail: JSON.stringify(item, null, 2),
      children: [],
    };
    if (live) {
      liveRoot.children.push(node);
      return;
    }
    addPathNode(eventRoot, eventPath.replace(/^thread-events\//, ''), node);
  };

  for (const turn of detail.turns) {
    for (const item of turn.items) {
      if (
        item.kind === 'commandExecution' ||
        item.kind === 'webSearch' ||
        item.kind === 'fileRead' ||
        item.kind === 'fileChange' ||
        item.kind === 'agentToolCall' ||
        item.kind === 'skillToolCall' ||
        item.kind === 'toolCall' ||
        item.kind === 'hook' ||
        item.kind === 'plan' ||
        item.kind === 'reasoning'
      ) {
        addEventNode(turn.id, item);
      }
    }
  }

  for (const item of detail.liveItems?.items ?? []) {
    addEventNode(detail.thread.activeTurnId ?? 'live', item, true);
  }

  void status;
  void activeView;

  root.children.push(artifactRoot, eventRoot, liveRoot);
  return sortWorkspaceTree(root);
}

export function flattenWorkspaceNodes(root: WorkspaceTreeNode) {
  const map = new Map<string, WorkspaceTreeNode>();
  const visit = (node: WorkspaceTreeNode) => {
    map.set(node.id, node);
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return map;
}

export function findFirstPreviewNode(
  node: WorkspaceTreeNode,
): WorkspaceTreeNode | null {
  if (
    node.kind === 'artifact' ||
    node.kind === 'live-artifact' ||
    node.kind === 'event' ||
    node.kind === 'file'
  ) {
    return node;
  }
  for (const child of node.children) {
    const found = findFirstPreviewNode(child);
    if (found) {
      return found;
    }
  }
  return null;
}

export function collectAncestorPaths(path: string) {
  const segments = path.split('/').filter(Boolean);
  const paths: string[] = [];
  for (let index = 1; index <= segments.length; index += 1) {
    paths.push(segments.slice(0, index).join('/'));
  }
  return paths;
}
