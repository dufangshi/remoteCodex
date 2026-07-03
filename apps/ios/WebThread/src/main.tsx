import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { applyIOSTheme, readIOSBootstrap } from './IOSBootstrap';
import {
  IOSFatalErrorBoundary,
  installGlobalFatalErrorReporter,
} from './IOSFatalErrorBoundary';
import { IOSThreadDetailPage } from './IOSThreadDetailPage';
import './styles.css';

installGlobalFatalErrorReporter();

const bootstrap = readIOSBootstrap();
applyIOSTheme(bootstrap.theme ?? 'system');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IOSFatalErrorBoundary>
      <IOSThreadDetailPage bootstrap={bootstrap} />
    </IOSFatalErrorBoundary>
  </StrictMode>,
);
