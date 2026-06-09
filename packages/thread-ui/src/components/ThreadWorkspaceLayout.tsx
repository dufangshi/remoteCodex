import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Rows3,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";

import type { AgentRuntimeStatusDto, ThreadDto } from "@remote-codex/shared";
import { useAppShellNav } from "../app-shell/AppShellNavContext";
import {
  formatShortTimestamp,
  threadStatusClassName,
  threadStatusLabel,
} from "./threadPresentation";
import { RenameDialog } from "./RenameDialog";
import type { ThemeMode } from "../app-shell/AppShellNavContext";
import {
  GraphChatMainShell,
  GraphChatMobileScrim,
  GraphChatRoomsRailShell,
  GraphChatShellFrame,
  GraphChatShellRoot,
  GraphChatSplitRegion,
  GraphChatTopbarShell,
} from "./graph-chat/GraphChatShellLayout";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./graph-workspace/GraphResizablePanels";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./graph-ui/Dialog";

const THEME_MODE_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  icon: typeof Monitor;
}> = [
  { value: "system", label: "Follow system", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
];

interface ThreadWorkspaceLayoutProps {
  threads: ThreadDto[];
  status: AgentRuntimeStatusDto | null;
  loading?: boolean;
  error?: string | null;
  viewportConstrained?: boolean;
  layoutMode?: "desktop" | "responsive" | "mobile";
  effectiveTheme?: "light" | "dark";
  themeMode?: ThemeMode;
  onThemeModeChange?: (mode: ThemeMode) => void;
  showMobileAppMenu?: boolean;
  showMobileThreadNavToggle?: boolean;
  showMobileNewThreadShortcut?: boolean;
  mobileHeaderAction?: ReactNode;
  currentThreadId?: string | undefined;
  currentThreadLabel?: string | null | undefined;
  currentWorkspaceId?: string | null | undefined;
  currentWorkspaceLabel?: string | null | undefined;
  sessionLabel?: string | null | undefined;
  usageLabel?: string | null | undefined;
  topbarActions?: ReactNode;
  workspaceLabels?: Record<string, string>;
  metaContent?: ReactNode;
  settingsContent?: ReactNode;
  globalSettingsContent?: ReactNode;
  appMenuButton?: ReactNode;
  appNavigationMenu?: ReactNode;
  workspaceReturnHref?: string;
  onWorkspaceReturn?: () => void;
  getThreadHref?: (threadId: string) => string;
  onOpenThread?: (threadId: string) => void;
  getNewThreadHref?: (workspaceId?: string | null) => string;
  newThreadHref?: string;
  newThreadLabel?: string;
  onNewThread?: () => void;
  onNewThreadTitle?: (title: string) => Promise<void> | void;
  renderThreadLink?: (input: {
    thread: ThreadDto;
    children: ReactNode;
    className: string;
    onClick: () => void;
  }) => ReactNode;
  onCloseAppNavigation?: () => void;
  onRenameThread?:
    | ((threadId: string, title: string) => Promise<void> | void)
    | undefined;
  onDeleteThread?: ((thread: ThreadDto) => void) | undefined;
  workspaceContent?: ReactNode;
  workspaceTitle?: string;
  workspaceActions?: ReactNode;
  children: ReactNode;
}

interface ThreadCardsProps {
  threads: ThreadDto[];
  currentThreadId?: string | undefined;
  currentWorkspaceId?: string | null | undefined;
  workspaceLabels?: Record<string, string>;
  onOpenThread: (threadId: string) => void;
  getThreadHref?: ((threadId: string) => string) | undefined;
  renderThreadLink?: ThreadWorkspaceLayoutProps["renderThreadLink"] | undefined;
  onBeginRenameThread?: ((thread: ThreadDto) => void) | undefined;
  onDeleteThread?: ((thread: ThreadDto) => void) | undefined;
  scrollable?: boolean;
  maxHeightClassName?: string;
  showDeleteButton?: boolean;
  showSessionCopyButton?: boolean;
  collapsed?: boolean;
}

function ThreadCard({
  thread,
  currentThreadId,
  currentWorkspaceId,
  workspaceLabels = {},
  onOpenThread,
  getThreadHref,
  renderThreadLink,
  onBeginRenameThread,
  onDeleteThread,
  showDeleteButton = false,
  showSessionCopyButton = false,
  collapsed = false,
}: {
  thread: ThreadDto;
  currentThreadId?: string | undefined;
  currentWorkspaceId?: string | null | undefined;
  workspaceLabels?: Record<string, string>;
  onOpenThread: (threadId: string) => void;
  getThreadHref?: ((threadId: string) => string) | undefined;
  renderThreadLink?: ThreadWorkspaceLayoutProps["renderThreadLink"] | undefined;
  onBeginRenameThread?: ((thread: ThreadDto) => void) | undefined;
  onDeleteThread?: ((thread: ThreadDto) => void) | undefined;
  showDeleteButton?: boolean;
  showSessionCopyButton?: boolean;
  collapsed?: boolean;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const resetTimerRef = useRef<number | null>(null);
  const workspaceLabel = workspaceLabels[thread.workspaceId];
  const roomMetaLabel = workspaceLabel && !currentWorkspaceId ? workspaceLabel : null;
  const isCurrentThread = currentThreadId === thread.id;

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleCopySessionId() {
    const sessionId = thread.providerSessionId;
    if (!sessionId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(sessionId);
      setCopyState("copied");
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(
        () => setCopyState("idle"),
        1200,
      );
    } catch {
      setCopyState("failed");
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(
        () => setCopyState("idle"),
        1600,
      );
    }
  }

  const openThread = () => onOpenThread(thread.id);
  const cardClassName = `thread-graph-room-card group flex w-full items-center gap-3 rounded-xl border text-left transition ${
    isCurrentThread ? "is-active" : ""
  } ${collapsed ? "justify-center px-2 py-2" : "px-3 py-2.5"}`;
  const cardContent = (
    <>
      <div
        className={`thread-graph-room-card-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isCurrentThread ? "is-active" : ""
        }`}
      >
        <MessageSquare className="h-4 w-4" />
      </div>
      <div
        className={`min-w-0 flex-1 ${
          collapsed ? "thread-desktop-collapsed-hidden" : ""
        }`}
      >
        <div className="flex min-w-0 items-center gap-1">
          <p
            className="thread-graph-room-card-title min-w-0 flex-1 truncate text-sm font-medium"
            title={thread.title}
          >
            {thread.title}
          </p>
          {onBeginRenameThread && !collapsed ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onBeginRenameThread(thread);
              }}
              aria-label={`Rename thread ${thread.title}`}
              title="Rename thread"
              className="thread-card-quiet-button inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition"
            >
              <Pencil className="h-3 w-3" />
            </button>
          ) : null}
          {showSessionCopyButton && thread.providerSessionId ? (
            <button
              type="button"
              aria-label="Copy session ID"
              title={
                copyState === "copied"
                  ? "Copied"
                  : copyState === "failed"
                    ? "Copy failed"
                    : "Copy session ID"
              }
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                void handleCopySessionId();
              }}
              className="thread-card-quiet-button thread-card-session-copy-button inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          {roomMetaLabel ? (
            <p
              className="thread-graph-room-card-meta min-w-0 flex-1 truncate text-[11px] text-[var(--theme-fg-muted)]"
              title={roomMetaLabel}
            >
              {roomMetaLabel}
            </p>
          ) : (
            <span className="min-w-0 flex-1" aria-hidden="true" />
          )}
          <span
            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-normal ${threadStatusClassName(thread.status)}`}
          >
            {threadStatusLabel(thread.status)}
          </span>
          <time
            className="shrink-0 text-[11px] text-[var(--theme-fg-muted)]"
            dateTime={thread.lastTurnStartedAt ?? thread.updatedAt}
          >
            {formatShortTimestamp(thread.lastTurnStartedAt ?? thread.updatedAt)}
          </time>
        </div>
      </div>
      {showDeleteButton && onDeleteThread && !collapsed ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onDeleteThread(thread);
          }}
          aria-label={`Delete thread ${thread.title}`}
          className="thread-card-danger-button shrink-0 rounded-full p-1 transition"
          title="Delete thread"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </>
  );
  const href = getThreadHref?.(thread.id);

  if (renderThreadLink) {
    return (
      <>
        {renderThreadLink({
          thread,
          children: cardContent,
          className: cardClassName,
          onClick: openThread,
        })}
      </>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          openThread();
        }}
        title={collapsed ? thread.title : undefined}
        className={cardClassName}
      >
        {cardContent}
      </a>
    );
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openThread}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openThread();
        }
      }}
      title={collapsed ? thread.title : undefined}
      className={cardClassName}
    >
      {cardContent}
    </div>
  );
}

export function ThreadCards({
  threads,
  currentThreadId,
  currentWorkspaceId,
  workspaceLabels = {},
  onOpenThread,
  getThreadHref,
  renderThreadLink,
  onBeginRenameThread,
  onDeleteThread,
  scrollable = false,
  maxHeightClassName = "max-h-full",
  showDeleteButton = false,
  showSessionCopyButton = false,
  collapsed = false,
}: ThreadCardsProps) {
  const containerClassName = scrollable
    ? `min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain pr-1 ${maxHeightClassName}`
    : "";

  return (
    <div className={containerClassName}>
      <div className="min-w-0 space-y-1">
        {threads.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            currentThreadId={currentThreadId}
            currentWorkspaceId={currentWorkspaceId}
            workspaceLabels={workspaceLabels}
            onOpenThread={onOpenThread}
            showDeleteButton={showDeleteButton}
            showSessionCopyButton={showSessionCopyButton}
            collapsed={collapsed}
            {...(getThreadHref ? { getThreadHref } : {})}
            {...(renderThreadLink ? { renderThreadLink } : {})}
            {...(onBeginRenameThread ? { onBeginRenameThread } : {})}
            {...(onDeleteThread ? { onDeleteThread } : {})}
          />
        ))}
      </div>
    </div>
  );
}

export function ThreadWorkspaceLayout({
  threads,
  status,
  loading = false,
  error,
  viewportConstrained = false,
  layoutMode = "responsive",
  effectiveTheme: effectiveThemeProp,
  themeMode: themeModeProp,
  onThemeModeChange,
  showMobileAppMenu = false,
  showMobileThreadNavToggle = false,
  showMobileNewThreadShortcut = true,
  mobileHeaderAction,
  currentThreadId,
  currentThreadLabel = null,
  currentWorkspaceId = null,
  currentWorkspaceLabel = null,
  sessionLabel = null,
  usageLabel = null,
  topbarActions,
  metaContent,
  settingsContent,
  globalSettingsContent,
  workspaceLabels = {},
  appMenuButton,
  appNavigationMenu,
  workspaceReturnHref,
  onWorkspaceReturn,
  getThreadHref,
  onOpenThread,
  getNewThreadHref,
  newThreadHref: explicitNewThreadHref,
  newThreadLabel = "New Chat",
  onNewThread,
  onNewThreadTitle,
  renderThreadLink,
  onCloseAppNavigation,
  onRenameThread,
  onDeleteThread,
  workspaceContent,
  workspaceTitle = "Workspace",
  workspaceActions,
  children,
}: ThreadWorkspaceLayoutProps) {
  const shellNav = useAppShellNav();
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  );
  const themeMode = themeModeProp ?? shellNav?.themeMode ?? "system";
  const effectiveTheme =
    effectiveThemeProp ??
    shellNav?.effectiveTheme ??
    (themeMode === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : themeMode);
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(false);
  const [roomsRailCollapsed, setRoomsRailCollapsed] = useState(false);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [isShellMobileViewport, setIsShellMobileViewport] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 639px)").matches
      : layoutMode === "mobile",
  );
  const [mobileWorkspace, setMobileWorkspace] = useState<"chat" | "workspace">(
    "chat",
  );
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [createThreadDialogOpen, setCreateThreadDialogOpen] = useState(false);
  const [newThreadTitleDraft, setNewThreadTitleDraft] = useState("");
  const [creatingThread, setCreatingThread] = useState(false);
  const [topbarDetailsOpen, setTopbarDetailsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"session" | "global">(
    "session",
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const handleViewportChange = () => {
      setIsShellMobileViewport(mediaQuery.matches);
    };

    handleViewportChange();
    mediaQuery.addEventListener("change", handleViewportChange);
    return () => {
      mediaQuery.removeEventListener("change", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      setSystemPrefersDark(mediaQuery.matches);
    };

    handleSystemThemeChange();
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, []);

  const visibleThreads = useMemo(() => {
    const scopedThreads = currentWorkspaceId
      ? threads.filter((thread) => thread.workspaceId === currentWorkspaceId)
      : threads;

    return [...scopedThreads].sort((left, right) => {
      if (left.id === currentThreadId) {
        return -1;
      }
      if (right.id === currentThreadId) {
        return 1;
      }

      const leftTimestamp = Date.parse(
        left.lastTurnStartedAt ?? left.updatedAt,
      );
      const rightTimestamp = Date.parse(
        right.lastTurnStartedAt ?? right.updatedAt,
      );
      return rightTimestamp - leftTimestamp;
    });
  }, [currentThreadId, currentWorkspaceId, threads]);

  const newThreadHref =
    explicitNewThreadHref ?? getNewThreadHref?.(currentWorkspaceId);
  const topbarRoomLabel = currentWorkspaceLabel ?? currentWorkspaceId ?? "all";
  const topbarSessionLabel =
    sessionLabel ?? currentThreadLabel ?? currentThreadId ?? "default_session";
  const topbarUsageLabel =
    usageLabel ??
    (status?.state ? `runtime ${status.state}` : "waiting for agent usage");
  const setThemeMode = onThemeModeChange ?? shellNav?.setThemeMode;
  const canUpdateThemeMode = Boolean(setThemeMode);
  const closeNavigationSurfaces = () => {
    setMobileRoomsOpen(false);
    onCloseAppNavigation?.();
  };

  async function handleRenameThread(threadId: string) {
    if (!onRenameThread) {
      return;
    }

    const normalizedTitle = draftTitle.trim();
    if (!normalizedTitle) {
      return;
    }

    setRenamingThreadId(threadId);
    try {
      await onRenameThread(threadId, normalizedTitle);
      setEditingThreadId(null);
      setDraftTitle("");
    } finally {
      setRenamingThreadId(null);
    }
  }

  function beginRenameThread(thread: ThreadDto) {
    setEditingThreadId(thread.id);
    setDraftTitle(thread.title);
  }

  function cancelRenameThread() {
    setEditingThreadId(null);
    setDraftTitle("");
  }

  function openThread(threadId: string) {
    onOpenThread?.(threadId);
    closeNavigationSurfaces();
  }

  function buildNewThreadHrefWithTitle(title: string) {
    if (!newThreadHref || !title.trim()) {
      return newThreadHref;
    }

    try {
      const url = new URL(newThreadHref, window.location.origin);
      url.searchParams.set("title", title.trim());
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      const separator = newThreadHref.includes("?") ? "&" : "?";
      return `${newThreadHref}${separator}title=${encodeURIComponent(title.trim())}`;
    }
  }

  async function handleCreateThreadFromDialog() {
    const title = newThreadTitleDraft.trim();
    setCreatingThread(true);

    try {
      if (title && onNewThreadTitle) {
        await onNewThreadTitle(title);
        setNewThreadTitleDraft("");
        setCreateThreadDialogOpen(false);
        closeNavigationSurfaces();
        return;
      }

      if (newThreadHref) {
        window.location.assign(
          buildNewThreadHrefWithTitle(title) ?? newThreadHref,
        );
        return;
      }

      await onNewThread?.();
      setNewThreadTitleDraft("");
      setCreateThreadDialogOpen(false);
      closeNavigationSurfaces();
    } finally {
      setCreatingThread(false);
    }
  }

  function renderNewThreadDialogButton(className: string, compact = false) {
    const content = compact ? (
      <>
        <Plus className="h-4 w-4" />
        <span className="sr-only">{newThreadLabel}</span>
      </>
    ) : (
      <>
        <Plus className="h-4 w-4" />
        <span>{newThreadLabel}</span>
      </>
    );

    return (
      <Dialog
        open={createThreadDialogOpen}
        onOpenChange={(open) => {
          if (!creatingThread) {
            setCreateThreadDialogOpen(open);
          }
        }}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={compact ? newThreadLabel : undefined}
            title={newThreadLabel}
            className={className}
          >
            {content}
          </button>
        </DialogTrigger>
        <DialogContent
          data-testid="create-thread-dialog"
          data-theme-effective={effectiveTheme}
          data-theme-mode={themeMode}
          className="thread-graph-create-thread-dialog thread-graph-dialog"
        >
          <DialogHeader>
            <DialogTitle>Create New Chat</DialogTitle>
            <DialogDescription>
              Name the room so it is easy to find later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <input
              id="thread-graph-create-thread-title"
              name="thread-title"
              value={newThreadTitleDraft}
              onChange={(event) => setNewThreadTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreateThreadFromDialog();
                }
              }}
              placeholder="Chat name"
              aria-label="Chat name"
              autoComplete="off"
              className="thread-graph-create-thread-input h-10 rounded-md border px-3 text-sm outline-none transition"
            />
            <button
              type="button"
              onClick={() => void handleCreateThreadFromDialog()}
              disabled={creatingThread}
              className="thread-graph-create-thread-submit inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingThread ? "Creating..." : "Create"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function renderSettingsDialog() {
    if (
      !settingsContent &&
      !metaContent &&
      !globalSettingsContent &&
      !canUpdateThemeMode
    ) {
      return null;
    }

    const hasSessionSettings = Boolean(settingsContent || metaContent);
    const hasGlobalSettings = Boolean(globalSettingsContent);
    const activeSettingsTab =
      settingsTab === "global" && hasGlobalSettings
        ? "global"
        : !hasSessionSettings && hasGlobalSettings
          ? "global"
          : "session";

    return (
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="Open settings"
            title="Settings"
            className="thread-icon-button inline-flex h-10 w-10 items-center justify-center rounded-full sm:h-9 sm:w-9"
          >
            <Settings className="h-4 w-4" />
          </button>
        </DialogTrigger>
        <DialogContent
          data-testid="settings-dialog"
          data-theme-effective={effectiveTheme}
          data-theme-mode={themeMode}
          className="thread-graph-settings-dialog thread-graph-dialog"
        >
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage this session and host-wide preferences.
            </DialogDescription>
          </DialogHeader>
          {canUpdateThemeMode ? (
            <div className="thread-graph-settings-card rounded-lg border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--theme-fg)]">
                    Appearance
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                    Current theme: {effectiveTheme}
                  </p>
                </div>
                <div
                  className="thread-graph-theme-mode-group grid grid-cols-3 gap-1 rounded-lg border p-1"
                  role="group"
                  aria-label="Theme mode"
                >
                  {THEME_MODE_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const isSelected = themeMode === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        data-testid={`theme-mode-${option.value}`}
                        aria-pressed={isSelected}
                        disabled={!canUpdateThemeMode}
                        onClick={() => setThemeMode?.(option.value)}
                        className={`thread-graph-theme-mode-button inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition ${
                          isSelected ? "is-selected" : ""
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span className="truncate">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
          <div className="thread-graph-settings-tabs grid grid-cols-2 gap-1 rounded-lg border p-1">
            <button
              type="button"
              aria-pressed={activeSettingsTab === "session"}
              onClick={() => setSettingsTab("session")}
              className={`thread-graph-settings-tab-button rounded-md px-3 py-2 text-sm font-medium transition ${
                activeSettingsTab === "session" ? "is-active" : ""
              }`}
            >
              Session
            </button>
            <button
              type="button"
              aria-pressed={activeSettingsTab === "global"}
              disabled={!hasGlobalSettings}
              onClick={() => setSettingsTab("global")}
              className={`thread-graph-settings-tab-button rounded-md px-3 py-2 text-sm font-medium transition ${
                activeSettingsTab === "global" ? "is-active" : ""
              }`}
            >
              Global
            </button>
          </div>
          <div className="thread-graph-settings-body mt-4 min-h-0 overflow-y-auto pr-1 text-sm">
            {activeSettingsTab === "session" ? (
              <div className="grid gap-4">
                {settingsContent ? (
                  <div className="thread-graph-settings-card rounded-lg border p-3">
                    {settingsContent}
                  </div>
                ) : null}
                {metaContent ? (
                  <div className="thread-graph-settings-card rounded-lg border p-3">
                    {metaContent}
                  </div>
                ) : null}
                {!hasSessionSettings ? (
                  <div className="thread-graph-settings-card rounded-lg border p-3 text-[var(--theme-fg-muted)]">
                    No session settings are available.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="thread-graph-settings-global-content">
                {globalSettingsContent}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function renderRoomsRailContent(collapsed = false) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <section className="flex min-h-0 flex-1 flex-col">
          <div
            className={`mb-3 flex items-center gap-2 px-2 text-xs font-medium tracking-normal text-[var(--theme-fg-muted)] ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <Rows3 className="h-3.5 w-3.5" />
            <span className={collapsed ? "sr-only" : ""}>Rooms</span>
            {!collapsed && loading ? (
              <span className="ml-auto text-xs text-[var(--theme-fg-muted)]">
                Refreshing...
              </span>
            ) : null}
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-1">
            {error ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-900 dark:text-rose-100">
                {error}
              </div>
            ) : null}

            {!error && visibleThreads.length === 0 && !loading ? (
              <div className="rounded-xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-6 text-sm text-[var(--theme-fg-muted)]">
                No threads available in this view.
              </div>
            ) : null}

            {visibleThreads.length > 0 ? (
              <ThreadCards
                threads={visibleThreads}
                currentThreadId={currentThreadId}
                currentWorkspaceId={currentWorkspaceId}
                workspaceLabels={workspaceLabels}
                onOpenThread={openThread}
                collapsed={collapsed}
                {...(onRenameThread
                  ? { onBeginRenameThread: beginRenameThread }
                  : {})}
                showDeleteButton={Boolean(onDeleteThread)}
                {...(getThreadHref ? { getThreadHref } : {})}
                {...(renderThreadLink ? { renderThreadLink } : {})}
                {...(onDeleteThread ? { onDeleteThread } : {})}
              />
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  function renderWorkspacePanel() {
    if (workspaceContent) {
      return (
        <div className="thread-workspace-panel relative flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] border">
          <button
            type="button"
            onClick={() => setWorkspaceCollapsed(true)}
            className="thread-workspace-collapse-tab thread-desktop-only-inline-flex"
            title="Collapse workspace"
            aria-label="Collapse workspace"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
          {workspaceActions ? (
            <div className="pointer-events-none absolute right-12 top-2 z-20 flex items-center gap-1">
              <div className="pointer-events-auto">{workspaceActions}</div>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">
            {workspaceContent}
          </div>
        </div>
      );
    }

    return (
      <div className="thread-workspace-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] border">
        <div className="thread-workspace-panel-header flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--theme-border)] px-3 sm:h-[60px] sm:px-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-[var(--theme-fg)] sm:text-[18px]">
              {workspaceTitle}
            </p>
            <p className="truncate text-xs text-[var(--theme-fg-muted)]">
              {currentWorkspaceLabel ?? currentWorkspaceId ?? "Current context"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {workspaceActions}
            <button
              type="button"
              onClick={() => setWorkspaceCollapsed(true)}
              className="thread-workspace-small-toggle thread-desktop-only-inline-flex"
              title="Collapse workspace"
              aria-label="Collapse workspace"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {workspaceContent ?? (
            <div className="grid h-full min-h-0 gap-3 overflow-y-auto p-3 text-sm text-[var(--theme-fg-soft)]">
              <div className="thread-workspace-card rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--theme-fg-muted)]">
                  Runtime
                </p>
                <p className="mt-2 text-[var(--theme-fg)]">
                  {status?.state ?? "unknown"}
                </p>
              </div>
              <div className="thread-workspace-card rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--theme-fg-muted)]">
                  Workspace
                </p>
                <p className="mt-2 break-words text-[var(--theme-fg)]">
                  {currentWorkspaceLabel ?? currentWorkspaceId ?? "All threads"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasWorkspace = Boolean(workspaceContent);
  const renderMobileWorkspaceSplit =
    layoutMode === "mobile" ||
    (layoutMode === "responsive" && isShellMobileViewport);
  const renderMobileTopbarControls = renderMobileWorkspaceSplit;

  return (
    <>
      <GraphChatShellRoot
        effectiveTheme={effectiveTheme}
        layoutMode={layoutMode}
        themeMode={themeMode}
        viewportConstrained={viewportConstrained}
      >
        <GraphChatShellFrame roomsRailCollapsed={roomsRailCollapsed}>
          <GraphChatMobileScrim
            open={mobileRoomsOpen}
            onClose={() => setMobileRoomsOpen(false)}
          />

          <GraphChatRoomsRailShell
            collapsed={roomsRailCollapsed}
            mobileOpen={mobileRoomsOpen}
          >
            <div
              className={`thread-rooms-rail-header flex h-[calc(3.75rem+env(safe-area-inset-top))] shrink-0 items-end border-b border-[var(--theme-border)] px-4 pb-3 sm:h-16 sm:items-center sm:pb-0 ${
                roomsRailCollapsed ? "sm:w-full sm:justify-center sm:px-2" : ""
              }`}
            >
              <div
                className={`flex w-full items-center gap-3 ${
                  roomsRailCollapsed ? "sm:justify-center" : "justify-between"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRoomsRailCollapsed((current) => !current)}
                    className="thread-icon-button thread-desktop-only-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    title={
                      roomsRailCollapsed ? "Expand rooms" : "Collapse rooms"
                    }
                    aria-label={
                      roomsRailCollapsed ? "Expand rooms" : "Collapse rooms"
                    }
                  >
                    {roomsRailCollapsed ? (
                      <PanelLeftOpen className="h-4 w-4" />
                    ) : (
                      <PanelLeftClose className="h-4 w-4" />
                    )}
                  </button>
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--theme-accent-solid)] text-sm font-semibold text-[var(--theme-accent-solid-fg)] ${
                      roomsRailCollapsed
                        ? "thread-desktop-collapsed-hidden"
                        : ""
                    }`}
                  >
                    {(currentWorkspaceLabel ?? "R").charAt(0).toUpperCase()}
                  </div>
                  <div
                    className={`min-w-0 ${
                      roomsRailCollapsed
                        ? "thread-desktop-collapsed-hidden"
                        : ""
                    }`}
                  >
                    <p className="truncate text-sm font-semibold text-[var(--theme-fg)]">
                      {currentWorkspaceLabel ?? "Remote Codex"}
                    </p>
                    <p className="truncate text-xs text-[var(--theme-fg-muted)]">
                      {currentWorkspaceId ?? "Thread workspace"}
                    </p>
                  </div>
                </div>
                <div
                  className={`flex shrink-0 items-center gap-1 ${
                    roomsRailCollapsed ? "thread-desktop-collapsed-hidden" : ""
                  }`}
                >
                  {renderSettingsDialog()}
                  {workspaceReturnHref || onWorkspaceReturn ? (
                    <a
                      href={workspaceReturnHref ?? "#"}
                      onClick={(event) => {
                        if (onWorkspaceReturn) {
                          event.preventDefault();
                          onWorkspaceReturn();
                        }
                      }}
                      className="thread-icon-button inline-flex h-10 w-10 items-center justify-center rounded-full sm:h-9 sm:w-9"
                      title="Back to workspace"
                      aria-label="Back to workspace"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setMobileRoomsOpen(false)}
                    aria-label="Close rooms"
                    title="Close rooms"
                    className="thread-icon-button thread-mobile-only-inline-flex h-10 w-10 items-center justify-center rounded-full"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div
              className={`thread-graph-new-room-strip flex shrink-0 items-center border-b ${
                roomsRailCollapsed
                  ? "h-12 w-full justify-center px-2 sm:h-12"
                  : "h-[68px] px-4"
              }`}
            >
              {renderNewThreadDialogButton(
                `thread-graph-new-room-button inline-flex items-center justify-center rounded-xl font-medium transition ${
                  roomsRailCollapsed
                    ? "h-9 w-9 p-0"
                    : "h-11 w-full gap-2 px-3 text-sm sm:h-9"
                }`,
                roomsRailCollapsed,
              )}
            </div>

            <div
              className={`flex min-h-0 flex-1 flex-col ${
                roomsRailCollapsed ? "w-full px-2 py-2" : "px-3 py-3"
              }`}
            >
              {renderRoomsRailContent(roomsRailCollapsed)}
            </div>
          </GraphChatRoomsRailShell>

          <GraphChatMainShell>
            <GraphChatTopbarShell>
              <div className="thread-topbar-row flex min-h-12 items-center px-3 py-1.5 sm:min-h-12 sm:px-4">
                <div className="flex w-full items-center justify-between gap-3 sm:gap-4">
                  <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    {renderMobileTopbarControls &&
                    showMobileThreadNavToggle &&
                    !mobileRoomsOpen ? (
                      <button
                        type="button"
                        onClick={() => setMobileRoomsOpen(true)}
                        aria-label="Open rooms"
                        title="Open rooms"
                        className="thread-icon-button thread-mobile-only-inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                      >
                        <Menu className="h-4 w-4" />
                      </button>
                    ) : null}
                    <div className="min-w-0">
                      {renderMobileTopbarControls ? (
                        <h1 className="thread-mobile-only-block min-w-0 truncate text-sm font-semibold leading-none text-[var(--theme-fg)]">
                          {currentThreadLabel ?? "Shared Workspace"}
                        </h1>
                      ) : null}
                      <div className="relative flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (!topbarRoomLabel) {
                              return;
                            }
                            void navigator.clipboard?.writeText(
                              topbarRoomLabel,
                            );
                          }}
                          className="thread-topbar-meta-row flex min-w-0 max-w-full items-center gap-1 text-left text-[11px] leading-none sm:text-xs"
                          title="Copy room ID"
                        >
                          <span className="shrink-0">Room</span>
                          <span className="truncate font-mono">
                            {topbarRoomLabel}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-expanded={topbarDetailsOpen}
                          aria-haspopup="dialog"
                          onClick={() => setTopbarDetailsOpen((open) => !open)}
                          className="thread-topbar-details-trigger inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium leading-none transition"
                          title="Session and usage"
                        >
                          Details
                        </button>
                        {topbarDetailsOpen ? (
                          <div
                            className="thread-topbar-details-popover absolute left-0 top-[calc(100%+0.5rem)] z-50 w-[min(26rem,calc(100vw-1.5rem))] rounded-lg border p-2.5 shadow-lg"
                            role="dialog"
                            aria-label="Session and usage"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (!topbarSessionLabel) {
                                  return;
                                }
                                void navigator.clipboard?.writeText(
                                  topbarSessionLabel,
                                );
                              }}
                              className="thread-topbar-meta-row flex min-w-0 max-w-full items-center gap-2 text-left text-xs leading-5"
                              title="Copy session ID"
                            >
                              <span className="w-12 shrink-0">Session</span>
                              <span className="truncate font-mono">
                                {topbarSessionLabel}
                              </span>
                            </button>
                            <div
                              className="thread-topbar-meta-row mt-1 flex min-w-0 max-w-full items-center gap-2 text-xs leading-5"
                              title="Room token usage"
                            >
                              <span className="w-12 shrink-0">Usage</span>
                              <span className="truncate font-mono">
                                {topbarUsageLabel}
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="inline-flex shrink-0 items-center gap-2">
                    {topbarActions ? (
                      <div className="thread-graph-topbar-actions thread-desktop-only-inline-flex items-center rounded-lg border p-0.5 shadow-none">
                        {topbarActions}
                      </div>
                    ) : null}
                    {renderMobileTopbarControls ? mobileHeaderAction : null}
                    {renderMobileTopbarControls && showMobileNewThreadShortcut
                      ? renderNewThreadDialogButton(
                          "thread-secondary-action inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium sm:h-9",
                        )
                      : null}
                  </div>
                </div>
              </div>

              {renderMobileTopbarControls && hasWorkspace ? (
                <div className="thread-mobile-view-switch thread-mobile-only-grid grid-cols-2 gap-1 px-3 pb-2">
                  <button
                    type="button"
                    onClick={() => setMobileWorkspace("chat")}
                    className={`thread-mobile-segment h-10 rounded-lg text-sm font-medium transition ${
                      mobileWorkspace === "chat" ? "is-active" : ""
                    }`}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileWorkspace("workspace")}
                    className={`thread-mobile-segment h-10 rounded-lg text-sm font-medium transition ${
                      mobileWorkspace === "workspace" ? "is-active" : ""
                    }`}
                  >
                    Workspace
                  </button>
                </div>
              ) : null}
            </GraphChatTopbarShell>

            <GraphChatSplitRegion>
              {hasWorkspace && !workspaceCollapsed ? (
                renderMobileWorkspaceSplit ? (
                  <div className="thread-split-container thread-graph-shell-mobile-split h-full min-h-0 overflow-hidden">
                    <div
                      className={`h-full min-h-0 overflow-hidden ${
                        mobileWorkspace === "chat"
                          ? "block"
                          : "thread-mobile-chat-hidden"
                      }`}
                    >
                      {children}
                    </div>
                    <div
                      className={`h-full min-h-0 overflow-hidden ${
                        mobileWorkspace === "workspace"
                          ? "block"
                          : "thread-mobile-workspace-hidden"
                      }`}
                    >
                      {renderWorkspacePanel()}
                    </div>
                  </div>
                ) : (
                  <ResizablePanelGroup
                    direction="horizontal"
                    className="thread-split-container thread-graph-shell-resizable thread-graph-shell-desktop-split h-full min-h-0 overflow-hidden"
                  >
                    <ResizablePanel
                      defaultSize={47}
                      minSize={30}
                      maxSize={75}
                      className="thread-split-chat-pane min-w-0 overflow-hidden"
                    >
                      {children}
                    </ResizablePanel>
                    <ResizableHandle className="thread-resize-handle w-2 bg-transparent after:w-px after:bg-slate-200/80 after:transition-colors hover:after:bg-slate-300 dark:after:bg-[#303642] dark:hover:after:bg-[#475063]" />
                    <ResizablePanel
                      defaultSize={53}
                      minSize={30}
                      maxSize={70}
                      className="thread-split-workspace-pane min-w-0 overflow-hidden"
                    >
                      {renderWorkspacePanel()}
                    </ResizablePanel>
                  </ResizablePanelGroup>
                )
              ) : (
                <div className="thread-split-container relative h-full min-h-0 overflow-hidden">
                  {hasWorkspace && workspaceCollapsed ? (
                    <button
                      type="button"
                      onClick={() => setWorkspaceCollapsed(false)}
                      className="thread-workspace-expand-fab thread-desktop-only-inline-flex"
                      title="Expand workspace"
                      aria-label="Expand workspace"
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </button>
                  ) : null}
                  {children}
                </div>
              )}
            </GraphChatSplitRegion>
          </GraphChatMainShell>
        </GraphChatShellFrame>
      </GraphChatShellRoot>

      <RenameDialog
        open={editingThreadId !== null}
        title="Rename Thread"
        label="Thread Title"
        value={draftTitle}
        busy={renamingThreadId !== null}
        onChange={setDraftTitle}
        onCancel={cancelRenameThread}
        onSubmit={() =>
          editingThreadId ? handleRenameThread(editingThreadId) : undefined
        }
      />
    </>
  );
}
