import type { ReactNode } from 'react';

export function GraphChatShellRoot({
  children,
  effectiveTheme,
  layoutMode,
  themeMode,
  viewportConstrained,
}: {
  children: ReactNode;
  effectiveTheme: 'light' | 'dark';
  layoutMode: 'desktop' | 'responsive' | 'mobile';
  themeMode?: string | undefined;
  viewportConstrained: boolean;
}) {
  return (
    <div
      className={`thread-ui-shell ${
        effectiveTheme === 'dark' ? 'thread-ui-theme-dark dark' : ''
      } ${viewportConstrained ? 'thread-ui-viewport-constrained' : ''} ${
        viewportConstrained
          ? 'h-[100svh] max-h-[100svh] min-h-0 overflow-hidden overscroll-none'
          : 'min-h-[100svh] overflow-hidden'
      } bg-[var(--theme-bg)] text-[var(--theme-fg)] sm:p-2`}
      data-theme-effective={effectiveTheme}
      data-theme-mode={themeMode ?? effectiveTheme}
      data-thread-layout={layoutMode}
    >
      {children}
    </div>
  );
}

export function GraphChatShellFrame({
  children,
  roomsRailCollapsed,
}: {
  children: ReactNode;
  roomsRailCollapsed: boolean;
}) {
  return (
    <div
      className={`thread-shell-frame relative h-full min-h-0 ${
        roomsRailCollapsed
          ? 'is-rail-collapsed sm:grid-cols-[56px_minmax(0,1fr)]'
          : 'sm:grid-cols-[264px_minmax(0,1fr)]'
      }`}
    >
      {children}
    </div>
  );
}

export function GraphChatMobileScrim({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  if (!open) {
    return null;
  }

  return (
    <button
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      className="thread-mobile-only-block fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[1px] dark:bg-black/55"
      onClick={onClose}
    />
  );
}

export function GraphChatRoomsRailShell({
  children,
  collapsed,
  mobileOpen,
}: {
  children: ReactNode;
  collapsed: boolean;
  mobileOpen: boolean;
}) {
  return (
    <aside
      className={`thread-graph-rooms-surface thread-rooms-rail fixed inset-y-0 left-0 z-50 flex min-h-0 w-[min(20rem,calc(100vw-2rem))] flex-col border-r shadow-[0_20px_50px_rgba(15,23,42,0.18)] transition-transform duration-200 ease-out sm:static sm:z-auto sm:w-auto sm:translate-x-0 sm:rounded-[12px] sm:border sm:shadow-[var(--theme-shadow)] ${
        mobileOpen
          ? 'translate-x-0'
          : 'pointer-events-none -translate-x-full sm:pointer-events-auto'
      } ${collapsed ? 'thread-ui-rail-collapsed sm:items-center' : ''}`}
    >
      {children}
    </aside>
  );
}

export function GraphChatMainShell({ children }: { children: ReactNode }) {
  return (
    <main className="thread-shell-main h-full min-h-0 min-w-0 overflow-hidden">
      <div className="thread-main-panel thread-shell-card flex h-full min-h-0 flex-col overflow-hidden bg-[var(--theme-panel)] shadow-[var(--theme-shadow)] sm:rounded-[12px] sm:border">
        {children}
      </div>
    </main>
  );
}

export function GraphChatTopbarShell({ children }: { children: ReactNode }) {
  return (
    <div className="thread-topbar-surface flex shrink-0 flex-col border-b pt-[env(safe-area-inset-top)] sm:pt-0">
      {children}
    </div>
  );
}

export function GraphChatSplitRegion({ children }: { children: ReactNode }) {
  return (
    <div className="thread-split-region min-h-0 flex-1 overflow-hidden p-0 sm:p-2">
      {children}
    </div>
  );
}
