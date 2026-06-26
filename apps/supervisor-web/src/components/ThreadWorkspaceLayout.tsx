import {
  ThreadCards,
  ThreadWorkspaceLayout as SharedThreadWorkspaceLayout,
} from '@remote-codex/thread-ui';
import type { ComponentProps } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAppShellNav } from './AppShellNavContext';
import { AppShellSettingsDialog } from './AppShellNavigation';
import {
  currentNewThreadHref,
  currentThreadHref,
  currentWorkspacesHref,
} from '../lib/relayRoutes';

type ThreadWorkspaceLayoutProps = ComponentProps<
  typeof SharedThreadWorkspaceLayout
>;

function buildNewThreadHref(workspaceId?: string | null) {
  return currentNewThreadHref(workspaceId);
}

export { ThreadCards };

export function ThreadWorkspaceLayout({
  getThreadHref,
  onOpenThread,
  getNewThreadHref,
  renderThreadLink,
  onCloseAppNavigation,
  ...props
}: ThreadWorkspaceLayoutProps) {
  const navigate = useNavigate();
  const shellNav = useAppShellNav();
  const closeAppNavigation = onCloseAppNavigation ?? shellNav?.closeNav;
  const effectiveTheme = props.effectiveTheme ?? shellNav?.effectiveTheme;
  const themeMode = props.themeMode ?? shellNav?.themeMode;
  const onThemeModeChange = props.onThemeModeChange ?? shellNav?.setThemeMode;

  return (
    <SharedThreadWorkspaceLayout
      {...props}
      workspaceReturnHref={props.workspaceReturnHref ?? currentWorkspacesHref()}
      globalSettingsContent={
        props.globalSettingsContent ?? <AppShellSettingsDialog embedded />
      }
      {...(effectiveTheme ? { effectiveTheme } : {})}
      {...(themeMode ? { themeMode } : {})}
      {...(onThemeModeChange ? { onThemeModeChange } : {})}
      getThreadHref={getThreadHref ?? ((threadId) => currentThreadHref(threadId))}
      onOpenThread={
        onOpenThread ?? ((threadId) => navigate(currentThreadHref(threadId)))
      }
      getNewThreadHref={getNewThreadHref ?? buildNewThreadHref}
      renderThreadLink={
        renderThreadLink ??
        (({ thread, children, className, onClick }) => (
          <Link
            to={currentThreadHref(thread.id)}
            className={className}
            onClick={onClick}
          >
            {children}
          </Link>
        ))
      }
      {...(closeAppNavigation
        ? { onCloseAppNavigation: closeAppNavigation }
        : {})}
    />
  );
}
