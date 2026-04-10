import React from 'react';
import ReactDOM from 'react-dom/client';
import 'streamdown/styles.css';

import { App } from './app';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
