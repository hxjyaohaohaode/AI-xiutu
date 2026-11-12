import * as React from 'react';
import type { SVGProps } from 'react';

/** Editor actions share the same 24-unit optical grid as the tool and parameter symbols. */
const shapes = {
  undo: <path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-2" />,
  redo: <path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12h2" />,
  rotateLeft: (
    <>
      <path d="M5 7a8 8 0 1 1-1 9M2 7h5V2" />
      <path d="m10 9 5 1-1 5-5-1Z" />
    </>
  ),
  rotateRight: (
    <>
      <path d="M19 7a8 8 0 1 0 1 9m2-9h-5V2" />
      <path d="m9 10 5-1 1 5-5 1Z" />
    </>
  ),
  refresh: <path d="M3 10a9 9 0 0 1 15-6l3 3m0-5v5h-5M21 14a9 9 0 0 1-15 6l-3-3m0 5v-5h5" />,
  return: <path d="m9 4-6 6 6 6M3 10h12a6 6 0 0 1 6 6v4" />,
  up: <path d="M12 21V3m-6 6 6-6 6 6" />,
  down: <path d="M12 3v18m-6-6 6 6 6-6" />,
  left: <path d="M21 12H3m6-6-6 6 6 6" />,
  flipX: (
    <>
      <path d="M12 3v18M3 6v12l6-6Zm18 0v12l-6-6Z" />
      <path d="M3 6v12l6-6Z" fill="currentColor" fillOpacity=".12" />
    </>
  ),
  flipY: (
    <>
      <path d="M3 12h18M6 3h12l-6 6Zm0 18h12l-6-6Z" />
      <path d="M6 3h12l-6 6Z" fill="currentColor" fillOpacity=".12" />
    </>
  ),
  move: <path d="M3 12h18M12 3v18M6 9l-3 3 3 3m12-6 3 3-3 3M9 6l3-3 3 3m-6 12 3 3 3-3" />,
  fit: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
  fitIn: <path d="M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6" />,
  expand: <path d="M3 9V3h6M3 3l6 6m6-6h6v6m0-6-6 6M3 15v6h6m-6 0 6-6m6 6h6v-6m0 6-6-6" />,
  curve: (
    <>
      <path d="M3 19h18M4 4v15m1-2c7 0 6-10 14-10" />
      <circle cx="12" cy="12" r="2" fill="var(--surface, #fff)" />
    </>
  ),
  caretDown: <path d="m6 9 6 6 6-6" />,
  caretUp: <path d="m6 15 6-6 6 6" />,
  caretLeft: <path d="m15 6-6 6 6 6" />,
  caretRight: <path d="m9 6 6 6-6 6" />,
  check: <path d="m4 12 5 5L20 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  circle: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="7" />
      <path d="M12 3v3m0 12v3M2 12h3m14 0h3" />
    </>
  ),
  compass: (
    <>
      <path d="M12 3v3m-1 0L5 21m8-15 6 15M8 15h8" />
      <circle cx="12" cy="7" r="2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  crop: <path d="M7 3v12a2 2 0 0 0 2 2h12M3 7h12a2 2 0 0 1 2 2v12M20 3l-3 4" />,
  cursor: <path d="m4 3 16 10-7 1-3 7L4 3Zm9 11 5 6" />,
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </g>
  ),
  download: <path d="M12 3v12m-5-5 5 5 5-5M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />,
  upload: <path d="M12 15V3M7 8l5-5 5 5M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />,
  eraser: (
    <>
      <path d="m3 12 9-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-9 9H8l-5-6a2 2 0 0 1 0-3ZM8 7l10 10M12 21h9" />
      <path d="m3 12 5-5 10 10-4 4H8l-5-6Z" fill="currentColor" fillOpacity=".1" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9 5a11 11 0 0 1 3 0c6 0 10 7 10 7a21 21 0 0 1-3 4M6 6a21 21 0 0 0-4 6s4 7 10 7a11 11 0 0 0 4-1M10 10a3 3 0 0 0 4 4M3 3l18 18" />
    </>
  ),
  eyedropper: (
    <>
      <path d="m14 3 7 7m-7-3-9 9v3l-2 2m2-2h3l9-9M14 7l3-4a2 2 0 0 1 3 3l-4 3" />
      <path d="m7 14 3 3" />
    </>
  ),
  folder: <path d="M3 9V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 9h18l-3 11H5L3 9Z" />,
  corners: (
    <>
      <path d="m5 5 13-2 3 15-16 3Z" />
      <g fill="var(--surface, #fff)">
        <rect x="3" y="3" width="4" height="4" rx=".5" />
        <rect x="16" y="1" width="4" height="4" rx=".5" />
        <rect x="19" y="16" width="4" height="4" rx=".5" />
        <rect x="3" y="19" width="4" height="4" rx=".5" />
      </g>
    </>
  ),
  gradient: (
    <>
      <path d="M4 3h16v18H4Z" />
      <path d="M4 7h16M4 11h16m-16 5h16" />
      <path d="M4 3h16v4H4Z" fill="currentColor" fillOpacity=".2" />
    </>
  ),
  hand: (
    <path d="M8 11V5a2 2 0 0 1 4 0v7-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v9c0 4-3 6-6 6h-2c-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l3 3V8" />
  ),
  point: (
    <path d="M9 13V4a2 2 0 0 1 4 0v6l5 1a3 3 0 0 1 3 3v2a6 6 0 0 1-6 6h-2c-3 0-5-3-7-5l-3-4a2 2 0 0 1 3-2l3 3" />
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m3 17 5-5 4 4 3-3 6 6" />
      <circle cx="15" cy="8" r="2" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6M6 10h8m-4-4v8" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6M6 10h8" />
    </>
  ),
  paint: (
    <>
      <path d="m12 11 7-8a2 2 0 0 1 3 3l-8 7-2-2ZM12 13c1 4-2 7-6 7H3c3-2 0-5 4-7 2-1 4-1 5 0Z" />
    </>
  ),
  pencil: (
    <>
      <path d="m4 15 12-12a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20l-6 1 1-6Zm10-10 5 5M4 15l5 5" />
    </>
  ),
  perspective: (
    <>
      <path d="m4 5 16-3v20L4 19ZM12 4v16M4 12h16" />
    </>
  ),
  plus: <path d="M12 4v16M4 12h16" />,
  polygon: (
    <>
      <path d="m4 6 13-3 4 12-10 6-8-8Z" />
      <g fill="currentColor" stroke="none">
        <circle cx="4" cy="6" r="1.8" />
        <circle cx="17" cy="3" r="1.8" />
        <circle cx="21" cy="15" r="1.8" />
        <circle cx="11" cy="21" r="1.8" />
        <circle cx="3" cy="13" r="1.8" />
      </g>
    </>
  ),
  selectionPlus: <path d="M7 3H3v4m10-4h4m4 4V3h-4M3 13v4m4 4H3v-4M13 17h8m-4-4v8" />,
  alphaLock: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="M8 9h4v4H8Zm4 4h4v4h-4Z" fill="currentColor" fillOpacity=".2" />
      <path d="M12 5v14M5 9h14m-13 4h12" />
    </>
  ),
  sliders: (
    <>
      <path d="M3 6h18M3 18h18M8 3v6m8 6v6" />
      <circle cx="8" cy="6" r="2" fill="var(--surface, #fff)" />
      <circle cx="16" cy="18" r="2" fill="var(--surface, #fff)" />
    </>
  ),
  sparkle: (
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4" />
  ),
  text: <path d="M3 7V3h18v4M12 3v18m-5 0h10" />,
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />,
  person: (
    <>
      <path d="M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4M6 19v-2a6 6 0 0 1 12 0v2" />
      <circle cx="12" cy="8" r="3" />
    </>
  ),
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="5" r="1.3" />
      <circle cx="15" cy="5" r="1.3" />
      <circle cx="9" cy="12" r="1.3" />
      <circle cx="15" cy="12" r="1.3" />
      <circle cx="9" cy="19" r="1.3" />
      <circle cx="15" cy="19" r="1.3" />
    </g>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M3 4h6v16H3Z" fill="currentColor" fillOpacity=".1" />
    </>
  ),
  rectangle: <rect x="3" y="5" width="18" height="14" rx="2" />,
} as const;

