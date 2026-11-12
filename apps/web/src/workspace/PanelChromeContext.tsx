import { createContext, useContext, type ReactNode } from 'react';

export const PanelChromeContext = createContext<{
  mobile: boolean;
  maximized: boolean;
  openLayout: () => void;
  toggleMaximized: () => void;
  /** A phone tool can share the chrome row instead of adding another navigation row. */
  headerTarget?: HTMLElement | null;
  /** The phone adjustment shelf hosts this real layout trigger beside the current value. */
  adjustmentLayoutControl?: ReactNode;
  adjustmentMenuTarget?: HTMLElement | null;
} | null>(null);

export const usePanelChrome = () => useContext(PanelChromeContext);
