# About product captures

The current About overview uses assets in [review](review/). Product captures use the running browser application, with the selected photo, tool, and parameters held across the light and dark frames. Capture filenames with `-dark` represent the dark appearance. The page selects the theme, locale, and mobile source at runtime. The active captures include 22 browser views per locale (Simplified Chinese, Traditional Chinese and English) and 14 paired sketch tool details.

## Capture inputs

- The workbench views show test projects and the existing public coast, portrait and product samples. See [the photo source manifest](source-manifest.json) and [story art provenance](stories/art-sources.json).
- The local editing example uses the sample ceramic still life and three saved adjustments. The vase highlight is −22, the window exposure is +0.28 EV and the background shadow is +18. Three comments point to the saved revision. The neighboring comparison uses the V4 reference engine on the [horizontal still-life sample](review/tone-still-life.webp).
- Skin, facial features and makeup use [the public portrait](portrait.webp). The body view uses the full-length generated source below. The main sketch capture records strokes, shapes and text placed in the sketch editor. The desktop assistant image shows a real completed response.
- The voice excerpt is based on an isolated OpenAI Realtime browser session, with the browser test microphone, GPT-Realtime 2.1 Mini, Marin and a 120-second configured maximum. Its About controls replay the excerpt locally.
- The pool conversation and the exhibition-cover prompt, settings and result use the existing [request record](stories/dialogue-record.json) and [generated lighthouse](stories/generated-lighthouse.webp).

The active review captures were taken from the local working tree based on `5bfc9e3`. The historical captures outside `review/` have separate [local](stories/local-capture-provenance.json) and [signed-in](stories/signed-capture-provenance.json) records. Browser checks for the About interface are in `scripts/qa/system-redesign.browser.mjs`.

## ImageGen prompts

The following assets were made with the built-in ImageGen tool for the sketch feature row and the body editing sample. Shape placement, opacity and layer order preserve the generated alpha channel.

### [sketch-pressure.webp](review/sketch-pressure.webp)

> Use case: ui-mockup. One unlabeled square bitmap for a photo editor feature thumbnail. Draw three tapered brush strokes of different widths, straight on pale cool gray #edf0f3 blank sketch canvas, charcoal and blue ink, plus a small yellow thickness slider beneath. Graphic fills 75% of image. No type, no letters, no text, no title, no label. Center the subject, front-on 2D with restrained slate blue, charcoal, teal and warm yellow accent. The canvas is a mostly uniform cool light gray like editing software. Clean digital linework with extremely subtle texture, legible at 83 px. A single illustration, not a composite sheet or advertising poster. Absolutely no typography anywhere.

### [sketch-eraser.webp](review/sketch-eraser.webp)

> Use case: ui-mockup. Asset type: one square editorial feature illustration for the Sketch & Layers strip of the Yingjian image-editor About page. Show a direct eraser demonstration: a thick brick-red curved drawn line with an intentionally erased diagonal gap across it, faint transparent checkerboard revealed in the gap, outlined small circular eraser cursor at the gap, no text. Production art direction: cool ivory paper #f2f0e9, charcoal ink, dark blue-teal #337d86, golden yellow #e7b54b, sparing brick #b86650. Front-on, crisp, high-end restrained graphic design, faint tangible paper tooth, clear at a 90×90 thumbnail. Center the demonstrated function in the middle 74%, full bleed paper background, big shapes and very little fine print. This is a stylized isolated functional detail based on the real sketch canvas (brush strokes, vector shapes, typed layer, direct manipulation), not a full app screenshot. No generic landscape, person, device frame, decorative labels, logos, watermarks, clutter, typography except explicitly quoted.

### [sketch-shapes.webp](review/sketch-shapes.webp)

> Use case: ui-mockup. One square feature illustration for a real image editor's sketch tool strip. An elegant pale cool-gray square graph-paper swatch with three clean native editing shapes, a warm mustard rounded rectangle, a muted teal ellipse surrounded by a thin four-handle selection rectangle, and a charcoal outlined triangle, big clear geometry. Isolate all shapes on a truly transparent background, keeping approximately 10 percent clear exterior margin on all sides. The light gray work surface is a bounded material shape with rounded edges, not a background. Strong contrast at 83 px, flat front-on view, same subtle gray, warm yellow and blue palette as editing software. No lettering, no words, no logo, no watermark, no generic scenery or people.

