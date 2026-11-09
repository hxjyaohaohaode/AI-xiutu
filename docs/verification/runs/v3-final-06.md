# v3-final-06 实际运行记录

机器记录如下；本页复制真实输出，不将测试清单当作人工逐行审计。

```json
{
  "label": "v3-final-06",
  "startedAt": "2026-11-09T18:36:09.444Z",
  "finishedAt": "2026-11-09T18:37:10.799Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "e9bfb4480d3ad2e7fa865fbd31416c3131ea603e9c684814e6ee321e99613366",
  "inventory": "v3-final-06-inventory.json",
  "files": 283,
  "sourceLines": 82421,
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 22363,
      "log": "v3-final-06-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 33241,
      "log": "v3-final-06-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 947,
      "log": "v3-final-06-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 4793,
      "log": "v3-final-06-production-dependencies.log"
    }
  ],
  "passed": true
}
```

## typecheck

原始文件：`v3-final-06-typecheck.log`；SHA-256：`a9cbeed8f1d9b26b6285203e7aaf4f61472bdc5b69a22f7bc2f539ab940d4b90`。

````text

> ai-xiutu@0.1.0 typecheck
> node scripts/typecheck.mjs

Typecheck packages/ai/tsconfig.json
Typecheck packages/contracts/tsconfig.json
Typecheck packages/db/tsconfig.json
Typecheck packages/editor/tsconfig.json
Typecheck packages/multimodal/tsconfig.json
Typecheck packages/portrait/tsconfig.json
Typecheck packages/providers/tsconfig.json
Typecheck packages/storage/tsconfig.json
Typecheck apps/api/tsconfig.json
Typecheck apps/web/tsconfig.json
Typecheck apps/worker-ai/tsconfig.json
Typecheck scripts/tsconfig.json
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````

## tests

原始文件：`v3-final-06-tests.log`；SHA-256：`2d6f6e67f060b21c896a4ae963028febb64abd50d9aa6e26a3801f980e0a3baa`。

````text

> ai-xiutu@0.1.0 test
> node scripts/test.mjs

▶ queued cancellation and disabled-provider recovery use actual SQL and API ACL
  ✔ disabled capabilities still expose authorized cancellation; concurrent retries release once (256.826455ms)
  ✔ revoked or suspended actor cannot cancel; owner can release queued work without private operator access (130.911233ms)
  ✔ cancel racing an already dispatched request never releases or resends it (101.940561ms)
  ✔ restored queued rows with dispatch or unreadable evidence become unknown without refunds (321.676731ms)
  ✔ all adapters disabled still recover every stale operation once, redact audio and preserve receipts/holds (317.872195ms)
  ✔ missing backup evidence stops dispatch but never prevents conservative stale recovery (71.745378ms)
✔ queued cancellation and disabled-provider recovery use actual SQL and API ACL (1529.289119ms)
▶ AI result decisions, immutable source history and composition ACL
  ✔ forward migration preserves existing history and backfills retained storage without double counting (182.997585ms)
  ✔ public discovery resolves unconfigured adapters honestly and exposes no credentials (48.091745ms)
  ✔ fixtures create real immutable uploads, source snapshots and completed candidates (121.847864ms)
  ✔ missing session, outsider, viewer and platform operations do not gain adoption privileges (26.857395ms)
  ✔ rejection records an immutable decision without changing already settled points (53.940802ms)
  ✔ concurrent identical forks create one branch and changing a reused key fails (36.757231ms)
{"event":"api_error","requestId":"req-k","errorType":"Error","code":"INTERNAL"}
  ✔ lost adoption COMMIT acknowledgement replays the committed branch without duplicating it or settling again (40.460081ms)
{"event":"api_error","requestId":"req-n","errorType":"Error","code":"INTERNAL"}
  ✔ failed decision persistence rolls back its artwork and source snapshot in the same transaction (14.452767ms)
  ✔ adopting an image as a layer preserves its base, parameters, contain placement and immutable source history (95.729203ms)
  ✔ AI layer adoption checks capacity, output provenance and project ownership before appending (45.091441ms)
  ✔ replace atomically changes current source, preserves old source and rejects stale proposals (42.802657ms)
  ✔ restoring history appends source plus recipe together and uses CAS (28.233575ms)
  ✔ outdated parameter proposal may be preserved as a branch from its original source (19.359855ms)
  ✔ matching parameter suggestion applies exactly once and records a new revision (20.645295ms)
  ✔ text adoption creates document snapshots and prevents stale replacement (34.593416ms)
  ✔ wrong output type/index, unfinished jobs and attempted automatic refund fail closed (36.687525ms)
  ✔ composition saves enforce same-project image dependencies and block deletion from history (56.614035ms)
  ✔ cross-space copy remaps all composition source IDs to independently authorized assets (44.01707ms)
  ✔ user decision history stays project scoped after membership revocation (16.128676ms)
✔ AI result decisions, immutable source history and composition ACL (1139.761091ms)
▶ asset annotations, authorized organization and v2 revision persistence
  ✔ additive migration is repeatable and user declarations preserve timezone without changing image bytes (44.452346ms)
  ✔ viewer and platform operator cannot edit or inspect unauthorized private annotations (34.040247ms)
  ✔ annotation validation rejects implicit timezones, unexpected GPS/export flags and malformed tags (18.773135ms)
  ✔ real project/space filters and exact microsecond cursors do not lose same-millisecond assets (29.646658ms)
  ✔ expired or revoked reference grant cannot query metadata; old cursor does not preserve access (8.839427ms)
  ✔ actual upload origin is recorded explicitly; a suggestive filename never implies AI provenance (32.19742ms)
  ✔ full v2 recipes and region data persist through ordinary artwork/revision CAS (27.762699ms)
{"event":"api_error","requestId":"req-z","errorType":"Error","code":"INTERNAL"}
  ✔ a lost upload COMMIT acknowledgement never deletes an already committed private asset (25.87557ms)
{"event":"upload_asset_cleanup_deferred"}
{"event":"api_error","requestId":"req-11","errorType":"Error","code":"INTERNAL"}
  ✔ an unavailable authoritative cleanup query preserves an unconfirmed private upload (14.110357ms)
