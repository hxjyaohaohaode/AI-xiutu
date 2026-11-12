# Editor component references

This editor implements its own controlled inputs, recipe transactions, accessibility,
and portrait-specific navigation. The following source-available React Bits components
were inspected while rebuilding the parameter controls.

| Reference source | Applied here | Behavior |
| --- | --- | --- |
| [WakeSlider](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Micro/WakeSlider/WakeSlider.tsx) | PrecisionRange.tsx; precision-studio.css | A cosine-squared falloff raises nearby decorative ruler ticks during direct manipulation. The actual range value remains native and exact. |
| [RubberSegment](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Micro/RubberSegment/RubberSegment.tsx) | ParameterShelf.tsx; precision-studio.css | The active disc is measured from the selected icon slot and moves using the referenced easing curve. ResizeObserver keeps its geometry aligned to the rail. |
| [ElasticSlider](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Components/ElasticSlider/ElasticSlider.tsx) | PrecisionRange.tsx; precision-studio.css | The visual track, neutral fill origin, explicit bounds, and thumb geometry informed the layout. Elastic overshoot is omitted because image-editing values must remain within their recipe bounds. |

The icons in ParameterGlyph.tsx are drawn for this editor and selected by stable
parameter identifiers. They are not generated images. The native range retains
keyboard input, exact numeric entry, reset, cancel, and a single committed
transaction per gesture. Reduced-motion preferences disable the selection and
tick transitions.

React Bits is copyright (c) 2026 David Haz. Its MIT + Commons Clause license
is included at [../about/effects/LICENSE.react-bits.md](../about/effects/LICENSE.react-bits.md).
The references are used within this application, not distributed as a separate
component product.
