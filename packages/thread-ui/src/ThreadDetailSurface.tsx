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
import type { ThemeMode } from './app-shell/AppShellNavContext';
import {
  createDefaultPluginContextValue,
  type PluginContextValue,
} from './plugins/plugin-context';
import { usePlugins } from './plugins/usePlugins';
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
import { ThreadGraphWorkspacePanel } from './components/ThreadGraphWorkspacePanel';
import {
  GraphChatThreadChatPanel,
  type GraphChatThreadUsageSummary,
} from './components/graph-chat/GraphChatThreadChatPanel';

function summarizeThreadUsage(
  detail: ThreadDetailDto,
): GraphChatThreadUsageSummary {
  return detail.turns.reduce<GraphChatThreadUsageSummary>(
    (summary, turn) => {
      const usage = turn.tokenUsage?.total;
      if (!usage) {
        return summary;
      }
      return {
        input: summary.input + usage.inputTokens,
        output: summary.output + usage.outputTokens,
        cache: summary.cache + usage.cachedInputTokens,
        turns: summary.turns + 1,
      };
    },
    { input: 0, output: 0, cache: 0, turns: 0 },
  );
}

function formatTopbarTokenCount(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(Math.round(value));
}

function formatTopbarUsageSummary(
  usage: GraphChatThreadUsageSummary | null,
) {
  if (!usage || usage.turns <= 0) {
    return 'waiting for agent usage';
  }
  return `in ${formatTopbarTokenCount(usage.input)} / out ${formatTopbarTokenCount(
    usage.output,
  )} / cache ${formatTopbarTokenCount(usage.cache)}`;
}

