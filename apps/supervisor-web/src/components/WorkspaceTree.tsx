import { useState } from 'react';

import type { WorkspaceTreeNodeDto } from '../../../../packages/shared/src/index';
import { fetchWorkspaceTree } from '../lib/api';

interface WorkspaceTreeProps {
  rootPath: string;
  initialNodes: WorkspaceTreeNodeDto[];
  showHidden: boolean;
}

interface TreeBranchProps {
  node: WorkspaceTreeNodeDto;
  showHidden: boolean;
}

function TreeBranch({ node, showHidden }: TreeBranchProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [children, setChildren] = useState<WorkspaceTreeNodeDto[] | null>(null);

  async function toggleNode() {
    if (node.kind !== 'directory') {
      return;
    }

    if (!open && children === null) {
      setLoading(true);
      setError(null);
      try {
        const tree = await fetchWorkspaceTree(node.absPath, showHidden);
        setChildren(tree.nodes);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to load children.');
      } finally {
        setLoading(false);
      }
    }

    setOpen((current) => !current);
  }

  return (
    <li className="rounded-2xl border border-stone-800 bg-stone-950/60 px-3 py-3">
      <button
        type="button"
        onClick={toggleNode}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p className="font-medium text-stone-100">{node.name}</p>
          <p className="text-xs text-stone-500">{node.absPath}</p>
        </div>
        <span className="rounded-full border border-stone-700 px-2 py-1 text-xs uppercase tracking-[0.2em] text-stone-400">
          {node.kind}
        </span>
      </button>
      {node.kind === 'directory' && open && (
        <div className="mt-3 border-l border-stone-800 pl-4">
          {loading && <p className="text-sm text-stone-500">Loading...</p>}
          {error && <p className="text-sm text-rose-300">{error}</p>}
          {children && children.length === 0 && <p className="text-sm text-stone-500">Empty directory.</p>}
          {children && children.length > 0 && (
            <ul className="space-y-3">
              {children.map((child) => (
                <TreeBranch key={child.absPath} node={child} showHidden={showHidden} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function WorkspaceTree({ rootPath, initialNodes, showHidden }: WorkspaceTreeProps) {
  return (
    <div className="rounded-3xl border border-stone-800 bg-stone-900 p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Tree</p>
          <h3 className="mt-2 text-xl font-semibold text-stone-100">{rootPath}</h3>
        </div>
        <div className="text-right text-xs text-stone-500">
          {showHidden ? 'Including hidden files' : 'Hidden files filtered'}
        </div>
      </div>
      {initialNodes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-700 px-4 py-6 text-sm text-stone-500">
          This directory is empty.
        </div>
      ) : (
        <ul className="space-y-3">
          {initialNodes.map((node) => (
            <TreeBranch key={node.absPath} node={node} showHidden={showHidden} />
          ))}
        </ul>
      )}
    </div>
  );
}
