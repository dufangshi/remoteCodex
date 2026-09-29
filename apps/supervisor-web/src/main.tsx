import React from 'react';
import ReactDOM from 'react-dom/client';
import 'streamdown/styles.css';

import { App } from './app';
import './index.css';
import { initializeFontSize } from './lib/fontSize';

initializeFontSize();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