✔ asset annotations, authorized organization and v2 revision persistence (391.967939ms)
▶ authorized source copies, retained capacity and durable replay use actual SQL
  ✔ real private fixtures and disabled copy policies do not silently reupload (131.679686ms)
  ✔ concurrent identical and independently keyed copies share one immutable source and one capacity charge (66.570838ms)
{"event":"api_error","requestId":"req-p","errorType":"Error","code":"INTERNAL"}
  ✔ lost commit response can be retried without a second asset or capacity reservation (33.852001ms)
  ✔ one capacity row covers concurrent copies to different projects in the same space (98.21275ms)
  ✔ byte capacity and a partial full-project copy roll back all rows and counters (65.672495ms)
  ✔ operators configure capacity with CAS but do not acquire private image access (49.924327ms)
  ✔ revoking copy policy denies new decisions but a committed same-key retry reads only its independent destination (29.858013ms)
  ✔ a non-owner copy grant binds one destination and cannot be reused as a full project grant (99.665604ms)
  ✔ grant expiry at the final publication boundary rolls back the copy, request and capacity together (48.32492ms)
  ✔ source copy cap applies across distinct idempotency keys and concurrent source assets (49.039674ms)
✔ authorized source copies, retained capacity and durable replay use actual SQL (806.714078ms)
▶ persistent API security, collaboration, quota and private media integration
  ✔ strict Origin and real unavailable SMS gate (41.547331ms)
  ✔ SMS registration, hashed sessions and invalid OTP attempt persistence (242.838588ms)
  ✔ private project ACL excludes platform operator; team roles are real (77.383845ms)
  ✔ bounded image decoding, EXIF removal and authenticated file access (84.655763ms)
  ✔ complete recipe validation, immutable revisions and CAS conflict (47.508409ms)
  ✔ comments anchor to exact revision; tasks/documents use durable CAS (62.133332ms)
  ✔ independent reference/copy policies, revocation and personal-team copy idempotency (89.972503ms)
  ✔ admin records and audited quota adjustment never grant private project access (180.822422ms)
  ✔ period uniqueness, concurrent reservations and expired unknown release conserve lots (109.289237ms)
  ✔ unconfigured AI cannot fabricate a job and revoked team members lose read access (11.85947ms)
  ✔ reset consumes its purpose code and revokes old sessions (139.780367ms)
  ✔ SQL rate limits survive app recreation and untrusted XFF cannot replace peer IP (476.908149ms)
  ✔ exactly one trusted proxy hop uses the nearest forwarded address (26.136846ms)
✔ persistent API security, collaboration, quota and private media integration (1720.15608ms)
✔ editing one region or group retains every other color block, mask, composition and version (16.865378ms)
✔ numeric controls require registry identity and preserve independent fields (1.40973ms)
✔ singular or excessive transformations are rejected before preview reaches React or the renderer (2.098035ms)
✔ all interactive mask creation kinds start from valid editable geometry (0.64568ms)
✔ image dimensions use all returned limits, including discrete lists and custom step (1.655803ms)
✔ platform or operator narrower bounds cannot be bypassed by a provider profile (0.177369ms)
✔ unsupported fields and PNG compression are absent from outgoing options (0.289209ms)
✔ transparent JPEG, excessive outputs and invalid compression are visible failures (0.224441ms)
✔ displayed service points include quality price and exact output count (0.173283ms)
✔ batch budget includes every selected image and enforces the transaction point cap (0.226874ms)
✔ uncertain decision retries retain a token without persisting generated or edited content (2.557883ms)
✔ privacy-mode storage failure and malformed persisted tokens cannot corrupt decision requests (0.781377ms)
✔ current adoption is blocked for dirty, different-project, wrong-source and stale-revision results (3.159786ms)
✔ cloud sources retain their copy policy across project changes and cannot become local uploads (1.804359ms)
✔ a lost copy response preserves one request identity while actor, source and destination are isolated (0.957373ms)
✔ persisted valid identities recover after a reload; corrupt or unavailable session storage fails safely (0.595403ms)
✔ second contact cancels a drawing transaction once and suppresses both pointers until released (1.312713ms)
✔ third contact and unrelated releases cannot unlock the suppressed transaction early (0.133783ms)
✔ duplicate down by the owned pointer is blocked without cancelling the valid stroke (0.133032ms)
✔ normal two-finger navigation remains possible but a new edit cannot join the gesture (0.103647ms)
✔ blur/source reset discards obsolete contacts without leaving the next gesture disabled (0.167143ms)
✔ rollback uses the original pre-stroke recipe and never removes a newer edit or source (4.303863ms)
✔ RGBA8 colors round-trip through both numeric color spaces without channel or alpha drift (4.828328ms)
✔ continuous hue reaches every sector rather than snapping to the quick swatches (1.801955ms)
✔ HEX shorthand and every alpha byte preserve precise RGBA data (0.858183ms)
✔ editing a nested region preserves siblings and independently edited latest data (2.517561ms)
✔ stale nested paths cannot write into a sibling or silently replace the parent (0.644238ms)
✔ curve drag has one pointer owner; another finger cannot move, finish, cancel or replace it (3.986971ms)
✔ cancellation restores the starting recipe once and a late lost-capture event cannot repeat it (1.203ms)
✔ window-level cancellation without a pointer id uses the same ownership and rollback rule (0.856939ms)
✔ source changes invalidate late move, up, cancel and lost-capture paths without writing old data (1.425831ms)
✔ a changed channel cannot receive a former channel gesture or its rollback (0.867604ms)
✔ releasePointerCapture reentrancy cannot turn a committed drag into a rollback (0.418729ms)
✔ an external commit interrupts the drag so late move, commit and cancel preserve the new edit (2.048492ms)
✔ several synchronous owned previews remain cancellable without requiring a React render (0.575401ms)
✔ unavailable capture and explicit discard leave no dangling transaction (0.563444ms)
✔ a local curve transaction owns the whole recipe and cannot commit after its scope changes (0.519499ms)
✔ unchanged image export prepares the encoded bytes with the captured source filename (1.691849ms)
▶ source, recipe, generation, loading and unmount changes discard a late export before URL allocation
  ✔ new source with the identical recipe (0.423511ms)
  ✔ changed adjustments on the same source (0.572355ms)
  ✔ replacement recipe object even when values happen to match (0.216737ms)
  ✔ new request generation (0.247785ms)
  ✔ pending source replacement (0.210829ms)
  ✔ unmounted owner (0.174193ms)
