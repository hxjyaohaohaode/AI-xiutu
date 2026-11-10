import { createContext, useContext } from 'react';

export const PanelChromeContext = createContext<{
  mobile: boolean;
  maximized: boolean;
  openLayout: () => void;
  toggleMaximized: () => void;
} | null>(null);

export const usePanelChrome = () => useContext(PanelChromeContext);
