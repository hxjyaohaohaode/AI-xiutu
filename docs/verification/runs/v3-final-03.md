# v3-final-03 实际运行记录

机器记录如下；本页复制真实输出，不将测试清单当作人工逐行审计。

```json
{
  "label": "v3-final-03",
  "startedAt": "2026-11-09T18:29:04.097Z",
  "finishedAt": "2026-11-09T18:30:01.262Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "e9bfb4480d3ad2e7fa865fbd31416c3131ea603e9c684814e6ee321e99613366",
  "inventory": "v3-final-03-inventory.json",
  "files": 283,
  "sourceLines": 82421,
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 22204,
      "log": "v3-final-03-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 29230,
      "log": "v3-final-03-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 893,
      "log": "v3-final-03-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 4831,
      "log": "v3-final-03-production-dependencies.log"
    }
  ],
  "passed": true
}
```

## typecheck

原始文件：`v3-final-03-typecheck.log`；SHA-256：`a9cbeed8f1d9b26b6285203e7aaf4f61472bdc5b69a22f7bc2f539ab940d4b90`。

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

原始文件：`v3-final-03-tests.log`；SHA-256：`85913c3daf29ac6ad1036ff3375f27aef0b7ef21938066c2570f841f117faebd`。

````text

> ai-xiutu@0.1.0 test
> node scripts/test.mjs

▶ queued cancellation and disabled-provider recovery use actual SQL and API ACL
  ✔ disabled capabilities still expose authorized cancellation; concurrent retries release once (171.031944ms)
  ✔ revoked or suspended actor cannot cancel; owner can release queued work without private operator access (59.410954ms)
  ✔ cancel racing an already dispatched request never releases or resends it (63.71537ms)
  ✔ restored queued rows with dispatch or unreadable evidence become unknown without refunds (235.162486ms)
  ✔ all adapters disabled still recover every stale operation once, redact audio and preserve receipts/holds (213.268941ms)
  ✔ missing backup evidence stops dispatch but never prevents conservative stale recovery (33.504729ms)
✔ queued cancellation and disabled-provider recovery use actual SQL and API ACL (1013.868199ms)
▶ AI result decisions, immutable source history and composition ACL
  ✔ forward migration preserves existing history and backfills retained storage without double counting (137.06112ms)
  ✔ public discovery resolves unconfigured adapters honestly and exposes no credentials (14.837773ms)
  ✔ fixtures create real immutable uploads, source snapshots and completed candidates (92.863235ms)
  ✔ missing session, outsider, viewer and platform operations do not gain adoption privileges (21.836156ms)
  ✔ rejection records an immutable decision without changing already settled points (49.040176ms)
  ✔ concurrent identical forks create one branch and changing a reused key fails (32.929999ms)
{"event":"api_error","requestId":"req-k","errorType":"Error","code":"INTERNAL"}
  ✔ lost adoption COMMIT acknowledgement replays the committed branch without duplicating it or settling again (32.457995ms)
{"event":"api_error","requestId":"req-n","errorType":"Error","code":"INTERNAL"}
  ✔ failed decision persistence rolls back its artwork and source snapshot in the same transaction (13.733815ms)
  ✔ adopting an image as a layer preserves its base, parameters, contain placement and immutable source history (74.627053ms)
  ✔ AI layer adoption checks capacity, output provenance and project ownership before appending (44.164415ms)
  ✔ replace atomically changes current source, preserves old source and rejects stale proposals (39.991355ms)
  ✔ restoring history appends source plus recipe together and uses CAS (25.108903ms)
  ✔ outdated parameter proposal may be preserved as a branch from its original source (13.618556ms)
  ✔ matching parameter suggestion applies exactly once and records a new revision (18.509155ms)
  ✔ text adoption creates document snapshots and prevents stale replacement (31.06547ms)
  ✔ wrong output type/index, unfinished jobs and attempted automatic refund fail closed (31.545235ms)
  ✔ composition saves enforce same-project image dependencies and block deletion from history (53.124712ms)
  ✔ cross-space copy remaps all composition source IDs to independently authorized assets (48.082889ms)
  ✔ user decision history stays project scoped after membership revocation (7.580751ms)
✔ AI result decisions, immutable source history and composition ACL (918.21366ms)
▶ asset annotations, authorized organization and v2 revision persistence
  ✔ additive migration is repeatable and user declarations preserve timezone without changing image bytes (37.471195ms)
  ✔ viewer and platform operator cannot edit or inspect unauthorized private annotations (28.826003ms)
  ✔ annotation validation rejects implicit timezones, unexpected GPS/export flags and malformed tags (17.852402ms)
  ✔ real project/space filters and exact microsecond cursors do not lose same-millisecond assets (28.463976ms)
  ✔ expired or revoked reference grant cannot query metadata; old cursor does not preserve access (8.330846ms)
  ✔ actual upload origin is recorded explicitly; a suggestive filename never implies AI provenance (29.84218ms)
  ✔ full v2 recipes and region data persist through ordinary artwork/revision CAS (29.061249ms)
{"event":"api_error","requestId":"req-z","errorType":"Error","code":"INTERNAL"}
  ✔ a lost upload COMMIT acknowledgement never deletes an already committed private asset (20.64907ms)
{"event":"upload_asset_cleanup_deferred"}
{"event":"api_error","requestId":"req-11","errorType":"Error","code":"INTERNAL"}
  ✔ an unavailable authoritative cleanup query preserves an unconfirmed private upload (12.496024ms)