### [sketch-type.webp](review/sketch-type.webp)

> Use case: ui-mockup. Asset type: one square editorial feature illustration for the Sketch & Layers strip of the Yingjian image-editor About page. Show a precise text-layer editing demonstration: the only text is the short verbatim headline “BLUE HOUR” in deep ink with a fine light-blue transform box and four white square handles, a compact aligned small pair of type-size and swatch icons. Production art direction: cool ivory paper #f2f0e9, charcoal ink, dark blue-teal #337d86, golden yellow #e7b54b, sparing brick #b86650. Front-on, crisp, high-end restrained graphic design, faint tangible paper tooth, clear at a 90×90 thumbnail. Center the demonstrated function in the middle 74%, full bleed paper background, big shapes and very little fine print. This is a stylized isolated functional detail based on the real sketch canvas (brush strokes, vector shapes, typed layer, direct manipulation), not a full app screenshot. No generic landscape, person, device frame, decorative labels, logos, watermarks, clutter, typography except explicitly quoted.

### [sketch-palette.webp](review/sketch-palette.webp)

> Use case: ui-mockup. One unlabeled square bitmap for a photo editor feature thumbnail. Draw a white floating color-picker surface on a pale cool gray #edf0f3 drawing canvas, five solid swatches in charcoal, sand, honey, teal, and slate blue, a saturation square and vertical hue strip, a blue stroke below indicating the selected color. No type, no letters, no text, no title, no label. Center the subject, front-on 2D with restrained slate blue, charcoal, teal and warm yellow accent. The canvas is a mostly uniform cool light gray like editing software. Clean digital linework with extremely subtle texture, legible at 83 px. A single illustration, not a composite sheet or advertising poster. Absolutely no typography anywhere.

### [sketch-image-layer.webp](review/sketch-image-layer.webp)

> Use case: ui-mockup. One unlabeled square bitmap for a photo editor feature thumbnail. Draw a centered photograph of a single translucent aqua glass cube being positioned on a flat pale cool gray #edf0f3 canvas, thin blue selection rectangle, four square corner handles and alignment guides. Clean direct manipulation and enough margin around it. No type, no letters, no text, no title, no label. Center the subject, front-on 2D with restrained slate blue, charcoal, teal and warm yellow accent. The canvas is a mostly uniform cool light gray like editing software. Clean digital linework with extremely subtle texture, legible at 83 px. A single illustration, not a composite sheet or advertising poster. Absolutely no typography anywhere.

### [sketch-opacity.webp](review/sketch-opacity.webp)

> Use case: ui-mockup. One square feature illustration for a real image editor's sketch tool strip. A small frosted pale blue-gray work surface with a honey square overlapping a translucent teal square, clearly showing the muted teal-brown overlap, and a single short unobtrusive yellow opacity slider beneath. Isolate all shapes on a truly transparent background, keeping approximately 10 percent clear exterior margin on all sides. The light gray work surface is a bounded material shape with rounded edges, not a background. Strong contrast at 83 px, flat front-on view, same subtle gray, warm yellow and blue palette as editing software. No lettering, no words, no logo, no watermark, no generic scenery or people.

### [sketch-history.webp](review/sketch-history.webp)

> Use case: ui-mockup. Asset type: one square editorial feature illustration for the Sketch & Layers strip of the Yingjian image-editor About page. Show an undo/redo demonstration: two before/after sketch thumbnails, the same small graphic in two sequential stages with an added mustard stroke only in the later stage, a thin curved undo arrow between the thumbnails. Production art direction: cool ivory paper #f2f0e9, charcoal ink, dark blue-teal #337d86, golden yellow #e7b54b, sparing brick #b86650. Front-on, crisp, high-end restrained graphic design, faint tangible paper tooth, clear at a 90×90 thumbnail. Center the demonstrated function in the middle 74%, full bleed paper background, big shapes and very little fine print. This is a stylized isolated functional detail based on the real sketch canvas (brush strokes, vector shapes, typed layer, direct manipulation), not a full app screenshot. No generic landscape, person, device frame, decorative labels, logos, watermarks, clutter, typography except explicitly quoted.

### [sketch-arrange.webp](review/sketch-arrange.webp)

