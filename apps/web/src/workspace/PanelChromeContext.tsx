import { createContext, useContext } from 'react';

export const PanelChromeContext = createContext<{
  mobile: boolean;
  maximized: boolean;
  openLayout: () => void;
  toggleMaximized: () => void;
  /** A phone tool can share the chrome row instead of adding another navigation row. */
  headerTarget?: HTMLElement | null;
  fixedInspector?: boolean;
} | null>(null);

export const usePanelChrome = () => useContext(PanelChromeContext);
