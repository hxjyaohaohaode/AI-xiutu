import React from 'react';
import ReactDOM from 'react-dom/client';
import { SiteShell } from './SiteShell';
import { initializeLocale } from './i18n';
import './public-shell.css';
import './theme.css';
import './components/reference-surfaces.css';
import './components/control-motion/control-motion.css';
import './components/status-mark.css';
import './components/check-control.css';
import './about/about.css';
import './about/stories.css';

// Public read-only document links live outside the signed-in workspace shell.
const sharedToken = /^#\/shared\/([A-Za-z0-9_-]{43})$/.exec(location.hash)?.[1];
const SharedDocumentPage = React.lazy(() =>
  import('./project-files/SharedDocumentPage').then((m) => ({ default: m.SharedDocumentPage })),
);
if (sharedToken) window.addEventListener('hashchange', () => location.reload());

void initializeLocale().then(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {sharedToken ? (
        <React.Suspense fallback={null}>
          <SharedDocumentPage token={sharedToken} />
        </React.Suspense>
      ) : (
        <SiteShell />
      )}
    </React.StrictMode>,
  ),
);