> Use case: ui-mockup. One square feature illustration for a real image editor's sketch tool strip. Three slightly offset pale cool-gray sketch layer cards: charcoal hand-drawn mark on top, muted mustard geometric shape on the middle sheet, a blue-gray image crop on the bottom sheet, and a small pair of up/down arrow marks aligned beside them. Isolate all shapes on a truly transparent background, keeping approximately 10 percent clear exterior margin on all sides. The light gray work surface is a bounded material shape with rounded edges, not a background. Strong contrast at 83 px, flat front-on view, same subtle gray, warm yellow and blue palette as editing software. No lettering, no words, no logo, no watermark, no generic scenery or people.

### [sketch-reference.webp](review/sketch-reference.webp)

> Use case: ui-mockup. One unlabeled square bitmap for a photo editor feature thumbnail. Draw two equally sized windows on pale cool gray #edf0f3 paper: left a simple ink sketch of a blue arch and its reflection, right the same geometry rendered as a simple color image. A small forward arrow between them. Short visual analogy of a sketch sent as reference. No type, no letters, no text, no title, no label. Center the subject, front-on 2D with restrained slate blue, charcoal, teal and warm yellow accent. The canvas is a mostly uniform cool light gray like editing software. Clean digital linework with extremely subtle texture, legible at 83 px. A single illustration, not a composite sheet or advertising poster. Absolutely no typography anywhere.

### [portrait-body-source.webp](review/portrait-body-source.webp)

> Use case: photorealistic-natural. One new source photograph for a real browser portrait-editing demonstration. Full-body adult East Asian woman in her late twenties, standing in a real minimally styled daylight portrait studio, relaxed stance, hands and feet fully visible and slightly separated, looking at the camera, slight natural smile. Mid-tone warm gray simple jacket, neutral dark straight trousers, ivory sneakers. Full-length centered portrait with a little floor and headroom. Diffuse daylight from tall window, real skin and fabric texture, no heavy retouch, no glamour look, same restrained neutral appearance as a practical editing exercise. Warm off-white wall, mild soft shadows, no props, no graphic layout, no user interface, no words or watermark. The camera is straight on around waist height, all joints legible. Vertical 2:3 composition.

## Follow-up product review

The hero uses the Light Rays shader and a single cursor across the About overview. The current color comparison shows the same 1200 × 900 frame in both states. The adjusted version was rendered with the V4 reference engine at exposure +0.34 EV, contrast +8, highlights −22, shadows +21, vibrance +20 and temperature +8.

The portrait detail tiles are 360 × 360 compositions of the actual canvas and its matching control or palette, in light and dark. The full canvas screenshots were also retaken for each mode. Face uses a closer canvas view with eye width at 21%. Body shows the waist tool at 18%. The desktop assistant captures were retaken with the recorded answer visible and the history dialog closed. The sketch row includes 14 additional pairs captured from the real toolbars, using the selected control and its neighboring icons in each tile.

The About voice card presents a selected excerpt from the previous isolated voice call. The text and times identify the recorded request, reply and mute states. Strands renders the decorative orb in the browser and Holo Card draws its foil over the live layout.

### Generated sample photographs

These 44 images were generated individually with the built-in ImageGen tool. The wall, folder and delivery backing use separate sets of 30, 3 and 10 photographs. A further photograph is the original for the color comparison.

Shared prompt used with each scene below.

> Use case: photorealistic-natural. Generate one single landscape 4:3 editorial photograph for a real photo editing application, the Yingjian product portfolio. Natural materials, fine authentic texture and considered negative space. Restrained editorial art direction, palette of cool ash grey, slate blue, dark teal and muted warm natural colors as the scene requires. Meaningfully different subject and angle from standard nature stock. Natural or plausible practical light, full-bleed to all edges, subject readable at 180 pixels. No photo frame, labels, text, logos, watermarks, montage, UI, or decorative border. Shoot the described composition, one photographic image. Scene:

