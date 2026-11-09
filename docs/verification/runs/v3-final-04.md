# v3-final-04 实际运行记录

机器记录如下；本页复制真实输出，不将测试清单当作人工逐行审计。

```json
{
  "label": "v3-final-04",
  "startedAt": "2026-11-09T18:33:05.559Z",
  "finishedAt": "2026-11-09T18:34:10.160Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "e9bfb4480d3ad2e7fa865fbd31416c3131ea603e9c684814e6ee321e99613366",
  "inventory": "v3-final-04-inventory.json",
  "files": 283,
  "sourceLines": 82421,
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 23542,
      "log": "v3-final-04-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 31223,
      "log": "v3-final-04-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 922,
      "log": "v3-final-04-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 8906,
      "log": "v3-final-04-production-dependencies.log"
    }
  ],
  "passed": true
}
```

## typecheck

原始文件：`v3-final-04-typecheck.log`；SHA-256：`a9cbeed8f1d9b26b6285203e7aaf4f61472bdc5b69a22f7bc2f539ab940d4b90`。

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

原始文件：`v3-final-04-tests.log`；SHA-256：`04216b7083e88147a150f2e1a9b83aeaeec7c0c0f74b83ff1000cbbf5d97a3e2`。

````text

> ai-xiutu@0.1.0 test
> node scripts/test.mjs

▶ queued cancellation and disabled-provider recovery use actual SQL and API ACL
  ✔ disabled capabilities still expose authorized cancellation; concurrent retries release once (175.003418ms)
  ✔ revoked or suspended actor cannot cancel; owner can release queued work without private operator access (56.862161ms)
  ✔ cancel racing an already dispatched request never releases or resends it (72.06419ms)
  ✔ restored queued rows with dispatch or unreadable evidence become unknown without refunds (258.852127ms)
  ✔ all adapters disabled still recover every stale operation once, redact audio and preserve receipts/holds (218.348354ms)
  ✔ missing backup evidence stops dispatch but never prevents conservative stale recovery (36.755421ms)
✔ queued cancellation and disabled-provider recovery use actual SQL and API ACL (1087.565358ms)
▶ AI result decisions, immutable source history and composition ACL
  ✔ forward migration preserves existing history and backfills retained storage without double counting (139.859335ms)
  ✔ public discovery resolves unconfigured adapters honestly and exposes no credentials (14.129967ms)
  ✔ fixtures create real immutable uploads, source snapshots and completed candidates (94.238505ms)
  ✔ missing session, outsider, viewer and platform operations do not gain adoption privileges (21.041228ms)
  ✔ rejection records an immutable decision without changing already settled points (45.135283ms)
  ✔ concurrent identical forks create one branch and changing a reused key fails (34.114077ms)
{"event":"api_error","requestId":"req-k","errorType":"Error","code":"INTERNAL"}
  ✔ lost adoption COMMIT acknowledgement replays the committed branch without duplicating it or settling again (28.598506ms)
{"event":"api_error","requestId":"req-n","errorType":"Error","code":"INTERNAL"}
  ✔ failed decision persistence rolls back its artwork and source snapshot in the same transaction (18.675459ms)
  ✔ adopting an image as a layer preserves its base, parameters, contain placement and immutable source history (84.327389ms)
  ✔ AI layer adoption checks capacity, output provenance and project ownership before appending (40.438747ms)
  ✔ replace atomically changes current source, preserves old source and rejects stale proposals (37.94496ms)
  ✔ restoring history appends source plus recipe together and uses CAS (28.470333ms)
  ✔ outdated parameter proposal may be preserved as a branch from its original source (19.80892ms)
  ✔ matching parameter suggestion applies exactly once and records a new revision (17.560754ms)
  ✔ text adoption creates document snapshots and prevents stale replacement (31.634427ms)
  ✔ wrong output type/index, unfinished jobs and attempted automatic refund fail closed (32.389549ms)
  ✔ composition saves enforce same-project image dependencies and block deletion from history (51.511475ms)
  ✔ cross-space copy remaps all composition source IDs to independently authorized assets (38.029598ms)
  ✔ user decision history stays project scoped after membership revocation (9.55595ms)
✔ AI result decisions, immutable source history and composition ACL (920.321989ms)
▶ asset annotations, authorized organization and v2 revision persistence
  ✔ additive migration is repeatable and user declarations preserve timezone without changing image bytes (37.756254ms)
  ✔ viewer and platform operator cannot edit or inspect unauthorized private annotations (41.655441ms)
  ✔ annotation validation rejects implicit timezones, unexpected GPS/export flags and malformed tags (30.054193ms)
  ✔ real project/space filters and exact microsecond cursors do not lose same-millisecond assets (35.86558ms)
  ✔ expired or revoked reference grant cannot query metadata; old cursor does not preserve access (8.359261ms)
  ✔ actual upload origin is recorded explicitly; a suggestive filename never implies AI provenance (34.295161ms)
  ✔ full v2 recipes and region data persist through ordinary artwork/revision CAS (35.268813ms)
{"event":"api_error","requestId":"req-z","errorType":"Error","code":"INTERNAL"}
  ✔ a lost upload COMMIT acknowledgement never deletes an already committed private asset (24.56401ms)
{"event":"upload_asset_cleanup_deferred"}
{"event":"api_error","requestId":"req-11","errorType":"Error","code":"INTERNAL"}
  ✔ an unavailable authoritative cleanup query preserves an unconfirmed private upload (14.013935ms)
