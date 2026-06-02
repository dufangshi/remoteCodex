import {
  useMemo,
  type ComponentType,
  type ForwardRefExoticComponent,
  type Ref,
  type RefAttributes,
  type RefObject,
  type ReactNode,
} from 'react';

import type {
  AgentBackendManagementSchemaDto,
  AgentProviderCapabilitiesDto,
  AgentRuntimeStatusDto,
  ThreadDetailDto,
  ThreadDto,
} from '@remote-codex/shared';
import type { ThreadDetailUiAdapter } from './adapters';
import type { PluginContextValue } from './plugins/plugin-context';
import { ThreadWorkspaceLayout } from './components/ThreadWorkspaceLayout';
import {
  ThreadTimeline,
  type ThreadTimelineProps,
} from './components/ThreadTimeline';
import {
  ThreadComposer,
  type ThreadComposerProps,
} from './components/ThreadComposer';
import {
  ThreadShellPanel,
  type ThreadShellControlState,
  type ThreadShellPanelHandle,
} from './components/ThreadShellPanel';

export interface ThreadDetailSurfaceProps {
  threads: ThreadDto[];
  detail: ThreadDetailDto | null;
  loading: boolean;
  error: string | null;
  status?: AgentRuntimeStatusDto | null;
  capabilities?: AgentProviderCapabilitiesDto | null;
  managementSchema?: AgentBackendManagementSchemaDto | null;
  plugins: PluginContextValue;
  adapter: ThreadDetailUiAdapter;
  metaContent?: ReactNode;
  settingsContent?: ReactNode;
  mobileHeaderAction?: ReactNode;
  appMenuButton?: ReactNode;
  appNavigationMenu?: ReactNode;
  surfaceActions?: ReactNode;
  floatingPanel?: ReactNode;
  beforeTimelineContent?: ReactNode;
  errorContent?: ReactNode;
  workspaceMissingContent?: ReactNode;
  dialogs?: ReactNode;
  currentThreadId?: string;
  currentWorkspaceId?: string | null;
  currentWorkspaceLabel?: string | null;
  onCloseAppNavigation?: () => void;
  className?: string;
  activeView?: 'chat' | 'shell';
  liveOutput?: string;
  timelineProps?: Partial<
    Omit<ThreadTimelineProps, 'threadId' | 'turns' | 'liveOutput' | 'adapter'>
  >;
  composerProps?: Omit<ThreadComposerProps, 'activeView' | 'onSubmit'>;
  shellComposerProps?: Omit<ThreadComposerProps, 'activeView' | 'onSubmit'>;
  useFloatingMobileComposer?: boolean;
  floatingMobileComposerBottomOffset?: number;
  composerHostRef?: RefObject<HTMLDivElement | null>;
  shellPanelRef?: Ref<ThreadShellPanelHandle>;
  shellEffectiveTheme?: 'light' | 'dark';
  onShellStateChange?: (state: ThreadShellControlState) => void;
  shellUnavailableContent?: ReactNode;
  shellDisconnectedContent?: ReactNode;
  timelineComponent?: ComponentType<ThreadTimelineProps>;
  shellPanelComponent?: ForwardRefExoticComponent<
    {
      threadId: string;
      shellAdapter: NonNullable<ThreadDetailUiAdapter['shell']>;
      isVisible?: boolean;
      showHeader?: boolean;
      showFloatingToolbox?: boolean;
      effectiveTheme?: 'light' | 'dark';
      onStateChange?: (state: ThreadShellControlState) => void;
    } & RefAttributes<ThreadShellPanelHandle>
  >;
  shellContent?: ReactNode;
  loadingContent?: ReactNode;
  emptyContent?: ReactNode;
}

