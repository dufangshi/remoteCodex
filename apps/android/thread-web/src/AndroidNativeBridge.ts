export type AndroidNativeMessage =
  | { type: 'closeThread' }
  | { type: 'threadWebReady'; title: string; workspaceId?: string | null }
  | { type: 'threadWebDebug'; message: string }
  | { type: 'openThread'; threadId: string }
  | { type: 'openWorkspace'; workspaceId: string }
  | { type: 'openDevices' }
  | {
      type: 'shareDownloadedFile';
      filename: string;
      contentType: string;
      base64: string;
    }
  | { type: 'copyText'; text: string; label?: string }
  | { type: 'setNavigationTitle'; title: string; workspaceId?: string | null }
  | { type: 'setThemeMode'; theme: 'light' | 'dark' | 'system' }
  | { type: 'reportFatalError'; message: string };

declare global {
  interface Window {
    remoteCodexAndroid?: {
      postMessage(message: string): void;
      requestJson?(message: string): void;
      pickFile?(message: string): void;
    };
  }
}

export function postAndroidMessage(message: AndroidNativeMessage) {
  window.remoteCodexAndroid?.postMessage(JSON.stringify(message));
}
