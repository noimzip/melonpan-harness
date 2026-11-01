// Browser environment polyfills for Node.js process APIs
if (typeof (globalThis as any).process === 'undefined') {
  (globalThis as any).process = { env: {}, cwd: () => '/' };
} else {
  if (typeof (globalThis as any).process.env === 'undefined') {
    (globalThis as any).process.env = {};
  }
  if (typeof (globalThis as any).process.cwd !== 'function') {
    (globalThis as any).process.cwd = () => '/' ;
  }
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