✔ asset annotations, authorized organization and v2 revision persistence (428.582466ms)
▶ authorized source copies, retained capacity and durable replay use actual SQL
  ✔ real private fixtures and disabled copy policies do not silently reupload (129.956639ms)
  ✔ concurrent identical and independently keyed copies share one immutable source and one capacity charge (74.253544ms)
{"event":"api_error","requestId":"req-p","errorType":"Error","code":"INTERNAL"}
  ✔ lost commit response can be retried without a second asset or capacity reservation (38.976064ms)
  ✔ one capacity row covers concurrent copies to different projects in the same space (102.843594ms)
  ✔ byte capacity and a partial full-project copy roll back all rows and counters (69.501158ms)
  ✔ operators configure capacity with CAS but do not acquire private image access (42.187776ms)
  ✔ revoking copy policy denies new decisions but a committed same-key retry reads only its independent destination (23.988115ms)
  ✔ a non-owner copy grant binds one destination and cannot be reused as a full project grant (92.71978ms)
  ✔ grant expiry at the final publication boundary rolls back the copy, request and capacity together (52.57344ms)
  ✔ source copy cap applies across distinct idempotency keys and concurrent source assets (41.711686ms)
✔ authorized source copies, retained capacity and durable replay use actual SQL (824.665869ms)
▶ persistent API security, collaboration, quota and private media integration
  ✔ strict Origin and real unavailable SMS gate (38.61297ms)
  ✔ SMS registration, hashed sessions and invalid OTP attempt persistence (195.905576ms)
  ✔ private project ACL excludes platform operator; team roles are real (68.7279ms)
  ✔ bounded image decoding, EXIF removal and authenticated file access (58.142833ms)
  ✔ complete recipe validation, immutable revisions and CAS conflict (35.46854ms)
  ✔ comments anchor to exact revision; tasks/documents use durable CAS (46.383956ms)
  ✔ independent reference/copy policies, revocation and personal-team copy idempotency (64.023856ms)
  ✔ admin records and audited quota adjustment never grant private project access (124.128446ms)
  ✔ period uniqueness, concurrent reservations and expired unknown release conserve lots (107.883434ms)
  ✔ unconfigured AI cannot fabricate a job and revoked team members lose read access (10.672359ms)
  ✔ reset consumes its purpose code and revokes old sessions (146.546948ms)
  ✔ SQL rate limits survive app recreation and untrusted XFF cannot replace peer IP (419.150589ms)
  ✔ exactly one trusted proxy hop uses the nearest forwarded address (18.513936ms)
✔ persistent API security, collaboration, quota and private media integration (1445.195295ms)
✔ editing one region or group retains every other color block, mask, composition and version (12.156092ms)
✔ numeric controls require registry identity and preserve independent fields (0.690714ms)
✔ singular or excessive transformations are rejected before preview reaches React or the renderer (1.820272ms)
✔ all interactive mask creation kinds start from valid editable geometry (0.613248ms)
✔ image dimensions use all returned limits, including discrete lists and custom step (1.599679ms)
✔ platform or operator narrower bounds cannot be bypassed by a provider profile (0.174834ms)
✔ unsupported fields and PNG compression are absent from outgoing options (0.338902ms)
✔ transparent JPEG, excessive outputs and invalid compression are visible failures (0.231369ms)
✔ displayed service points include quality price and exact output count (0.177028ms)
✔ batch budget includes every selected image and enforces the transaction point cap (0.353164ms)
✔ uncertain decision retries retain a token without persisting generated or edited content (3.350507ms)
✔ privacy-mode storage failure and malformed persisted tokens cannot corrupt decision requests (0.541178ms)
✔ current adoption is blocked for dirty, different-project, wrong-source and stale-revision results (2.4665ms)
✔ cloud sources retain their copy policy across project changes and cannot become local uploads (1.37566ms)
✔ a lost copy response preserves one request identity while actor, source and destination are isolated (0.751215ms)
✔ persisted valid identities recover after a reload; corrupt or unavailable session storage fails safely (0.50894ms)
✔ second contact cancels a drawing transaction once and suppresses both pointers until released (1.20306ms)
✔ third contact and unrelated releases cannot unlock the suppressed transaction early (0.129466ms)
✔ duplicate down by the owned pointer is blocked without cancelling the valid stroke (0.219783ms)
✔ normal two-finger navigation remains possible but a new edit cannot join the gesture (0.115925ms)
✔ blur/source reset discards obsolete contacts without leaving the next gesture disabled (0.145741ms)
✔ rollback uses the original pre-stroke recipe and never removes a newer edit or source (4.423008ms)
✔ RGBA8 colors round-trip through both numeric color spaces without channel or alpha drift (4.628109ms)
✔ continuous hue reaches every sector rather than snapping to the quick swatches (1.910759ms)
✔ HEX shorthand and every alpha byte preserve precise RGBA data (0.941734ms)
✔ editing a nested region preserves siblings and independently edited latest data (2.369323ms)
✔ stale nested paths cannot write into a sibling or silently replace the parent (0.54212ms)
✔ curve drag has one pointer owner; another finger cannot move, finish, cancel or replace it (4.016203ms)
✔ cancellation restores the starting recipe once and a late lost-capture event cannot repeat it (1.029116ms)
✔ window-level cancellation without a pointer id uses the same ownership and rollback rule (0.673708ms)
✔ source changes invalidate late move, up, cancel and lost-capture paths without writing old data (1.67339ms)
✔ a changed channel cannot receive a former channel gesture or its rollback (0.407266ms)
✔ releasePointerCapture reentrancy cannot turn a committed drag into a rollback (0.62121ms)
✔ an external commit interrupts the drag so late move, commit and cancel preserve the new edit (2.497206ms)
✔ several synchronous owned previews remain cancellable without requiring a React render (0.477973ms)
✔ unavailable capture and explicit discard leave no dangling transaction (0.453466ms)
✔ a local curve transaction owns the whole recipe and cannot commit after its scope changes (0.481498ms)
✔ unchanged image export prepares the encoded bytes with the captured source filename (2.183782ms)
▶ source, recipe, generation, loading and unmount changes discard a late export before URL allocation
  ✔ new source with the identical recipe (0.250559ms)
  ✔ changed adjustments on the same source (0.254826ms)
  ✔ replacement recipe object even when values happen to match (0.521659ms)
  ✔ new request generation (0.230158ms)
  ✔ pending source replacement (0.21156ms)
  ✔ unmounted owner (0.226633ms)
