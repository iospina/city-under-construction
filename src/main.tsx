// ---------------------------------------------------------------------------
// main.tsx — Application entry point.
// ---------------------------------------------------------------------------

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initAnalytics } from './services/analytics';
import './styles/index.css';

// Initialise PostHog (no-op if key is missing)
initAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
