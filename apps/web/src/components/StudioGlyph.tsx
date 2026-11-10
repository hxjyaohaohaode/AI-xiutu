import * as React from 'react';
import { useId, type SVGProps } from 'react';

const glyphs = {
  hair: (
    <>
      <path d="M5 19V10a7 7 0 0 1 14 0v9M5 14c3-1 5-4 6-8 1 4 4 6 8 6M8 14v3a4 4 0 0 0 8 0v-3" />
    </>
  ),
  beauty: (
    <>
      <path d="M8 4.5c1.1-1 2.4-1.5 4-1.5s2.9.5 4 1.5M7 7c0 6 1.6 10 5 12 3.4-2 5-6 5-12M9 10h.01M15 10h.01M10 14.5c1.3.8 2.7.8 4 0" />
      <path d="M4 8v4M2 10h4M19 16v4M17 18h4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  color: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.5-3.3l-.6-.7a1.6 1.6 0 0 1 1.2-2.7H18a3 3 0 0 0 3-3A8.8 8.8 0 0 0 12 3Z" />
      <circle cx="7.5" cy="10" r=".8" />
      <circle cx="11" cy="6.8" r=".8" />
      <circle cx="15.7" cy="8.4" r=".8" />
      <circle cx="7.5" cy="15" r=".8" />
    </>
  ),
  curves: (
    <>
      <path d="M4 3v17h17M4 17c8 0 7-10 16-10" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M8 4v2M18 18h2" />
    </>
  ),
  crop: (
    <>
      <path d="M7 3v12a2 2 0 0 0 2 2h12M3 7h12a2 2 0 0 1 2 2v12M19 3l-4 4" />
    </>
  ),
  local: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 6v2M12 16v2M6 12h2M16 12h2" />
    </>
  ),
  detail: (
    <>
      <path d="m12 3 8.5 5v8L12 21l-8.5-5V8L12 3Z" />
      <path d="m3.5 8 8.5 5 8.5-5M12 13v8M8 5.4l8.5 5" />
    </>
  ),
  repair: (
    <>
      <path d="m8.5 4.5-4 4a4 4 0 0 0 0 5.7l5.3 5.3a4 4 0 0 0 5.7 0l4-4a4 4 0 0 0 0-5.7l-5.3-5.3a4 4 0 0 0-5.7 0Z" />
      <path d="m8 8 8 8m-7-5h.01M12 8h.01M12 16h.01M15 13h.01" />
    </>
  ),
  paint: (
    <>
      <path d="m13 11 6-8 2 2-8 8-2-2 2-2ZM12 13c0 4-2 7-7 7H3c3-2 0-6 4-7 1.6-.5 3.3-.3 5 0Z" />
    </>
  ),
  liquify: (
    <>
      <path d="M3 6c3-5 5 5 9 0s6 3 9 0M3 12c3-5 5 5 9 0s6 3 9 0M3 18c3-5 5 5 9 0s6 3 9 0" />
    </>
  ),
  composite: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  history: (
    <>
      <path d="M3 11a9 9 0 1 1 2.4 7M3 5v6h6" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  editor: (
    <>
      <path d="M4 7h16M4 17h16" />
      <rect x="7" y="4" width="4" height="6" rx="1.5" />
      <rect x="14" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
  works: (
    <>
      <rect x="3" y="5" width="16" height="15" rx="2" />
      <path d="m3 16 5-5 4 4 3-3 4 4M7 2h12a3 3 0 0 1 3 3v11" />
      <circle cx="14.5" cy="9" r="1" />
    </>
  ),
  compare: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 2v20M6 14l3-3M15 13l3-3M6 8h2M16 16h2" />
    </>
  ),
  collaborate: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2" />
    </>
  ),
  docs: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
      <path d="M14 3v6h6M8 13h8M8 17h6" />
    </>
  ),
  deliver: (
    <>
      <path d="m3 7 9-4 9 4v11l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v11M8 5l9 4" />
      <path d="m16 16 1 1 2-2" />
    </>
  ),
  usage: (
    <>
      <path d="M4 3v17h17M8 16v-5M13 16V7M18 16v-8" />
    </>
  ),
  ai: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" />
      <path d="m12 7 1.4 3.6L17 12l-3.6 1.4L12 17l-1.4-3.6L7 12l3.6-1.4L12 7Z" />
    </>
  ),
  import: (
    <>
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 3v12m-5-5 5 5 5-5" />
    </>
  ),
  export: (
    <>
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 15V3M7 8l5-5 5 5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 5h16M4 12h16M4 19h16" />
      <circle cx="8" cy="5" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="19" r="2" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  voice: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8" />
    </>
  ),
  select: (
    <>
      <path d="m4 3 15 9-7 2-3 7L4 3ZM12 14l5 6" />
    </>
  ),
  background: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      <path d="m9 15 6-6" />
    </>
  ),
  collage: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18M12 11h9M3 15h9" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
    </>
  ),
  moon: <path d="M20.6 14.6A9 9 0 0 1 9.4 3.4a9 9 0 1 0 11.2 11.2Z" />,
  system: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  chevron: <path d="m7 10 5 5 5-5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
} as const;

export type StudioGlyphName = keyof typeof glyphs;

/** Optical 20px symbols share a 24-unit grid; data-bearing SVGs stay independent. */
export function StudioGlyph({
  name,
  size = 20,
  title,
  className = '',
  ...props
}: Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> & {
  name: StudioGlyphName;
  size?: number;
  title?: string;
}) {
  const titleId = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`studio-glyph ${className}`}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-labelledby={title ? titleId : undefined}
      focusable="false"
      {...props}
    >
      {title && <title id={titleId}>{title}</title>}
      {glyphs[name]}
    </svg>
  );
}
