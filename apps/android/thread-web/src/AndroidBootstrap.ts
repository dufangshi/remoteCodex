export interface AndroidThreadBootstrap {
  baseUrl: string;
  mode: 'local' | 'server' | 'relay';
  authToken?: string | null;
  relayDeviceId?: string | null;
  threadId?: string | null;
  theme?: 'system' | 'light' | 'dark';
  fixture?: boolean;
}

export type AndroidThemeMode = NonNullable<AndroidThreadBootstrap['theme']>;

declare global {
  interface Window {
    __REMOTE_CODEX_ANDROID_BOOTSTRAP__?: Partial<AndroidThreadBootstrap>;
    remoteCodexAndroidHost?: {
      setSceneActive?(active: boolean): void;
      setTheme?(theme: AndroidThemeMode): void;
      openSettings?(): void;
      receiveNativeHttpResponse?(response: {
        requestId: string;
        ok: boolean;
        statusCode: number;
        headers?: Record<string, string>;
        body?: string | null;
        bodyBase64?: string | null;
        error?: string | null;
      }): void;
      receiveNativeFilePickResult?(response: {
        requestId: string;
        cancelled?: boolean;
        error?: string | null;
        file?: {
          filename: string;
          contentType?: string | null;
          base64: string;
        } | null;
      }): void;
    };
  }
}

export function readAndroidBootstrap(): AndroidThreadBootstrap {
  const bootstrap = window.__REMOTE_CODEX_ANDROID_BOOTSTRAP__ ?? {};
  return {
    baseUrl: normalizeBaseUrl(bootstrap.baseUrl ?? 'http://10.0.2.2:8787'),
    mode: bootstrap.mode ?? 'local',
    authToken: bootstrap.authToken ?? null,
    relayDeviceId: bootstrap.relayDeviceId ?? null,
    threadId: bootstrap.threadId ?? null,
    theme: bootstrap.theme ?? 'system',
    fixture: bootstrap.fixture ?? !bootstrap.threadId,
  };
}

export function applyAndroidTheme(
  theme: AndroidThreadBootstrap['theme'],
): 'light' | 'dark' {
  const effective =
    theme === 'light'
      ? 'light'
      : theme === 'dark'
        ? 'dark'
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';
  document.documentElement.dataset.themeMode = theme ?? 'system';
  document.documentElement.dataset.themeEffective = effective;
  document.documentElement.style.colorScheme = effective;
  return effective;
}

export function installAndroidViewportSizing() {
  const apply = () => {
    const height =
      window.innerHeight ||
      document.documentElement.clientHeight ||
      document.body?.clientHeight ||
      0;
    if (height <= 0) {
      return;
    }
    const visualViewport = window.visualViewport;
    const visualHeight = visualViewport?.height ?? height;
    const keyboardBottom = visualViewport
      ? Math.max(
          0,
          Math.round(height - visualViewport.height - visualViewport.offsetTop),
        )
      : 0;
    const value = `${height}px`;
    document.documentElement.style.setProperty(
      '--android-viewport-height',
      value,
    );
    document.documentElement.style.setProperty(
      '--android-visual-viewport-height',
      `${Math.max(0, Math.round(visualHeight))}px`,
    );
    document.documentElement.style.setProperty(
      '--android-keyboard-bottom',
      `${keyboardBottom}px`,
    );
    for (const element of [
      document.documentElement,
      document.body,
      document.getElementById('root'),
    ]) {
      if (!element) {
        continue;
      }
      element.style.height = value;
      element.style.minHeight = value;
    }
  };

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  window.addEventListener('remote-codex-android-insets', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('scroll', apply);
  return () => {
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
    window.removeEventListener('remote-codex-android-insets', apply);
    window.visualViewport?.removeEventListener('resize', apply);
    window.visualViewport?.removeEventListener('scroll', apply);
  };
}

function normalizeBaseUrl(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return 'http://10.0.2.2:8787';
  }
}
