import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** Root tsx uses classic JSX; Vite uses the automatic runtime. Supply the real
 * factory only while checking SSR semantics, then restore the process state. */
export function renderTestMarkup(element: React.ReactElement): string {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', { value: React, configurable: true });
  try {
    return renderToStaticMarkup(element);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  }
}