export function ThreadDetailSurface({
  threads,
  detail,
  loading,
  error,
  status = null,
  plugins,
  adapter,
  metaContent,
  settingsContent,
  mobileHeaderAction,
  appMenuButton,
  appNavigationMenu,
  surfaceActions,
  floatingPanel,
  beforeTimelineContent,
  errorContent,
  workspaceMissingContent,
  dialogs,
  currentThreadId,
  currentWorkspaceId,
  currentWorkspaceLabel,
  onCloseAppNavigation,
  className = 'thread-detail-surface relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-y shadow-2xl shadow-stone-950/20 sm:flex-none sm:rounded-[2rem] sm:border',
  activeView = 'chat',
  liveOutput = '',
  timelineProps,
  composerProps,
  shellComposerProps,
  useFloatingMobileComposer = false,
  floatingMobileComposerBottomOffset = 0,
  composerHostRef,
  shellPanelRef,
  shellEffectiveTheme = 'dark',
  onShellStateChange,
  shellUnavailableContent,
  shellDisconnectedContent,
  timelineComponent: TimelineComponent = ThreadTimeline,
  shellPanelComponent: ShellPanelComponent = ThreadShellPanel,
  shellContent,
  loadingContent,
  emptyContent,
}: ThreadDetailSurfaceProps) {
  const timelineAdapter = useMemo(
    () => ({
      ...(adapter.getImageAssetUrl
        ? {
            getImageAssetUrl: (input: { threadId: string; path: string }) =>
              adapter.getImageAssetUrl?.(input.path) ?? '',
          }
        : {}),
      onOpenLinkedThread: adapter.openThread,
      ...(adapter.loadHistoryItemDetail
        ? { onLoadHistoryItemDetail: adapter.loadHistoryItemDetail }
        : {}),
    }),
    [
      adapter.getImageAssetUrl,
      adapter.loadHistoryItemDetail,
      adapter.openThread,
    ],
  );
  const terminalPanelEnabled = plugins.getThreadPanels().some(
    (panel) => panel.kind === 'terminal',
  );

  const defaultContent = loading ? (
    loadingContent ?? (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[var(--theme-fg-muted)]">
        Loading thread detail...
      </div>
    )
  ) : detail ? (
    <div className={className}>
      {surfaceActions ? (
        <div className="pointer-events-none absolute right-4 top-4 z-30 hidden lg:block">
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            {surfaceActions}
          </div>
        </div>
      ) : null}
      {floatingPanel ? (
        <div className="fixed right-3 top-20 z-50 lg:absolute lg:right-4 lg:top-16">
          {floatingPanel}
        </div>
      ) : null}
      {error && !loading && (
        errorContent ?? (
          <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 sm:px-6">
            {error}
          </div>
        )
      )}
      {detail.workspacePathStatus === 'missing' && (
        workspaceMissingContent ?? (
          <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 sm:px-6">
            <p className="font-medium text-rose-50">Workspace path missing</p>
            <p className="mt-1 break-words text-rose-100/90">
              {detail.workspace.absPath}
            </p>
          </div>
        )
      )}
      {beforeTimelineContent}
      <div
        className={
          activeView === 'chat'
            ? 'flex min-h-0 flex-1 flex-col'
            : 'hidden'
        }
      >
        <TimelineComponent
          threadId={detail.thread.id}
          turns={detail.turns}
          totalTurnCount={detail.totalTurnCount ?? detail.turns.length}
          pendingRequests={detail.pendingRequests}
          activeTurnId={detail.thread.activeTurnId}
          threadRunning={
            detail.thread.status === 'running' ||
            detail.thread.activeTurnId !== null
          }
          liveOutput={liveOutput}
          className="thread-timeline-surface min-h-0 flex-1"
          {...timelineProps}
          adapter={timelineAdapter}
          onOpenThread={timelineProps?.onOpenThread ?? adapter.openThread}
        />
        {composerProps ? (
          useFloatingMobileComposer ? (
            <div
              ref={composerHostRef}
              className="fixed inset-x-0 bottom-0 z-50 overflow-visible sm:hidden"
              style={{
                bottom: `${floatingMobileComposerBottomOffset}px`,
                paddingBottom: 'env(safe-area-inset-bottom)',
              }}
            >
              <ThreadComposer
                {...composerProps}
                activeView="chat"
                edgeToEdgeMobile
                onSubmit={adapter.sendPrompt}
              />
            </div>
          ) : (
            <div ref={composerHostRef}>
              <ThreadComposer
                {...composerProps}
                activeView="chat"
                onSubmit={adapter.sendPrompt}
              />
            </div>
          )
        ) : null}
      </div>
      <div
        className={
          activeView === 'shell'
            ? 'flex min-h-0 flex-1 flex-col'
            : 'hidden'
        }
      >
        {shellContent ??
          (detail.thread.isLoaded && terminalPanelEnabled && adapter.shell ? (
            <ShellPanelComponent
              ref={shellPanelRef}
              threadId={detail.thread.id}
              shellAdapter={adapter.shell}
              effectiveTheme={shellEffectiveTheme}
              isVisible={activeView === 'shell'}
              showHeader={false}
              showFloatingToolbox={false}
              {...(onShellStateChange
                ? { onStateChange: onShellStateChange }
                : {})}
            />
          ) : detail.thread.isLoaded && !terminalPanelEnabled ? (
            shellUnavailableContent ?? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
                <div className="thread-empty-surface max-w-md rounded-[1.6rem] border px-6 py-8 text-center">
                  <p className="text-base font-medium text-[var(--theme-fg)]">
                    Terminal plugin disabled
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--theme-fg-muted)]">
                    Enable the Terminal plugin in Settings to use the shell panel.
                  </p>
                </div>
              </div>
            )
          ) : (
            shellDisconnectedContent ?? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
                <div className="thread-empty-surface max-w-md rounded-[1.6rem] border px-6 py-8 text-center">
                  <p className="text-base font-medium text-[var(--theme-fg)]">
                    Thread disconnected
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--theme-fg-soft)]">
                    Reconnect this thread before creating or attaching a shell.
                  </p>
                </div>
              </div>
            )
          ))}
        {activeView === 'shell' && shellComposerProps && !shellContent ? (
          <ThreadComposer
            {...shellComposerProps}
            activeView="shell"
            onSubmit={adapter.sendPrompt}
          />
        ) : null}
      </div>
      {dialogs}
    </div>
  ) : (
    emptyContent ?? (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[var(--theme-fg-muted)]">
        Select a thread to inspect.
      </div>
    )
  );

  return (
    <ThreadWorkspaceLayout
      threads={threads}
      status={status}
      loading={loading}
      error={loading ? null : error}
      viewportConstrained
      currentThreadId={currentThreadId ?? detail?.thread.id}
      currentThreadLabel={detail?.thread.title}
      currentWorkspaceId={currentWorkspaceId ?? detail?.thread.workspaceId}
      currentWorkspaceLabel={currentWorkspaceLabel ?? detail?.workspace.label}
      metaContent={metaContent}
      settingsContent={settingsContent}
      mobileHeaderAction={mobileHeaderAction}
      appMenuButton={appMenuButton}
      appNavigationMenu={appNavigationMenu}
      showMobileNewThreadShortcut={false}
      onOpenThread={adapter.openThread}
      {...(onCloseAppNavigation ? { onCloseAppNavigation } : {})}
      {...(adapter.getThreadHref ? { getThreadHref: adapter.getThreadHref } : {})}
      {...(adapter.getNewThreadHref
        ? { getNewThreadHref: adapter.getNewThreadHref }
        : {})}
      {...(adapter.renameThread ? { onRenameThread: adapter.renameThread } : {})}
      {...(adapter.deleteThread ? { onDeleteThread: adapter.deleteThread } : {})}
    >
      {defaultContent}
    </ThreadWorkspaceLayout>
  );
}
