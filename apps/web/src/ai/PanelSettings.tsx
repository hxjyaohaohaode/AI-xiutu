import { ArrowsInSimple, ArrowsOutSimple, SlidersHorizontal } from '@phosphor-icons/react';
import { usePanelChrome } from '../workspace/PanelChromeContext';

export function PanelSettings({ onClose }: { onClose: () => void }) {
  const chrome = usePanelChrome();
  if (!chrome?.mobile) return null;
  return (
    <div className="ai-panel-settings" role="group" aria-label="面板布局">
      <button type="button" onClick={() => { onClose(); chrome.toggleMaximized(); }}>
        {chrome.maximized ? <ArrowsInSimple size={17} /> : <ArrowsOutSimple size={17} />}
        {chrome.maximized ? '恢复面板' : '展开面板'}
      </button>
      <button type="button" onClick={() => { onClose(); chrome.openLayout(); }}>
        <SlidersHorizontal size={17} />面板位置与尺寸
      </button>
    </div>
  );
}
