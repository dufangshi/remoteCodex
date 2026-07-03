import type {
  ThreadExportFormatDto,
  UpdateThreadSettingsInput,
} from '@remote-codex/shared';

export type IOSConnectionMode = 'local' | 'server' | 'relay';
export type IOSThemeMode = 'light' | 'dark' | 'system';

export interface IOSBootstrap {
  baseUrl: string;
  mode: IOSConnectionMode;
  authToken?: string | null;
  relayDeviceId?: string | null;
  threadId?: string | null;
  theme?: IOSThemeMode;
  fixture?: boolean;
  uiTestInitialSettings?: UpdateThreadSettingsInput | null;
  uiTestAutoResolvePendingRequests?: boolean;
  uiTestClickPendingRequestControls?: boolean;
  uiTestClickVisibleSettingsControls?: boolean;
  uiTestForkMode?: 'latest' | 'selected' | null;
  uiTestAutoExportTranscript?: boolean;
  uiTestAutoExportTranscriptFormat?: ThreadExportFormatDto;
  uiTestClickVisibleExportControls?: boolean;
  uiTestFocusWorkspacePath?: string | null;
  uiTestAutoLoadMoreWorkspacePreview?: boolean;
  uiTestAutoWorkspaceFileActions?: boolean;
  uiTestClickVisibleWorkspaceControls?: boolean;
  uiTestAutoLoadHistoryDetail?: boolean;
  uiTestClickVisibleHistoryDetails?: boolean;
  uiTestAutoLoadOlderHistory?: boolean;
  uiTestAutoVerifyImageAsset?: boolean;
  uiTestAutoVerifyTimelineContent?: boolean;
  uiTestAutoVerifySlashToolbox?: boolean;
  uiTestDisableRefreshFallback?: boolean;
  uiTestAutoRenameTitle?: string | null;
  uiTestAutoDeleteThread?: boolean;
}

declare global {
  interface Window {
    __REMOTE_CODEX_IOS_BOOTSTRAP__?: Partial<IOSBootstrap>;
  }
}

export function normalizeBaseUrl(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) {
    return 'http://127.0.0.1:8787';
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

export function readIOSBootstrap(): IOSBootstrap {
  const value = window.__REMOTE_CODEX_IOS_BOOTSTRAP__ ?? {};
  return {
    baseUrl: normalizeBaseUrl(value.baseUrl),
    mode: value.mode ?? 'local',
    authToken: value.authToken ?? null,
    relayDeviceId: value.relayDeviceId ?? null,
    threadId: value.threadId ?? null,
    theme: value.theme ?? 'system',
    fixture: value.fixture ?? !value.threadId,
    uiTestInitialSettings: value.uiTestInitialSettings ?? null,
    uiTestAutoResolvePendingRequests:
      value.uiTestAutoResolvePendingRequests ?? false,
    uiTestClickPendingRequestControls:
      value.uiTestClickPendingRequestControls ?? false,
    uiTestClickVisibleSettingsControls:
      value.uiTestClickVisibleSettingsControls ?? false,
    uiTestForkMode:
      value.uiTestForkMode === 'latest' || value.uiTestForkMode === 'selected'
        ? value.uiTestForkMode
        : null,
    uiTestAutoExportTranscript: value.uiTestAutoExportTranscript ?? false,
    uiTestAutoExportTranscriptFormat:
      value.uiTestAutoExportTranscriptFormat === 'html' ? 'html' : 'pdf',
    uiTestClickVisibleExportControls:
      value.uiTestClickVisibleExportControls ?? false,
    uiTestFocusWorkspacePath: value.uiTestFocusWorkspacePath ?? null,
    uiTestAutoLoadMoreWorkspacePreview:
      value.uiTestAutoLoadMoreWorkspacePreview ?? false,
    uiTestAutoWorkspaceFileActions:
      value.uiTestAutoWorkspaceFileActions ?? false,
    uiTestClickVisibleWorkspaceControls:
      value.uiTestClickVisibleWorkspaceControls ?? false,
    uiTestAutoLoadHistoryDetail: value.uiTestAutoLoadHistoryDetail ?? false,
    uiTestClickVisibleHistoryDetails:
      value.uiTestClickVisibleHistoryDetails ?? false,
    uiTestAutoLoadOlderHistory: value.uiTestAutoLoadOlderHistory ?? false,
    uiTestAutoVerifyImageAsset: value.uiTestAutoVerifyImageAsset ?? false,
    uiTestAutoVerifyTimelineContent:
      value.uiTestAutoVerifyTimelineContent ?? false,
    uiTestAutoVerifySlashToolbox:
      value.uiTestAutoVerifySlashToolbox ?? false,
    uiTestDisableRefreshFallback: value.uiTestDisableRefreshFallback ?? false,
    uiTestAutoRenameTitle: value.uiTestAutoRenameTitle ?? null,
    uiTestAutoDeleteThread: value.uiTestAutoDeleteThread ?? false,
  };
}

export function effectiveTheme(theme: IOSThemeMode) {
  if (theme === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  return theme;
}

export function applyIOSTheme(theme: IOSThemeMode) {
  const nextTheme = effectiveTheme(theme);
  document.documentElement.dataset.themeMode = theme;
  document.documentElement.dataset.themeEffective = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
  return nextTheme;
}