✔ asset annotations, authorized organization and v2 revision persistence (348.46621ms)
▶ authorized source copies, retained capacity and durable replay use actual SQL
  ✔ real private fixtures and disabled copy policies do not silently reupload (122.384345ms)
  ✔ concurrent identical and independently keyed copies share one immutable source and one capacity charge (58.950701ms)
{"event":"api_error","requestId":"req-p","errorType":"Error","code":"INTERNAL"}
  ✔ lost commit response can be retried without a second asset or capacity reservation (35.690082ms)
  ✔ one capacity row covers concurrent copies to different projects in the same space (89.249014ms)
  ✔ byte capacity and a partial full-project copy roll back all rows and counters (64.625922ms)
  ✔ operators configure capacity with CAS but do not acquire private image access (41.015263ms)
  ✔ revoking copy policy denies new decisions but a committed same-key retry reads only its independent destination (23.500051ms)
  ✔ a non-owner copy grant binds one destination and cannot be reused as a full project grant (84.593568ms)
  ✔ grant expiry at the final publication boundary rolls back the copy, request and capacity together (38.470125ms)
  ✔ source copy cap applies across distinct idempotency keys and concurrent source assets (31.367806ms)
✔ authorized source copies, retained capacity and durable replay use actual SQL (716.693773ms)
▶ persistent API security, collaboration, quota and private media integration
  ✔ strict Origin and real unavailable SMS gate (40.51688ms)
  ✔ SMS registration, hashed sessions and invalid OTP attempt persistence (205.125451ms)
  ✔ private project ACL excludes platform operator; team roles are real (66.503464ms)
  ✔ bounded image decoding, EXIF removal and authenticated file access (60.629504ms)
  ✔ complete recipe validation, immutable revisions and CAS conflict (32.775435ms)
  ✔ comments anchor to exact revision; tasks/documents use durable CAS (51.531109ms)
  ✔ independent reference/copy policies, revocation and personal-team copy idempotency (63.672781ms)
  ✔ admin records and audited quota adjustment never grant private project access (139.374592ms)
  ✔ period uniqueness, concurrent reservations and expired unknown release conserve lots (118.291681ms)
  ✔ unconfigured AI cannot fabricate a job and revoked team members lose read access (13.448002ms)
  ✔ reset consumes its purpose code and revokes old sessions (154.003606ms)
  ✔ SQL rate limits survive app recreation and untrusted XFF cannot replace peer IP (445.272742ms)
  ✔ exactly one trusted proxy hop uses the nearest forwarded address (20.518794ms)
✔ persistent API security, collaboration, quota and private media integration (1526.077246ms)
✔ editing one region or group retains every other color block, mask, composition and version (12.042638ms)
✔ numeric controls require registry identity and preserve independent fields (0.646187ms)
✔ singular or excessive transformations are rejected before preview reaches React or the renderer (1.821975ms)
✔ all interactive mask creation kinds start from valid editable geometry (0.533877ms)
✔ image dimensions use all returned limits, including discrete lists and custom step (1.662834ms)
✔ platform or operator narrower bounds cannot be bypassed by a provider profile (0.273083ms)
✔ unsupported fields and PNG compression are absent from outgoing options (0.358813ms)
✔ transparent JPEG, excessive outputs and invalid compression are visible failures (0.232752ms)
✔ displayed service points include quality price and exact output count (0.176547ms)
✔ batch budget includes every selected image and enforces the transaction point cap (0.351982ms)
✔ uncertain decision retries retain a token without persisting generated or edited content (2.096921ms)
✔ privacy-mode storage failure and malformed persisted tokens cannot corrupt decision requests (0.414537ms)
✔ current adoption is blocked for dirty, different-project, wrong-source and stale-revision results (2.549725ms)
✔ cloud sources retain their copy policy across project changes and cannot become local uploads (1.557855ms)
✔ a lost copy response preserves one request identity while actor, source and destination are isolated (0.993622ms)
✔ persisted valid identities recover after a reload; corrupt or unavailable session storage fails safely (0.394928ms)
✔ second contact cancels a drawing transaction once and suppresses both pointers until released (1.411614ms)
✔ third contact and unrelated releases cannot unlock the suppressed transaction early (0.166652ms)
✔ duplicate down by the owned pointer is blocked without cancelling the valid stroke (0.196247ms)
✔ normal two-finger navigation remains possible but a new edit cannot join the gesture (0.197489ms)
✔ blur/source reset discards obsolete contacts without leaving the next gesture disabled (0.24489ms)
✔ rollback uses the original pre-stroke recipe and never removes a newer edit or source (4.528527ms)
✔ RGBA8 colors round-trip through both numeric color spaces without channel or alpha drift (4.695499ms)
✔ continuous hue reaches every sector rather than snapping to the quick swatches (1.874464ms)
✔ HEX shorthand and every alpha byte preserve precise RGBA data (0.835313ms)
✔ editing a nested region preserves siblings and independently edited latest data (2.36789ms)
✔ stale nested paths cannot write into a sibling or silently replace the parent (0.640278ms)
✔ curve drag has one pointer owner; another finger cannot move, finish, cancel or replace it (3.919023ms)
✔ cancellation restores the starting recipe once and a late lost-capture event cannot repeat it (0.862173ms)
✔ window-level cancellation without a pointer id uses the same ownership and rollback rule (0.898608ms)
✔ source changes invalidate late move, up, cancel and lost-capture paths without writing old data (2.271183ms)
✔ a changed channel cannot receive a former channel gesture or its rollback (0.446024ms)
✔ releasePointerCapture reentrancy cannot turn a committed drag into a rollback (0.420866ms)
✔ an external commit interrupts the drag so late move, commit and cancel preserve the new edit (3.61868ms)
✔ several synchronous owned previews remain cancellable without requiring a React render (0.409539ms)
✔ unavailable capture and explicit discard leave no dangling transaction (0.416479ms)
✔ a local curve transaction owns the whole recipe and cannot commit after its scope changes (0.444963ms)
✔ unchanged image export prepares the encoded bytes with the captured source filename (1.648604ms)
▶ source, recipe, generation, loading and unmount changes discard a late export before URL allocation
  ✔ new source with the identical recipe (0.280825ms)
  ✔ changed adjustments on the same source (0.210889ms)
  ✔ replacement recipe object even when values happen to match (0.222046ms)
  ✔ new request generation (0.203358ms)
  ✔ pending source replacement (0.189216ms)
  ✔ unmounted owner (0.133071ms)
