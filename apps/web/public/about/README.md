# About product captures

The active About page is a continuous product overview. Generated promotional illustrations, fake conversations, click-to-reveal tours and the old FAQ interaction are no longer part of it.

## Allowed imagery

- workspace, local, portrait, layers, tablet and phone captures each have zh-CN, zh-TW and en variants. They must come from the actual application running the source revision recorded in the capture manifest.
- The capture workflow imports licensed real photographs, uses the actual editor and preserves visible unavailable or error states. It never paints fictitious application controls onto an image.
- Existing capture files retain their historical provenance until replaced by a successful new capture job. Their presence alone does not validate the redesign.
- The three fixed sample paths coast.webp, portrait.webp and color-study.webp remain for legacy navigation compatibility; the verification task replaces their former generated practice images with the licensed real input photographs. The active About entry does not import a sample into a user's workspace.

## Capture and verification

See scripts/qa/system-redesign.browser.mjs and the screenshot manifest generated beside these assets. Captures should record the tested commit, source-photo author and license URL, image dimensions and SHA-256. Desktop and narrow-screen About captures are also retained under docs/design/verification/system-redesign for review.

A screenshot is evidence of the visible interface only. It does not establish successful paid AI generation, SMS delivery, native HDR processing or real multi-user collaboration. Those require their own runtime checks.