- [porcelain](review/library/porcelain.webp) · Chalk-white sculptural porcelain vessels on a pale stone slab, a diagonal late-morning window shadow and enough separation in the whites to study highlight detail. Off-white, greige and slate.
- [wet-alley](review/library/wet-alley.webp) · Wet brick passage seen straight down a narrow city street at twilight, a cyclist in a burnt ochre raincoat receding, shop windows glowing softly. Charcoal and amber with restrained blues.
- [linen](review/library/linen.webp) · Detail of three folded pieces of washed ivory and dusty-blue linen on a timber worktable, pronounced cloth weave and low angle window light. Gray, natural flax, pale slate.
- [record-shop](review/library/record-shop.webp) · A small record store seen through its dark green window frame in afternoon sun. Foreground has a stack of unmarked record sleeves and warm reflections, no legible text. Muted forest green and honey.
- [travertine](review/library/travertine.webp) · A modern travertine exterior with steps, sharp diagonal shadows and a terracotta-toned doorway, one slice of clear sky. A minimal architectural crop in warm cream and slate.
- [night-ferry](review/library/night-ferry.webp) · A working ferry docking just before dawn, one quiet orange lamp and slate-blue water ripples, metal railings visible through mist. Wide tonal range and plausible geometry.
- [citrus](review/library/citrus.webp) · A split blood orange and two whole fruit on pale blue glazed ceramic, a tiny water drop and directional sun. Burnt coral and cool stone blue, editorial still life.
- [window-portrait](review/library/window-portrait.webp) · Environmental portrait of an adult East Asian woman with short dark hair and an olive jacket, next to a high industrial window, looking off-camera. Daylight skin tones, charcoal backdrop, no cosmetics gloss.
- [contact-sheet](review/library/contact-sheet.webp) · A designer’s light table holding the edges of real small blank film negative strips and a loupe, muted reflections and warm desk lamp against blue gray. A tactile editorial studio shot with no legible text.
- [glass-refraction](review/library/glass-refraction.webp) · Two thick smoke-green glass blocks on a concrete table, photographed at table level, crisp caustics and two small specular highlights. Cool green, champagne and graphite.
- [winter-track](review/library/winter-track.webp) · Footprints curving across a dusting of snow toward a single birch and the edge of a cedar forest, late overcast light with differentiated whites. Quiet and textured, off-white and gray-green.
- [tailor](review/library/tailor.webp) · Tactile top-down image of a tailor's hands pinning pale ochre fabric on a dark table, with black thread, metal shears and a piece of blue cloth partly visible. Natural gesture, practical low light.
- [tone-still-life](review/tone-still-life.webp) · A wide editorial tabletop still life showing the complete composition: two reddish-brown ranunculus flowers with both heads fully visible and a complete small mustard ceramic vase, some deep-teal folded linen and a charcoal slate surface, warm light from the right and a pale warm gray plaster wall. Center all objects in the middle 74 percent width and 75 percent height, show the entire vase from lip to base and enough empty space on all four sides. Midtone-rich natural original exposure with highlights and shadow texture, suited for side by side color grading demonstration.
- [conservatory](review/library/conservatory.webp) · A 1930s greenhouse corner with large silver green leaves against wired glass and an old pale-blue painted stool. Soft diffuse light, muted botanical tones.
- [studio-headshot](review/library/studio-headshot.webp) · Three-quarter head and shoulders photograph of an adult man with short curly hair and subtle freckles against cool warm-gray plaster. Gentle side light, strong face contour, neutral realistic skin.
- [frosted-window](review/library/frosted-window.webp) · Translucent pale blue shower glass and water droplets, a softly out-of-focus apricot lamp reflected in the lower corner. A restrained abstract texture study.
- [salt-flat](review/library/salt-flat.webp) · A pale dawn salt flat with cracked clay pattern and mauve mountains reflected in a thin layer of water. Minimal, broad range of bright neutral midtones.
- [workshop](review/library/workshop.webp) · Close-up of worn black steel type drawers and a pair of brass dividers on a faded teal workbench. Quiet artisan workshop, highlights along the edges.
- [coral-facade](review/library/coral-facade.webp) · A quiet dusty coral painted building seen head-on, one deep blue open shutter and broad oblique shadow, photographic natural materials.
- [paper-study](review/library/paper-study.webp) · Three layered large sheets of uncoated slate-blue, cream, and ochre paper with torn edges on grey concrete, gently raking light. Tactile editorial flat lay.
- [black-sand](review/library/black-sand.webp) · Black volcanic sand and thin white wave foam shot from a high angle, with an ash-blue sea and wet shimmering tones, no cliffs, no horizon.
- [yellow-seat](review/library/yellow-seat.webp) · An empty mustard upholstered armchair beside a closed ivory roller blind, understated architectural interior shot with side light. Natural wrinkles and subdued color.
- [orchid](review/library/orchid.webp) · White orchid flower heads against a deep charcoal-green wall in diffuse side light, two blossoms with real fine texture and enough separation for detail retouching.
- [blue-dusk](review/library/blue-dusk.webp) · An elevated concrete transit platform at blue dusk, straight perspective, with one warm round practical lamp and soft traces of distant traffic. Slate cyan and tungsten.
- [dried-herbs](review/library/dried-herbs.webp) · Dry sprigs of rosemary on a cool stone surface next to a transparent glass of water, fine cast shadows, close side-on composition.
- [cyclist-studio](review/library/cyclist-studio.webp) · A cropped adult cyclist in olive clothing holding a bicycle at a pale industrial door, daylight portrait with visible fabric grain and a soft background.
- [rain-macro](review/library/rain-macro.webp) · Close-up raindrops on a deep slate car door beside one streak of golden reflection, high texture definition and generous dark tones.
- [indigo-bowl](review/library/indigo-bowl.webp) · A deep indigo handmade bowl with small flecks of pale glaze sitting next to folded gray cloth, early window light raking across a dark stone tabletop.
- [museum-night](review/library/museum-night.webp) · An empty modern museum interior at night, a pale amber floor lamp casting a pool of light on concrete, framed edges and an unlit gallery in shadow.
- [copper-kettle](review/library/copper-kettle.webp) · A brushed copper kettle and tin strainer on a muted sage counter in late afternoon, no branding, rich local specular highlights with subtle wear.
- [orange-market](review/library/orange-market.webp) · A covered market after close, soft ochre shutters, a single crumpled blue awning and soft lamplight on cobblestones. Natural geometry and quiet empty scene.
- [headland-grass](review/library/headland-grass.webp) · Close high coastal grass and low wind-bent plants in a subdued late-summer field, a thin line of slate sea beneath a muted sky, no rocks or crashing waves.
- [lemon-crate](review/library/lemon-crate.webp) · Quiet color study of pale yellow lemons in a vintage blue painted wooden produce crate, at a three-quarter angle in an outdoor shady area.
- [book-press](review/library/book-press.webp) · A bookbinder’s wooden press and a stack of unmarked linen book covers on a table. A small sidelight picks out the cream edges and steel fasteners.
- [cotton-portrait](review/library/cotton-portrait.webp) · A candid seated adult South Asian woman with dark hair and a loose pale-gray cotton shirt, soft window light and a charcoal studio backdrop. Real skin texture, calm expression.
- [sage-pottery](review/library/sage-pottery.webp) · Muted jade and warm grey pottery drying upside down on the unvarnished shelves of a pottery studio. Tilted frame, daylit, tactile shadow detail.
- [pool-after-rain](review/library/pool-after-rain.webp) · A row of empty pale deck chairs and green ceramic wall tiles at a small indoor public swimming bath. Soft natural light, no visible text, water reflections against cream ceiling.
- [hill-house](review/library/hill-house.webp) · A single low off-white concrete house with broad sloping roof among muted green hills just after rain, low clouds and slate sky, architectural photo at a distance.
- [silver-leaf](review/library/silver-leaf.webp) · A cluster of silvery eucalyptus leaves and a single desaturated gold dry leaf on graphite textile, side lit macro image, distinct but understated detail.
- [print-studio](review/library/print-studio.webp) · A fine-art print studio table with the corner of a cool-toned landscape print, textured cotton paper and a clean metal ruler, pale window light and slate surfaces. No text.
- [tiled-courtyard](review/library/tiled-courtyard.webp) · An elevated editorial photograph of soft afternoon shadows crossing ochre and navy mosaic courtyard tiles, with a small antique dark wood bench at the edge. Natural stone texture.
- [blue-window](review/library/blue-window.webp) · A still life of small ivory clay cups and a worn navy-painted window sill, diagonal sunlight, quiet indoor studio texture. Full rounded shapes.
- [pale-cliff](review/library/pale-cliff.webp) · A broad soft overcast blue sky over pale layered coastal sandstone in a low-angle landscape view, sparse sage vegetation, natural tonal range with soft shadows.
- [dusk-taxi](review/library/dusk-taxi.webp) · Through a wet city window at dusk, a far-away muted orange taxi and slate buildings, shallow depth of field and amber reflections. No readable lettering or branding.
