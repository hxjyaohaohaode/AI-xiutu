import React, { type ReactNode } from 'react';

// Feature silhouettes are drawn directly on a 24-unit grid. The treatment mark
// changes with each parameter; no portrait value is represented by a generic face.
const eye = <path d="M3 12q9-8 18 0-9 8-18 0Z" />;
const lips = <path d="M3 12q5-5 9-2 4-3 9 2-9 9-18 0Zm0 0h18" />;
const nose = <path d="m10 3-3 12q5 4 10 0L14 3M9 16h6" />;
const face = <path d="M5 8a7 7 0 0 1 14 0c0 7-3 12-7 14C8 20 5 15 5 8Z" />;
const portraitMarks: Record<string, ReactNode> = {
  smooth: (
    <>
      <path d="M5 4c-1 8 2 15 7 18 3-2 5-5 6-9M8 11q4-3 8 0M9 15q3-2 6 0" />
    </>
  ),
  wrinkles: (
    <>
      <path d="M4 8q4-3 8 0t8 0M4 12q4-3 8 0t8 0M6 17q3-2 6 0t6 0" />
    </>
  ),
  texture: (
    <>
      <path d="M4 7V4h3m10 0h3v3M4 17v3h3m10 0h3v-3" />
      <g fill="currentColor" stroke="none">
        <circle cx="8" cy="9" r="1" />
        <circle cx="15" cy="8" r="1.2" />
        <circle cx="12" cy="13" r="1.3" />
        <circle cx="7" cy="16" r="1.1" />
        <circle cx="17" cy="17" r="1" />
      </g>
    </>
  ),
  skinLight: (
    <>
      {face}
      <path d="M12 3v18M12 4c4 0 6 4 6 7 0 4-3 8-6 10Z" fill="currentColor" fillOpacity=".15" />
    </>
  ),
  even: (
    <>
      <path d="M5 4c-1 8 2 15 7 18 5-3 8-10 7-18M8 9h8M8 13h8m-6 4h4" />
    </>
  ),
  skinShine: (
    <>
      <path d="m10 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" />
      <path d="m16 18 3 3 3-3m-3-5v8" />
    </>
  ),
  skinBlemish: (
    <>
      <path d="M4 4v6c0 6 3 10 8 12 3-2 5-4 6-7" />
      <circle cx="9" cy="13" r="1.8" />
      <circle cx="14" cy="17" r="1" fill="currentColor" />
      <path d="m15 4 5 5m0-5-5 5" />
    </>
  ),
  skinColorSpot: (
    <>
      <path d="M4 8c2-3 6-2 7 1 2 4-2 7-5 5S2 11 4 8ZM14 14c2-2 6-1 6 2s-5 5-6 2Z" />
      <path d="M18 3v6m-3-3h6" />
    </>
  ),
  skinWarmth: (
    <>
      <path d="M8 5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0ZM11 8v10" />
      <path d="M18 5h4m-4 4h3" />
    </>
  ),
  complexion: (
    <>
      <path d="M5 5v6c0 5 3 9 7 11 4-2 7-6 7-11V5" />
      <path d="M6 12q3-2 4 1m4 0q1-3 4-1m-8 6h4" />
    </>
  ),
  underEye: (
    <>
      <path d="M3 9q4 5 8 0m2 0q4 5 8 0M4 14q3 3 6 0m4 0q3 3 6 0" />
      <path d="M6 18h3m6 0h3" opacity=".45" />
    </>
  ),
  eyeLight: (
    <>
      {eye}
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v3m-1 15h2M3 4l2 2m14 0 2-2" />
    </>
  ),
  browDetail: (
    <>
      <path d="m3 11 5-3 4 1m1 0 3-1 5 3M5 9l1-3m3 2 1-3m5 3 1-3m3 4 1-3M5 16q3-2 5 0m4 0q2-2 5 0" />
    </>
  ),
  teethTone: (
    <>
      <path d="M4 8q8 4 16 0v5c0 6-16 6-16 0ZM4 12h16m-12-2v7m4-6v7m4-8v7" />
      <path d="M19 2v4m-2-2h4" />
    </>
  ),
  nostrilTone: (
    <>
      {nose}
      <path d="M7.5 17h2m5 0h2" strokeWidth="2" />
    </>
  ),
  hairline: <path d="M4 19V12a8 8 0 0 1 16 0v7M4 13q5 1 8-4 3 5 8 4" />,
  hairVolume: <path d="M4 19v-5a8 8 0 0 1 16 0v5M12 10V2m-3 3 3-3 3 3M6 17q2-5 6-5t6 5" />,
  earSize: <path d="M5 11a7 7 0 1 1 12 5c-2 2-2 5-5 5-2 0-3-1-3-3m0-6a3.5 3.5 0 1 1 6 2.5l-2 2" />,
  pupilSize: (
    <>
      {eye}
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    </>
  ),
  meshLight: (
    <>
      <path d="m12 3-7 5 2 10 5 4 5-4 2-10ZM5 8l7 5 7-5M7 18l5-5 5 5M12 3v19" />
    </>
  ),
  sculpt: (
    <>
      <path d="M6 4v8q0 7 6 10 6-3 6-10V4M9 8l-1 7 4 3 4-3-1-7M12 5v13" />
    </>
  ),
  faceSlim: (
    <>
      <path d="M8 3v9q0 6 4 10 4-4 4-10V3M2 9l3 3-3 3m20-6-3 3 3 3" />
    </>
  ),
  faceSmall: (
    <>
      <ellipse cx="12" cy="12" rx="4.5" ry="6" />
      <path d="m3 3 4 4m-4 0h4V3m14 0-4 4m0-4v4h4M3 21l4-4m-4 0h4v4m14 0-4-4m0 4v-4h4" />
    </>
  ),
  faceNarrow: (
    <>
      <path d="M9 3C4 12 8 20 12 22c4-2 8-10 3-19M2 12h5m-2-2 2 2-2 2m17-2h-5m2-2-2 2 2 2" />
    </>
  ),
  vFace: (
    <>
      <path d="M5 4v7q0 7 7 11 7-4 7-11V4M7 12l5 7 5-7" />
      <path d="M2 16h4m12 0h4" />
    </>
  ),
  temples: (
    <>
      <path d="M7 5q5-4 10 0M6 7v6m12-6v6M8 17l4 5 4-5M2 8l3 2-3 2m20-4-3 2 3 2" />
    </>
  ),
  cheekbones: (
    <>
      <path d="M5 4v7l3 6 4 5 4-5 3-6V4M5 12l4-2 2 3m2 0 2-3 4 2" />
    </>
  ),
  jaw: (
    <>
      <path d="M5 3v11l3 5 4 3 4-3 3-5V3M2 16h5m-2-2 2 2-2 2m17-2h-5m2-2-2 2 2 2" />
    </>
  ),
  chin: (
    <>
      <path d="M5 4v8q0 5 7 7 7-2 7-7V4M12 14v8m-3-3 3 3 3-3" />
    </>
  ),
  forehead: (
    <>
      <path d="M5 12V9a7 7 0 0 1 14 0v3M7 10h10M12 12v9m-3-3 3 3 3-3" />
    </>
  ),
  eyeSize: (
    <>
      {eye}
      <circle cx="12" cy="12" r="3" />
      <path d="M3 5V2h4m10 0h4v3M3 19v3h4m10 0h4v-3" />
    </>
  ),
  eyeSpacing: (
    <>
      <path d="M2 14q4-5 8 0-4 5-8 0m12 0q4-5 8 0-4 5-8 0M8 5h8m-6-2L8 5l2 2m4-4 2 2-2 2" />
    </>
  ),
  eyeRotate: (
    <>
      <path d="M3 14q4-6 8-2-2 5-8 2m10-2q4-4 8 2-6 3-8-2M3 7q3-5 7-3m0-2v3H7m14 2q-3-5-7-3m0-2v3h3" />
    </>
  ),
  eyeWidth: (
    <>
      {eye}
      <circle cx="12" cy="12" r="2.5" />
      <path d="M3 4h18M6 2 3 4l3 2m12-4 3 2-3 2" />
    </>
  ),
  eyeHeight: (
    <>
      <path d="M2 12q7-8 14 0-7 8-14 0Z" />
      <circle cx="9" cy="12" r="2.5" />
      <path d="M21 3v18m-2-16 2-2 2 2m-4 14 2 2 2-2" />
    </>
  ),
  lowerLid: (
    <>
      <path d="M3 10q9-8 18 0" opacity=".4" />
      <path d="M3 12q9 8 18 0M12 17v5m-3-3 3 3 3-3" />
    </>
  ),
  irisScale: (
    <>
      {eye}
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  noseWidth: (
    <>
      {nose}
      <path d="M5 21h14m-12-2-2 2 2 2m10-4 2 2-2 2" />
    </>
  ),
  noseTip: (
    <>
      {nose}
      <circle cx="12" cy="14" r="2.5" />
      <path d="M20 13v8m-2-2 2 2 2-2" />
    </>
  ),
  noseLength: (
    <>
      <path d="m9 3-3 15q5 4 10 0L13 3M20 4v16m-2-14 2-2 2 2m-4 12 2 2 2-2" />
    </>
  ),
  lipSize: (
    <>
      {lips}
      <path d="M3 6V3h4m10 0h4v3M3 18v3h4m10 0h4v-3" />
    </>
  ),
  lipWidth: (
    <>
      {lips}
      <path d="M3 4h18M6 2 3 4l3 2m12-4 3 2-3 2" />
    </>
  ),
  upperLip: (
    <>
      {lips}
      <path d="M3 12q5-5 9-2 4-3 9 2Z" fill="currentColor" fillOpacity=".2" />
      <path d="M12 7V2m-2 2 2-2 2 2" />
    </>
  ),
  lowerLip: (
    <>
      {lips}
      <path d="M3 12h18q-9 9-18 0Z" fill="currentColor" fillOpacity=".2" />
      <path d="M12 18v4m-2-2 2 2 2-2" />
    </>
  ),
  smile: (
    <>
      <path d="M4 10q8 13 16 0M2 8l3-3 3 3m-3-3v8m11-5 3-3 3 3m-3-3v8" />
    </>
  ),
  browThickness: (
    <>
      <path d="m3 11 5-3 4 1m1 0 3-1 5 3M3 15l5-3 4 1m1 0 3-1 5 3M12 2v5m-2-3 2-2 2 2" />
    </>
  ),
  browPosition: (
    <>
      <path d="m3 13 5-3 4 1m1 0 3-1 5 3M7 3v5m-2-3 2-2 2 2m8-2v5m-2-3 2-2 2 2M5 18q3-2 5 0m4 0q2-2 5 0" />
    </>
  ),
  headSize: (
    <>
      <ellipse cx="12" cy="7" rx="4" ry="5" />
      <path d="M3 22v-3q0-5 6-5m6 0q6 0 6 5v3M2 3h3v4m17-4h-3v4" />
    </>
  ),
  neckLength: (
    <>
      <path d="M7 3v10l-4 3v6m14-19v10l4 3v6M12 5v16m-2-14 2-2 2 2m-4 12 2 2 2-2" />
    </>
  ),
  neckWidth: (
    <>
      <path d="M8 3v10l-5 3v6m13-19v10l5 3v6M5 9h14m-12-2L5 9l2 2m10-4 2 2-2 2" />
    </>
  ),
  shoulders: (
    <>
      <path d="M9 3v5l-6 3v10m12-18v5l6 3v10M3 16h18m-15-3-3 3 3 3m12-6 3 3-3 3" />
    </>
  ),
  arms: (
    <>
      <path d="m8 4-5 3-1 12 3 1L8 8m8-4 5 3 1 12-3 1-3-12M8 5v17m8-17v17" />
    </>
  ),
  waist: (
    <>
      <path d="M6 3q5 9 0 19m12-19q-5 9 0 19M2 12h6m-2-2 2 2-2 2m16-2h-6m2-2-2 2 2 2" />
    </>
  ),
  hips: (
    <>
      <path d="M8 3v6q-5 6-3 13m11-19v6q5 6 3 13M2 15h5m-2-2 2 2-2 2m17-2h-5m2-2-2 2 2 2" />
    </>
  ),
  legLength: (
    <>
      <path d="M7 3 6 22h4l2-14 2 14h4L17 3M2 4v17m-1-15 1-2 2 2m-3 13 1 2 2-2" />
    </>
  ),
  legs: (
    <>
      <path d="M7 3 6 22h4l2-14 2 14h4L17 3M2 13h5m-2-2 2 2-2 2m17-2h-5m2-2-2 2 2 2" />
    </>
  ),
  height: (
    <>
      <circle cx="10" cy="4" r="2" />
      <path d="M5 8h10l-1 7v7h-3l-1-6-1 6H6v-7ZM21 2v20m-2-18 2-2 2 2m-4 16 2 2 2-2" />
    </>
  ),
  lipstick: (
    <>
      {lips}
      <path d="M3 12h18q-9 9-18 0Z" fill="currentColor" fillOpacity=".3" />
      <path d="m7 10 2-1m6 0 2 1" />
    </>
  ),
  eyeshadow: (
    <>
      <path d="M3 12q4-6 8 0m2 0q4-6 8 0M3 7q4-5 8 0m2 0q4-5 8 0" />
      <path
        d="M3 12q4-6 8 0V7q-4-5-8 0Zm10 0q4-6 8 0V7q-4-5-8 0Z"
        fill="currentColor"
        fillOpacity=".12"
      />
    </>
  ),
  blush: (
    <>
      <path d="M5 3v6q0 9 7 13 7-4 7-13V3" />
      <ellipse cx="7" cy="14" rx="3" ry="2.5" fill="currentColor" fillOpacity=".15" />
      <ellipse cx="17" cy="14" rx="3" ry="2.5" fill="currentColor" fillOpacity=".15" />
    </>
  ),
  contour: (
    <>
      <path d="M5 4v7q0 7 7 11 7-4 7-11V4M8 9l-1 5 4 5m5-10 1 5-4 5" />
      <path
        d="M5 11q0 7 7 11l-5-8 1-5Zm14 0q0 7-7 11l5-8-1-5Z"
        fill="currentColor"
        fillOpacity=".15"
      />
    </>
  ),
  highlight: (
    <>
      <path d="M12 4v10M5 11l4 2m10-2-4 2m-5 6h4M19 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" />
    </>
  ),
  browColor: (
    <>
      <path d="m3 10 5-3 4 1m1 0 3-1 5 3M3 13l5-3 4 1m1 0 3-1 5 3M15 19l5-5 2 2-5 5-3 1Z" />
    </>
  ),
  underEyeMakeup: (
    <>
      <path d="M3 9q4 5 8 0m2 0q4 5 8 0M4 14q3 3 6 0m4 0q3 3 6 0M5 18h5m4 0h5" />
      <path d="M5 18h5m4 0h5" strokeWidth="2.8" />
    </>
  ),
};
const marks: Record<string, ReactNode> = {
  exposure: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M6 9h6M9 6v6m4 4h5" />
    </>
  ),
  brightness: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
    </>
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
    </>
  ),
  highlights: (
    <>
      <path d="M4 17a8 8 0 0 1 16 0M12 2v4M3 7l3 3m15-3-3 3M2 21h20" />
      <path d="M8 17a4 4 0 0 1 8 0" />
    </>
  ),
  shadows: (
    <>
      <path d="M4 6a8 8 0 0 0 16 0M2 2h20M5 11l9 9m-9-4 5 5m1-10 7 7" />
    </>
  ),
  whites: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M3 3h3M3 3v3m15 15h3m0-3v3" />
    </>
  ),
  blacks: (
    <>
      <circle cx="12" cy="12" r="7" fill="currentColor" />
      <path d="M3 3h3M3 3v3m15 15h3m0-3v3" />
    </>
  ),
  temperature: (
    <>
      <path d="M8 5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0ZM11 8v10M18 5h4m-4 4h3" />
    </>
  ),
  tint: (
    <>
      <path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z" />
      <path d="M12 5v16m0-10 7 4" />
    </>
  ),
  saturation: (
    <>
      <path d="M8 3S2 10 2 14a6 6 0 0 0 12 0C14 10 8 3 8 3Z" />
      <path d="M17 8s-5 6-5 9a5 5 0 0 0 10 0c0-3-5-9-5-9Z" fill="currentColor" fillOpacity=".25" />
    </>
  ),
  vibrance: (
    <>
      <path d="m12 3 3 6 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z" />
      <path d="M12 9v6m-3-3h6" />
    </>
  ),
  sharpness: (
    <>
      <path d="m3 21 9-18 9 18ZM12 3v18" />
      <path d="M12 3v18h9Z" fill="currentColor" fillOpacity=".16" />
    </>
  ),
  soften: (
    <>
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="9" strokeDasharray="1 4" />
    </>
  ),
  clarity: (
    <>
      <path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6M7 16l4-8 6 8Z" />
    </>
  ),
  hue: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m12 4 7 12H5ZM12 4v8m-7 4 7-4 7 4" />
    </>
  ),
  hueWidth: (
    <>
      <path d="M6 6a8 8 0 1 0 12 0M12 12 8 3m4 9 4-9M8 3h8" />
      <path d="M12 12 8 3h8Z" fill="currentColor" fillOpacity=".2" />
    </>
  ),
  luminance: (
    <>
      <path d="M3 20h18M4 16l5-7 4 4 4-10 3 13" />
      <circle cx="17" cy="4" r="1.5" />
    </>
  ),
  balance: <path d="M12 3v18M3 6h18M6 6l-4 8h8Zm12 0-4 8h8ZM7 21h10" />,
  inputBlack: (
    <>
      <path d="M3 18h18M4 15V9m4 6V5m4 10V8m4 7V3m4 12v-4" />
      <path d="m3 22 3-4 3 4Z" fill="currentColor" />
    </>
  ),
  inputWhite: (
    <>
      <path d="M3 18h18M4 15V9m4 6V5m4 10V8m4 7V3m4 12v-4" />
      <path d="m15 22 3-4 3 4Z" />
    </>
  ),
  gamma: <path d="M3 3v18h18M4 20C17 20 7 4 21 4" />,
  outputBlack: (
    <>
      <path d="M3 16h18M3 5v8m6-8v8m6-8v8m6-8v8" />
      <path d="m3 22 3-4 3 4Z" fill="currentColor" />
    </>
  ),
  outputWhite: (
    <>
      <path d="M3 16h18M3 5v8m6-8v8m6-8v8m6-8v8" />
      <path d="m15 22 3-4 3 4Z" />
    </>
  ),
  monochrome: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16M3 15l6-6 8 11" />
      <path d="M12 4h9v16h-9Z" fill="currentColor" fillOpacity=".16" />
    </>
  ),
  fade: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m4 17 13-13m-7 17 11-11" opacity=".45" />
    </>
  ),
  width: <path d="M3 8V4h18v4M3 16v4h18v-4M2 12h20m-17-3-3 3 3 3m14-6 3 3-3 3" />,
  height: <path d="M8 3H4v18h4M16 3h4v18h-4M12 2v20M9 5l3-3 3 3m-6 14 3 3 3-3" />,
  x: <path d="M5 3v18m0-9h17m-4-3 4 3-4 3M2 5h6m-6 14h6" />,
  y: <path d="M3 5h18m-9 0v17m-3-4 3 4 3-4M5 2v6m14-6v6" />,
  rotation: (
    <>
      <path d="M5 7a8 8 0 1 1-1 9M2 7h5V2" />
      <path d="m10 9 5 1-1 5-5-1Z" />
    </>
  ),
  angle: <path d="M3 20h18L5 4v16m6 0a6 6 0 0 0-2-5" />,
  perspectiveX: <path d="m4 6 16-3v18L4 18Zm8-2v16M4 12h16" />,
  perspectiveY: <path d="m6 4-3 16h18L18 4Zm-2 8h16M12 4v16" />,
  skewX: (
    <>
      <path d="m8 4 13 0-5 16H3Z" />
      <path d="M4 2h6m4 20h6" />
    </>
  ),
  skewY: (
    <>
      <path d="m4 8 16-5v13L4 21Z" />
      <path d="M2 4v6m20 4v6" />
    </>
  ),
  paintColor: <path d="M12 3c-2 4-7 7.6-7 12a7 7 0 0 0 14 0c0-4.4-5-8-7-12Zm-4 12a4 4 0 0 0 4 4" />,
  blend: (
    <>
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
      <path d="M12 7a6 6 0 0 1 0 10 6 6 0 0 1 0-10Z" fill="currentColor" fillOpacity=".2" />
    </>
  ),
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />,
  positionX: <path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4M12 6v2m0 8v2" />,
  positionY: <path d="M12 3v18M8 7l4-4 4 4m-8 10 4 4 4-4M6 12h2m8 0h2" />,
  opacity: (
    <>
      <rect x="3" y="3" width="13" height="13" rx="2" />
      <rect x="8" y="8" width="13" height="13" rx="2" fill="currentColor" fillOpacity=".18" />
    </>
  ),
  radius: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12h8m-3-3 3 3-3 3" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  radiusY: (
    <>
      <ellipse cx="12" cy="12" rx="7" ry="9" />
      <path d="M12 12v8m-3-3 3 3 3-3" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  diameter: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M6 9l-3 3 3 3m12-6 3 3-3 3" />
    </>
  ),
  feather: (
    <>
      <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity=".16" />
      <circle cx="12" cy="12" r="9" strokeDasharray="2 3" />
    </>
  ),
  amount: <path d="M4 20V12m8 8V4m8 16V8M2 12h4m4-8h4m4 4h4" />,
  size: <path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6M3 3l6 6m6 6 6 6" />,
  seed: (
    <g fill="currentColor" stroke="none">
      <circle cx="6" cy="7" r="1.4" />
      <circle cx="17" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="5" cy="18" r="1.8" />
      <circle cx="19" cy="17" r="1.4" />
    </g>
  ),
  iterations: <path d="M4 9a8 8 0 0 1 14-4l3 3m-5 0h5V3M20 15A8 8 0 0 1 6 19l-3-3m5 0H3v5" />,
  flow: (
    <>
      <path d="M4 5h6m-6 7h10M4 19h16" />
      <circle cx="19" cy="5" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  strength: (
    <>
      <path d="M3 19h18M5 15V9m7 6V6m7 9V3M3 9h4m3-3h4m3-3h4" />
    </>
  ),
  vignette: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <ellipse cx="12" cy="12" rx="6" ry="4.5" />
      <path d="M4 5h4M4 5v4m12-4h4v4M4 15v4h4m8 0h4v-4" opacity=".45" />
    </>
  ),
  denoiseLuminance: (
    <>
      <path d="M3 7h18M3 17h18m-14-4 3-3 4 4 3-3" />
      <circle cx="7" cy="4" r="1" fill="currentColor" />
      <circle cx="17" cy="20" r="1" fill="currentColor" />
    </>
  ),
  denoiseChroma: (
    <>
      <path d="M3 6h18M3 18h18" />
      <circle cx="9" cy="12" r="4" />
      <circle cx="15" cy="12" r="4" opacity=".5" />
    </>
  ),
  aberrationRed: (
    <>
      <circle cx="10" cy="12" r="7" />
      <path d="M14 4a8 8 0 0 1 0 16M4 12h10m-3-3 3 3-3 3" />
    </>
  ),
  aberrationBlue: (
    <>
      <circle cx="14" cy="12" r="7" />
      <path d="M10 4a8 8 0 0 0 0 16M20 12H10m3-3-3 3 3 3" />
    </>
  ),
  saturationMin: (
    <>
      <path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13ZM8 16h8" />
    </>
  ),
  saturationMax: (
    <>
      <path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13ZM8 16h8m-4-4v8" />
    </>
  ),
  luminanceMin: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M8 12h8M12 1v2m0 18v2M1 12h2m18 0h2" />
    </>
  ),
  luminanceMax: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M8 12h8m-4-4v8M12 1v2m0 18v2M1 12h2m18 0h2" />
    </>
  ),
};
const aliases: Record<string, string> = {
  lightness: 'luminance',
  texture: 'seed',
  grain: 'seed',
  rotationDegrees: 'rotation',
  angleDegrees: 'angle',
  scaleX: 'width',
  scaleY: 'height',
  translateX: 'x',
  translateY: 'y',
  centerX: 'x',
  centerY: 'y',
  aberrationCenterX: 'x',
  aberrationCenterY: 'y',
  radiusX: 'radius',
  searchRadius: 'radius',
  patchRadius: 'radius',
  startx: 'x',
  starty: 'y',
  endx: 'x',
  endy: 'y',
  'donor-x': 'x',
  'donor-y': 'y',
  'layer-opacity': 'opacity',
  smoothing: 'portrait:smooth',
  uniformity: 'portrait:even',
  shine: 'portrait:skinShine',
  speckle: 'portrait:skinBlemish',
  fineLines: 'portrait:wrinkles',
  chromaSpots: 'portrait:skinColorSpot',
};

