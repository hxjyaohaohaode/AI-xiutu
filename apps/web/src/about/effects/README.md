# About motion components

These components adapt selected free React Bits source to this application's paper, ink and orange visual language. They add no dependencies. The exact upstream license is retained in [LICENSE.react-bits.md](LICENSE.react-bits.md); this is product integration, not a redistributed component pack.

## Integration

```tsx
import { HoverPreview, PointerRibbons, ScrollReveal } from './effects';

<section className="product-hero">
  <PointerRibbons tone="ink" />
  <div className="product-hero__content">
    <ScrollReveal as="h2" mode="scrub" splitWords>
      The image, exactly as you imagine it.
    </ScrollReveal>
    <HoverPreview data-pointer-protect>
      <img src="/about/studio.webp" alt="Actual editing workspace" />
    </HoverPreview>
  </div>
</section>
```

The hero needs `position:relative; isolation:isolate`; content needs `position:relative; z-index:1`. `PointerRibbons` occupies z-index 0 and never receives pointer input itself. Put `data-pointer-protect` on a photo/demo container to suppress traces when the pointer is over it; buttons, inputs and images are protected automatically. The trace is decorative and has no input or analytics state.

`HoverPreview` tilts a presentation image at most 4°. Do not wrap an actual editing canvas or precision control with it. It inherits the dimensions of its content and does not make noninteractive content focusable; a link or button inside gets the same active light on keyboard focus. It never requests gyroscope access.

`ScrollReveal` supports native document scroll only. `enter` reveals once; `scrub` follows native scroll position. It does not capture wheel/touch, add a nested scroller, pin content, or create a mandatory click. `splitWords` is only for plain text and preserves CJK segmentation, punctuation and whitespace. Actual input controls become fully visible as soon as focus enters. Photo/control pixels are not blurred.

## Runtime bounds

- Pointer trail: 3 spring chains × 42 points; fixed 1/120-second integration, maximum frame delta 50ms.
- Canvas backing store: DPR at most 1.75 and longest dimension at most 1,920 pixels.
- No permanent animation loop: the pointer trail fades and stops after settling; the hover spring stops at rest; scroll work is scheduled only by scrolling or an unfinished reveal.
- IntersectionObserver and document visibility suspend decorative work. ResizeObserver keeps geometry current. Listeners, observers and animation frames are removed on unmount.
- Coarse pointers use static artwork. Reduced motion shows normal readable content and the static trace motif; no cursor trail or tilt.
- Failure to create Canvas 2D leaves the SVG artwork visible; no WebGL dependency is introduced.

## Upstream source reviewed

| Adaptation | Source | Observed source blob |
| --- | --- | --- |
| PointerRibbons: seeded spring chain, fixed timestep, lens width profile | [Ribbons.tsx](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Animations/Ribbons/Ribbons.tsx) | `cd81e4e60726ca8d974b42e6ce251d7c6c5f2c83` |
| HoverPreview: normalized pointer geometry and damped spring settling | [TiltedCard.tsx](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Components/TiltedCard/TiltedCard.tsx) | `e076c933bef0aa52f484505eb0e31c7d0e930b96` |
| ScrollReveal: staggered piece progression, opacity and lift | [ScrollReveal.tsx](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/TextAnimations/ScrollReveal/ScrollReveal.tsx) | `109e2ccb80c0e9608420a4e501342e0ebea9745a` |
| Reference study, no copied module | [Threads.tsx](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Backgrounds/Threads/Threads.tsx), [FlowingMenu.tsx](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Components/FlowingMenu/FlowingMenu.tsx) | `adf650d1795cf053356be7d213d01695ce3c1597`, `2759ee5ca7cae2b720c0b80a0f9ccdaab83835ae` |

The Canvas 2D renderer, product palette, idle scheduling, protected input/photograph areas, scroll geometry and native observers are application-specific adaptations. The full upstream WebGL and GSAP implementations were studied, not bundled. Browser observations, including rendering limits, are recorded in [REFERENCE_STUDY.md](REFERENCE_STUDY.md).