✔ source, recipe, generation, loading and unmount changes discard a late export before URL allocation (3.068912ms)
✔ a slower superseded export cannot replace the newer source result (0.640518ms)
✔ an already unavailable export does not start encoding (0.492024ms)
✔ codec failures remain actionable only for the current request owner (0.525905ms)
✔ delivery disables image and recipe actions during decode or pending cloud source lookup (11.574796ms)
✔ two consumers of the same immutable preview share its exact histogram allocation (1.491595ms)
✔ new frame identity recomputes independently and never returns the preceding frame counts (1.028155ms)
✔ absent frames remain absent without creating placeholder counts or mutating a cached result (0.196488ms)
✔ late image download cannot overwrite edits made while its network request was pending (3.692585ms)
✔ late referenced-layer decoding stops after project switch even if the same recipe is selected (2.018523ms)
✔ unchanged request may commit while changed source identity cancels an otherwise identical recipe (0.857987ms)
✔ history binding resolves the old immutable source and rejects the current source or foreign project (0.719438ms)
✔ component motion has explicit independently selected desktop, tablet and phone tracks (1.46137ms)
✔ all media-containing wrappers keep zero blur in every breakpoint (0.147884ms)
✔ CSS includes reduced-motion and gesture escape paths with hidden state inert support (1.561281ms)
✔ selecting a compact-panel parameter reveals its whole main control with bounded local scrolling (0.876445ms)
✔ a control taller than an unusually short panel aligns its heading rather than oscillating (0.131579ms)
✔ the shelf retains named native controls, exact signed ranges, selected state and disabled availability (22.839442ms)
✔ pixel crop keeps exact boundaries at small, odd, tall and 16K sizes (8.275796ms)
✔ pixel crop clamps edge drags to at least one real source pixel (0.333614ms)
✔ numeric editor changes require trusted registry identity and leave input untouched (0.916636ms)
✔ legacy radial selection updates never erase v2 color, effects or independent regions (0.445264ms)
✔ one-pixel brush snaps a boundary click to exactly one original pixel center (1.075577ms)
✔ source preview sampling maps normalized source locations and clamps outer edge (0.425553ms)
✔ duplicate validates global brush complexity and preserves original when budget would overflow (14.167206ms)
✔ a secondary pointer cannot steal, finish or cancel the owned slider preview (1.629154ms)
✔ Escape cancellation cannot be followed by a late keyup commit (0.194344ms)
✔ keyboard chord commits once after its final key and ignores unrelated releases (0.118299ms)
✔ neutral gestures create no changed result and source unmount discards ownership (0.288196ms)
✔ v2 AI confirmation includes advanced changes alongside legacy exposure (2.66493ms)
✔ v3 confirmation lists inherited color/effects and new optical/transform parameters (3.019166ms)
✔ v3 retained masks, groups, paint, composition and warp changes are explicitly disclosed (4.098639ms)
✔ non-numeric review ignores object key order but preserves ordered-layer and curve differences (0.755233ms)
✔ equal JSONB-style reordered recipes do not create false numeric changes (0.584173ms)
✔ legacy candidates remain legacy and non-numeric replacements are explicitly named (1.018951ms)
✔ preview preparation is an exact reference identity when geometry already fits the budget (7.821079ms)
✔ adaptive downsampling preserves alpha with premultiplied linear area reconstruction (3.775209ms)
✔ output-aware planning handles rotation, projective crop and scale without rewriting recipe or source coordinates (10.392979ms)
✔ actual worker protocol downsizes expanded previews and retains the full transformed export and layer coordinates (1555.296867ms)
✔ worker fallback keeps original pixels after transfer, resolves layer aliases and clears them for a new source (17.06377ms)
✔ render readiness includes active displacement and protection but excludes disabled warp edits (5.574702ms)
✔ painting and source sampling reject transparent contain corners while shape handles can clamp (3.477203ms)
✔ layer handles retain off-frame freedom and pixel painting follows inverse displacement (1.855703ms)
✔ prefers native randomUUID and keeps the Web Crypto receiver (0.764354ms)
✔ HTTP-style Crypto without randomUUID uses exactly 16 random bytes (0.165199ms)
✔ fallback enforces v4 and RFC variant bits while preserving the remaining entropy (0.571914ms)
✔ a native UUID failure can fall back only to a working secure RNG (0.149355ms)
✔ no RNG is an explicit unavailable error, never a weak identifier (0.451642ms)
✔ a failing secure RNG rejects rather than returning zero or pseudo-random bytes (0.152461ms)
✔ 844×390 restores all dock modes inside the workspace and above the reachable toolbar (1.470511ms)
✔ continuous panel sizes are bounded by available pixels, not a 330px product ceiling (0.180553ms)
✔ phone width, height, floating positions and side docking remain user choices (0.17854ms)
✔ a very large docked panel never automatically covers the photo; explicit overlay remains available (0.902664ms)
✔ a 339px saved phone sheet preserves the complete exclusion area at both 320×700 and 390×844 (0.290208ms)
✔ fresh phone defaults reserve photo pixels without beginning in overlay (0.351701ms)
✔ low-room guidance uses actual fit space without changing composition or limiting manual sizes (0.321035ms)
✔ side docks and short windows deduct their own viewport chrome and fit padding (0.232851ms)
✔ 320px quick photo view preserves the requested 339px panel and keeps fitted images above it (0.448888ms)
✔ measured banners and keyboard space constrain panels without overwriting their saved rectangle (0.218059ms)
✔ maximize and collapse are derived display modes with an exact normal-size return path (0.189687ms)
✔ undocking preserves the visible origin and keyboard movement supports one pixel (0.254595ms)
✔ floating west/north resize holds the opposite edge through minimum size and viewport limits (0.324771ms)
✔ bottom sheets resize symmetrically in width and retain their bottom anchor in height (0.154153ms)
✔ resizing across six actual QA sizes keeps every edge accessible (4.643376ms)
✔ layout parsing repairs unavailable display modes and rejects corrupt old preferences (0.479395ms)
✔ multimodal SQL integration requires the explicit CI database when requested (0.881812ms)
▶ multimodal jobs use real SQL, private normalized images and injected supplier boundaries
  ✔ v3 plans preserve image dependencies and fine transform, while unuploaded or foreign layer references create no hold (107.271234ms)
  ✔ new v2 numeric plans freeze their protocol, moderate generated changes and preserve existing masks without auto-applying (66.386056ms)
  ✔ invalid generated v2 paths never publish and retain their genuine receipt plus unknown hold (60.356277ms)
  ✔ old frozen v2 tasks retain the legacy adjustment protocol and digest while new protocol tampering fails before dispatch (102.769884ms)
  ✔ text iteration explicitly freezes its successful same-project parent, without implicit full chat history (106.978841ms)
  ✔ image submit is idempotent, reserves once and exposes no generated asset until normalized-byte review passes (109.129017ms)
  ✔ text generation freezes document context and returns a candidate without overwriting the live document (48.571331ms)
  ✔ speech success retains only the audio hash, omits raw audio from DTOs and does not execute edits (70.142611ms)
  ✔ edit-plan still returns a complete frozen-recipe candidate without changing the artwork (56.929513ms)
  ✔ successful empty ASR becomes an explicit no-speech result and settles once without fabricated text (62.989314ms)
  ✔ input review rejection and review-hash mismatch do not call a billable image model (92.460108ms)
  ✔ reference-image block prevents generation and preserves the existing source (63.550372ms)
  ✔ blocked generated image is never attached or exposed, private bytes are removed and billing remains unknown (57.978262ms)
  ✔ independent image adapter returning a wrong decoded size cannot bypass worker validation (43.674153ms)
  ✔ post-generation text moderation block preserves the source and never publishes the candidate (48.653345ms)
  ✔ unknown image outcome is not retried and only an operator can settle it idempotently (82.445602ms)
  ✔ a definitive model refusal releases the hold for all four operations without a retry (165.524206ms)
  ✔ a definitive output-review error cannot release a hold after the model has already succeeded (111.128792ms)
  ✔ speech unknown, invalid frozen bytes and stale worker recovery all redact raw audio without retry (98.57772ms)
  ✔ authorization and project scoping reject outsiders, wrong wallets and cross-project references before a hold (26.478839ms)
  ✔ text permission revoked during asynchronous input review stops the billable call (39.19847ms)
  ✔ model disabled during input review stops image dispatch even though admission was valid (47.254241ms)
  ✔ speech permission revoked during journal persistence stops transcription and erases queued audio (39.648946ms)
  ✔ image revocation during output review prevents asset attachment and discards the private candidate (58.299489ms)
  ✔ frozen manifest detects tampering and binds image row model to the approved model (60.577941ms)
  ✔ a missing frozen reference cannot silently downgrade an approved reference-image request to text-only generation (42.269209ms)
  ✔ reference revocation during image review prevents its bytes from being sent to generation (48.544ms)
  ✔ edit-plan integrity includes the whole base recipe, not only currentAdjustments sent to the LLM (44.567473ms)
  ✔ an existing dispatch record freezes a restored queued image job instead of sending it again (34.808593ms)
  ✔ restored image dispatch evidence wins over later model disablement and cannot release the paid hold (42.846121ms)
  ✔ restored plan dispatch evidence wins over revoked membership before any access-denied release (44.242856ms)
  ✔ missing database dispatch evidence halts new work instead of silently rebuilding vendor requests (26.099586ms)
