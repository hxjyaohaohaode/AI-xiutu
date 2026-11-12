import React from 'react';
import ReactDOM from 'react-dom/client';
import { SiteShell } from './SiteShell';
import { initializeLocale } from './i18n';
import './public-shell.css';
import './theme.css';
import './components/control-motion/control-motion.css';
import './components/status-mark.css';
import './components/check-control.css';
import './about/about.css';

void initializeLocale().then(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <SiteShell />
    </React.StrictMode>,
  ),
);
