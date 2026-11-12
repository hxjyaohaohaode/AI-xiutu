# About product captures

The active About page is a continuous product overview. Examples place actual interface captures next to separate illustration, photo and state demonstrations. The artwork and the interactive voice and collaborator examples never imply a connected account or call.

## Allowed imagery

- Eighteen capture names each have zh-CN, zh-TW and en variants: workspace, desktop-flow, local, portrait, layers, tablet, phone, library, collaboration, assistant and delivery, plus seven separately rendered phone views. A native picture selects the matching phone image. Every image must come from the actual application running the source revision recorded in the capture manifest.
- The capture workflow imports licensed real photographs, uses the actual editor and preserves visible unavailable or error states. It never paints fictitious application controls onto an image.
- The latest signed-in workspace, device, library and team images have hashes and input descriptions in stories/signed-capture-provenance.json. Locally captured editing details are recorded in stories/local-capture-provenance.json. The older generated source-manifest.json records the capture run named in that file.
- The three fixed sample paths coast.webp, portrait.webp and color-study.webp remain for legacy navigation compatibility; the verification task replaces their former generated practice images with the licensed real input photographs. The active About entry does not import a sample into a user's workspace.

The generated images, application-rendered ceramic grade and recorded voice frames have separate provenance in stories/art-sources.json. The voice frames come from a completed OpenAI call in a disposable project.

## Capture and verification

See scripts/qa/system-redesign.browser.mjs and the screenshot manifest generated beside these assets. Captures should record the tested commit, source-photo author and license URL, image dimensions and SHA-256. Desktop and narrow-screen About captures are also retained under docs/design/verification/system-redesign for review.

A screenshot is evidence of the visible interface only. It does not establish successful paid AI generation, SMS delivery, native HDR processing or real multi-user collaboration. Those require their own runtime checks.