✔ multimodal jobs use real SQL, private normalized images and injected supplier boundaries (2160.09315ms)
▶ OpenAI persistent batch lifecycle, accounting, references and real request lineage
  ✔ lost acknowledgement after a real batch COMMIT keeps every published image and settles once (131.278925ms)
{"event":"ai_asset_cleanup_deferred"}
  ✔ unknown output plus unavailable cleanup check retains private bytes without publishing them (65.33019ms)
  ✔ n outputs reserve n times the selected quality price once; queued price does not change (92.816967ms)
  ✔ input denial releases the whole reservation and calls no image supplier (47.805399ms)
  ✔ one rejected output leaves the entire batch unpublished, unknown and not retried (92.586389ms)
  ✔ references and mask use exact hashed bytes; parent output is explicitly selected and persisted (216.822073ms)
  ✔ a reference revoked during supplier execution prevents all publication (84.004768ms)
  ✔ batch cardinality and transport uncertainty keep the complete hold; malformed options create none (136.966147ms)
  ✔ editing queued parameters cannot replace the frozen payload or mint a cheaper multi-image job (45.707194ms)
✔ OpenAI persistent batch lifecycle, accounting, references and real request lineage (970.774852ms)
✔ endpoint allowlist rejects userinfo, off-region, query and redirect targets (1.386064ms)
✔ frozen input hashes include endpoint, exact JSON body and requested adjustments (0.815021ms)
✔ AI proposals cannot call arbitrary tools, overwrite geometry or exceed parameter bounds (4.007584ms)
✔ AI legacy adjustment proposals preserve the complete v2 recipe and never gain access to its new fields (2.956957ms)
✔ new v2 plans expose only registry numeric values, keep the old default protocol byte-for-byte and bound moderation input (1.577413ms)
✔ v2 proposals atomically validate joint levels, report actual differences and preserve all regions (2.902355ms)
✔ v3 global proposals preserve fine geometry, layers and warp without exposing their private data to the provider (3.824027ms)
✔ v2 whitelist rejects arbitrary paths, duplicates, non-finite numbers, integer violations and invalid final levels (2.824357ms)
✔ real HTTP adapter uses bounded JSON, authorization, no redirects and never retries (12.633546ms)
✔ Qwen adapter retains vendor receipt for incomplete responses and rejects a definite error without retry (2.351833ms)
✔ database integration is explicitly required by CI (0.94636ms)
▶ AI transaction, moderation, idempotency, unknown and restore invariants
  ✔ one submission reserves once; completed candidate never modifies the artwork (55.776005ms)
  ✔ input rejection never calls the model and releases the original lot (39.333124ms)
  ✔ ambiguous external result holds points and is never automatically retried (53.576743ms)
  ✔ existing dispatch evidence prevents re-execution of a restored queued row (36.097871ms)
  ✔ changed head and revoked membership reject new paid requests (9.3395ms)
  ✔ journal record missing from restored DB stops all future dispatch (5.121963ms)
