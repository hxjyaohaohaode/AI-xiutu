import { pointText } from './model';
import type { CSSProperties } from 'react';

/** Counter-inspired stagger reveals the actual digits; financial values never count through invented amounts. */
export function UsageNumber({ value }: { value: unknown }) {
  const text = pointText(value);
  return (
    <span className="usage-number">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {Array.from(text).map((digit, index) => (
          <span
            className="usage-number-digit"
            key={index}
            style={{ '--digit-delay': `${Math.min(index * 20, 160)}ms` } as CSSProperties}
          >
            {digit}
          </span>
        ))}
      </span>
    </span>
  );
}
