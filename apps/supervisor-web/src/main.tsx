import React from 'react';
import { I18nProvider, initializeI18n } from '@remote-codex/thread-ui/i18n';
import ReactDOM from 'react-dom/client';
import 'streamdown/styles.css';

import { App } from './app';
import './index.css';
import { initializeFontSize } from './lib/fontSize';

initializeFontSize();
initializeI18n();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider><App /></I18nProvider>
  </React.StrictMode>
);
