import type { OfficeChartSnapshot } from '@ai-xiutu/contracts';
import { snapshotSvg } from '@ai-xiutu/contracts/office-data';
import './chart-view.css';

/**
 * Interactive layer over the shared chart SVG (the same markup that is exported).
 * - Hover: tooltip from each mark's <title>, and the hovered series is focused.
 * - Legend: click / Enter / Space toggles a series or slice; hidden state can be
 *   persisted by the caller (onHidden) or kept local for read-only viewers.
 * - Entry motion runs only here (never in exported files) and honours reduced motion.
 * The SVG is produced by our renderer, which escapes every data string.
 */
export interface ChartMount {
  update(chart: OfficeChartSnapshot): void;
  destroy(): void;
}

export function mountChart(
  host: HTMLElement,
  initial: OfficeChartSnapshot,
  hooks: {
    onHidden?: (hidden: number[]) => void;
    label?: (action: 'hide' | 'show', name: string) => string;
  } = {},
): ChartMount {
  let chart = initial;
  let hidden = [...(initial.options?.hidden ?? [])];
  host.classList.add('chart-view');
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  const canvas = document.createElement('div');
  canvas.className = 'chart-canvas';
  host.replaceChildren(canvas, tip);

  function render(animate: boolean) {
    let markup: string;
    try {
      markup = snapshotSvg({ ...chart, options: { ...chart.options, hidden } });
    } catch (error) {
      canvas.replaceChildren();
      const message = document.createElement('p');
      message.className = 'chart-error';
      message.textContent = error instanceof Error ? error.message : String(error);
      canvas.append(message);
      return;
    }
    canvas.innerHTML = markup;
    const svg = canvas.querySelector('svg');
    if (!svg) return;
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    // Move per-mark <title> into data-tip so the custom tooltip replaces the native one.
    svg.querySelectorAll(':scope title').forEach((title) => {
      const owner = title.parentNode;
      if (!(owner instanceof Element) || owner === svg) return;
      if (!owner.closest('.legend-item')) owner.setAttribute('data-tip', title.textContent ?? '');
      title.remove();
    });
    svg.querySelectorAll<SVGGElement>('[data-legend]').forEach((item) => {
      const pressed = item.getAttribute('data-hidden') !== 'true';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-pressed', String(pressed));
      const name = item.querySelector('text')?.textContent ?? '';
      item.setAttribute('aria-label', hooks.label?.(pressed ? 'hide' : 'show', name) ?? name);
    });
    const motion = chart.options?.animation ?? 'auto';
    host.dataset.motion = motion;
    if (animate && motion !== 'none' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      host.classList.remove('chart-enter');
      void host.offsetWidth;
      host.classList.add('chart-enter');
    }
  }

  function toggle(series: number) {
    hidden = hidden.includes(series) ? hidden.filter((i) => i !== series) : [...hidden, series].sort((a, b) => a - b);
    render(false);
    hooks.onHidden?.(hidden);
    host.querySelector<SVGGElement>(`[data-legend="${series}"]`)?.focus();
  }

  const onMove = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const series = target?.closest('[data-series]')?.getAttribute('data-series');
    if (series != null) host.dataset.focus = series;
    else delete host.dataset.focus;
    const text = target?.closest('[data-tip]')?.getAttribute('data-tip');
    if (!text) {
      tip.hidden = true;
      return;
    }
    const box = host.getBoundingClientRect();
    tip.textContent = text;
    tip.hidden = false;
    const x = event.clientX - box.left,
      y = event.clientY - box.top;
    const width = tip.offsetWidth,
      height = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(x + 14, box.width - width - 4)) + 'px';
    tip.style.top = (y - height - 12 < 4 ? y + 18 : y - height - 12) + 'px';
  };
  const onLeave = () => {
    tip.hidden = true;
    delete host.dataset.focus;
  };
  const onClick = (event: MouseEvent) => {
    const item = event.target instanceof Element ? event.target.closest('[data-legend]') : null;
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    toggle(Number(item.getAttribute('data-legend')));
  };
  const onKey = (event: KeyboardEvent) => {
    const item = event.target instanceof Element ? event.target.closest('[data-legend]') : null;
    if (!item || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    toggle(Number(item.getAttribute('data-legend')));
  };
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', onLeave);
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKey);
  render(true);
  return {
    update(next) {
      const animate = next.kind !== chart.kind;
      chart = next;
      hidden = [...(next.options?.hidden ?? [])];
      render(animate);
    },
    destroy() {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('click', onClick);
      host.removeEventListener('keydown', onKey);
      host.replaceChildren();
    },
  };
}
