import React, { type ReactNode } from 'react';

/* Navigation glyphs follow the anatomy each control changes. They never imply
 * that a detector is available, or stand in for a generated before/after image. */
const portraitMarks: Record<string, ReactNode> = {
  smooth: <path d="M7 15c2-3 8-3 10 0M8 18c2-2 6-2 8 0" />,
  wrinkles: <path d="m6 14 3-1 3 1 3-1 3 1M8 17l2-1 2 1 2-1 2 1" />,
  texture: <><circle cx="8" cy="14" r=".6" /><circle cx="12" cy="13" r=".6" /><circle cx="16" cy="14" r=".6" /><circle cx="10" cy="17" r=".6" /><circle cx="14" cy="17" r=".6" /></>,
  skinLight: <><path d="M12 8v12M12 8c6 0 6 12 0 12" /><path d="M18 5v4m-2-2h4" /></>,
  even: <path d="M6 13h12M7 16h10M9 19h6" />,
  skinShine: <><path d="m12 6 1.2 3.8L17 11l-3.8 1.2L12 16l-1.2-3.8L7 11l3.8-1.2Z" /><path d="m17 17 3 3m0-3-3 3" /></>,
  skinBlemish: <><circle cx="8" cy="14" r="1.3" /><circle cx="16" cy="16" r="1" /><path d="m15 5 4 4m-4 0 4-4" /></>,
  skinColorSpot: <><path d="M7 13c-2 1-1 4 1 4s3-4 1-4Zm8 1c-2 0-2 4 0 4s3-3 1-4Z" /><path d="M18 5v4m-2-2h4" /></>,
  skinWarmth: <><path d="M9 9v6a3 3 0 1 0 4 0V9a2 2 0 0 0-4 0Z" /><path d="M11 12v5m6-7h3m-2-3v6" /></>,
  complexion: <><path d="M8 12c-4 2-1 6 2 3m6-3c4 2 1 6-2 3" /><path d="M10 19h4" /></>,
  underEye: <path d="M5 12q3 3 6 0m2 0q3 3 6 0M6 15q2 2 4 0m4 0q2 2 4 0" />,
  eyeLight: <><path d="M4 12q4-6 8 0-4 5-8 0m8 0q4-6 8 0-4 5-8 0" /><path d="M8 9v6m8-6v6" /></>,
  browDetail: <path d="m5 9 3-1 3 1m2 0 3-1 3 1M6 8l1-2m1 2 1-2m5 2 1-2m1 2 1-2" />,
  teethTone: <><path d="M7 15q5 4 10 0v3q-5 5-10 0Z" /><path d="M12 16v4m5-11h4m-2-2v4" /></>,
  meshLight: <path d="M12 5 6 10l2 9 4 3 4-3 2-9ZM6 10l6 4 6-4M8 19l4-5 4 5M12 5v17" />,
  sculpt: <path d="m10 8-2 7q4 3 8 0l-2-7M12 7v10M8 19h8" />,
  faceSlim: <path d="m4 9 3 3-3 3m16-6-3 3 3 3M9 6q-2 12 3 15 5-3 3-15" />,
  faceSmall: <><path d="m5 5 3 3m-3 0h3V5m11 0-3 3m0-3v3h3M6 19l3-3m-3 0h3v3m9 0-3-3m0 3v-3h3" /><ellipse cx="12" cy="12" rx="4" ry="6" /></>,
  faceNarrow: <path d="M9 5q-3 8 3 17 6-9 3-17M2 12h6m-2-2 2 2-2 2m16-2h-6m2-2-2 2 2 2" />,
  vFace: <path d="M7 12q0 6 5 10 5-4 5-10M3 17h4m-2-2 2 2-2 2m16-2h-4m2-2-2 2 2 2" />,
  temples: <path d="M5 6v5m14-5v5M2 8h6m-2-2 2 2-2 2m16-2h-6m2-2-2 2 2 2" />,
  cheekbones: <path d="M5 12q3-3 5 1m4 0q2-4 5-1M2 14h5m-2-2 2 2-2 2m17-2h-5m2-2-2 2 2 2" />,
  jaw: <path d="M5 13v4l7 5 7-5v-4M2 18h5m-2-2 2 2-2 2m17-2h-5m2-2-2 2 2 2" />,
  chin: <path d="M8 18q4 6 8 0M12 15v9m-2-2 2 2 2-2" />,
  forehead: <path d="M6 7q6-8 12 0M12 2v8m-2-2 2 2 2-2M8 9h8" />,
  eyeSize: <><path d="M4 12q8-10 16 0-8 9-16 0Z" /><circle cx="12" cy="12" r="3.5" /><path d="m4 5 3 2m10 0 3-2m-16 14 3-2m10 0 3 2" /></>,
  eyeSpacing: <path d="M3 12q3-4 6 0-3 4-6 0m12 0q3-4 6 0-3 4-6 0M8 6h8m-6-2L8 6l2 2m4-4 2 2-2 2" />,
  eyeRotate: <><path d="m4 13 5-5 2 5Zm9 0 2-5 5 5Z" /><path d="M2 8q0-4 4-4m-2-1 2 1-1 2m17 2q0-4-4-4m2-1-2 1 1 2" /></>,
  eyeWidth: <><path d="M3 12q9-7 18 0-9 7-18 0M3 5h18m-16-2L3 5l2 2m14-4 2 2-2 2" /><circle cx="12" cy="12" r="2" /></>,
  eyeHeight: <path d="M4 12q8-8 16 0-8 8-16 0M12 2v7m-2-5 2-2 2 2m-2 12v6m-2-2 2 2 2-2" />,
  lowerLid: <path d="M4 11q8-7 16 0M4 13q8 7 16 0M12 17v6m-2-2 2 2 2-2" />,
  irisScale: <><path d="M3 12q9-9 18 0-9 9-18 0Z" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
  noseWidth: <path d="m10 5-2 10q4 3 8 0L14 5M5 20h14m-12-2-2 2 2 2m10-4 2 2-2 2" />,
  noseTip: <><path d="m10 5-2 10q4 3 8 0L14 5" /><circle cx="12" cy="15" r="2" /><path d="M20 12v8m-2-2 2 2 2-2" /></>,
  noseLength: <path d="m10 4-3 13q5 3 10 0L14 4M12 5v13m-2-2 2 2 2-2" />,
  lipSize: <path d="M4 13q4-6 8-3 4-3 8 3-8 9-16 0Zm0 0h16M7 4 4 7m0-3v3h3m10 13 3-3m0 3v-3h-3" />,
  lipWidth: <path d="M4 13q4-5 8-2 4-3 8 2-8 7-16 0Zm-2-7h20m-18-2L2 6l2 2m16-4 2 2-2 2" />,
  upperLip: <><path d="M4 14q4-7 8-3 4-4 8 3M4 14q8 6 16 0" /><path d="M12 8V2m-2 2 2-2 2 2" /></>,
  lowerLip: <><path d="M4 11q4-5 8-2 4-3 8 2M4 11q8 9 16 0" /><path d="M12 18v5m-2-2 2 2 2-2" /></>,
  smile: <path d="M5 12q7 10 14 0M2 9l3-3 3 3m-3-3v8m11-5 3-3 3 3m-3-3v8" />,
  browThickness: <path d="m4 11 5-2 3 1m1 0 3-1 5 2M4 14l5-2 3 1m1 0 3-1 5 2M12 3v5m-2-3 2-2 2 2" />,
  browPosition: <path d="m4 11 5-2 3 1m1 0 3-1 5 2M7 2v6m-2-4 2-2 2 2m8-2v6m-2-4 2-2 2 2M5 16h4m6 0h4" />,
  headSize: <><ellipse cx="12" cy="7" rx="4" ry="5" /><path d="M4 22v-5l5-3m6 0 5 3v5M2 3h3V1m17 2h-3V1" /></>,
  neckLength: <path d="M8 2v10l-5 4v7m13-21v10l5 4v7M12 7v12m-2-10 2-2 2 2m-4 8 2 2 2-2" />,
  neckWidth: <path d="M8 2v10l-5 4v7m13-21v10l5 4v7M6 10h12m-10-2-2 2 2 2m8-4 2 2-2 2" />,
  shoulders: <path d="M8 4v4l-6 3v10m14-17v4l6 3v10M2 15h20m-18-2-2 2 2 2m16-4 2 2-2 2" />,
  arms: <path d="m7 5-4 3-2 10 3 1L7 9m10-4 4 3 2 10-3 1-3-10M7 7v14m10-14v14" />,
  waist: <path d="M6 3q5 9 0 19m12-19q-5 9 0 19M2 12h6m-2-2 2 2-2 2m16-2h-6m2-2-2 2 2 2" />,
  hips: <path d="M8 3q0 8-3 11l2 9m9-20q0 8 3 11l-2 9M2 15h6m-2-2 2 2-2 2m16-2h-6m2-2-2 2 2 2" />,
  legLength: <path d="M7 2 6 22h4l2-14 2 14h4L17 2M2 5v15m-2-2 2 2 2-2" />,
  legs: <path d="M7 2 6 22h4l2-14 2 14h4L17 2M1 13h6m-2-2 2 2-2 2m18-2h-6m2-2-2 2 2 2" />,
  height: <><circle cx="12" cy="4" r="2" /><path d="M7 8h10l-1 7v8h-3l-1-6-1 6H8v-8ZM22 2v21m-2-19 2-2 2 2m-4 17 2 2 2-2" /></>,
  lipstick: <path d="M4 13q4-7 8-3 4-4 8 3-8 9-16 0Zm0 0h16m-10 2 4 2m-2-5 3-1" />,
  eyeshadow: <path d="M3 13q4-6 8 0m2 0q4-6 8 0M3 9q4-6 8 0m2 0q4-6 8 0M6 16h2m8 0h2" />,
  blush: <><ellipse cx="7" cy="15" rx="3" ry="2" /><ellipse cx="17" cy="15" rx="3" ry="2" /><path d="m6 13 2 4m8-4 2 4" /></>,
  contour: <path d="M5 8q1 7 5 10M19 8q-1 7-5 10M7 10q1 3 3 5m7-5q-1 3-3 5" />,
  highlight: <path d="M12 7v8M5 12l4 2m10-2-4 2m-3 3v3m5-17 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" />,
  browColor: <path d="m4 8 4-2 3 1m2 0 3-1 4 2M5 10l3-2 3 1m2 0 3-1 3 2m-1 7 3-3 2 2-3 3-3 1Z" />,
  underEyeMakeup: <path d="M4 10q4 4 8 0m0 0q4 4 8 0M5 14q3 3 6 0m2 0q3 3 6 0M7 17h3m4 0h3" />,
};
const marks: Record<string, ReactNode> = {
  exposure: <><circle cx="12" cy="12" r="8" /><path d="M7 10h6m-3-3v6m4 3h4" /></>,
  brightness: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" /></>,
  contrast: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" /></>,
  highlights: <><path d="M4 17a8 8 0 0 1 16 0M12 2v4M3 7l3 3m15-3-3 3M2 21h20" /><path d="M8 17a4 4 0 0 1 8 0" /></>,
  shadows: <path d="M4 7a8 8 0 0 0 16 0M2 3h20M6 12l6 6m-7-2 5 5m1-10 7 7" />,
  whites: <><circle cx="12" cy="12" r="7" /><path d="M12 1v2m0 18v2M1 12h2m18 0h2" /></>,
  blacks: <><circle cx="12" cy="12" r="7" fill="currentColor" stroke="none" /><path d="M2 4h4M2 2v4m16 16h4m0-2v4" /></>,
  temperature: <><path d="M9 5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0ZM12 7v11" /><path d="M19 5h3m-3 4h2" /></>,
  tint: <><path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z" /><path d="M12 5v16m0-10 7 4" /></>,
  saturation: <><path d="M8 3S2 10 2 14a6 6 0 0 0 12 0C14 10 8 3 8 3Z" /><path d="M17 8s-5 6-5 9a5 5 0 0 0 10 0c0-3-5-9-5-9Z" fill="currentColor" fillOpacity=".22" /></>,
  vibrance: <><path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z" /><path d="M12 8v7m-3-3h6" /></>,
  sharpness: <path d="m3 20 9-17 9 17ZM12 3v17M3 20h18" />,
  soften: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" strokeDasharray="2 3" /><circle cx="12" cy="12" r="10" strokeDasharray=".5 4" /></>,
  clarity: <><path d="M3 10V3h7m4 0h7v7M3 14v7h7m4 0h7v-7" /><path d="m7 16 4-8 6 8Z" /></>,
  hue: <><circle cx="12" cy="12" r="8" /><path d="m12 4 7 12H5Zm0 4v8m-4-2 8-4" /></>,
  luminance: <><path d="M2 18h20M4 15l4-6 4 4 4-10 4 12" /><circle cx="16" cy="4" r="1" /></>,
  balance: <path d="M12 3v18M3 6h18M6 6l-4 8h8Zm12 0-4 8h8ZM7 21h10" />,
  inputBlack: <><path d="M3 19h18M4 19V9m4 10V5m4 14V8m4 11V3m4 16v-6" /><path d="m3 22 3-3 3 3" /></>,
  inputWhite: <><path d="M3 19h18M4 19V9m4 10V5m4 14V8m4 11V3m4 16v-6" /><path d="m15 22 3-3 3 3" /></>,
  gamma: <path d="M3 3v18h18M4 20C18 20 6 3 21 3" />,
  outputBlack: <><path d="M3 18h18M3 5v10m5-10v10m5-10v10m5-10v10" /><path d="m3 22 3-3 3 3" /></>,
  outputWhite: <><path d="M3 18h18M3 5v10m5-10v10m5-10v10m5-10v10" /><path d="m15 22 3-3 3 3" /></>,
  monochrome: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M12 4v16M3 15l6-6 8 11" /></>,
  fade: <><path d="M4 4h16v16H4Z" /><path d="M5 17 17 5M9 19 19 9M3 11l8-8" opacity=".45" /></>,
  width: <path d="M3 8V4h18v4M3 16v4h18v-4M2 12h20m-18-2-2 2 2 2m16-4 2 2-2 2" />,
  height: <path d="M8 3H4v18h4M16 3h4v18h-4M12 2v20m-2-18 2-2 2 2m-4 16 2 2 2-2" />,
  x: <path d="M5 3v18m0-9h17m-3-3 3 3-3 3M2 5h6m-6 14h6" />,
  y: <path d="M3 5h18m-9 0v17m-3-3 3 3 3-3M5 2v6m14-6v6" />,
  rotation: <><path d="M5 7a8 8 0 1 1-1 8M2 7h5V2" /><path d="m9 9 6 1-1 6-6-1Z" /></>,
  angle: <path d="M3 19h18L5 5v14m6 0a6 6 0 0 0-2-5" />,
  opacity: <><rect x="3" y="3" width="13" height="13" rx="3" /><rect x="8" y="8" width="13" height="13" rx="3" fill="currentColor" fillOpacity=".15" /></>,
  radius: <><circle cx="12" cy="12" r="8" /><path d="M12 12h8m-2-2 2 2-2 2" /><circle cx="12" cy="12" r="1" /></>,
  feather: <><circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity=".2" /><circle cx="12" cy="12" r="6" strokeDasharray="2 2" /><circle cx="12" cy="12" r="9" strokeDasharray="1 4" /></>,
  amount: <path d="M4 20V12m8 8V4m8 16V8M1 12h6m2-8h6m2 4h6" />,
  size: <path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6M3 3l6 6m6 6 6 6" />,
  seed: <><circle cx="6" cy="7" r="1" /><circle cx="17" cy="5" r="1.5" /><circle cx="12" cy="12" r="1" /><circle cx="5" cy="18" r="1.5" /><circle cx="19" cy="17" r="1" /></>,
  iterations: <path d="M4 9a8 8 0 0 1 14-4l3 3m-5 0h5V3M20 15A8 8 0 0 1 6 19l-3-3m5 0H3v5" />,
};

