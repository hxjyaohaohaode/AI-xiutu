# Editor component sources

The application retains its own controlled values, recipe transactions, source
coordinates, capability checks, keyboard inputs, and cancellation ownership.
Presentation motion does not interpolate a recipe or delay a business action.

## Verified source snapshot

React Bits was read at commit
`9d9c687dc4f55b23539aa5417b703078047efa74`. The table links to that fixed snapshot,
not a moving main branch. All implemented mechanisms use the existing React
runtime and the shared `motion/kinetic.ts` scheduler; no Motion, GSAP, Tailwind,
or per-component animation runtime was added for the editor.

| User reference | Official source / blob | Product adaptation |
| --- | --- | --- |
| 88 Dock | [Dock.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-tailwind/Components/Dock/Dock.tsx), `0b9df424945b45f9077203df29327cf693c9a14d` | `workspace/useDockProximity.ts`: measured cosine-squared neighbours and spring return. Only icon faces move; fixed desktop and phone targets remain independent. Keyboard focus follows the same neighbourhood; touch uses a smaller single-icon response. |
| 124 Wake Slider | [WakeSlider.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-tailwind/Micro/WakeSlider/WakeSlider.tsx), `5205a6be52d705b56ca3a72fc9137fd819fdeed0` | `useWakeTicks.ts`: separately smoothed position and velocity, directional reach and amplitude, then a flat resting ruler. Native range values stay exact. |
| 127 Scrub Field | [ScrubField.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-tailwind/Micro/ScrubField/ScrubField.tsx), `4fb88e53a274da8edcae7cb09d4e52e4019a4274` | `PrecisionRange.tsx`: click for strict numeric entry; 3px mouse / 8px touch slop, 2px per increment, Shift coarse / Alt fine, bounded visual resistance. One owned gesture commits once; Escape, blur, cancel and stale source guards remain. |
| 129 Warm Tooltip | [WarmTooltip.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-tailwind/Micro/WarmTooltip/WarmTooltip.tsx), `e1c36b73b55ee220c073ee0329edaa2ad83d8f63` | `components/control-motion/WarmTooltip.tsx`: one shared travelling bubble, 400ms cold delay, immediate warm/focus opening, 80ms exit grace and 300ms warm window. Viewport collision handling and immediate Escape dismissal are application adaptations. |
| 131 Rubber Segment | [RubberSegment.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-tailwind/Micro/RubberSegment/RubberSegment.tsx), `f7bb4da03c175a39d617433cc39b4dd8968f353f` | `components/control-motion/RubberSegment.tsx`: independent measured leading/trailing springs and directional stretch, drag threshold and short velocity projection. Native buttons preserve Enter/Space; pointer cancellation does not select. Shelf/Dock indicators reuse measured spring presentation without draggable numerical values. |
| 136 Squish Switch | [SquishSwitch.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-tailwind/Micro/SquishSwitch/SquishSwitch.tsx), `c87f879681fde954fa035545dba1b84e09b56473` | `components/control-motion/SquishSwitch.tsx`: spring position, velocity squash, drag preview and one final controlled boolean. This is separate from the existing view-transition `MotionSwitch`. |
| 204 Colour palette | User-linked Uiverse page by Cobp, captured official HTML/CSS; CSS SHA-256 `ece48849ac2cc049709b05e04c242beca91321c90a80a4c85deddd9f7c05bcc4` | `components/ColorPicker.tsx` and `editor-controls.css`: neighbour faces scale 1.5 / 1.3 / 1.15 and return over 500ms. Real colour selection remains the action; the existing clipboard promise alone can report copying. The reference HTML contains no copying JavaScript. Phone faces are smaller inside separate 44px targets. |

References 99 Elastic Slider and 123 Comet Dial were source-reviewed but were not
adopted in this round: their current demos were not observed in the agreed study.
The implemented ruler is the velocity-driven 124 mechanism, not an elastic
out-of-range value or a decorative dial.

The source audit and desktop official-demo observations are separate evidence.
The coordinating reviewer observed 88, 124, 127, 129, 131, 136 and 204 before
implementation. Product browser acceptance is recorded by the integration CI and
its subsequently reviewed screenshots; source inspection and node tests do not
constitute that visual acceptance.

## Ownership, motion and licensing

`kinetic.ts` runs all moving values on one animation clock, uses bounded time
substeps, stops when settled, snaps on hidden documents and responds to dynamic
reduced-motion preference changes. Colour-face CSS disables transforms under
reduced motion. Parameter, Studio and Control glyphs are original code-native SVG
artwork on the same 24-unit grid; no generated image is used as an icon.

React Bits is copyright (c) 2026 David Haz. Its MIT + Commons Clause license is
retained at [LICENSE.react-bits.md](../about/effects/LICENSE.react-bits.md).
These mechanisms are used inside the application rather than sold as a component
product. The colour palette's separate MIT notice, copyright (c) 2026 Cobp,
is retained at [LICENSE.uiverse-204.txt](../components/control-motion/LICENSE.uiverse-204.txt).
