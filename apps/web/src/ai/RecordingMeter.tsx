import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../motion/usePresence';

/** Samples the already-owned recording stream. No second permission request,
 * oscillator, random amplitude or synthetic voice activity. */
export function RecordingMeter({ stream }: { stream: MediaStream | null }) {
  const root = useRef<SVGSVGElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const bars = Array.from(root.current?.querySelectorAll('rect') ?? []);
    const clear = () =>
      bars.forEach((bar) => {
        bar.setAttribute('y', '11');
        bar.setAttribute('height', '2');
      });
    clear();
    if (!stream || reduced || typeof AudioContext === 'undefined') return;
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      return;
    }
    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;
    try {
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch {
      void context.close().catch(() => {});
      return;
    }
    void context.resume().catch(() => {});
    const data = new Float32Array(analyser.fftSize);
    const levels = new Array<number>(bars.length).fill(0);
    let frame = 0;
    let lastSample = -Infinity;
    const paint = (now: number) => {
      if (document.visibilityState === 'hidden') return;
      if (now - lastSample >= 45) {
        lastSample = now;
        analyser.getFloatTimeDomainData(data);
        let square = 0;
        for (const value of data) square += value * value;
        levels.shift();
        levels.push(Math.min(1, Math.sqrt(square / data.length) * 4));
        bars.forEach((bar, index) => {
          const height = 2 + levels[index]! * 18;
          bar.setAttribute('y', String((24 - height) / 2));
          bar.setAttribute('height', String(height));
        });
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => {});
      clear();
    };
  }, [stream, reduced]);
  return (
    <svg
      ref={root}
      className="recording-meter"
      viewBox="0 0 96 24"
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: 20 }, (_, index) => (
        <rect key={index} x={index * 4.8 + 1} y="11" width="2.2" height="2" rx="1.1" />
      ))}
    </svg>
  );
}
