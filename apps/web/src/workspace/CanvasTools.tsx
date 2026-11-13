import { useState, type ReactNode } from 'react';
import { DotsThree, EyeSlash, MapPin } from '@phosphor-icons/react';
import { t } from '../i18n';

type Position = 'start' | 'end' | 'hidden';
const locations: Position[] = ['start', 'end', 'hidden'];

export function useCanvasTools() {
  const [position, setPosition] = useState<{ actions: Position; collaboration: Position }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('studio-canvas-tools') ?? '{}');
      return {
        actions: locations.includes(saved.actions) ? saved.actions : 'start',
        collaboration: locations.includes(saved.collaboration) ? saved.collaboration : 'end',
      };
    } catch { return { actions: 'start', collaboration: 'end' }; }
  });
  function move(tool: keyof typeof position, target: Position) {
    const next = { ...position, [tool]: target };
    setPosition(next);
    try { localStorage.setItem('studio-canvas-tools', JSON.stringify(next)); }
    catch { /* A restricted browser can still adjust the current layout. */ }
  }
  return { position, move };
}

export function CanvasTools({ layout, fixedActions, actions, collaboration, focused }: {
  layout: ReturnType<typeof useCanvasTools>;
  fixedActions: ReactNode;
  actions?: ReactNode;
  collaboration?: ReactNode;
  focused?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { position, move } = layout;
  return (
    <div className="canvas-tools-overlay">
      {(['start', 'end'] as const).map((side) => (
        <div className="canvas-tools-dock" data-side={side} key={side}>
          {side === 'start' && fixedActions}
          {!focused && position.actions === side && actions}
          {!focused && position.collaboration === side && collaboration}
          {!focused && side === 'end' && (
            <div className="canvas-tools-settings">
              <button type="button" className="icon-button" aria-label={t('画布工具布局')}
                aria-expanded={open} onClick={() => setOpen(!open)}>
                <DotsThree size={19} weight="bold" />
              </button>
              {open && <div className="canvas-tools-menu">
                {(['actions', 'collaboration'] as const).map((tool) => (
                  <div key={tool}>
                    <span>{t(tool === 'actions' ? '图片工具' : '协作状态')}</span>
                    <div role="group" aria-label={t(tool === 'actions' ? '图片工具' : '协作状态')}>
                      {locations.map((side) => (
                        <button key={side} type="button" aria-pressed={position[tool] === side}
                          onClick={() => { move(tool, side); setOpen(false); }}>
                          {side === 'hidden' ? <EyeSlash size={15} /> : <MapPin size={15} />}
                          {t(side === 'start' ? '左侧' : side === 'end' ? '右侧' : '隐藏')}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
