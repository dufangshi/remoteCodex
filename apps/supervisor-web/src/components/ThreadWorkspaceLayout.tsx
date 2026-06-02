import {
  ThreadCards,
  ThreadWorkspaceLayout as SharedThreadWorkspaceLayout,
} from '@remote-codex/thread-ui';
import type { ComponentProps } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAppShellNav } from './AppShellNavContext';
import {
  AppShellMenuButton,
  AppShellNavigationMenu,
} from './AppShellNavigation';

type ThreadWorkspaceLayoutProps = ComponentProps<typeof SharedThreadWorkspaceLayout>;

function buildNewThreadHref(workspaceId?: string | null) {
  return workspaceId
    ? `/threads/new?workspaceId=${encodeURIComponent(workspaceId)}`
    : '/threads/new';
}

export { ThreadCards };

export function ThreadWorkspaceLayout({
  appMenuButton,
  appNavigationMenu,
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

  return (
    <SharedThreadWorkspaceLayout
      {...props}
      appMenuButton={appMenuButton ?? <AppShellMenuButton />}
      appNavigationMenu={appNavigationMenu ?? <AppShellNavigationMenu />}
      getThreadHref={getThreadHref ?? ((threadId) => `/threads/${threadId}`)}
      onOpenThread={onOpenThread ?? ((threadId) => navigate(`/threads/${threadId}`))}
      getNewThreadHref={getNewThreadHref ?? buildNewThreadHref}
      renderThreadLink={
        renderThreadLink ??
        (({ thread, children, className, onClick }) => (
          <Link
            to={`/threads/${thread.id}`}
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