✔ AI transaction, moderation, idempotency, unknown and restore invariants (228.630688ms)
✔ module registry rejects duplicates, missing dependencies and cycles without executing code (7.527933ms)
✔ asset copy contract accepts only a destination and stable request key, never caller ownership or bytes (1.731045ms)
✔ sealed registry isolates caller data, resolves explicit gates and cannot pretend a contract has an executor (2.240716ms)
✔ decision schema keeps kind-specific fields, CAS and idempotency explicit (4.780692ms)
✔ shared source frame binds analysis to normalized pixels and command envelope carries no actor authority (3.619899ms)
▶ schema readiness uses the migration registry and rejects old, incomplete and newer databases
  ✔ migrate and readiness agree on the actual highest registered migration (7.243574ms)
  ✔ old v2 (6.542495ms)
  ✔ missing intermediate (5.009037ms)
  ✔ newer than this code (6.196186ms)
  ✔ empty (2.816786ms)
  ✔ doctor CLI reports the complete current schema without contacting vendors (335.133826ms)
✔ schema readiness uses the migration registry and rejects old, incomplete and newer databases (380.525188ms)
✔ recipe construction owns its arrays and the shared default is deeply frozen (2.367667ms)
✔ full-recipe validation rejects malformed versions, unknown params, NaN and negative detail (2.016546ms)
✔ validation does not invoke getters and rejects inherited/prototype payloads (0.602541ms)
✔ JSON round trip has deterministic versioned data and no references to the input (1.458624ms)
✔ neutral recipe is byte-identical for all byte values and alpha, but never mutates input (2.107574ms)
✔ exposure performs linear-light EV rather than multiplying encoded bytes (0.849083ms)
✔ signed light tools move in both directions, and brightness is not exposure (2.724376ms)
✔ contrast has a midtone pivot and highlight/shadow controls target different tonal ranges (0.453425ms)
✔ saturation -100 is grayscale and vibrance leaves neutral gray neutral (0.600387ms)
✔ temperature and tint have signed, distinct relative color semantics (0.604043ms)
✔ curve endpoints, channel isolation and RGB-then-channel order are explicit (2.987549ms)
✔ bad curve ordering, duplicate x, missing endpoints and accessors are rejected (0.493636ms)
✔ crop, all clockwise rotations and output-axis flips are exact RGBA permutations (1.126642ms)
✔ geometry helpers use actual crop quantization and invert across all rotations/flips (1.001112ms)
✔ alpha survives every adjustment and transparent color cannot bleed through detail filters (2.386165ms)
✔ soften reduces a small local fluctuation and sharpening increases it without changing flat fields (0.570542ms)
✔ radial feather and inverse have bounded complementary weights (0.30421ms)
✔ enabled local tone and smoothing leave every outside pixel byte-identical to the global baseline (2.039211ms)
✔ inverted local mask protects its center and local detail does not become a global effect (0.518203ms)
✔ histograms count visible pixels, preserve channel bins and ignore hidden RGB (0.239402ms)
✔ bounds reject excessive dimensions, incomplete buffers and unauthorized budget enlargement (0.342928ms)
✔ extreme valid settings remain bounded, keep alpha, and do not mutate recipes (2.995305ms)
✔ worker-rendered preview and main-thread export use identical canonical pixels for the same input (137.553059ms)
✔ BMP preflight supports explicit uncompressed RGB variants and rejects alternate encodings (2.563693ms)
✔ real static GIF is inspected through complete frame/trailer and rejects truncation/animation (7.092425ms)
✔ real AVIF primary-image associations work for RGB and alpha; sequence/missing/invalid boxes fail closed (28.307768ms)
✔ header inspection requires explicit larger image budget, bounded at 64MP/16384 (0.579025ms)
✔ AVIF dimensions are selected through the actual primary item association, not the first ispe (3.365865ms)
✔ AVIF FullBox fields cannot borrow bytes from a following sibling box (1.199983ms)
✔ AVIF item counts, item IDs, primary flags and minimum AV1 configuration are checked (0.61531ms)
✔ AVIF rejects duplicate singleton metadata instead of choosing an arbitrary primary (0.526866ms)
✔ AVIF scans visible top-level boxes after meta and rejects sequence or duplicate metadata (0.479534ms)
✔ AVIF box lengths, extended sizes and bounded nesting fail closed (5.318785ms)
✔ AVIF distinguishes an intentionally bounded large-file prefix from a truncated complete small file (12.147343ms)
✔ BMP validates signed dimensions, padded row footprint and declared payload before decoding (0.448378ms)
✔ GIF counts actual image blocks, bounds extensions and requires the complete static trailer (0.559605ms)
✔ extended formats share explicit pixel budgets without allocating decoded high-resolution images (0.811736ms)
✔ header preflight recognizes static PNG, 8-bit JPEG profiles and both WebP bitstreams (2.959962ms)
✔ animation declarations are flagged before any decoder is constructed (0.719086ms)
✔ header dimensions block zero sizes, huge sides and decompression pixel bombs (0.636111ms)
✔ PNG preflight checks header CRC, chunk boundaries, ordering and bounded metadata (44.494762ms)
✔ JPEG preflight rejects malformed segments, alternate size frames and unknown coding modes (0.365522ms)
✔ WebP preflight checks RIFF length, padding, frame signatures, versions and canvas mismatch (0.360405ms)
✔ unsupported signatures and oversized header buffers fail closed (0.333464ms)
✔ tiled neutral rendering preserves all RGBA byte values and disabled local state (4.396401ms)
✔ all stages match the reference byte for byte for several non-dividing tile sizes (46.385825ms)
✔ fractional crop, all rotations and output flips share exact geometry with the reference (114.424251ms)
✔ default 512-pixel tile boundaries and partial edge tiles have no seams or alpha drift (519.842137ms)
✔ two consecutive radius-1 detail stages retain their full two-pixel dependency halo (1.802703ms)
✔ radial masks, feather and inversion remain in original whole-image coordinates across tiles (95.365962ms)
✔ crop-border detail samples include neighbors outside the crop just like pre-crop reference processing (2.379835ms)
✔ single-pixel, row, column and small transparent images retain correct real-image edge extension (3.278173ms)
✔ Float32 work buffers are tile-sized and allocated twice, then reused for all tiles (51.279567ms)
✔ the explicit tiled path supports a 16,384-pixel side without widening reference-renderer admission (1.801481ms)
✔ a real 20MP input with a small crop uses only cropped tiles and honors an explicitly lower admission budget (5.231121ms)
✔ high-resolution geometry helpers map coordinates without requiring a whole-image float allocation (0.458483ms)
✔ tiled input budgets, tile size, buffer completeness and cancellation fail before unsafe work (2.40293ms)
✔ tiled rendering in a real worker uses the same canonical pixels as reference export (200.182046ms)
✔ compiled radial masks preserve the old radial mathematical convention (2.015235ms)
✔ linear gradient projection uses source pixel aspect, bounded endpoints and optional smoothing (0.482699ms)
✔ polygon selection has pixel-aspect-aware inward feather and exact zero exterior (0.637923ms)
✔ brush capsules are continuous between samples and maintain circular source-pixel radii (0.409649ms)
✔ brush additive/subtractive strokes compose ordered coverage without point-density buildup (0.621148ms)
✔ a half-pixel brush selects exactly one pixel center at the maximum admitted square dimensions (0.788311ms)
✔ RLE masks preserve every byte weight at source cell centers and explicit normalized resizing (1.679738ms)
✔ continuous source color selection wraps hue, distinguishes grey and preserves transparent exclusion under inversion (0.476059ms)
✔ continuous color saturation and encoded-luminance bands feather independently (0.660438ms)
✔ color overlay can explicitly sample a smaller original preview through normalized coordinates (0.496019ms)
✔ compiled mask domain rejects non-finite samples and bounds inverse selection to the actual source image (0.212201ms)
✔ version dispatch is explicit and never drops unknown version fields (5.366687ms)
✔ explicit v1 migration preserves all common fields and owns every nested value (2.649512ms)
✔ AI-safe base adjustment patch preserves version, masks and every v2 control (3.179153ms)
✔ the v2 registry exactly addresses implemented bounded controls and canonical defaults (25.095138ms)
✔ v2 rejects invalid coupled ranges, integer seeds, incomplete masks and unsupported fields (0.904115ms)
✔ new nested validators do not execute accessors or accept prototype payloads (0.976455ms)
✔ discriminated region builders replace masks without leaking radial fields (3.694261ms)
✔ mask validation enforces finite geometry, nondegeneracy, RLE coverage and complexity caps (51.680673ms)
✔ default v2 is an exact RGBA identity and migrated v1 replays byte-for-byte in both renderers (29.62806ms)
✔ levels independently set input endpoints, gamma direction and output endpoints (2.670665ms)
✔ each of eight HSL bands has real signed hue, saturation and lightness behavior without recoloring grey (15.46799ms)
✔ HSL interpolation is continuous across hue zero and stable at extreme dark levels (1.007572ms)
✔ three-way color grading and split-tone settings affect the intended tonal weights (1.37017ms)
✔ monochrome and fade have separate linear-luminance and encoded-range semantics (0.709882ms)
✔ vignette has signed exposure, adjustable source-space center/radii and a neutral interior (1.187644ms)
✔ grain is deterministic by source coordinate and seed, has real size/color modes and leaves alpha intact (5.521491ms)
✔ texture and clarity are signed, spatially distinct, flat-preserving and alpha-weighted (6.065572ms)
✔ every manual mask type produces a real local edit with exact zero-weight outside preservation (6.310112ms)
✔ ordered regions, opacity, disabled state and invert retain real independent semantics (2.928904ms)
✔ a real one-pixel edit preserves every exterior RGBA byte and ignores transparent neighbor colors (2.451362ms)
✔ continuous color-range remains bound to unmodified source pixels after global and prior regional edits (1.529881ms)
✔ all v2 stages preserve alpha and hidden RGB without mutating source or recipe (15.376398ms)
✔ full/tiled v2 share exact pixels for all stages, masks, geometry and nondividing tile edges (915.344804ms)
✔ maximum ordered detail dependency uses the complete twelve-pixel halo (73.167394ms)
✔ v2 default tile size crosses a real 512 boundary without seams, including source-anchored noise (36.52924ms)
✔ v2 full/tiled handle real image edges, singleton axes, budgets and cancellation (8.085574ms)
✔ v2 tiled rendering allocates only two reusable tile-sized Float32 work buffers (25.095308ms)
✔ every registered extreme remains a bounded real rendering parameter with stable alpha (26.365633ms)
✔ a real worker v2 tile export equals the main-thread reference for the same frozen input (243.903414ms)
✔ compound union/intersection/subtract/xor combine multiple soft areas with bounded inversion (2.649462ms)
✔ full regional curves, HSL and levels change only selected pixels and leave all exterior bytes untouched (18.621429ms)
✔ shared group correction is applied once across overlapping regions, with independent per-region edits afterwards (19.731221ms)
✔ region and group enable/opacity controls are independent and zero is exact identity (3.799379ms)
✔ source-color selection is fixed to immutable input even after global color adjustments (6.370944ms)
✔ every declared blend mode is finite, alpha-correct and distinguishes representative colors (0.977156ms)
✔ normal/multiply/screen/soft-light use their actual distinct equations, with transparent backdrops unaffected by blend choice (0.6351ms)
✔ a half-pixel paint stroke controls exactly one RGBA pixel and leaves its neighbors byte-identical (2.598295ms)
✔ paint opacity and isolated erasing do not erase the original image (5.576614ms)
✔ clone strokes sample a fixed pre-paint source instead of repeatedly sampling already painted pixels (3.300446ms)
✔ paint mask, visibility and layer order are genuine non-destructive compositing controls (3.493307ms)
✔ image layers resolve explicit pixels and perform placement, scale, alpha, masking and rotation (7.363103ms)
✔ disabled image layers never trigger resolution and can be retained without a fake output (1.283519ms)
✔ warp has signed compact support and distinct push, pinch, bulge and twirl fields (0.50348ms)
✔ warp protection locks selected background pixels exactly, including alpha and hidden RGB (8.743517ms)
✔ zero or disabled warp remains byte-identical and off-region pixels are not resampled (4.176069ms)
✔ luminance and chroma denoising operate independently, preserve flat fields and alpha (7.698058ms)
✔ signed chromatic aberration shifts the chosen channel without changing alpha or other channels (3.044989ms)
✔ all new source-space stages have identical full/tiled output across non-dividing tile edges and preserve input ownership (81.687139ms)
✔ spatial brush indexing preserves continuous capsules and does not build up opacity from denser samples (11.231586ms)
✔ paint workload admission rejects excessive paths before any image-sized byte allocation (117.628557ms)
✔ reusing one immutable image source in several layers counts its pixels once (7.539459ms)
✔ tiled v3 allocates only tile-sized Float32 buffers even across local color and paint layers (64.430728ms)
✔ a real worker exports v3 source layers, regional edits and geometry byte-identically to the main-thread reference (165.788131ms)
✔ v3 neutral migration reproduces original v1/v2 bytes including legacy locals, crop and alpha (30.504574ms)
✔ all-angle affine/projective source/output mappings round-trip through integer crop and quarter turns (35.454156ms)
✔ fine exact quarter-turn rotation swaps dimensions and produces no extra border pixels (3.909415ms)
✔ fine fractional rotation adds real transparent support and crop mode retains the chosen output frame (2.709523ms)
✔ fine quarter turns preserve hidden transparent RGB across round-off in both rotation directions (21.707406ms)
✔ compiled frame mapping retains exact legacy crop quantization and every quarter-turn/flip convention (16.539454ms)
✔ translation and independent axis scales are real geometric operations with invertible hit testing (2.062996ms)
✔ v3 geometry validates allocation budgets and singular or horizon-crossing transforms before rendering (2.080482ms)
✔ premultiplied linear reconstruction excludes hidden transparent colors and preserves neutral transparent data (1.635321ms)
✔ v3 rendering is cancellable at admission and through repeated pixel-row checks (1.387326ms)
✔ compiled gesture coordinates distinguish frame controls from inverse-warp content picking (1.417571ms)
✔ v3 creation owns defaults, round-trips strict JSON and never silently downgrades (16.061542ms)
✔ v3 global registry exposes exact defaults and generic setters retain all extension data (40.097721ms)
✔ v3 validation rejects unknown keys, invalid versions and incomplete color blocks (4.073293ms)
✔ v3 parser never executes accessors and rejects cycles, symbols, exotic prototypes and sparse arrays (1.731766ms)
✔ groups reference unique explicit identities and have independent validated complete color blocks (4.509142ms)
✔ operation provenance is bounded inert data and can carry a complete person control vector (3.19722ms)
✔ compound masks preserve discriminants and enforce depth, node and shape budgets (0.368056ms)
✔ paint validation enforces alpha/channel, finite coordinates and clone origins before any rendering (43.219651ms)
✔ image layers use bounded resource identities and reject URL payloads and illegal dimensions (2.428128ms)
✔ strict WAV validates actual duration including the 30-second boundary and typed-array offsets (113.398007ms)
✔ WAV rejects compressed, stereo, wrong-rate, wrong-byte-rate, missing, truncated and oversized input (8.455252ms)
✔ WAV rejects appended data, duplicate chunks and forged RIFF lengths (0.293523ms)
✔ provider setup has no implicit enabled model or endpoint bypass (1.10565ms)
✔ Ark audited profiles enforce request dimensions, reference types and model allowlists before dispatch (1.558625ms)
✔ Ark single-image request sends real official fields with reference bytes and keeps AI watermark (11.650348ms)
✔ Ark older group-capable profiles explicitly disable multiple output and streaming (2.107614ms)
✔ Ark rejects URL-only output, extra images, malformed base64 and wrong real dimensions as unknown (3.379886ms)
✔ HTTP refusal is distinguished from uncertain billing and raw provider error text is not propagated (1.305783ms)
✔ response readers reject announced excess, streamed excess, invalid JSON and interrupted bodies (2.491533ms)
✔ Qwen transcription uses allowed Beijing workspace endpoint and base64 WAV, never a public audio URL (0.576921ms)
✔ Qwen rejects unsafe input locally and treats truncated/malformed transcription as unknown (1.011719ms)
✔ OpenAI adapter is disabled without explicit enable/key/model allowlist and refuses arbitrary endpoints (114.176873ms)
✔ OpenAI generation uses the fixed real Images JSON protocol and returns all requested raster outputs (177.108877ms)
✔ OpenAI edit protocol sends exact normalized reference and markup bytes, with 2.6 complexity (17.680688ms)
✔ OpenAI mask requires a matching transparent PNG and never silently flattens a guide (18.656022ms)
✔ OpenAI profiles enforce real quality, format dependencies, current size evidence and batch budgets locally (0.722901ms)
✔ OpenAI JPEG and WebP compression is transmitted and decoded as the requested real format (1.596291ms)
✔ explicit transparency checks actual decoded alpha, not a filename or response declaration (1.78082ms)
✔ OpenAI ambiguous or partially completed batch responses stay unknown, preserve request receipt and never retry (4.353186ms)
✔ portrait analysis is owned, strictly source-bound and rejects stale IDs, duplicate targets and unknown fields (15.096725ms)
✔ portrait boundary rejects accessors, non-finite landmarks, sparse data and invalid visibility without executing them (1.74743ms)
✔ bounded off-image pose estimates retain a valid face and visible shoulders without enabling invisible legs (27.388452ms)
✔ open eyebrow chains use all hull vertices while only actually closed edges form contour loops (0.509259ms)
✔ face skin and lipstick masks protect eyes and the mouth cavity (1.915303ms)
✔ all registered face/body controls compile to real valid primitives with their own named targets (164.464626ms)
✔ every enabled portrait control produces real pixels, signed controls reverse, and tiled export matches the preview engine (493.244924ms)
✔ portrait controls replace their own operations without growing repeated slider changes or modifying other modules (22.5347ms)
✔ detaching a whole person preserves pixels and provenance while allowing a new automatic pass without IDs colliding or manual edits being overwritten (26.743989ms)
✔ makeup color is per tool and does not leak into numeric controls or recolor other tools on unrelated changes (24.818154ms)
✔ automatic recompilation refuses manual changes, deletion, ordering and missing checksums without losing the existing recipe (91.962112ms)
✔ changing automatic values retains existing order relative to later independent layers (13.804147ms)
✔ two fully configured portrait targets fit published operation budgets and keep independent values (78.429725ms)
✔ body tools check only the joints they need, retaining shoulder editing when lower-body joints are hidden (2.492445ms)
✔ tilted non-square portraits push their chin along the actual pixel-space facial axis (2.716905ms)
✔ sideways and inverted portraits retain a mouth-oriented facial axis instead of the screen vertical (7.991542ms)
✔ makeup options and RGBA reject sparse data and accessors without running user code (5.963989ms)
✔ a large face can receive masked makeup without an illegal paint radius or painting the mouth cavity (5.821974ms)
✔ semantic zero/reset remains identity and can remove a previous effect even if new contours are unavailable (11.119077ms)
✔ analysis adapter validates configuration, source binding, preview ratio and response version before accepting inference (3.849234ms)
✔ analysis adapter rejects cancelled work before and after inference and never treats partial output as success (0.629421ms)
✔ Tencent adapters have no unconfigured delivery or moderation bypass (1.703142ms)
✔ TC3 authorization binds exact body, action and UTC credential scope (1.896004ms)
✔ SMS uses official fixed endpoint, one approved purpose template and exact recipient receipt (7.986354ms)
✔ network errors, streamed interruption, invalid envelopes and large responses stay unknown without retries (2.747551ms)
✔ definite Tencent client rejection differs from ambiguous internal failure (1.440586ms)
✔ text moderation binds exact UTF-8 bytes and keeps Review distinct from Pass (0.977887ms)
✔ image moderation hashes the exact file and refuses small, mismatched or oversized content before external dispatch (12.015069ms)
✔ real JPEG/PNG/WebP/AVIF/static GIF/single-page TIFF codecs normalize to private PNG (64.630115ms)
✔ real animated GIF/WebP and multipage TIFF are rejected without first-frame flattening (16.990315ms)
✔ APNG/AVIF sequence declarations and unsupported containers are refused before decoding (17.776077ms)
✔ high-resolution normalization processes a real 20MP source and enforces independent server bounds (411.46545ms)
✔ streaming byte cap and process-wide decoder admission apply across storage instances (11.193849ms)
✔ private thumbnails preserve aspect and alpha, do not enlarge, and reuse immutable cached files (73.179444ms)
✔ model preparation rejects a truncated task even when its bad download hash was recorded (1.288206ms)
✔ model preparation validates length and TFLite magic independently of its hash (0.481077ms)
✔ model preparation requires a complete archive directory and exact versioned pose size (0.524963ms)
ℹ tests 444
ℹ suites 0
ℹ pass 444
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 32954.936834
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````