export type ControlGlyphName = keyof typeof shapes;
export type ControlGlyphProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> & {
  size?: number | string;
};
export function ControlGlyph({
  name,
  size = 20,
  className = '',
  ...props
}: ControlGlyphProps & { name: ControlGlyphName }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`control-glyph ${className}`}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {shapes[name]}
    </svg>
  );
}
const symbol = (name: ControlGlyphName) => (props: ControlGlyphProps) => (
  <ControlGlyph name={name} {...props} />
);

export const ArrowCounterClockwise = symbol('undo'),
  ArrowClockwise = symbol('redo');
export const ArrowArcLeft = symbol('rotateLeft'),
  ArrowArcRight = symbol('rotateRight');
export const ArrowBendUpLeft = symbol('return'),
  ArrowUUpLeft = symbol('return'),
  ArrowsClockwise = symbol('refresh');
export const ArrowUp = symbol('up'),
  ArrowDown = symbol('down'),
  ArrowLeft = symbol('left');
export const ArrowsLeftRight = symbol('flipX'),
  ArrowsDownUp = symbol('flipY'),
  ArrowsOutCardinal = symbol('move');
export const CornersOut = symbol('fit'),
  CornersIn = symbol('fitIn'),
  ArrowsOut = symbol('expand');
export const BezierCurve = symbol('curve'),
  CaretDown = symbol('caretDown'),
  CaretUp = symbol('caretUp'),
  CaretLeft = symbol('caretLeft'),
  CaretRight = symbol('caretRight');
export const Check = symbol('check'),
  X = symbol('close'),
  Circle = symbol('circle'),
  CompassTool = symbol('compass');
export const Copy = symbol('copy'),
  CopySimple = symbol('copy'),
  Crop = symbol('crop'),
  Cursor = symbol('cursor'),
  DotsThree = symbol('more');
export const DownloadSimple = symbol('download'),
  UploadSimple = symbol('upload'),
  Eraser = symbol('eraser');
export const Eye = symbol('eye'),
  EyeSlash = symbol('eyeOff'),
  Eyedropper = symbol('eyedropper'),
  FolderOpen = symbol('folder');
export const FrameCorners = symbol('corners'),
  Gradient = symbol('gradient'),
  Hand = symbol('hand'),
  HandPointing = symbol('point'),
  ImageSquare = symbol('image');
export const MagnifyingGlassPlus = symbol('zoomIn'),
  MagnifyingGlassMinus = symbol('zoomOut'),
  PaintBrush = symbol('paint'),
  PencilSimple = symbol('pencil');
export const Perspective = symbol('perspective'),
  Plus = symbol('plus'),
  Polygon = symbol('polygon'),
  SelectionPlus = symbol('selectionPlus');
export const ShieldCheckered = symbol('alphaLock'),
  SlidersHorizontal = symbol('sliders'),
  Sparkle = symbol('sparkle'),
  TextT = symbol('text'),
  Trash = symbol('trash'),
  UserFocus = symbol('person');
export const DotsSix = symbol('grip'),
  SidebarSimple = symbol('sidebar'),
  Rectangle = symbol('rectangle');
