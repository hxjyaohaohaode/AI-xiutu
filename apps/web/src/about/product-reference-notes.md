# Continuous product overview

This page replaces the previous tabbed tour, generated promotional artwork, simulated conversations and accordion FAQ. All essential material stays in document order and remains visible without motion. The main action opens the real local studio.

## Public source adaptation

- Reference 31, React Bits [ScrollExpand](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Animations/ScrollExpand/ScrollExpand.tsx): bounded native scroll progress, whole-frame expansion and radius change. `useOverviewMotion.ts` uses the shared resting spring, native scroll/resize observers, and cleanup. The desktop scale is 0.84–1; phone scale is 0.97–1. Actual screenshot pixels keep their aspect ratio and receive no invented controls.
- Reference 35, React Bits [AnimatedContent](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Animations/AnimatedContent/AnimatedContent.tsx): one restrained entry translation per visible content group, 24px on desktop and 14px on phone. The adaptation shares the resting spring with frame expansion, never opacity-gates content, never traps or reassigns wheel events, and adds no GSAP dependency. Changing reduced-motion preference resets all transforms immediately.
- React Bits [ScrollReveal](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/TextAnimations/ScrollReveal/ScrollReveal.tsx): examined for text progress. Word-by-word blur was intentionally omitted so product copy remains immediately readable.

React Bits copyright and MIT + Commons Clause terms are retained in effects/LICENSE.react-bits.md. No Pro component source was used.

## Product imagery

Only captures of the actual application belong in `ProductScreen`. No generated promotional art is imported. The review defines 17 views in each of Simplified Chinese, Traditional Chinese and English: desktop workspace, local editing, portrait, actual drawing layers, tablet, phone, library, collaboration, assistant and delivery, plus seven separate phone views. A native `picture` chooses the matching phone capture; it does not shrink a desktop screenshot into a phone frame. Collaboration captures use a disposable project with real API-created comments and three task states. Assistant captures explicitly show the real unconfigured service state; they do not invent an AI result. Drawing captures use the actual canvas, image import, text and layer tools.

The exact tested commit, source photographs, viewport, locale and SHA-256 of each published image are recorded in `public/about/source-manifest.json`. The browser workflow publishes this allowlisted payload only after its full verification job succeeds and the source branch still matches the tested commit. Failed image loads retain the image's accessible description and a real reload action. Manual visual review and the distinction between automated checks, reviewed screenshots and upstream evidence belong in `docs/design/verification/system-redesign/README.md` and the 111-item feature review; a declared capture is not a passing capture.

## Scope and verification

Relevant feature matrix areas: R06 tool navigation and touch controls, C08 responsive layouts, C09 About; screenshots explain supported editing workflows without claiming the matrix's unsupported capabilities. Source-only construction and type checking cannot establish screenshot accuracy, layout quality, reduced-motion behaviour or cross-device success. Verify these against the integrated revision before declaring acceptance.

## Workspace comparison

`components/CompareReveal.tsx` implements the requested curved comparison boundary with an original SVG clip path and a bounded damped spring. Only the edge responds to drag speed; the two real RGBA image planes remain stationary in the same fitted rectangle. Native range keyboard control, equal-dimension gating and reduced-motion rendering remain. Its six brief particle marks are decorative and never represent processing progress. This source is maintained directly in the product repository.
