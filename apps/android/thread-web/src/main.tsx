import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ThreadDetailSurface } from '@remote-codex/thread-ui';

import { AndroidThreadDetailPage } from './AndroidThreadDetailPage';
import {
  applyAndroidTheme,
  installAndroidViewportSizing,
  readAndroidBootstrap,
} from './AndroidBootstrap';
import { supervisorApiUrl, supervisorWebSocketUrl } from './AndroidConnection';
import { installNativeHttpResponseBridge } from './AndroidNativeHttp';
import { postAndroidMessage } from './AndroidNativeBridge';
import './styles.css';

const bootstrap = readAndroidBootstrap();
applyAndroidTheme(bootstrap.theme);
installAndroidViewportSizing();
installNativeHttpResponseBridge();

const sharedThreadUiLoaded = typeof ThreadDetailSurface === 'function';

function AndroidThreadApp() {
  const readyPostedRef = useRef(false);

  useEffect(() => {
    if (!bootstrap.fixture && bootstrap.threadId) {
      return;
    }
    if (readyPostedRef.current) {
      return;
    }
    readyPostedRef.current = true;
    postAndroidMessage({
      type: 'threadWebReady',
      title: 'Android Thread Web fixture',
      workspaceId: null,
    });
  }, []);

  if (!bootstrap.fixture && bootstrap.threadId) {
    return <AndroidThreadDetailPage bootstrap={bootstrap} />;
  }

  return (
    <main className="android-thread-fixture" data-testid="android-thread-fixture">
      <p className="android-thread-kicker">Remote Codex Android</p>
      <h1>Thread UI bundle loaded</h1>
      <p>
        This APK asset imports <code>@remote-codex/thread-ui</code> and is ready
        for the Phase 2 WebView bridge.
      </p>
      <dl>
        <div>
          <dt>Shared UI</dt>
          <dd>{sharedThreadUiLoaded ? 'ThreadDetailSurface imported' : 'missing'}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{bootstrap.mode}</dd>
        </div>
        <div>
          <dt>Base URL</dt>
          <dd>{bootstrap.baseUrl}</dd>
        </div>
        <div>
          <dt>Thread</dt>
          <dd>{bootstrap.threadId ?? 'fixture'}</dd>
        </div>
        <div>
          <dt>REST</dt>
          <dd>{supervisorApiUrl(bootstrap, '/api/threads')}</dd>
        </div>
        <div>
          <dt>WebSocket</dt>
          <dd>{supervisorWebSocketUrl(bootstrap, { threadId: bootstrap.threadId })}</dd>
        </div>
      </dl>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AndroidThreadApp />
  </StrictMode>,
);