✔ source, recipe, generation, loading and unmount changes discard a late export before URL allocation (3.103102ms)
✔ a slower superseded export cannot replace the newer source result (0.540257ms)
✔ an already unavailable export does not start encoding (0.392614ms)
✔ codec failures remain actionable only for the current request owner (0.813881ms)
✔ delivery disables image and recipe actions during decode or pending cloud source lookup (16.345366ms)
✔ two consumers of the same immutable preview share its exact histogram allocation (1.435901ms)
✔ new frame identity recomputes independently and never returns the preceding frame counts (0.271641ms)
✔ absent frames remain absent without creating placeholder counts or mutating a cached result (0.153131ms)
✔ late image download cannot overwrite edits made while its network request was pending (4.28468ms)
✔ late referenced-layer decoding stops after project switch even if the same recipe is selected (1.821504ms)
✔ unchanged request may commit while changed source identity cancels an otherwise identical recipe (0.748642ms)
✔ history binding resolves the old immutable source and rejects the current source or foreign project (0.557963ms)
✔ component motion has explicit independently selected desktop, tablet and phone tracks (1.38177ms)
✔ all media-containing wrappers keep zero blur in every breakpoint (0.175866ms)
✔ CSS includes reduced-motion and gesture escape paths with hidden state inert support (4.14581ms)
✔ selecting a compact-panel parameter reveals its whole main control with bounded local scrolling (0.72745ms)
✔ a control taller than an unusually short panel aligns its heading rather than oscillating (0.117257ms)
✔ the shelf retains named native controls, exact signed ranges, selected state and disabled availability (23.165912ms)
✔ pixel crop keeps exact boundaries at small, odd, tall and 16K sizes (11.962113ms)
✔ pixel crop clamps edge drags to at least one real source pixel (0.425243ms)
✔ numeric editor changes require trusted registry identity and leave input untouched (1.830368ms)
✔ legacy radial selection updates never erase v2 color, effects or independent regions (0.402579ms)
✔ one-pixel brush snaps a boundary click to exactly one original pixel center (1.23032ms)
✔ source preview sampling maps normalized source locations and clamps outer edge (0.491273ms)
✔ duplicate validates global brush complexity and preserves original when budget would overflow (15.830318ms)
✔ a secondary pointer cannot steal, finish or cancel the owned slider preview (1.201216ms)
✔ Escape cancellation cannot be followed by a late keyup commit (0.210508ms)
✔ keyboard chord commits once after its final key and ignores unrelated releases (0.115334ms)
✔ neutral gestures create no changed result and source unmount discards ownership (0.232542ms)
✔ v2 AI confirmation includes advanced changes alongside legacy exposure (2.500581ms)
✔ v3 confirmation lists inherited color/effects and new optical/transform parameters (2.991003ms)
✔ v3 retained masks, groups, paint, composition and warp changes are explicitly disclosed (4.462088ms)
✔ non-numeric review ignores object key order but preserves ordered-layer and curve differences (0.793199ms)
✔ equal JSONB-style reordered recipes do not create false numeric changes (0.48305ms)
✔ legacy candidates remain legacy and non-numeric replacements are explicitly named (0.891488ms)
✔ preview preparation is an exact reference identity when geometry already fits the budget (8.350675ms)
✔ adaptive downsampling preserves alpha with premultiplied linear area reconstruction (3.285287ms)
✔ output-aware planning handles rotation, projective crop and scale without rewriting recipe or source coordinates (14.819223ms)
✔ actual worker protocol downsizes expanded previews and retains the full transformed export and layer coordinates (1711.243786ms)
✔ worker fallback keeps original pixels after transfer, resolves layer aliases and clears them for a new source (19.591899ms)
✔ render readiness includes active displacement and protection but excludes disabled warp edits (6.144119ms)
✔ painting and source sampling reject transparent contain corners while shape handles can clamp (2.961617ms)
✔ layer handles retain off-frame freedom and pixel painting follows inverse displacement (1.61416ms)
✔ prefers native randomUUID and keeps the Web Crypto receiver (0.741531ms)
✔ HTTP-style Crypto without randomUUID uses exactly 16 random bytes (0.213172ms)
✔ fallback enforces v4 and RFC variant bits while preserving the remaining entropy (0.526376ms)
✔ a native UUID failure can fall back only to a working secure RNG (0.232021ms)
✔ no RNG is an explicit unavailable error, never a weak identifier (0.440095ms)
✔ a failing secure RNG rejects rather than returning zero or pseudo-random bytes (0.142636ms)
✔ 844×390 restores all dock modes inside the workspace and above the reachable toolbar (1.193324ms)
✔ continuous panel sizes are bounded by available pixels, not a 330px product ceiling (0.184909ms)
✔ phone width, height, floating positions and side docking remain user choices (0.266503ms)
✔ a very large docked panel never automatically covers the photo; explicit overlay remains available (0.940011ms)
✔ a 339px saved phone sheet preserves the complete exclusion area at both 320×700 and 390×844 (0.318081ms)
✔ fresh phone defaults reserve photo pixels without beginning in overlay (0.400415ms)
✔ low-room guidance uses actual fit space without changing composition or limiting manual sizes (0.329287ms)
✔ side docks and short windows deduct their own viewport chrome and fit padding (0.275066ms)
✔ 320px quick photo view preserves the requested 339px panel and keeps fitted images above it (0.472695ms)
✔ measured banners and keyboard space constrain panels without overwriting their saved rectangle (0.21808ms)
✔ maximize and collapse are derived display modes with an exact normal-size return path (0.226132ms)
✔ undocking preserves the visible origin and keyboard movement supports one pixel (0.224629ms)
✔ floating west/north resize holds the opposite edge through minimum size and viewport limits (0.541539ms)
✔ bottom sheets resize symmetrically in width and retain their bottom anchor in height (0.186612ms)
✔ resizing across six actual QA sizes keeps every edge accessible (4.939727ms)
✔ layout parsing repairs unavailable display modes and rejects corrupt old preferences (0.403189ms)
✔ multimodal SQL integration requires the explicit CI database when requested (0.738867ms)
▶ multimodal jobs use real SQL, private normalized images and injected supplier boundaries
  ✔ v3 plans preserve image dependencies and fine transform, while unuploaded or foreign layer references create no hold (86.155992ms)
  ✔ new v2 numeric plans freeze their protocol, moderate generated changes and preserve existing masks without auto-applying (60.391962ms)
  ✔ invalid generated v2 paths never publish and retain their genuine receipt plus unknown hold (50.131549ms)
  ✔ old frozen v2 tasks retain the legacy adjustment protocol and digest while new protocol tampering fails before dispatch (72.577438ms)
  ✔ text iteration explicitly freezes its successful same-project parent, without implicit full chat history (82.441371ms)
  ✔ image submit is idempotent, reserves once and exposes no generated asset until normalized-byte review passes (84.459462ms)
  ✔ text generation freezes document context and returns a candidate without overwriting the live document (47.847832ms)
  ✔ speech success retains only the audio hash, omits raw audio from DTOs and does not execute edits (54.040774ms)
  ✔ edit-plan still returns a complete frozen-recipe candidate without changing the artwork (41.424166ms)
  ✔ successful empty ASR becomes an explicit no-speech result and settles once without fabricated text (59.32566ms)
  ✔ input review rejection and review-hash mismatch do not call a billable image model (77.857972ms)
  ✔ reference-image block prevents generation and preserves the existing source (41.839709ms)
  ✔ blocked generated image is never attached or exposed, private bytes are removed and billing remains unknown (56.212208ms)
  ✔ independent image adapter returning a wrong decoded size cannot bypass worker validation (50.110617ms)
  ✔ post-generation text moderation block preserves the source and never publishes the candidate (41.887747ms)
  ✔ unknown image outcome is not retried and only an operator can settle it idempotently (68.506949ms)
  ✔ a definitive model refusal releases the hold for all four operations without a retry (130.464197ms)
  ✔ a definitive output-review error cannot release a hold after the model has already succeeded (105.781723ms)
  ✔ speech unknown, invalid frozen bytes and stale worker recovery all redact raw audio without retry (95.005826ms)
  ✔ authorization and project scoping reject outsiders, wrong wallets and cross-project references before a hold (25.917382ms)
  ✔ text permission revoked during asynchronous input review stops the billable call (35.089984ms)
  ✔ model disabled during input review stops image dispatch even though admission was valid (42.107759ms)
  ✔ speech permission revoked during journal persistence stops transcription and erases queued audio (39.269518ms)
  ✔ image revocation during output review prevents asset attachment and discards the private candidate (52.026755ms)
  ✔ frozen manifest detects tampering and binds image row model to the approved model (71.445708ms)
  ✔ a missing frozen reference cannot silently downgrade an approved reference-image request to text-only generation (38.408436ms)
  ✔ reference revocation during image review prevents its bytes from being sent to generation (47.655381ms)
  ✔ edit-plan integrity includes the whole base recipe, not only currentAdjustments sent to the LLM (46.104502ms)
  ✔ an existing dispatch record freezes a restored queued image job instead of sending it again (42.094719ms)
  ✔ restored image dispatch evidence wins over later model disablement and cannot release the paid hold (39.278662ms)
  ✔ restored plan dispatch evidence wins over revoked membership before any access-denied release (47.449896ms)
  ✔ missing database dispatch evidence halts new work instead of silently rebuilding vendor requests (24.272766ms)
