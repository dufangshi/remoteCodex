import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { MessageSquarePlus, Plus, Settings } from 'lucide-react';
import { MatterWorkbench } from '@remote-codex/thread-ui';
import type { ThreadDto, WorkspaceDto } from '@remote-codex/shared';
import { fetchThreads, fetchWorkspaces } from '../lib/api';
import { currentNewThreadHref, currentRelayDeviceIdFromPath, currentThreadHref, currentWorkspacesHref } from '../lib/relayRoutes';
import { useAppShellNav } from '../components/AppShellNavContext';
import { RecentThreadMenu } from '../components/RecentThreadMenu';
import { useWorkbenchNavigation } from './useWorkbenchNavigation';
import { useThreadListPolling } from './useThreadListPolling';

// Legacy workspace-list URLs now resolve directly into the conversation shell.
export function ThreadsPage() {
  const [params] = useSearchParams();
  const workspaceId = params.get('workspaceId');
  const deviceId = currentRelayDeviceIdFromPath();
  const navigate = useNavigate();
  const shell = useAppShellNav();
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const navigation = useWorkbenchNavigation(null, threads, deviceId);
  useThreadListPolling({ enabled: !loading && !!workspace, setThreads });
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setWorkspace(null); setThreads([]);
    if (!workspaceId) return;
    void Promise.all([fetchThreads(), fetchWorkspaces()]).then(([items, workspaces]) => {
      if (!active) return;
      const found = workspaces.find(value => value.id === workspaceId);
      if (!found) throw new Error('Workspace not found.');
      setWorkspace(found); setThreads(items);
    }).catch(caught => {
      if (active) setError(caught instanceof Error ? caught.message : 'Unable to open workspace.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, deviceId, retry]);
  if (!workspaceId) return <Navigate to={currentWorkspacesHref()} replace />;
  const next = threads.filter(thread => thread.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
  if (!loading && !error && next) return <Navigate to={currentThreadHref(next.id)} replace />;
  const createHref = currentNewThreadHref(workspaceId);
  return <div className="thread-ui-shell thread-ui-viewport-constrained h-full" data-theme-effective={shell?.effectiveTheme ?? 'light'} data-theme-mode={shell?.themeMode ?? 'system'}>
    <MatterWorkbench
      title={workspace?.label ?? 'Workspace'} homeHref={currentWorkspacesHref()}
      options={{ ...navigation, emptyWorkspace: true, workspacePath: workspace?.absPath ?? '', activeView: 'chat', terminalEnabled: false, onViewChange: () => {}, onSearch: () => {}, onNavigate: navigate,
        renderThreadMenu: thread => <RecentThreadMenu thread={thread} currentKey={navigation.currentKey} onFavorite={navigation.onToggleThreadFavorite} onRenamed={navigation.onThreadRenamed} onRemoved={navigation.onThreadRemoved} onNavigate={navigate} /> }}
      settings={<button aria-label="Open settings" onClick={shell?.openSettings}><Settings /></button>}
      newThread={!loading && !error && <Link to={createHref} aria-label="New thread"><Plus /></Link>}
      actions={null} threadMenu={null} connection={null} explorer={null} revealExplorer={0}
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        {loading ? <p role="status">Opening workspace…</p> : error ? <><p role="alert">{error}</p><button className="relay-button-secondary rounded-lg px-4 py-2" onClick={() => setRetry(value => value + 1)}>Retry</button></> : <>
          <MessageSquarePlus size={32} className="text-[var(--theme-fg-muted)]" />
          <h1 className="text-xl font-semibold">Start a thread in {workspace?.label}</h1>
          <p className="text-sm text-[var(--theme-fg-muted)]">Your conversations in this workspace will appear here.</p>
          <Link to={createHref} className="relay-button-primary inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold"><Plus size={18} />Create thread</Link>
        </>}
      </div>
    </MatterWorkbench>
  </div>;
}