## web-build

原始文件：`v3-final-06-web-build.log`；SHA-256：`3e6465681269ab01281b55495ca1e799dce2a51abbcb58eeb67ec5d5c4b9c126`。

````text

> @ai-xiutu/web@0.1.0 build
> vite build

vite v8.3.7 building client environment for production...
transforming...
✓ 4756 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                               0.76 kB │ gzip:   0.50 kB
dist/assets/selection.worker-C--UIaSV.js     44.12 kB
dist/assets/render.worker-BgYnZMC-.js        73.85 kB
dist/assets/portrait.worker-CgCL4MaK.js     281.72 kB
dist/assets/index-CNkrE7Tk.css              231.54 kB │ gzip:  39.86 kB
dist/assets/DrawingBoard-C6oXUdKC.js         13.08 kB │ gzip:   4.49 kB
dist/assets/OpsDashboard-DKkn4MoB.js         47.71 kB │ gzip:  11.52 kB
dist/assets/Ui-CuuumAl2.js                   76.59 kB │ gzip:  19.54 kB
dist/assets/AIPanel-B0DJgl04.js             100.39 kB │ gzip:  27.71 kB
dist/assets/index-CBdpi8BV.js             1,147.71 kB │ gzip: 319.20 kB

✓ built in 594ms
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

````

## production-dependencies

原始文件：`v3-final-06-production-dependencies.log`；SHA-256：`70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c`。

````text
found 0 vulnerabilities
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````
