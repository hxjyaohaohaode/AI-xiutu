# Continuous product overview

This page replaces the previous tabbed tour, generated promotional artwork, simulated conversations and accordion FAQ. All essential material stays in document order and remains visible without motion. The main action opens the real local studio.

## Public source adaptation

- React Bits [ScrollExpand](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Animations/ScrollExpand/ScrollExpand.tsx): bounded native scroll progress, frame expansion, requestAnimationFrame scheduling, ResizeObserver cleanup and reduced-motion handling. Implemented in useOverviewMotion.ts. Only frame padding changes; screenshots are not cropped or supplemented with invented controls.
- React Bits [AnimatedContent](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Animations/AnimatedContent/AnimatedContent.tsx): restrained entry translation. Our adaptation uses native document scrolling, never opacity-gates content, never traps or reassigns wheel events, and adds no GSAP dependency.
- React Bits [ScrollReveal](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/TextAnimations/ScrollReveal/ScrollReveal.tsx): examined for text progress. Word-by-word blur was intentionally omitted so product copy remains immediately readable.

React Bits copyright and MIT + Commons Clause terms are retained in effects/LICENSE.react-bits.md. No Pro component source was used.

## Product imagery

Only captures of the actual application belong in ProductScreen. No generated promotional art is imported. The six named captures each have a matching language variant. Current screenshot provenance and capture revision must be recorded alongside public/about assets. Until the new capture task has completed, those files retain their earlier real-application capture revision; their existence is not evidence of this redesign passing browser review.

## Scope and verification

Relevant feature matrix areas: R06 tool navigation and touch controls, C08 responsive layouts, C09 About; screenshots explain supported editing workflows without claiming the matrix's unsupported capabilities. Source-only construction and type checking cannot establish screenshot accuracy, layout quality, reduced-motion behaviour or cross-device success. Verify these against the integrated revision before declaring acceptance.

## Workspace comparison

`components/CompareReveal.tsx` implements the requested curved comparison boundary with an original SVG clip path and a bounded damped spring. Only the edge responds to drag speed; the two real RGBA image planes remain stationary in the same fitted rectangle. Native range keyboard control, equal-dimension gating and reduced-motion rendering remain. Its six brief particle marks are decorative and never represent processing progress. This source is maintained directly in the product repository.
