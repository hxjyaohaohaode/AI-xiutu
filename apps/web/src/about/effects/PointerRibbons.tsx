import { useEffect, useRef } from 'react';
import './effects.css';

/**
 * The spring-chain and width profile are adapted from React Bits Ribbons.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause; see LICENSE.react-bits.md.
 * This adaptation uses a bounded Canvas 2D renderer, parent-scoped input,
 * an idle stop, visibility suspension and a static reduced-motion fallback.
 */
const POINTS = 42;
const STEP = 1 / 120;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smooth = (value: number) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const hash = (value: number) => {
  const s = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function ribbon(index: number, x: number, y: number) {
  const points = new Float32Array(POINTS * 2);
  for (let i = 0; i < POINTS; i += 1) {
    points[i * 2] = x;
    points[i * 2 + 1] = y;
  }
  return {
    x, y, vx: 0, vy: 0, points,
    pull: 0.35 + 1.3 * hash(index + 3),
    drag: 0.9 + 0.2 * hash(index + 5),
    width: 0.95 + 0.1 * hash(index + 7),
    lift: hash(index + 13) - 0.5,
    nudge: hash(index + 17) - 0.5,
  };
}

export interface PointerRibbonsProps {
  className?: string;
  tone?: 'ink' | 'light';
}

/** Place directly inside a positioned, isolated hero; content belongs above z-index 0. */
export function PointerRibbons({ className = '', tone = 'ink' }: PointerRibbonsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const host = root?.parentElement;
    if (!root || !canvas || !host) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const colors = tone === 'light' ? ['#f1e9db', '#dc8c60', '#c2cbbd'] : ['#26392f', '#c4643e', '#78907e'];
    const trails = colors.map((_, index) => ribbon(index, 0, 0));
    const edgeA = new Float32Array(POINTS * 2);
    const edgeB = new Float32Array(POINTS * 2);
    let width = 1;
    let height = 1;
    let scale = 1;
    let x = 0;
    let y = 0;
    let placed = false;
    let visible = true;
    let alive = true;
    let raf = 0;
    let last = 0;
    let movedAt = 0;
    let accumulator = 0;
    let opacity = 0;

    const allowed = () => alive && visible && !document.hidden && !reduced.matches && pointer.matches;
    const clear = () => context.clearRect(0, 0, width, height);
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      opacity = 0;
      placed = false;
      clear();
      root.dataset.live = 'false';
    };
    const simulate = (dt: number) => {
      // Fixed timesteps keep the spring stable after slower frames.
      const spring = 0.03 * 4 ** (2 * 0.58 - 1);
      const dampingRatio = 0.3 ** (2 * 0.35);
      const follow = 1 - 0.183 ** ((1 / 1.35) * dt * 60);
      trails.forEach((trail, index) => {
        const omega = 60 * Math.sqrt(spring * trail.pull);
        const damping = 2 * dampingRatio * 60 * Math.sqrt(spring) * trail.drag;
        const targetX = x + (index - 1 + trail.nudge * 0.2) * 9;
        const targetY = y + trail.lift * 9;
        trail.vx += (omega * omega * (targetX - trail.x) - damping * trail.vx) * dt;
        trail.vy += (omega * omega * (targetY - trail.y) - damping * trail.vy) * dt;
        trail.x += trail.vx * dt;
        trail.y += trail.vy * dt;
        trail.points[0] = trail.x;
        trail.points[1] = trail.y;
        for (let i = 1; i < POINTS; i += 1) {
          const at = i * 2;
          trail.points[at] += (trail.points[at - 2] - trail.points[at]) * follow;
          trail.points[at + 1] += (trail.points[at - 1] - trail.points[at + 1]) * follow;
        }
      });
    };
    const paint = () => {
      clear();
      trails.forEach((trail, index) => {
        const points = trail.points;
        let total = 0;
        for (let i = 1; i < POINTS; i += 1) {
          total += Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]);
        }
        if (total < 0.5) return;
        const half = (index === 1 ? 4.8 : 2.6) * trail.width * smooth(total / 55);
        let nx = 0;
        let ny = 1;
        for (let i = 0; i < POINTS; i += 1) {
          const before = Math.max(0, i - 1) * 2;
          const after = Math.min(POINTS - 1, i + 1) * 2;
          const dx = points[after] - points[before];
          const dy = points[after + 1] - points[before + 1];
          const length = Math.hypot(dx, dy);
          if (length > 0.001) { nx = -dy / length; ny = dx / length; }
          const u = i / (POINTS - 1);
          const lens = 1 - 0.9 * ((u - 0.5) * 2) ** 2;
          const reach = half * lens * smooth(length / 2);
          edgeA[i * 2] = points[i * 2] + nx * reach;
          edgeA[i * 2 + 1] = points[i * 2 + 1] + ny * reach;
          edgeB[i * 2] = points[i * 2] - nx * reach;
          edgeB[i * 2 + 1] = points[i * 2 + 1] - ny * reach;
        }
        context.beginPath();
        context.moveTo(edgeA[0], edgeA[1]);
        for (let i = 1; i < POINTS - 1; i += 1) {
          context.quadraticCurveTo(edgeA[i * 2], edgeA[i * 2 + 1],
            (edgeA[i * 2] + edgeA[i * 2 + 2]) / 2, (edgeA[i * 2 + 1] + edgeA[i * 2 + 3]) / 2);
        }
        context.lineTo(edgeA[(POINTS - 1) * 2], edgeA[(POINTS - 1) * 2 + 1]);
        context.lineTo(edgeB[(POINTS - 1) * 2], edgeB[(POINTS - 1) * 2 + 1]);
        for (let i = POINTS - 2; i > 0; i -= 1) {
          context.quadraticCurveTo(edgeB[i * 2], edgeB[i * 2 + 1],
            (edgeB[i * 2] + edgeB[i * 2 - 2]) / 2, (edgeB[i * 2 + 1] + edgeB[i * 2 - 1]) / 2);
        }
        context.lineTo(edgeB[0], edgeB[1]);
        context.closePath();
        context.fillStyle = colors[index];
        context.globalAlpha = opacity * (index === 1 ? 0.52 : 0.36);
        context.fill();
      });
      context.globalAlpha = 1;
    };
    const frame = (now: number) => {
      raf = 0;
      if (!allowed()) { stop(); return; }
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
      last = now;
      accumulator += dt;
      while (accumulator >= STEP) { simulate(STEP); accumulator -= STEP; }
      const age = now - movedAt;
      const targetOpacity = age < 140 ? 1 : 1 - smooth((age - 140) / 900);
      opacity += (targetOpacity - opacity) * (1 - Math.exp(-dt * 14));
      paint();
      if (age < 1400 || opacity > 0.002) raf = requestAnimationFrame(frame);
      else stop();
    };
    const wake = () => {
      if (!raf && placed && allowed()) { last = 0; raf = requestAnimationFrame(frame); }
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !allowed()) return;
      const target = event.target;
      if (target instanceof Element && target.closest('a,button,input,select,textarea,video,img,[data-pointer-protect]')) {
        // Keeping the pointer trace away from controls and photographs is intentional.
        if (placed) { movedAt = Math.min(movedAt, performance.now() - 850); wake(); }
        return;
      }
      const rect = root.getBoundingClientRect();
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      if (!placed) {
        trails.forEach((trail, index) => Object.assign(trail, ribbon(index, x, y)));
        placed = true;
        accumulator = 0;
      }
      movedAt = performance.now();
      root.dataset.live = 'true';
      wake();
    };
    const onLeave = () => { if (placed) { movedAt = performance.now() - 350; wake(); } };
    const resize = () => {
      width = Math.max(1, root.clientWidth);
      height = Math.max(1, root.clientHeight);
      scale = Math.min(window.devicePixelRatio || 1, 1.75, 1920 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);
      stop();
    };
    const onPreference = () => { stop(); root.dataset.interactive = allowed() ? 'true' : 'false'; };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (!visible) stop();
    });
    observer?.observe(root);
    intersection?.observe(root);
    host.addEventListener('pointermove', onMove, { passive: true });
    host.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onPreference);
    reduced.addEventListener('change', onPreference);
    pointer.addEventListener('change', onPreference);
    window.addEventListener('resize', resize, { passive: true });
    resize();
    onPreference();
    return () => {
      alive = false;
      stop();
      observer?.disconnect();
      intersection?.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onPreference);
      reduced.removeEventListener('change', onPreference);
      pointer.removeEventListener('change', onPreference);
      window.removeEventListener('resize', resize);
    };
  }, [tone]);

  return (
    <div ref={rootRef} className={`about-pointer-ribbons ${className}`} data-tone={tone} aria-hidden="true">
      <svg className="about-pointer-ribbons__rest" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice">
        <path d="M-80 555C186 494 197 134 458 168S762 684 1300 470" />
        <path d="M-80 577C194 523 211 155 464 190S758 713 1300 492" />
        <path d="M-80 598C203 552 225 177 470 212S753 741 1300 514" />
      </svg>
      <canvas ref={canvasRef} />
    </div>
  );
}