✔ source, recipe, generation, loading and unmount changes discard a late export before URL allocation (2.341072ms)
✔ a slower superseded export cannot replace the newer source result (0.395298ms)
✔ an already unavailable export does not start encoding (0.301776ms)
✔ codec failures remain actionable only for the current request owner (0.596682ms)
✔ delivery disables image and recipe actions during decode or pending cloud source lookup (9.134769ms)
✔ two consumers of the same immutable preview share its exact histogram allocation (1.550807ms)
✔ new frame identity recomputes independently and never returns the preceding frame counts (0.193813ms)
✔ absent frames remain absent without creating placeholder counts or mutating a cached result (0.334356ms)
✔ late image download cannot overwrite edits made while its network request was pending (3.488718ms)
✔ late referenced-layer decoding stops after project switch even if the same recipe is selected (1.690527ms)
✔ unchanged request may commit while changed source identity cancels an otherwise identical recipe (0.755373ms)
✔ history binding resolves the old immutable source and rejects the current source or foreign project (0.538795ms)
✔ component motion has explicit independently selected desktop, tablet and phone tracks (1.175017ms)
✔ all media-containing wrappers keep zero blur in every breakpoint (0.143087ms)
✔ CSS includes reduced-motion and gesture escape paths with hidden state inert support (0.771867ms)
✔ selecting a compact-panel parameter reveals its whole main control with bounded local scrolling (0.694721ms)
✔ a control taller than an unusually short panel aligns its heading rather than oscillating (0.116115ms)
✔ the shelf retains named native controls, exact signed ranges, selected state and disabled availability (18.692979ms)
✔ pixel crop keeps exact boundaries at small, odd, tall and 16K sizes (9.210063ms)
✔ pixel crop clamps edge drags to at least one real source pixel (0.421338ms)
✔ numeric editor changes require trusted registry identity and leave input untouched (0.823796ms)
✔ legacy radial selection updates never erase v2 color, effects or independent regions (0.418493ms)
✔ one-pixel brush snaps a boundary click to exactly one original pixel center (1.149939ms)
✔ source preview sampling maps normalized source locations and clamps outer edge (0.71352ms)
✔ duplicate validates global brush complexity and preserves original when budget would overflow (13.574646ms)
✔ a secondary pointer cannot steal, finish or cancel the owned slider preview (1.284744ms)
✔ Escape cancellation cannot be followed by a late keyup commit (0.239572ms)
✔ keyboard chord commits once after its final key and ignores unrelated releases (0.122865ms)
✔ neutral gestures create no changed result and source unmount discards ownership (0.274886ms)
✔ v2 AI confirmation includes advanced changes alongside legacy exposure (2.232385ms)
✔ v3 confirmation lists inherited color/effects and new optical/transform parameters (2.910069ms)
✔ v3 retained masks, groups, paint, composition and warp changes are explicitly disclosed (4.129743ms)
✔ non-numeric review ignores object key order but preserves ordered-layer and curve differences (0.844036ms)
✔ equal JSONB-style reordered recipes do not create false numeric changes (0.434897ms)
✔ legacy candidates remain legacy and non-numeric replacements are explicitly named (0.955504ms)
✔ preview preparation is an exact reference identity when geometry already fits the budget (7.278713ms)
✔ adaptive downsampling preserves alpha with premultiplied linear area reconstruction (2.053434ms)
✔ output-aware planning handles rotation, projective crop and scale without rewriting recipe or source coordinates (8.87087ms)
✔ actual worker protocol downsizes expanded previews and retains the full transformed export and layer coordinates (1496.530072ms)
✔ worker fallback keeps original pixels after transfer, resolves layer aliases and clears them for a new source (19.419666ms)
✔ render readiness includes active displacement and protection but excludes disabled warp edits (5.534325ms)
✔ painting and source sampling reject transparent contain corners while shape handles can clamp (2.7646ms)
✔ layer handles retain off-frame freedom and pixel painting follows inverse displacement (1.517595ms)
✔ prefers native randomUUID and keeps the Web Crypto receiver (0.794701ms)
✔ HTTP-style Crypto without randomUUID uses exactly 16 random bytes (0.16546ms)
✔ fallback enforces v4 and RFC variant bits while preserving the remaining entropy (0.537713ms)
✔ a native UUID failure can fall back only to a working secure RNG (0.152341ms)
✔ no RNG is an explicit unavailable error, never a weak identifier (0.486555ms)
✔ a failing secure RNG rejects rather than returning zero or pseudo-random bytes (0.142515ms)
✔ 844×390 restores all dock modes inside the workspace and above the reachable toolbar (1.307266ms)
✔ continuous panel sizes are bounded by available pixels, not a 330px product ceiling (0.182566ms)
✔ phone width, height, floating positions and side docking remain user choices (0.234364ms)
✔ a very large docked panel never automatically covers the photo; explicit overlay remains available (0.900772ms)
✔ a 339px saved phone sheet preserves the complete exclusion area at both 320×700 and 390×844 (0.314756ms)
✔ fresh phone defaults reserve photo pixels without beginning in overlay (0.349328ms)
✔ low-room guidance uses actual fit space without changing composition or limiting manual sizes (0.323198ms)
✔ side docks and short windows deduct their own viewport chrome and fit padding (0.288976ms)
✔ 320px quick photo view preserves the requested 339px panel and keeps fitted images above it (0.486335ms)
✔ measured banners and keyboard space constrain panels without overwriting their saved rectangle (0.222557ms)
✔ maximize and collapse are derived display modes with an exact normal-size return path (0.231139ms)
✔ undocking preserves the visible origin and keyboard movement supports one pixel (0.224179ms)
✔ floating west/north resize holds the opposite edge through minimum size and viewport limits (0.332472ms)
✔ bottom sheets resize symmetrically in width and retain their bottom anchor in height (0.131178ms)
✔ resizing across six actual QA sizes keeps every edge accessible (4.744211ms)
✔ layout parsing repairs unavailable display modes and rejects corrupt old preferences (0.464713ms)
✔ multimodal SQL integration requires the explicit CI database when requested (0.687009ms)
▶ multimodal jobs use real SQL, private normalized images and injected supplier boundaries
  ✔ v3 plans preserve image dependencies and fine transform, while unuploaded or foreign layer references create no hold (96.746774ms)
  ✔ new v2 numeric plans freeze their protocol, moderate generated changes and preserve existing masks without auto-applying (56.554098ms)
  ✔ invalid generated v2 paths never publish and retain their genuine receipt plus unknown hold (56.356598ms)
  ✔ old frozen v2 tasks retain the legacy adjustment protocol and digest while new protocol tampering fails before dispatch (83.514918ms)
  ✔ text iteration explicitly freezes its successful same-project parent, without implicit full chat history (93.829785ms)
  ✔ image submit is idempotent, reserves once and exposes no generated asset until normalized-byte review passes (92.481492ms)
  ✔ text generation freezes document context and returns a candidate without overwriting the live document (50.601128ms)
  ✔ speech success retains only the audio hash, omits raw audio from DTOs and does not execute edits (59.292091ms)
  ✔ edit-plan still returns a complete frozen-recipe candidate without changing the artwork (49.691247ms)
  ✔ successful empty ASR becomes an explicit no-speech result and settles once without fabricated text (56.423139ms)
  ✔ input review rejection and review-hash mismatch do not call a billable image model (74.864136ms)
  ✔ reference-image block prevents generation and preserves the existing source (56.348345ms)
  ✔ blocked generated image is never attached or exposed, private bytes are removed and billing remains unknown (52.907218ms)
  ✔ independent image adapter returning a wrong decoded size cannot bypass worker validation (45.668037ms)
  ✔ post-generation text moderation block preserves the source and never publishes the candidate (42.176407ms)
  ✔ unknown image outcome is not retried and only an operator can settle it idempotently (76.825491ms)
  ✔ a definitive model refusal releases the hold for all four operations without a retry (154.411631ms)
  ✔ a definitive output-review error cannot release a hold after the model has already succeeded (112.792866ms)
  ✔ speech unknown, invalid frozen bytes and stale worker recovery all redact raw audio without retry (100.644599ms)
  ✔ authorization and project scoping reject outsiders, wrong wallets and cross-project references before a hold (26.425362ms)
  ✔ text permission revoked during asynchronous input review stops the billable call (41.094091ms)
  ✔ model disabled during input review stops image dispatch even though admission was valid (47.3622ms)
  ✔ speech permission revoked during journal persistence stops transcription and erases queued audio (40.520598ms)
  ✔ image revocation during output review prevents asset attachment and discards the private candidate (54.446729ms)
  ✔ frozen manifest detects tampering and binds image row model to the approved model (56.869855ms)
  ✔ a missing frozen reference cannot silently downgrade an approved reference-image request to text-only generation (41.026223ms)
  ✔ reference revocation during image review prevents its bytes from being sent to generation (35.315663ms)
  ✔ edit-plan integrity includes the whole base recipe, not only currentAdjustments sent to the LLM (38.51633ms)
  ✔ an existing dispatch record freezes a restored queued image job instead of sending it again (39.241408ms)
  ✔ restored image dispatch evidence wins over later model disablement and cannot release the paid hold (38.27497ms)
  ✔ restored plan dispatch evidence wins over revoked membership before any access-denied release (48.43944ms)
  ✔ missing database dispatch evidence halts new work instead of silently rebuilding vendor requests (17.035406ms)
