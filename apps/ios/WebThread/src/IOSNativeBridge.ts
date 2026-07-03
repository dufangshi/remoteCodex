import type { IOSThemeMode } from './IOSBootstrap';

export type NativeBridgeMessage =
  | { type: 'closeThread' }
  | { type: 'openThread'; threadId: string }
  | { type: 'openWorkspace'; workspaceId: string }
  | { type: 'setNavigationTitle'; title: string; workspaceId?: string }
  | { type: 'setThemeMode'; theme: IOSThemeMode }
  | { type: 'pickAttachments'; requestId: string; kind: 'photo' | 'file' }
  | {
      type: 'shareDownloadedFile';
      filename: string;
      contentType: string;
      base64: string;
    }
  | { type: 'threadWebReady'; title: string; workspaceId?: string }
  | { type: 'threadWebDebug'; message: string }
  | { type: 'threadWebOptimisticPrompt'; message: string }
  | { type: 'reportFatalError'; message: string };

export type NativeAttachmentPickerResult = {
  requestId: string;
  kind: 'photo' | 'file';
  cancelled?: boolean;
  error?: string;
  files?: Array<{
    filename: string;
    contentType?: string;
    base64: string;
  }>;
};

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        remoteCodex?: {
          postMessage(message: NativeBridgeMessage): void;
        };
      };
    };
    remoteCodexIOS?: {
      setSceneActive?(active: boolean): void;
      resumeSceneActive?(): void;
      attachmentPickerResult?(result: NativeAttachmentPickerResult): void;
      setTheme?(theme: IOSThemeMode): void;
      openSettings?(): void;
    };
  }
}

export function postNativeMessage(message: NativeBridgeMessage) {
  window.webkit?.messageHandlers?.remoteCodex?.postMessage(message);
}

export function hasNativeBridge() {
  return Boolean(window.webkit?.messageHandlers?.remoteCodex?.postMessage);
}
