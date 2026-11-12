# Responsive redesign: inspection and correction rounds

This record separates source study, automated execution, human screenshot review and subsequent corrections. A green build is not visual acceptance. The canonical backend remains `9df0e9c06787bce270f4fa03502d81ed3097d872`; the 111 feature statuses are unchanged.

## Before implementation

The complete supplied document is preserved in [reference-209-input.md](reference-209-input.md). All 209 entries were mapped; 28 selected variants received full source review, 20 reference demos were operated in the user's Edge, and 19 core mechanisms were adapted. The [main review](reference-209-review.md), [42 flows](reference-209-flows.md) and [111-feature mapping](reference-209-feature-review.md) record their distinct evidence boundaries.

The pre-change run `43156744177` used product source `bb9e126`, passed 499 frontend tests and 16 browser cases, and produced 53 report screenshots. It establishes the old baseline only.

## Implementation round 1

Source: `0a88d9e22a7c455538e8c875c54ba82333d0b319`.

[Run 43162954294](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/43162954294) completed on 2026-11-12.

| Check | Actual result |
| --- | --- |
| All TypeScript projects and production build | Passed |
| Frontend tests | 515 passed, 0 failed, 0 skipped |
| Complete tests with disposable native PostgreSQL 18 | 1,090 passed, 0 failed, 7 skipped out of 1,097 |
| Seven editor scenarios | All passed: desktop, phone, 320px phone, short landscape, landscape tablet, portrait tablet and reduced motion |
| Three-language product capture groups | All desktop and independent phone captures completed |
| About native-scroll cases | All seven passed; every section reachable, current screenshot bytes verified |
| Combined account/operations case | Failed at the desktop account keyboard assertion; phone account and operations were not reached in this round |
| Total browser cases | 23 passed, 1 failed |
| Runtime / routing / unknown-origin errors | 0 / 0 / 0 |
| CJK font evidence | 67 captures, 188 visible text samples; matching SC/TC platform fonts |
| Screenshot integrity | All 101 report screenshots and 67 candidate image hashes verified |
| Screenshot publication | Skipped because the browser job failed |

Archive SHA-256: `45243f744d0a7b6af0db7d90b785f6e98367f53a06f754cc21dbb87336fcdd6c`.

The seven skipped tests need the native OCR runtime or dedicated HDR/RAW/EXR/large-JPEG image fixtures. They are not counted as passes. The local WASM all-suite attempt previously failed in concurrent voice-handshake tests and did not terminate; that attempt was stopped and is not acceptance evidence. The isolated native PostgreSQL run above completed those database tests successfully.

The account assertion had focused the first, inactive tab after visiting the last tab, without selecting it. The keyboard model correctly advanced from its selected tab. The next check uses an actual click to establish the selected starting tab, then asserts both focus and selection. Account and operations checks are also split by surface and viewport so one failure cannot prevent all later surfaces from being inspected.

## Human findings and targeted corrections

The seven About screenshots were opened and inspected individually. The editor reviewer opened all seven edited-workspace captures, all 18 local/portrait/drawing captures across three languages and desktop/phone, and the initial dark screenshot. Separate reviewers inspect business, account, navigation and AI screens. This human review is not represented by the automated manifest's `manualVisualReview` field.

| Observed issue | Required correction and verification |
| --- | --- |
| Changing Alt/Shift sensitivity during a numeric scrub jumped the value | Rebase the movement origin when sensitivity changes; keep the original cancellation value. Verify real mouse movement, modifier changes, Escape, late release and one Undo restoring actual pixels. |
| Collapsing a manually resized phone panel restored the default height | Preserve valid manual heights; repair only invalid old geometry. Verify 339px and 176px through actual range-key input and collapse/restore. |
| Escape during a segmented-control drag propagated to global panel close | Cancel only that gesture and stop propagation; retain a real callback regression. |
| Shared tooltips were behind native dialogs | Keep the tooltip within the owning dialog's DOM and use the native popover top layer. Check viewport coordinates, focus description, Escape and owner cleanup in the real drawing dialog. |
| Phone local editing put the active slider below its first screen | Recompose local selection and current adjustment controls for the phone panel. Re-capture all three languages. |
| A narrow portrait-tablet parameter label split its final letter onto a separate line | Adjust the parameter grid's minimum slot width and inspect the actual English screenshot. |
| Phone drawing controls consumed excessive canvas height and exposed oversized native fields | Recompose the drawing toolbar and controlled switches/fields; retain every tool, stable option ordering and drawing behavior. |
| Phone library controls delayed the first asset until approximately y=431px | Combine the import action with the heading and compact secondary actions/filtering; keep real asset thumbnails and all actions reachable. |
| Library tabs depended on another view's lazy-loaded stylesheet | Keep the shared tab styling in the always-loaded view layer and verify the library as the first visited surface. |
| A collaboration refresh briefly hid discussion text behind stacked blur/opacity entry animations | Keep live discussion and task content readable throughout a short positional entry; preserve the separate task-state animation. Recheck both refreshed and freshly opened views. |
| Later authentication styles overrode the separate phone proportions | Correct the narrowly scoped cascade; keep phone fields visually smaller while retaining readable input text and a 44px action target. |
| Restoration ranges and their numeric/unit columns did not line up | Give the actual native controls a shared track and a consistent value/unit column; keep all real parameter semantics. |
| The initial dark capture showed only the empty workspace | Import and edit a real photograph before the next dark capture. |
| A direct fresh About entry ignored the saved dark/system preference until the studio mounted | Initialize document appearance from the public shell's single controller; preserve legacy preference migration. Verify system changes, a real settings choice, return to About and a full refresh. |
| Tablet About hero scaled the desktop preview | Select the actual tablet capture and retain its 4:3 aspect ratio. |
| Old, unused About copy retained generated-image descriptions | Remove obsolete copy and keep only the public shell's live loading/recovery labels. |
| Public example screenshots exposed test-oriented names and described a lake as a coast | Use honest example labels and a lake description. The same licensed source photograph and actual API/editor operations remain. |

These corrections require their own subsequent exact-source CI and screenshot review. The first round's passes are not transferred to modified code.