✔ multimodal jobs use real SQL, private normalized images and injected supplier boundaries (1984.959983ms)
▶ OpenAI persistent batch lifecycle, accounting, references and real request lineage
  ✔ lost acknowledgement after a real batch COMMIT keeps every published image and settles once (127.795166ms)
{"event":"ai_asset_cleanup_deferred"}
  ✔ unknown output plus unavailable cleanup check retains private bytes without publishing them (67.684577ms)
  ✔ n outputs reserve n times the selected quality price once; queued price does not change (83.770541ms)
  ✔ input denial releases the whole reservation and calls no image supplier (50.357442ms)
  ✔ one rejected output leaves the entire batch unpublished, unknown and not retried (91.065918ms)
  ✔ references and mask use exact hashed bytes; parent output is explicitly selected and persisted (204.880041ms)
  ✔ a reference revoked during supplier execution prevents all publication (80.104699ms)
  ✔ batch cardinality and transport uncertainty keep the complete hold; malformed options create none (149.228665ms)
  ✔ editing queued parameters cannot replace the frozen payload or mint a cheaper multi-image job (47.886878ms)
✔ OpenAI persistent batch lifecycle, accounting, references and real request lineage (953.249877ms)
✔ endpoint allowlist rejects userinfo, off-region, query and redirect targets (1.188408ms)
✔ frozen input hashes include endpoint, exact JSON body and requested adjustments (0.864498ms)
✔ AI proposals cannot call arbitrary tools, overwrite geometry or exceed parameter bounds (4.156489ms)
✔ AI legacy adjustment proposals preserve the complete v2 recipe and never gain access to its new fields (3.103976ms)
✔ new v2 plans expose only registry numeric values, keep the old default protocol byte-for-byte and bound moderation input (1.58596ms)
✔ v2 proposals atomically validate joint levels, report actual differences and preserve all regions (3.964738ms)
✔ v3 global proposals preserve fine geometry, layers and warp without exposing their private data to the provider (7.974596ms)
✔ v2 whitelist rejects arbitrary paths, duplicates, non-finite numbers, integer violations and invalid final levels (2.043942ms)
✔ real HTTP adapter uses bounded JSON, authorization, no redirects and never retries (8.157702ms)
✔ Qwen adapter retains vendor receipt for incomplete responses and rejects a definite error without retry (2.112847ms)
✔ database integration is explicitly required by CI (0.647299ms)
▶ AI transaction, moderation, idempotency, unknown and restore invariants
  ✔ one submission reserves once; completed candidate never modifies the artwork (55.130243ms)
  ✔ input rejection never calls the model and releases the original lot (35.679224ms)
  ✔ ambiguous external result holds points and is never automatically retried (38.990707ms)
  ✔ existing dispatch evidence prevents re-execution of a restored queued row (26.488037ms)
  ✔ changed head and revoked membership reject new paid requests (7.883528ms)
  ✔ journal record missing from restored DB stops all future dispatch (5.010993ms)
