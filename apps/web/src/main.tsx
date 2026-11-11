import React from 'react';
import ReactDOM from 'react-dom/client';
import { SiteShell } from './SiteShell';
import { initializeLocale } from './i18n';
import './public-shell.css';
import './theme.css';
import './about/about.css';
import './about/product-story.css';

void initializeLocale().then(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <SiteShell />
    </React.StrictMode>,
  ),
);
