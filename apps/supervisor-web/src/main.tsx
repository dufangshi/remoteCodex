import WorkspaceEditorWorker from '@remote-codex/thread-ui/workspace-editor.worker?worker';
import React from 'react';
import { I18nProvider, initializeI18n } from '@remote-codex/thread-ui/i18n';
import ReactDOM from 'react-dom/client';
import 'streamdown/styles.css';

import { App } from './app';
import './index.css';
import { initializeFontSize } from './lib/fontSize';

// The host bundler resolves the worker asset before dependency optimization.
Object.assign(window, { MonacoEnvironment: { getWorker: () => new WorkspaceEditorWorker() } });
initializeFontSize();
initializeI18n();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider><App /></I18nProvider>
  </React.StrictMode>
);