✔ AI transaction, moderation, idempotency, unknown and restore invariants (201.081644ms)
✔ module registry rejects duplicates, missing dependencies and cycles without executing code (5.223823ms)
✔ asset copy contract accepts only a destination and stable request key, never caller ownership or bytes (1.787334ms)
✔ sealed registry isolates caller data, resolves explicit gates and cannot pretend a contract has an executor (3.828112ms)
✔ decision schema keeps kind-specific fields, CAS and idempotency explicit (4.040048ms)
✔ shared source frame binds analysis to normalized pixels and command envelope carries no actor authority (1.360679ms)
▶ schema readiness uses the migration registry and rejects old, incomplete and newer databases
  ✔ migrate and readiness agree on the actual highest registered migration (8.934067ms)
  ✔ old v2 (6.47673ms)
  ✔ missing intermediate (5.428273ms)
  ✔ newer than this code (5.514513ms)
  ✔ empty (4.453818ms)
  ✔ doctor CLI reports the complete current schema without contacting vendors (320.543822ms)
✔ schema readiness uses the migration registry and rejects old, incomplete and newer databases (373.415938ms)
✔ recipe construction owns its arrays and the shared default is deeply frozen (1.864761ms)
✔ full-recipe validation rejects malformed versions, unknown params, NaN and negative detail (1.632159ms)
✔ validation does not invoke getters and rejects inherited/prototype payloads (0.600469ms)
✔ JSON round trip has deterministic versioned data and no references to the input (0.626168ms)
✔ neutral recipe is byte-identical for all byte values and alpha, but never mutates input (1.839694ms)
✔ exposure performs linear-light EV rather than multiplying encoded bytes (0.818669ms)
✔ signed light tools move in both directions, and brightness is not exposure (2.361993ms)
✔ contrast has a midtone pivot and highlight/shadow controls target different tonal ranges (0.652998ms)
✔ saturation -100 is grayscale and vibrance leaves neutral gray neutral (0.662312ms)
✔ temperature and tint have signed, distinct relative color semantics (0.530393ms)
✔ curve endpoints, channel isolation and RGB-then-channel order are explicit (2.245648ms)
✔ bad curve ordering, duplicate x, missing endpoints and accessors are rejected (0.625036ms)
✔ crop, all clockwise rotations and output-axis flips are exact RGBA permutations (0.864408ms)
✔ geometry helpers use actual crop quantization and invert across all rotations/flips (0.900273ms)
✔ alpha survives every adjustment and transparent color cannot bleed through detail filters (3.541048ms)
✔ soften reduces a small local fluctuation and sharpening increases it without changing flat fields (0.530673ms)
✔ radial feather and inverse have bounded complementary weights (0.495399ms)
✔ enabled local tone and smoothing leave every outside pixel byte-identical to the global baseline (1.55981ms)
✔ inverted local mask protects its center and local detail does not become a global effect (0.49554ms)
✔ histograms count visible pixels, preserve channel bins and ignore hidden RGB (0.216668ms)
✔ bounds reject excessive dimensions, incomplete buffers and unauthorized budget enlargement (0.380646ms)
✔ extreme valid settings remain bounded, keep alpha, and do not mutate recipes (2.929252ms)
✔ worker-rendered preview and main-thread export use identical canonical pixels for the same input (115.052036ms)
✔ BMP preflight supports explicit uncompressed RGB variants and rejects alternate encodings (1.862608ms)
✔ real static GIF is inspected through complete frame/trailer and rejects truncation/animation (7.804297ms)
✔ real AVIF primary-image associations work for RGB and alpha; sequence/missing/invalid boxes fail closed (27.545667ms)
✔ header inspection requires explicit larger image budget, bounded at 64MP/16384 (0.527498ms)
✔ AVIF dimensions are selected through the actual primary item association, not the first ispe (3.056124ms)
✔ AVIF FullBox fields cannot borrow bytes from a following sibling box (0.924198ms)
✔ AVIF item counts, item IDs, primary flags and minimum AV1 configuration are checked (0.583203ms)
✔ AVIF rejects duplicate singleton metadata instead of choosing an arbitrary primary (0.503782ms)
✔ AVIF scans visible top-level boxes after meta and rejects sequence or duplicate metadata (0.386134ms)
✔ AVIF box lengths, extended sizes and bounded nesting fail closed (4.766683ms)
✔ AVIF distinguishes an intentionally bounded large-file prefix from a truncated complete small file (11.013713ms)
✔ BMP validates signed dimensions, padded row footprint and declared payload before decoding (0.46932ms)
✔ GIF counts actual image blocks, bounds extensions and requires the complete static trailer (0.653008ms)
✔ extended formats share explicit pixel budgets without allocating decoded high-resolution images (0.586317ms)
✔ header preflight recognizes static PNG, 8-bit JPEG profiles and both WebP bitstreams (2.774318ms)
✔ animation declarations are flagged before any decoder is constructed (0.658236ms)
✔ header dimensions block zero sizes, huge sides and decompression pixel bombs (0.468369ms)
✔ PNG preflight checks header CRC, chunk boundaries, ordering and bounded metadata (44.382681ms)
✔ JPEG preflight rejects malformed segments, alternate size frames and unknown coding modes (0.384612ms)
✔ WebP preflight checks RIFF length, padding, frame signatures, versions and canvas mismatch (0.348858ms)
✔ unsupported signatures and oversized header buffers fail closed (0.319373ms)
✔ tiled neutral rendering preserves all RGBA byte values and disabled local state (4.166043ms)
✔ all stages match the reference byte for byte for several non-dividing tile sizes (44.476859ms)
✔ fractional crop, all rotations and output flips share exact geometry with the reference (124.5793ms)
✔ default 512-pixel tile boundaries and partial edge tiles have no seams or alpha drift (451.273837ms)
✔ two consecutive radius-1 detail stages retain their full two-pixel dependency halo (2.030519ms)
✔ radial masks, feather and inversion remain in original whole-image coordinates across tiles (86.855219ms)
✔ crop-border detail samples include neighbors outside the crop just like pre-crop reference processing (2.86404ms)
✔ single-pixel, row, column and small transparent images retain correct real-image edge extension (1.841934ms)
✔ Float32 work buffers are tile-sized and allocated twice, then reused for all tiles (47.818714ms)
✔ the explicit tiled path supports a 16,384-pixel side without widening reference-renderer admission (1.270991ms)
✔ a real 20MP input with a small crop uses only cropped tiles and honors an explicitly lower admission budget (6.387687ms)
✔ high-resolution geometry helpers map coordinates without requiring a whole-image float allocation (0.45687ms)
✔ tiled input budgets, tile size, buffer completeness and cancellation fail before unsafe work (1.952813ms)
✔ tiled rendering in a real worker uses the same canonical pixels as reference export (196.332858ms)
✔ compiled radial masks preserve the old radial mathematical convention (1.445966ms)
✔ linear gradient projection uses source pixel aspect, bounded endpoints and optional smoothing (0.245751ms)
✔ polygon selection has pixel-aspect-aware inward feather and exact zero exterior (0.455749ms)
✔ brush capsules are continuous between samples and maintain circular source-pixel radii (0.402328ms)
✔ brush additive/subtractive strokes compose ordered coverage without point-density buildup (0.478373ms)
✔ a half-pixel brush selects exactly one pixel center at the maximum admitted square dimensions (0.890126ms)
✔ RLE masks preserve every byte weight at source cell centers and explicit normalized resizing (1.969878ms)
✔ continuous source color selection wraps hue, distinguishes grey and preserves transparent exclusion under inversion (0.592055ms)
✔ continuous color saturation and encoded-luminance bands feather independently (0.355448ms)
✔ color overlay can explicitly sample a smaller original preview through normalized coordinates (0.27746ms)
✔ compiled mask domain rejects non-finite samples and bounds inverse selection to the actual source image (0.400375ms)
✔ version dispatch is explicit and never drops unknown version fields (4.504471ms)
✔ explicit v1 migration preserves all common fields and owns every nested value (2.403814ms)
✔ AI-safe base adjustment patch preserves version, masks and every v2 control (3.031663ms)
✔ the v2 registry exactly addresses implemented bounded controls and canonical defaults (21.504731ms)
✔ v2 rejects invalid coupled ranges, integer seeds, incomplete masks and unsupported fields (0.874502ms)
✔ new nested validators do not execute accessors or accept prototype payloads (0.92633ms)
✔ discriminated region builders replace masks without leaking radial fields (2.840794ms)
✔ mask validation enforces finite geometry, nondegeneracy, RLE coverage and complexity caps (50.659147ms)
✔ default v2 is an exact RGBA identity and migrated v1 replays byte-for-byte in both renderers (18.24266ms)
✔ levels independently set input endpoints, gamma direction and output endpoints (2.379738ms)
✔ each of eight HSL bands has real signed hue, saturation and lightness behavior without recoloring grey (15.006387ms)
✔ HSL interpolation is continuous across hue zero and stable at extreme dark levels (0.65441ms)
✔ three-way color grading and split-tone settings affect the intended tonal weights (1.535792ms)
✔ monochrome and fade have separate linear-luminance and encoded-range semantics (0.471333ms)
✔ vignette has signed exposure, adjustable source-space center/radii and a neutral interior (1.550344ms)
✔ grain is deterministic by source coordinate and seed, has real size/color modes and leaves alpha intact (5.485112ms)
✔ texture and clarity are signed, spatially distinct, flat-preserving and alpha-weighted (3.700384ms)
✔ every manual mask type produces a real local edit with exact zero-weight outside preservation (5.762642ms)
✔ ordered regions, opacity, disabled state and invert retain real independent semantics (1.897079ms)
✔ a real one-pixel edit preserves every exterior RGBA byte and ignores transparent neighbor colors (2.075378ms)
✔ continuous color-range remains bound to unmodified source pixels after global and prior regional edits (1.975697ms)
✔ all v2 stages preserve alpha and hidden RGB without mutating source or recipe (13.9304ms)
✔ full/tiled v2 share exact pixels for all stages, masks, geometry and nondividing tile edges (841.993305ms)
✔ maximum ordered detail dependency uses the complete twelve-pixel halo (59.640064ms)
✔ v2 default tile size crosses a real 512 boundary without seams, including source-anchored noise (39.322448ms)
✔ v2 full/tiled handle real image edges, singleton axes, budgets and cancellation (6.228847ms)
✔ v2 tiled rendering allocates only two reusable tile-sized Float32 work buffers (19.847785ms)
✔ every registered extreme remains a bounded real rendering parameter with stable alpha (29.918551ms)
✔ a real worker v2 tile export equals the main-thread reference for the same frozen input (244.791969ms)
✔ compound union/intersection/subtract/xor combine multiple soft areas with bounded inversion (2.611939ms)
✔ full regional curves, HSL and levels change only selected pixels and leave all exterior bytes untouched (15.47165ms)
✔ shared group correction is applied once across overlapping regions, with independent per-region edits afterwards (14.355453ms)
✔ region and group enable/opacity controls are independent and zero is exact identity (2.800865ms)
✔ source-color selection is fixed to immutable input even after global color adjustments (4.468486ms)
✔ every declared blend mode is finite, alpha-correct and distinguishes representative colors (0.643202ms)
✔ normal/multiply/screen/soft-light use their actual distinct equations, with transparent backdrops unaffected by blend choice (0.237029ms)
✔ a half-pixel paint stroke controls exactly one RGBA pixel and leaves its neighbors byte-identical (1.877879ms)
✔ paint opacity and isolated erasing do not erase the original image (2.915387ms)
✔ clone strokes sample a fixed pre-paint source instead of repeatedly sampling already painted pixels (1.384763ms)
✔ paint mask, visibility and layer order are genuine non-destructive compositing controls (2.90355ms)
✔ image layers resolve explicit pixels and perform placement, scale, alpha, masking and rotation (4.079638ms)
✔ disabled image layers never trigger resolution and can be retained without a fake output (1.119392ms)
✔ warp has signed compact support and distinct push, pinch, bulge and twirl fields (0.467978ms)
✔ warp protection locks selected background pixels exactly, including alpha and hidden RGB (5.334654ms)
✔ zero or disabled warp remains byte-identical and off-region pixels are not resampled (2.27535ms)
✔ luminance and chroma denoising operate independently, preserve flat fields and alpha (6.424663ms)
✔ signed chromatic aberration shifts the chosen channel without changing alpha or other channels (2.368341ms)
✔ all new source-space stages have identical full/tiled output across non-dividing tile edges and preserve input ownership (73.386547ms)
✔ spatial brush indexing preserves continuous capsules and does not build up opacity from denser samples (8.785692ms)
✔ paint workload admission rejects excessive paths before any image-sized byte allocation (96.762918ms)
✔ reusing one immutable image source in several layers counts its pixels once (1.444273ms)
✔ tiled v3 allocates only tile-sized Float32 buffers even across local color and paint layers (67.628121ms)
✔ a real worker exports v3 source layers, regional edits and geometry byte-identically to the main-thread reference (139.293335ms)
✔ v3 neutral migration reproduces original v1/v2 bytes including legacy locals, crop and alpha (28.587138ms)
✔ all-angle affine/projective source/output mappings round-trip through integer crop and quarter turns (35.840274ms)
✔ fine exact quarter-turn rotation swaps dimensions and produces no extra border pixels (4.078025ms)
✔ fine fractional rotation adds real transparent support and crop mode retains the chosen output frame (2.944912ms)
✔ fine quarter turns preserve hidden transparent RGB across round-off in both rotation directions (27.314324ms)
✔ compiled frame mapping retains exact legacy crop quantization and every quarter-turn/flip convention (18.165383ms)
✔ translation and independent axis scales are real geometric operations with invertible hit testing (2.429403ms)
✔ v3 geometry validates allocation budgets and singular or horizon-crossing transforms before rendering (2.645189ms)
✔ premultiplied linear reconstruction excludes hidden transparent colors and preserves neutral transparent data (1.824628ms)
✔ v3 rendering is cancellable at admission and through repeated pixel-row checks (1.399256ms)
✔ compiled gesture coordinates distinguish frame controls from inverse-warp content picking (1.710917ms)
✔ v3 creation owns defaults, round-trips strict JSON and never silently downgrades (10.330378ms)
✔ v3 global registry exposes exact defaults and generic setters retain all extension data (36.023592ms)
✔ v3 validation rejects unknown keys, invalid versions and incomplete color blocks (3.777929ms)
✔ v3 parser never executes accessors and rejects cycles, symbols, exotic prototypes and sparse arrays (1.814648ms)
✔ groups reference unique explicit identities and have independent validated complete color blocks (4.853317ms)
✔ operation provenance is bounded inert data and can carry a complete person control vector (2.908392ms)
✔ compound masks preserve discriminants and enforce depth, node and shape budgets (0.360646ms)
✔ paint validation enforces alpha/channel, finite coordinates and clone origins before any rendering (35.241258ms)
✔ image layers use bounded resource identities and reject URL payloads and illegal dimensions (2.328174ms)
✔ strict WAV validates actual duration including the 30-second boundary and typed-array offsets (98.400437ms)
✔ WAV rejects compressed, stereo, wrong-rate, wrong-byte-rate, missing, truncated and oversized input (7.360883ms)
✔ WAV rejects appended data, duplicate chunks and forged RIFF lengths (0.237189ms)
✔ provider setup has no implicit enabled model or endpoint bypass (1.114747ms)
✔ Ark audited profiles enforce request dimensions, reference types and model allowlists before dispatch (1.481883ms)
✔ Ark single-image request sends real official fields with reference bytes and keeps AI watermark (7.300362ms)
✔ Ark older group-capable profiles explicitly disable multiple output and streaming (1.246387ms)
✔ Ark rejects URL-only output, extra images, malformed base64 and wrong real dimensions as unknown (3.13147ms)
✔ HTTP refusal is distinguished from uncertain billing and raw provider error text is not propagated (1.18905ms)
✔ response readers reject announced excess, streamed excess, invalid JSON and interrupted bodies (1.967118ms)
✔ Qwen transcription uses allowed Beijing workspace endpoint and base64 WAV, never a public audio URL (0.506898ms)
✔ Qwen rejects unsafe input locally and treats truncated/malformed transcription as unknown (0.855175ms)
✔ OpenAI adapter is disabled without explicit enable/key/model allowlist and refuses arbitrary endpoints (109.028435ms)
✔ OpenAI generation uses the fixed real Images JSON protocol and returns all requested raster outputs (157.135023ms)
✔ OpenAI edit protocol sends exact normalized reference and markup bytes, with 2.6 complexity (15.370348ms)
✔ OpenAI mask requires a matching transparent PNG and never silently flattens a guide (14.193345ms)
✔ OpenAI profiles enforce real quality, format dependencies, current size evidence and batch budgets locally (0.716464ms)
✔ OpenAI JPEG and WebP compression is transmitted and decoded as the requested real format (1.497897ms)
✔ explicit transparency checks actual decoded alpha, not a filename or response declaration (1.49955ms)
✔ OpenAI ambiguous or partially completed batch responses stay unknown, preserve request receipt and never retry (3.850209ms)
✔ portrait analysis is owned, strictly source-bound and rejects stale IDs, duplicate targets and unknown fields (14.487431ms)
✔ portrait boundary rejects accessors, non-finite landmarks, sparse data and invalid visibility without executing them (1.365987ms)
✔ bounded off-image pose estimates retain a valid face and visible shoulders without enabling invisible legs (27.343742ms)
✔ open eyebrow chains use all hull vertices while only actually closed edges form contour loops (0.506577ms)
✔ face skin and lipstick masks protect eyes and the mouth cavity (2.03468ms)
✔ all registered face/body controls compile to real valid primitives with their own named targets (152.492522ms)
✔ every enabled portrait control produces real pixels, signed controls reverse, and tiled export matches the preview engine (456.26418ms)
✔ portrait controls replace their own operations without growing repeated slider changes or modifying other modules (17.370826ms)
✔ detaching a whole person preserves pixels and provenance while allowing a new automatic pass without IDs colliding or manual edits being overwritten (27.131691ms)
✔ makeup color is per tool and does not leak into numeric controls or recolor other tools on unrelated changes (17.171915ms)
✔ automatic recompilation refuses manual changes, deletion, ordering and missing checksums without losing the existing recipe (75.892125ms)
✔ changing automatic values retains existing order relative to later independent layers (9.515223ms)
✔ two fully configured portrait targets fit published operation budgets and keep independent values (78.798695ms)
✔ body tools check only the joints they need, retaining shoulder editing when lower-body joints are hidden (2.757804ms)
✔ tilted non-square portraits push their chin along the actual pixel-space facial axis (2.61623ms)
✔ sideways and inverted portraits retain a mouth-oriented facial axis instead of the screen vertical (7.502237ms)
✔ makeup options and RGBA reject sparse data and accessors without running user code (4.890223ms)
✔ a large face can receive masked makeup without an illegal paint radius or painting the mouth cavity (5.496561ms)
✔ semantic zero/reset remains identity and can remove a previous effect even if new contours are unavailable (10.06162ms)
✔ analysis adapter validates configuration, source binding, preview ratio and response version before accepting inference (5.148454ms)
✔ analysis adapter rejects cancelled work before and after inference and never treats partial output as success (0.883828ms)
✔ Tencent adapters have no unconfigured delivery or moderation bypass (1.627945ms)
✔ TC3 authorization binds exact body, action and UTC credential scope (1.690689ms)
✔ SMS uses official fixed endpoint, one approved purpose template and exact recipient receipt (7.66318ms)
✔ network errors, streamed interruption, invalid envelopes and large responses stay unknown without retries (3.237561ms)
✔ definite Tencent client rejection differs from ambiguous internal failure (1.44676ms)
✔ text moderation binds exact UTF-8 bytes and keeps Review distinct from Pass (1.261169ms)
✔ image moderation hashes the exact file and refuses small, mismatched or oversized content before external dispatch (13.958641ms)
✔ real JPEG/PNG/WebP/AVIF/static GIF/single-page TIFF codecs normalize to private PNG (67.996393ms)
✔ real animated GIF/WebP and multipage TIFF are rejected without first-frame flattening (13.851558ms)
✔ APNG/AVIF sequence declarations and unsupported containers are refused before decoding (16.814774ms)
✔ high-resolution normalization processes a real 20MP source and enforces independent server bounds (422.566709ms)
✔ streaming byte cap and process-wide decoder admission apply across storage instances (11.806579ms)
✔ private thumbnails preserve aspect and alpha, do not enlarge, and reuse immutable cached files (75.912845ms)
✔ model preparation rejects a truncated task even when its bad download hash was recorded (1.330454ms)
✔ model preparation validates length and TFLite magic independently of its hash (0.410341ms)
✔ model preparation requires a complete archive directory and exact versioned pose size (0.310931ms)
ℹ tests 444
ℹ suites 0
ℹ pass 444
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 28978.735006
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````

## web-build

原始文件：`v3-final-03-web-build.log`；SHA-256：`56430969d2a94913c37332c7e337e7d4068890f0b0833ae231c325f0a7e5fb27`。

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

✓ built in 556ms
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

````

## production-dependencies

原始文件：`v3-final-03-production-dependencies.log`；SHA-256：`70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c`。

````text
found 0 vulnerabilities
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````