export interface ThreadDetailSurfaceProps {
  threads: ThreadDto[];
  detail: ThreadDetailDto | null;
  loading: boolean;
  error: string | null;
  status?: AgentRuntimeStatusDto | null;
  capabilities?: AgentProviderCapabilitiesDto | null;
  managementSchema?: AgentBackendManagementSchemaDto | null;
  plugins?: PluginContextValue;
  adapter: ThreadDetailUiAdapter;
  metaContent?: ReactNode;
  settingsContent?: ReactNode;
  mobileHeaderAction?: ReactNode;
  appMenuButton?: ReactNode;
  appNavigationMenu?: ReactNode;
  surfaceActions?: ReactNode;
  floatingPanel?: ReactNode;
  workspaceContent?: ReactNode;
  workspaceTitle?: string;
  workspaceActions?: ReactNode;
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
  shellThemeMode?: ThemeMode;
  onShellThemeModeChange?: (mode: ThemeMode) => void;
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
  plugins: providedPlugins,
  adapter,
  metaContent,
  settingsContent,
  mobileHeaderAction,
  appMenuButton,
  appNavigationMenu,
  surfaceActions,
  floatingPanel,
  workspaceContent,
  workspaceTitle,
  workspaceActions,
  beforeTimelineContent,
  errorContent,
  workspaceMissingContent,
  dialogs,
  currentThreadId,
  currentWorkspaceId,
  currentWorkspaceLabel,
  onCloseAppNavigation,
  className = 'thread-detail-surface relative flex h-full min-h-0 flex-1 flex-col overflow-hidden',
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
  shellThemeMode = shellEffectiveTheme,
  onShellThemeModeChange,
  onShellStateChange,
  shellUnavailableContent,
  shellDisconnectedContent,
  timelineComponent: TimelineComponent = ThreadTimeline,
  shellPanelComponent: ShellPanelComponent = ThreadShellPanel,
  shellContent,
  loadingContent,
  emptyContent,
}: ThreadDetailSurfaceProps) {
  const contextPlugins = usePlugins();
  const plugins =
    providedPlugins ?? contextPlugins ?? createDefaultPluginContextValue();
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
  const terminalPanelEnabled = plugins
    .getThreadPanels()
    .some((panel) => panel.kind === 'terminal');
  const threadUsageSummary = useMemo(
    () => (detail ? summarizeThreadUsage(detail) : null),
    [detail],
  );
  const topbarUsageLabel = useMemo(
    () => formatTopbarUsageSummary(threadUsageSummary),
    [threadUsageSummary],
  );
  const transcriptItemCount = useMemo(
    () =>
      detail
        ? detail.turns.reduce(
            (count, turn) => count + turn.items.length,
            detail.liveItems?.items.length ?? 0,
          )
        : 0,
    [detail],
  );
  const resolvedWorkspaceContent =
    workspaceContent ??
    (detail ? (
      <ThreadGraphWorkspacePanel
        detail={detail}
        status={status}
        plugins={plugins}
        workspaceAdapter={adapter.workspace ?? null}
        metaContent={metaContent}
        settingsContent={settingsContent}
        activeView={activeView}
      />
    ) : null);

  const defaultContent = loading ? (
    (loadingContent ?? (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[var(--theme-fg-muted)]">
        Loading thread detail...
      </div>
    ))
  ) : detail ? (
    <div className={className}>
      {floatingPanel ? (
        <div className="fixed right-3 top-20 z-50 lg:absolute lg:right-4 lg:top-16">
          {floatingPanel}
        </div>
      ) : null}
      {error &&
        !loading &&
        (errorContent ?? (
          <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 sm:px-6">
            {error}
          </div>
        ))}
      {detail.workspacePathStatus === 'missing' &&
        (workspaceMissingContent ?? (
          <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 sm:px-6">
            <p className="font-medium text-rose-50">Workspace path missing</p>
            <p className="mt-1 break-words text-rose-100/90">
              {detail.workspace.absPath}
            </p>
          </div>
        ))}
      <div
        className={
          activeView === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'
        }
      >
        <GraphChatThreadChatPanel
          detail={detail}
          adapter={adapter}
          timelineAdapter={timelineAdapter}
          TimelineComponent={TimelineComponent}
          liveOutput={liveOutput}
          threadUsageSummary={threadUsageSummary}
          transcriptItemCount={transcriptItemCount}
          useFloatingMobileComposer={useFloatingMobileComposer}
          floatingMobileComposerBottomOffset={floatingMobileComposerBottomOffset}
          {...(beforeTimelineContent ? { beforeTimelineContent } : {})}
          {...(composerProps ? { composerProps } : {})}
          {...(timelineProps ? { timelineProps } : {})}
          {...(composerHostRef ? { composerHostRef } : {})}
        />
      </div>
      <div
        className={
          activeView === 'shell' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'
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
            (shellUnavailableContent ?? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
                <div className="thread-empty-surface max-w-md rounded-[1.6rem] border px-6 py-8 text-center">
                  <p className="text-base font-medium text-[var(--theme-fg)]">
                    Terminal plugin disabled
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--theme-fg-muted)]">
                    Enable the Terminal plugin in Settings to use the shell
                    panel.
                  </p>
                </div>
              </div>
            ))
          ) : (
            (shellDisconnectedContent ?? (
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
            ))
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
    (emptyContent ?? (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[var(--theme-fg-muted)]">
        Select a thread to inspect.
      </div>
    ))
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
      sessionLabel={detail?.thread.providerSessionId ?? detail?.thread.id}
      usageLabel={topbarUsageLabel}
      topbarActions={surfaceActions}
      metaContent={metaContent}
      settingsContent={settingsContent}
      mobileHeaderAction={mobileHeaderAction}
      effectiveTheme={shellEffectiveTheme}
      themeMode={shellThemeMode}
      appMenuButton={appMenuButton}
      appNavigationMenu={appNavigationMenu}
      showMobileAppMenu={false}
      showMobileThreadNavToggle
      showMobileNewThreadShortcut={false}
      onOpenThread={adapter.openThread}
      workspaceContent={resolvedWorkspaceContent}
      workspaceTitle={workspaceTitle ?? 'Workspace'}
      workspaceActions={workspaceActions}
      {...(onCloseAppNavigation ? { onCloseAppNavigation } : {})}
      {...(onShellThemeModeChange
        ? { onThemeModeChange: onShellThemeModeChange }
        : {})}
      {...(adapter.getThreadHref
        ? { getThreadHref: adapter.getThreadHref }
        : {})}
      {...(adapter.getNewThreadHref
        ? { getNewThreadHref: adapter.getNewThreadHref }
        : {})}
      {...(adapter.renameThread
        ? { onRenameThread: adapter.renameThread }
        : {})}
      {...(adapter.deleteThread
        ? { onDeleteThread: adapter.deleteThread }
        : {})}
    >
      {defaultContent}
    </ThreadWorkspaceLayout>
  );
}
