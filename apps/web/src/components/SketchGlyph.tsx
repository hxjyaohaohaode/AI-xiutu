import type { JSX } from 'react';
import type { SketchIcon, SketchShape } from './sketch-document';

const shapes = {
  rectangle: <rect x="3.5" y="5.5" width="17" height="13" />,
  rounded: <rect x="3.5" y="5.5" width="17" height="13" rx="4" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="7" />,
  triangle: <path d="M12 3.5 21 19H3z" />,
  diamond: <path d="M12 3 21 12 12 21 3 12z" />,
  line: <path d="m4 19 16-14" />,
  arrow: <path d="m4 19 16-14m-8 0h8v8" />,
  star: <path d="m12 2 2.9 6.6 7.1.8-5.3 4.8 1.5 7-6.2-3.6-6.2 3.6 1.5-7L2 9.4l7.1-.8z" />,
  heart: <path d="M12 21 4 13a5 5 0 0 1 8-6 5 5 0 0 1 8 6z" />,
  check: <path d="m4 12 5 5L20 6" />,
  pin: (
    <path d="M12 22S5 15.7 5 10a7 7 0 1 1 14 0c0 5.7-7 12-7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
  ),
  bolt: <path d="m14 2-9 12h6l-1 8 9-12h-6z" />,
  speech: (
    <path d="M7 5h10a4 4 0 0 1 4 4v3a4 4 0 0 1-4 4h-5l-6 4v-4a4 4 0 0 1-3-4V9a4 4 0 0 1 4-4Z" />
  ),
  fill: <path d="m10 4 8 8-6 6-8-8zm-4 9 6 5 5-5m4 2c0 2 1 3 1 4a2 2 0 1 1-4 0c0-1 1-2 3-4Z" />,
} satisfies Record<SketchShape | SketchIcon | 'fill', JSX.Element>;

export function SketchGlyph({ name }: { name: keyof typeof shapes }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="21"
      height="21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}