✔ multimodal jobs use real SQL, private normalized images and injected supplier boundaries (1901.142506ms)
▶ OpenAI persistent batch lifecycle, accounting, references and real request lineage
  ✔ lost acknowledgement after a real batch COMMIT keeps every published image and settles once (148.139425ms)
{"event":"ai_asset_cleanup_deferred"}
  ✔ unknown output plus unavailable cleanup check retains private bytes without publishing them (86.603598ms)
  ✔ n outputs reserve n times the selected quality price once; queued price does not change (94.138014ms)
  ✔ input denial releases the whole reservation and calls no image supplier (49.67859ms)
  ✔ one rejected output leaves the entire batch unpublished, unknown and not retried (82.886674ms)
  ✔ references and mask use exact hashed bytes; parent output is explicitly selected and persisted (199.425364ms)
  ✔ a reference revoked during supplier execution prevents all publication (80.253839ms)
  ✔ batch cardinality and transport uncertainty keep the complete hold; malformed options create none (158.74326ms)
  ✔ editing queued parameters cannot replace the frozen payload or mint a cheaper multi-image job (49.985989ms)
✔ OpenAI persistent batch lifecycle, accounting, references and real request lineage (1001.770254ms)
✔ endpoint allowlist rejects userinfo, off-region, query and redirect targets (1.200655ms)
✔ frozen input hashes include endpoint, exact JSON body and requested adjustments (0.979331ms)
✔ AI proposals cannot call arbitrary tools, overwrite geometry or exceed parameter bounds (4.181031ms)
✔ AI legacy adjustment proposals preserve the complete v2 recipe and never gain access to its new fields (2.840805ms)
✔ new v2 plans expose only registry numeric values, keep the old default protocol byte-for-byte and bound moderation input (1.532346ms)
✔ v2 proposals atomically validate joint levels, report actual differences and preserve all regions (2.823168ms)
✔ v3 global proposals preserve fine geometry, layers and warp without exposing their private data to the provider (3.660324ms)
✔ v2 whitelist rejects arbitrary paths, duplicates, non-finite numbers, integer violations and invalid final levels (2.113645ms)
✔ real HTTP adapter uses bounded JSON, authorization, no redirects and never retries (46.898006ms)
✔ Qwen adapter retains vendor receipt for incomplete responses and rejects a definite error without retry (2.189189ms)
✔ database integration is explicitly required by CI (0.838408ms)
▶ AI transaction, moderation, idempotency, unknown and restore invariants
  ✔ one submission reserves once; completed candidate never modifies the artwork (57.273597ms)
  ✔ input rejection never calls the model and releases the original lot (41.696988ms)
  ✔ ambiguous external result holds points and is never automatically retried (47.001277ms)
  ✔ existing dispatch evidence prevents re-execution of a restored queued row (27.913404ms)
  ✔ changed head and revoked membership reject new paid requests (10.19296ms)
  ✔ journal record missing from restored DB stops all future dispatch (4.811174ms)