/** Source IDs keep icon selection stable across language changes. */
export function ParameterGlyph({ id, className = '' }: { id: string; className?: string }) {
  const tail = id.split('.').at(-1) ?? id;
  const portraitId = id.startsWith('portrait:') ? id.slice(9) : '';
  const portrait = portraitMarks[portraitId];
  let mark = portrait ?? marks[tail];
  if (!mark && /radius|width/i.test(tail)) mark = marks.radius;
  if (!mark && /height|length/i.test(tail)) mark = marks.height;
  if (!mark && /feather|soft/i.test(tail)) mark = marks.feather;
  if (!mark && /hue|chroma|color/i.test(tail)) mark = marks.hue;
  if (!mark && /rotation|rotate|angle/i.test(tail)) mark = marks.rotation;
  if (!mark && /translateX|centerX|donor-x|scaleX/.test(tail)) mark = marks.x;
  if (!mark && /translateY|centerY|donor-y|scaleY/.test(tail)) mark = marks.y;
  if (!mark && /texture|grain|noise/i.test(tail)) mark = marks.seed;
  return (
    <svg className={'parameter-glyph ' + className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {portrait && !/eyeSize|eyeWidth|eyeHeight|irisScale|nose|lip|upperLip|lowerLip|neck|shoulders|arms|waist|hips|leg|height|headSize/.test(portraitId) && (
        <path opacity=".2" d="M5 10c0-5 3-8 7-8s7 3 7 8c0 7-4 12-7 12S5 17 5 10Z" />
      )}
      {mark ?? marks.amount}
    </svg>
  );
}