/** Source identifiers, never translated labels, determine the feature drawing. */
export function parameterGlyphKey(id: string): string {
  if (id.startsWith('portrait:') && portraitMarks[id.slice(9)]) return id;
  if (/^projective-\d-[xy]$/.test(id)) return id;
  if (id === 'effects.vignette.amount') return 'vignette';
  if (id === 'effects.grain.amount') return 'seed';
  const tail = id.split('.').at(-1) ?? id;
  return aliases[tail] ?? (marks[tail] ? tail : 'amount');
}
export function ParameterGlyph({ id, className = '' }: { id: string; className?: string }) {
  const key = parameterGlyphKey(id);
  let mark = key.startsWith('portrait:') ? portraitMarks[key.slice(9)] : marks[key];
  if (key.startsWith('projective-')) {
    const corner = Number(key.split('-')[1]);
    const x = corner === 0 || corner === 3 ? 5 : 19;
    const y = corner < 2 ? 5 : 19;
    mark = (
      <>
        <path d="M5 5h14v14H5Z" opacity=".35" />
        <circle cx={x} cy={y} r="2.3" fill="currentColor" />
        {key.endsWith('x') ? (
          <path d="M3 12h18m-3-3 3 3-3 3" />
        ) : (
          <path d="M12 3v18m-3-3 3 3 3-3" />
        )}
      </>
    );
  }
  return (
    <svg
      className={`parameter-glyph ${className}`}
      data-glyph={key}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {mark ?? marks.amount}
    </svg>
  );
}