✔ AI transaction, moderation, idempotency, unknown and restore invariants (216.152016ms)
✔ module registry rejects duplicates, missing dependencies and cycles without executing code (5.53675ms)
✔ asset copy contract accepts only a destination and stable request key, never caller ownership or bytes (1.605317ms)
✔ sealed registry isolates caller data, resolves explicit gates and cannot pretend a contract has an executor (2.444526ms)
✔ decision schema keeps kind-specific fields, CAS and idempotency explicit (3.611971ms)
✔ shared source frame binds analysis to normalized pixels and command envelope carries no actor authority (1.923388ms)
▶ schema readiness uses the migration registry and rejects old, incomplete and newer databases
  ✔ migrate and readiness agree on the actual highest registered migration (5.803625ms)
  ✔ old v2 (5.372612ms)
  ✔ missing intermediate (4.814078ms)
  ✔ newer than this code (6.311091ms)
  ✔ empty (2.606631ms)
  ✔ doctor CLI reports the complete current schema without contacting vendors (335.041957ms)
✔ schema readiness uses the migration registry and rejects old, incomplete and newer databases (375.748927ms)
✔ recipe construction owns its arrays and the shared default is deeply frozen (1.882015ms)
✔ full-recipe validation rejects malformed versions, unknown params, NaN and negative detail (1.649905ms)
✔ validation does not invoke getters and rejects inherited/prototype payloads (0.606768ms)
✔ JSON round trip has deterministic versioned data and no references to the input (0.554849ms)
✔ neutral recipe is byte-identical for all byte values and alpha, but never mutates input (1.797428ms)
✔ exposure performs linear-light EV rather than multiplying encoded bytes (1.427799ms)
✔ signed light tools move in both directions, and brightness is not exposure (1.442021ms)
✔ contrast has a midtone pivot and highlight/shadow controls target different tonal ranges (0.530001ms)
✔ saturation -100 is grayscale and vibrance leaves neutral gray neutral (0.625876ms)
✔ temperature and tint have signed, distinct relative color semantics (0.572135ms)
✔ curve endpoints, channel isolation and RGB-then-channel order are explicit (2.598769ms)
✔ bad curve ordering, duplicate x, missing endpoints and accessors are rejected (0.652206ms)
✔ crop, all clockwise rotations and output-axis flips are exact RGBA permutations (0.797405ms)
✔ geometry helpers use actual crop quantization and invert across all rotations/flips (0.9919ms)
✔ alpha survives every adjustment and transparent color cannot bleed through detail filters (2.166846ms)
✔ soften reduces a small local fluctuation and sharpening increases it without changing flat fields (0.504973ms)
✔ radial feather and inverse have bounded complementary weights (0.220644ms)
✔ enabled local tone and smoothing leave every outside pixel byte-identical to the global baseline (2.730227ms)
✔ inverted local mask protects its center and local detail does not become a global effect (0.563632ms)
✔ histograms count visible pixels, preserve channel bins and ignore hidden RGB (0.206712ms)
✔ bounds reject excessive dimensions, incomplete buffers and unauthorized budget enlargement (0.336699ms)
✔ extreme valid settings remain bounded, keep alpha, and do not mutate recipes (3.31417ms)
✔ worker-rendered preview and main-thread export use identical canonical pixels for the same input (114.420038ms)
✔ BMP preflight supports explicit uncompressed RGB variants and rejects alternate encodings (2.005462ms)
✔ real static GIF is inspected through complete frame/trailer and rejects truncation/animation (6.774521ms)
✔ real AVIF primary-image associations work for RGB and alpha; sequence/missing/invalid boxes fail closed (21.845004ms)
✔ header inspection requires explicit larger image budget, bounded at 64MP/16384 (0.535517ms)
✔ AVIF dimensions are selected through the actual primary item association, not the first ispe (3.203492ms)
✔ AVIF FullBox fields cannot borrow bytes from a following sibling box (0.943664ms)
✔ AVIF item counts, item IDs, primary flags and minimum AV1 configuration are checked (0.529659ms)
✔ AVIF rejects duplicate singleton metadata instead of choosing an arbitrary primary (0.584381ms)
✔ AVIF scans visible top-level boxes after meta and rejects sequence or duplicate metadata (0.398551ms)
✔ AVIF box lengths, extended sizes and bounded nesting fail closed (4.974162ms)
✔ AVIF distinguishes an intentionally bounded large-file prefix from a truncated complete small file (13.066809ms)
✔ BMP validates signed dimensions, padded row footprint and declared payload before decoding (0.576149ms)
✔ GIF counts actual image blocks, bounds extensions and requires the complete static trailer (0.533665ms)
✔ extended formats share explicit pixel budgets without allocating decoded high-resolution images (0.581837ms)
✔ header preflight recognizes static PNG, 8-bit JPEG profiles and both WebP bitstreams (2.748946ms)
✔ animation declarations are flagged before any decoder is constructed (0.967469ms)
✔ header dimensions block zero sizes, huge sides and decompression pixel bombs (0.433274ms)
✔ PNG preflight checks header CRC, chunk boundaries, ordering and bounded metadata (47.023165ms)
✔ JPEG preflight rejects malformed segments, alternate size frames and unknown coding modes (0.498411ms)
✔ WebP preflight checks RIFF length, padding, frame signatures, versions and canvas mismatch (0.478722ms)
✔ unsupported signatures and oversized header buffers fail closed (0.4508ms)
✔ tiled neutral rendering preserves all RGBA byte values and disabled local state (4.000003ms)
✔ all stages match the reference byte for byte for several non-dividing tile sizes (42.314684ms)
✔ fractional crop, all rotations and output flips share exact geometry with the reference (108.015602ms)
✔ default 512-pixel tile boundaries and partial edge tiles have no seams or alpha drift (442.534095ms)
✔ two consecutive radius-1 detail stages retain their full two-pixel dependency halo (1.84329ms)
✔ radial masks, feather and inversion remain in original whole-image coordinates across tiles (82.961583ms)
✔ crop-border detail samples include neighbors outside the crop just like pre-crop reference processing (2.544478ms)
✔ single-pixel, row, column and small transparent images retain correct real-image edge extension (2.422364ms)
✔ Float32 work buffers are tile-sized and allocated twice, then reused for all tiles (49.729888ms)
✔ the explicit tiled path supports a 16,384-pixel side without widening reference-renderer admission (1.390358ms)
✔ a real 20MP input with a small crop uses only cropped tiles and honors an explicitly lower admission budget (5.897495ms)
✔ high-resolution geometry helpers map coordinates without requiring a whole-image float allocation (0.537701ms)
✔ tiled input budgets, tile size, buffer completeness and cancellation fail before unsafe work (2.087238ms)
✔ tiled rendering in a real worker uses the same canonical pixels as reference export (186.072462ms)
✔ compiled radial masks preserve the old radial mathematical convention (1.883751ms)
✔ linear gradient projection uses source pixel aspect, bounded endpoints and optional smoothing (0.243828ms)
✔ polygon selection has pixel-aspect-aware inward feather and exact zero exterior (0.57687ms)
✔ brush capsules are continuous between samples and maintain circular source-pixel radii (0.635308ms)
✔ brush additive/subtractive strokes compose ordered coverage without point-density buildup (0.500965ms)
✔ a half-pixel brush selects exactly one pixel center at the maximum admitted square dimensions (0.731904ms)
✔ RLE masks preserve every byte weight at source cell centers and explicit normalized resizing (1.634125ms)
✔ continuous source color selection wraps hue, distinguishes grey and preserves transparent exclusion under inversion (0.536429ms)
✔ continuous color saturation and encoded-luminance bands feather independently (0.472693ms)
✔ color overlay can explicitly sample a smaller original preview through normalized coordinates (0.300163ms)
✔ compiled mask domain rejects non-finite samples and bounds inverse selection to the actual source image (0.207123ms)
✔ version dispatch is explicit and never drops unknown version fields (4.390582ms)
✔ explicit v1 migration preserves all common fields and owns every nested value (2.486731ms)
✔ AI-safe base adjustment patch preserves version, masks and every v2 control (3.081193ms)
✔ the v2 registry exactly addresses implemented bounded controls and canonical defaults (23.047224ms)
✔ v2 rejects invalid coupled ranges, integer seeds, incomplete masks and unsupported fields (1.174922ms)
✔ new nested validators do not execute accessors or accept prototype payloads (0.982352ms)
✔ discriminated region builders replace masks without leaking radial fields (3.132605ms)
✔ mask validation enforces finite geometry, nondegeneracy, RLE coverage and complexity caps (55.735557ms)
✔ default v2 is an exact RGBA identity and migrated v1 replays byte-for-byte in both renderers (19.672102ms)
✔ levels independently set input endpoints, gamma direction and output endpoints (2.302433ms)
✔ each of eight HSL bands has real signed hue, saturation and lightness behavior without recoloring grey (14.408984ms)
✔ HSL interpolation is continuous across hue zero and stable at extreme dark levels (0.608307ms)
✔ three-way color grading and split-tone settings affect the intended tonal weights (1.259039ms)
✔ monochrome and fade have separate linear-luminance and encoded-range semantics (0.45026ms)
✔ vignette has signed exposure, adjustable source-space center/radii and a neutral interior (1.044616ms)
✔ grain is deterministic by source coordinate and seed, has real size/color modes and leaves alpha intact (4.901262ms)
✔ texture and clarity are signed, spatially distinct, flat-preserving and alpha-weighted (4.808162ms)
✔ every manual mask type produces a real local edit with exact zero-weight outside preservation (6.270929ms)
✔ ordered regions, opacity, disabled state and invert retain real independent semantics (1.449406ms)
✔ a real one-pixel edit preserves every exterior RGBA byte and ignores transparent neighbor colors (2.342273ms)
✔ continuous color-range remains bound to unmodified source pixels after global and prior regional edits (1.431459ms)
✔ all v2 stages preserve alpha and hidden RGB without mutating source or recipe (14.585479ms)
✔ full/tiled v2 share exact pixels for all stages, masks, geometry and nondividing tile edges (837.672486ms)
✔ maximum ordered detail dependency uses the complete twelve-pixel halo (60.089114ms)
✔ v2 default tile size crosses a real 512 boundary without seams, including source-anchored noise (33.13602ms)
✔ v2 full/tiled handle real image edges, singleton axes, budgets and cancellation (6.25194ms)
✔ v2 tiled rendering allocates only two reusable tile-sized Float32 work buffers (21.553268ms)
✔ every registered extreme remains a bounded real rendering parameter with stable alpha (22.7403ms)
✔ a real worker v2 tile export equals the main-thread reference for the same frozen input (228.65744ms)
✔ compound union/intersection/subtract/xor combine multiple soft areas with bounded inversion (2.801516ms)
✔ full regional curves, HSL and levels change only selected pixels and leave all exterior bytes untouched (17.033372ms)
✔ shared group correction is applied once across overlapping regions, with independent per-region edits afterwards (24.793842ms)
✔ region and group enable/opacity controls are independent and zero is exact identity (3.990403ms)
✔ source-color selection is fixed to immutable input even after global color adjustments (6.155735ms)
✔ every declared blend mode is finite, alpha-correct and distinguishes representative colors (1.020359ms)
✔ normal/multiply/screen/soft-light use their actual distinct equations, with transparent backdrops unaffected by blend choice (0.259902ms)
✔ a half-pixel paint stroke controls exactly one RGBA pixel and leaves its neighbors byte-identical (2.736468ms)
✔ paint opacity and isolated erasing do not erase the original image (3.888996ms)
✔ clone strokes sample a fixed pre-paint source instead of repeatedly sampling already painted pixels (1.412291ms)
✔ paint mask, visibility and layer order are genuine non-destructive compositing controls (3.390695ms)
✔ image layers resolve explicit pixels and perform placement, scale, alpha, masking and rotation (6.866287ms)
✔ disabled image layers never trigger resolution and can be retained without a fake output (3.107027ms)
✔ warp has signed compact support and distinct push, pinch, bulge and twirl fields (0.487665ms)
✔ warp protection locks selected background pixels exactly, including alpha and hidden RGB (5.327005ms)
✔ zero or disabled warp remains byte-identical and off-region pixels are not resampled (1.902649ms)
✔ luminance and chroma denoising operate independently, preserve flat fields and alpha (7.376717ms)
✔ signed chromatic aberration shifts the chosen channel without changing alpha or other channels (2.153028ms)
✔ all new source-space stages have identical full/tiled output across non-dividing tile edges and preserve input ownership (71.249207ms)
✔ spatial brush indexing preserves continuous capsules and does not build up opacity from denser samples (6.991286ms)
✔ paint workload admission rejects excessive paths before any image-sized byte allocation (96.793697ms)
✔ reusing one immutable image source in several layers counts its pixels once (1.54478ms)
✔ tiled v3 allocates only tile-sized Float32 buffers even across local color and paint layers (68.697919ms)
✔ a real worker exports v3 source layers, regional edits and geometry byte-identically to the main-thread reference (145.165587ms)
✔ v3 neutral migration reproduces original v1/v2 bytes including legacy locals, crop and alpha (25.723589ms)
✔ all-angle affine/projective source/output mappings round-trip through integer crop and quarter turns (32.755436ms)
✔ fine exact quarter-turn rotation swaps dimensions and produces no extra border pixels (3.800142ms)
✔ fine fractional rotation adds real transparent support and crop mode retains the chosen output frame (2.856899ms)
✔ fine quarter turns preserve hidden transparent RGB across round-off in both rotation directions (20.311477ms)
✔ compiled frame mapping retains exact legacy crop quantization and every quarter-turn/flip convention (16.228647ms)
✔ translation and independent axis scales are real geometric operations with invertible hit testing (2.236353ms)
✔ v3 geometry validates allocation budgets and singular or horizon-crossing transforms before rendering (2.215601ms)
✔ premultiplied linear reconstruction excludes hidden transparent colors and preserves neutral transparent data (2.148531ms)
✔ v3 rendering is cancellable at admission and through repeated pixel-row checks (2.235782ms)
✔ compiled gesture coordinates distinguish frame controls from inverse-warp content picking (1.878833ms)
✔ v3 creation owns defaults, round-trips strict JSON and never silently downgrades (11.432374ms)
✔ v3 global registry exposes exact defaults and generic setters retain all extension data (31.89609ms)
✔ v3 validation rejects unknown keys, invalid versions and incomplete color blocks (3.535663ms)
✔ v3 parser never executes accessors and rejects cycles, symbols, exotic prototypes and sparse arrays (3.60666ms)
✔ groups reference unique explicit identities and have independent validated complete color blocks (5.534388ms)
✔ operation provenance is bounded inert data and can carry a complete person control vector (3.069329ms)
✔ compound masks preserve discriminants and enforce depth, node and shape budgets (0.368646ms)
✔ paint validation enforces alpha/channel, finite coordinates and clone origins before any rendering (34.493537ms)
✔ image layers use bounded resource identities and reject URL payloads and illegal dimensions (2.363054ms)
✔ strict WAV validates actual duration including the 30-second boundary and typed-array offsets (115.423707ms)
✔ WAV rejects compressed, stereo, wrong-rate, wrong-byte-rate, missing, truncated and oversized input (7.050154ms)
✔ WAV rejects appended data, duplicate chunks and forged RIFF lengths (0.237348ms)
✔ provider setup has no implicit enabled model or endpoint bypass (1.371959ms)
✔ Ark audited profiles enforce request dimensions, reference types and model allowlists before dispatch (1.740285ms)
✔ Ark single-image request sends real official fields with reference bytes and keeps AI watermark (8.67225ms)
✔ Ark older group-capable profiles explicitly disable multiple output and streaming (1.352881ms)
✔ Ark rejects URL-only output, extra images, malformed base64 and wrong real dimensions as unknown (3.302591ms)
✔ HTTP refusal is distinguished from uncertain billing and raw provider error text is not propagated (1.409516ms)
✔ response readers reject announced excess, streamed excess, invalid JSON and interrupted bodies (1.903742ms)
✔ Qwen transcription uses allowed Beijing workspace endpoint and base64 WAV, never a public audio URL (0.529459ms)
✔ Qwen rejects unsafe input locally and treats truncated/malformed transcription as unknown (1.018887ms)
✔ OpenAI adapter is disabled without explicit enable/key/model allowlist and refuses arbitrary endpoints (111.854423ms)
✔ OpenAI generation uses the fixed real Images JSON protocol and returns all requested raster outputs (173.051563ms)
✔ OpenAI edit protocol sends exact normalized reference and markup bytes, with 2.6 complexity (14.569446ms)
✔ OpenAI mask requires a matching transparent PNG and never silently flattens a guide (13.415435ms)
✔ OpenAI profiles enforce real quality, format dependencies, current size evidence and batch budgets locally (0.978786ms)
✔ OpenAI JPEG and WebP compression is transmitted and decoded as the requested real format (1.565481ms)
✔ explicit transparency checks actual decoded alpha, not a filename or response declaration (1.581375ms)
✔ OpenAI ambiguous or partially completed batch responses stay unknown, preserve request receipt and never retry (3.985561ms)
✔ portrait analysis is owned, strictly source-bound and rejects stale IDs, duplicate targets and unknown fields (13.613013ms)
✔ portrait boundary rejects accessors, non-finite landmarks, sparse data and invalid visibility without executing them (1.524469ms)
✔ bounded off-image pose estimates retain a valid face and visible shoulders without enabling invisible legs (29.911897ms)
✔ open eyebrow chains use all hull vertices while only actually closed edges form contour loops (0.517391ms)
✔ face skin and lipstick masks protect eyes and the mouth cavity (2.082431ms)
✔ all registered face/body controls compile to real valid primitives with their own named targets (157.30098ms)
✔ every enabled portrait control produces real pixels, signed controls reverse, and tiled export matches the preview engine (501.491817ms)
✔ portrait controls replace their own operations without growing repeated slider changes or modifying other modules (14.250424ms)
✔ detaching a whole person preserves pixels and provenance while allowing a new automatic pass without IDs colliding or manual edits being overwritten (22.526187ms)
✔ makeup color is per tool and does not leak into numeric controls or recolor other tools on unrelated changes (16.996266ms)
✔ automatic recompilation refuses manual changes, deletion, ordering and missing checksums without losing the existing recipe (70.559336ms)
✔ changing automatic values retains existing order relative to later independent layers (8.832442ms)
✔ two fully configured portrait targets fit published operation budgets and keep independent values (74.799563ms)
✔ body tools check only the joints they need, retaining shoulder editing when lower-body joints are hidden (3.640501ms)
✔ tilted non-square portraits push their chin along the actual pixel-space facial axis (5.505183ms)
✔ sideways and inverted portraits retain a mouth-oriented facial axis instead of the screen vertical (7.564799ms)
✔ makeup options and RGBA reject sparse data and accessors without running user code (5.670142ms)
✔ a large face can receive masked makeup without an illegal paint radius or painting the mouth cavity (4.592857ms)
✔ semantic zero/reset remains identity and can remove a previous effect even if new contours are unavailable (8.628444ms)
✔ analysis adapter validates configuration, source binding, preview ratio and response version before accepting inference (4.524495ms)
✔ analysis adapter rejects cancelled work before and after inference and never treats partial output as success (0.933899ms)
✔ Tencent adapters have no unconfigured delivery or moderation bypass (1.950832ms)
✔ TC3 authorization binds exact body, action and UTC credential scope (1.925043ms)
✔ SMS uses official fixed endpoint, one approved purpose template and exact recipient receipt (11.976985ms)
✔ network errors, streamed interruption, invalid envelopes and large responses stay unknown without retries (2.845502ms)
✔ definite Tencent client rejection differs from ambiguous internal failure (1.731031ms)
✔ text moderation binds exact UTF-8 bytes and keeps Review distinct from Pass (1.114882ms)
✔ image moderation hashes the exact file and refuses small, mismatched or oversized content before external dispatch (13.80011ms)
✔ real JPEG/PNG/WebP/AVIF/static GIF/single-page TIFF codecs normalize to private PNG (68.549585ms)
✔ real animated GIF/WebP and multipage TIFF are rejected without first-frame flattening (15.374725ms)
✔ APNG/AVIF sequence declarations and unsupported containers are refused before decoding (27.137096ms)
✔ high-resolution normalization processes a real 20MP source and enforces independent server bounds (398.42823ms)
✔ streaming byte cap and process-wide decoder admission apply across storage instances (11.345553ms)
✔ private thumbnails preserve aspect and alpha, do not enlarge, and reuse immutable cached files (72.848569ms)
✔ model preparation rejects a truncated task even when its bad download hash was recorded (1.282785ms)
✔ model preparation validates length and TFLite magic independently of its hash (0.363008ms)
✔ model preparation requires a complete archive directory and exact versioned pose size (0.390979ms)
ℹ tests 444
ℹ suites 0
ℹ pass 444
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 30969.794102
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````

## web-build

原始文件：`v3-final-04-web-build.log`；SHA-256：`b8bdb72613e8a78bf8beb16b2943e507eb451d27d950ed0f1687acb85b24d807`。

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

✓ built in 587ms
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

````

## production-dependencies

原始文件：`v3-final-04-production-dependencies.log`；SHA-256：`70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c`。

````text
found 0 vulnerabilities
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````
