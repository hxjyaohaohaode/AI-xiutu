import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './features.css';
import './workspace/workspace.css';
import './refinement.css';
import './motion/motion.css';
import './workspace/studio.css';
import './editor/precision-studio.css';
import './workspace/workspace-views-studio.css';
import './workspace/dialogs-studio.css';
import './components/foundation.css';
import './workspace/adaptive.css';
import './ai/composer.css';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
