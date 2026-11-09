# v3-final-01 实际运行记录

机器记录如下；本页复制真实输出，不将测试清单当作人工逐行审计。

```json
{
  "label": "v3-final-01",
  "startedAt": "2026-11-09T18:26:17.479Z",
  "finishedAt": "2026-11-09T18:27:27.778Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "e9bfb4480d3ad2e7fa865fbd31416c3131ea603e9c684814e6ee321e99613366",
  "inventory": "v3-final-01-inventory.json",
  "files": 283,
  "sourceLines": 82421,
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 22212,
      "log": "v3-final-01-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 29086,
      "log": "v3-final-01-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 945,
      "log": "v3-final-01-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 18049,
      "log": "v3-final-01-production-dependencies.log"
    }
  ],
  "passed": true
}
```

## typecheck

原始文件：`v3-final-01-typecheck.log`；SHA-256：`a9cbeed8f1d9b26b6285203e7aaf4f61472bdc5b69a22f7bc2f539ab940d4b90`。

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

原始文件：`v3-final-01-tests.log`；SHA-256：`9b3e3055b78c3470975af1d668f4bb1902760b5470b8d0da2b8770e2ed30f309`。

````text

> ai-xiutu@0.1.0 test
> node scripts/test.mjs

▶ queued cancellation and disabled-provider recovery use actual SQL and API ACL
  ✔ disabled capabilities still expose authorized cancellation; concurrent retries release once (144.944284ms)
  ✔ revoked or suspended actor cannot cancel; owner can release queued work without private operator access (58.463907ms)
  ✔ cancel racing an already dispatched request never releases or resends it (59.98732ms)
  ✔ restored queued rows with dispatch or unreadable evidence become unknown without refunds (208.932318ms)
  ✔ all adapters disabled still recover every stale operation once, redact audio and preserve receipts/holds (206.278178ms)
  ✔ missing backup evidence stops dispatch but never prevents conservative stale recovery (42.408609ms)
✔ queued cancellation and disabled-provider recovery use actual SQL and API ACL (961.715039ms)
▶ AI result decisions, immutable source history and composition ACL
  ✔ forward migration preserves existing history and backfills retained storage without double counting (150.234195ms)
  ✔ public discovery resolves unconfigured adapters honestly and exposes no credentials (15.578999ms)
  ✔ fixtures create real immutable uploads, source snapshots and completed candidates (102.628923ms)
  ✔ missing session, outsider, viewer and platform operations do not gain adoption privileges (22.429274ms)
  ✔ rejection records an immutable decision without changing already settled points (53.704288ms)
  ✔ concurrent identical forks create one branch and changing a reused key fails (35.032173ms)
{"event":"api_error","requestId":"req-k","errorType":"Error","code":"INTERNAL"}
  ✔ lost adoption COMMIT acknowledgement replays the committed branch without duplicating it or settling again (30.60819ms)
{"event":"api_error","requestId":"req-n","errorType":"Error","code":"INTERNAL"}
  ✔ failed decision persistence rolls back its artwork and source snapshot in the same transaction (20.549182ms)
  ✔ adopting an image as a layer preserves its base, parameters, contain placement and immutable source history (93.049971ms)
  ✔ AI layer adoption checks capacity, output provenance and project ownership before appending (50.252916ms)
  ✔ replace atomically changes current source, preserves old source and rejects stale proposals (42.524444ms)
  ✔ restoring history appends source plus recipe together and uses CAS (30.376639ms)
  ✔ outdated parameter proposal may be preserved as a branch from its original source (16.806556ms)
  ✔ matching parameter suggestion applies exactly once and records a new revision (20.90257ms)
  ✔ text adoption creates document snapshots and prevents stale replacement (33.974523ms)
  ✔ wrong output type/index, unfinished jobs and attempted automatic refund fail closed (32.157828ms)
  ✔ composition saves enforce same-project image dependencies and block deletion from history (67.661332ms)
  ✔ cross-space copy remaps all composition source IDs to independently authorized assets (49.713419ms)
  ✔ user decision history stays project scoped after membership revocation (8.682242ms)
✔ AI result decisions, immutable source history and composition ACL (1001.672297ms)
▶ asset annotations, authorized organization and v2 revision persistence
  ✔ additive migration is repeatable and user declarations preserve timezone without changing image bytes (38.885672ms)
  ✔ viewer and platform operator cannot edit or inspect unauthorized private annotations (31.691666ms)
  ✔ annotation validation rejects implicit timezones, unexpected GPS/export flags and malformed tags (19.019711ms)
  ✔ real project/space filters and exact microsecond cursors do not lose same-millisecond assets (35.561125ms)
  ✔ expired or revoked reference grant cannot query metadata; old cursor does not preserve access (10.362993ms)
  ✔ actual upload origin is recorded explicitly; a suggestive filename never implies AI provenance (34.085112ms)
  ✔ full v2 recipes and region data persist through ordinary artwork/revision CAS (29.664751ms)
{"event":"api_error","requestId":"req-z","errorType":"Error","code":"INTERNAL"}
  ✔ a lost upload COMMIT acknowledgement never deletes an already committed private asset (20.850348ms)
{"event":"upload_asset_cleanup_deferred"}
{"event":"api_error","requestId":"req-11","errorType":"Error","code":"INTERNAL"}
  ✔ an unavailable authoritative cleanup query preserves an unconfirmed private upload (14.022488ms)
✔ asset annotations, authorized organization and v2 revision persistence (386.862671ms)
▶ authorized source copies, retained capacity and durable replay use actual SQL
  ✔ real private fixtures and disabled copy policies do not silently reupload (135.036506ms)
  ✔ concurrent identical and independently keyed copies share one immutable source and one capacity charge (76.093602ms)
{"event":"api_error","requestId":"req-p","errorType":"Error","code":"INTERNAL"}
  ✔ lost commit response can be retried without a second asset or capacity reservation (56.854379ms)
  ✔ one capacity row covers concurrent copies to different projects in the same space (97.329925ms)
  ✔ byte capacity and a partial full-project copy roll back all rows and counters (62.736698ms)
  ✔ operators configure capacity with CAS but do not acquire private image access (31.461243ms)
  ✔ revoking copy policy denies new decisions but a committed same-key retry reads only its independent destination (22.891718ms)
  ✔ a non-owner copy grant binds one destination and cannot be reused as a full project grant (69.829821ms)
  ✔ grant expiry at the final publication boundary rolls back the copy, request and capacity together (40.614201ms)
  ✔ source copy cap applies across distinct idempotency keys and concurrent source assets (36.286584ms)
✔ authorized source copies, retained capacity and durable replay use actual SQL (753.848901ms)
▶ persistent API security, collaboration, quota and private media integration
  ✔ strict Origin and real unavailable SMS gate (36.720011ms)
  ✔ SMS registration, hashed sessions and invalid OTP attempt persistence (206.84242ms)
  ✔ private project ACL excludes platform operator; team roles are real (69.027446ms)
  ✔ bounded image decoding, EXIF removal and authenticated file access (60.013956ms)
  ✔ complete recipe validation, immutable revisions and CAS conflict (35.126377ms)
  ✔ comments anchor to exact revision; tasks/documents use durable CAS (39.67969ms)
  ✔ independent reference/copy policies, revocation and personal-team copy idempotency (63.172538ms)
  ✔ admin records and audited quota adjustment never grant private project access (139.703768ms)
  ✔ period uniqueness, concurrent reservations and expired unknown release conserve lots (99.439888ms)
  ✔ unconfigured AI cannot fabricate a job and revoked team members lose read access (10.022988ms)
  ✔ reset consumes its purpose code and revokes old sessions (130.779065ms)
  ✔ SQL rate limits survive app recreation and untrusted XFF cannot replace peer IP (398.601206ms)
  ✔ exactly one trusted proxy hop uses the nearest forwarded address (19.106601ms)
✔ persistent API security, collaboration, quota and private media integration (1417.718659ms)
✔ editing one region or group retains every other color block, mask, composition and version (12.899706ms)
✔ numeric controls require registry identity and preserve independent fields (0.660681ms)
✔ singular or excessive transformations are rejected before preview reaches React or the renderer (1.894561ms)
✔ all interactive mask creation kinds start from valid editable geometry (0.585197ms)
✔ image dimensions use all returned limits, including discrete lists and custom step (1.527545ms)
✔ platform or operator narrower bounds cannot be bypassed by a provider profile (0.228296ms)
✔ unsupported fields and PNG compression are absent from outgoing options (0.287606ms)
✔ transparent JPEG, excessive outputs and invalid compression are visible failures (0.224661ms)
✔ displayed service points include quality price and exact output count (0.173713ms)
✔ batch budget includes every selected image and enforces the transaction point cap (0.244991ms)
✔ uncertain decision retries retain a token without persisting generated or edited content (2.212623ms)
✔ privacy-mode storage failure and malformed persisted tokens cannot corrupt decision requests (0.48181ms)
✔ current adoption is blocked for dirty, different-project, wrong-source and stale-revision results (2.44822ms)
✔ cloud sources retain their copy policy across project changes and cannot become local uploads (1.415936ms)
✔ a lost copy response preserves one request identity while actor, source and destination are isolated (0.741284ms)
✔ persisted valid identities recover after a reload; corrupt or unavailable session storage fails safely (0.4094ms)
✔ second contact cancels a drawing transaction once and suppresses both pointers until released (0.802846ms)
✔ third contact and unrelated releases cannot unlock the suppressed transaction early (0.155986ms)
✔ duplicate down by the owned pointer is blocked without cancelling the valid stroke (0.377372ms)
✔ normal two-finger navigation remains possible but a new edit cannot join the gesture (0.110567ms)
✔ blur/source reset discards obsolete contacts without leaving the next gesture disabled (0.147223ms)
✔ rollback uses the original pre-stroke recipe and never removes a newer edit or source (3.736862ms)
✔ RGBA8 colors round-trip through both numeric color spaces without channel or alpha drift (4.387158ms)
✔ continuous hue reaches every sector rather than snapping to the quick swatches (3.717493ms)
✔ HEX shorthand and every alpha byte preserve precise RGBA data (1.120718ms)
✔ editing a nested region preserves siblings and independently edited latest data (2.21681ms)
✔ stale nested paths cannot write into a sibling or silently replace the parent (0.554691ms)
✔ curve drag has one pointer owner; another finger cannot move, finish, cancel or replace it (3.613328ms)
✔ cancellation restores the starting recipe once and a late lost-capture event cannot repeat it (0.898853ms)
✔ window-level cancellation without a pointer id uses the same ownership and rollback rule (0.983451ms)
✔ source changes invalidate late move, up, cancel and lost-capture paths without writing old data (1.238197ms)
✔ a changed channel cannot receive a former channel gesture or its rollback (0.394758ms)
✔ releasePointerCapture reentrancy cannot turn a committed drag into a rollback (0.423612ms)
✔ an external commit interrupts the drag so late move, commit and cancel preserve the new edit (2.155989ms)
✔ several synchronous owned previews remain cancellable without requiring a React render (0.690197ms)
✔ unavailable capture and explicit discard leave no dangling transaction (0.57403ms)
✔ a local curve transaction owns the whole recipe and cannot commit after its scope changes (0.474279ms)
✔ unchanged image export prepares the encoded bytes with the captured source filename (1.538693ms)
▶ source, recipe, generation, loading and unmount changes discard a late export before URL allocation
  ✔ new source with the identical recipe (0.224741ms)
  ✔ changed adjustments on the same source (0.172021ms)
  ✔ replacement recipe object even when values happen to match (0.166653ms)
  ✔ new request generation (0.168095ms)
  ✔ pending source replacement (0.150028ms)
  ✔ unmounted owner (0.189888ms)
✔ source, recipe, generation, loading and unmount changes discard a late export before URL allocation (2.123709ms)
✔ a slower superseded export cannot replace the newer source result (0.377562ms)
✔ an already unavailable export does not start encoding (0.28355ms)
✔ codec failures remain actionable only for the current request owner (0.526529ms)
✔ delivery disables image and recipe actions during decode or pending cloud source lookup (8.90485ms)
✔ two consumers of the same immutable preview share its exact histogram allocation (1.434615ms)
✔ new frame identity recomputes independently and never returns the preceding frame counts (0.194445ms)
✔ absent frames remain absent without creating placeholder counts or mutating a cached result (0.15175ms)
✔ late image download cannot overwrite edits made while its network request was pending (3.473346ms)
✔ late referenced-layer decoding stops after project switch even if the same recipe is selected (1.620957ms)
✔ unchanged request may commit while changed source identity cancels an otherwise identical recipe (0.840745ms)
✔ history binding resolves the old immutable source and rejects the current source or foreign project (0.509402ms)
✔ component motion has explicit independently selected desktop, tablet and phone tracks (1.158737ms)
✔ all media-containing wrappers keep zero blur in every breakpoint (0.242237ms)
✔ CSS includes reduced-motion and gesture escape paths with hidden state inert support (0.800183ms)
✔ selecting a compact-panel parameter reveals its whole main control with bounded local scrolling (0.75192ms)
✔ a control taller than an unusually short panel aligns its heading rather than oscillating (0.117117ms)
✔ the shelf retains named native controls, exact signed ranges, selected state and disabled availability (19.139317ms)
✔ pixel crop keeps exact boundaries at small, odd, tall and 16K sizes (8.062944ms)
✔ pixel crop clamps edge drags to at least one real source pixel (0.390111ms)
✔ numeric editor changes require trusted registry identity and leave input untouched (0.791269ms)
✔ legacy radial selection updates never erase v2 color, effects or independent regions (0.3959ms)
✔ one-pixel brush snaps a boundary click to exactly one original pixel center (1.131065ms)
✔ source preview sampling maps normalized source locations and clamps outer edge (0.44197ms)
✔ duplicate validates global brush complexity and preserves original when budget would overflow (12.797121ms)
✔ a secondary pointer cannot steal, finish or cancel the owned slider preview (1.283475ms)
✔ Escape cancellation cannot be followed by a late keyup commit (0.190759ms)
✔ keyboard chord commits once after its final key and ignores unrelated releases (0.114454ms)
✔ neutral gestures create no changed result and source unmount discards ownership (0.254886ms)
✔ v2 AI confirmation includes advanced changes alongside legacy exposure (2.557337ms)
✔ v3 confirmation lists inherited color/effects and new optical/transform parameters (2.985255ms)
✔ v3 retained masks, groups, paint, composition and warp changes are explicitly disclosed (4.182641ms)
✔ non-numeric review ignores object key order but preserves ordered-layer and curve differences (0.929719ms)
✔ equal JSONB-style reordered recipes do not create false numeric changes (0.391323ms)
✔ legacy candidates remain legacy and non-numeric replacements are explicitly named (1.003452ms)
✔ preview preparation is an exact reference identity when geometry already fits the budget (7.340408ms)
✔ adaptive downsampling preserves alpha with premultiplied linear area reconstruction (2.205263ms)
✔ output-aware planning handles rotation, projective crop and scale without rewriting recipe or source coordinates (9.351397ms)
✔ actual worker protocol downsizes expanded previews and retains the full transformed export and layer coordinates (1776.435097ms)
✔ worker fallback keeps original pixels after transfer, resolves layer aliases and clears them for a new source (17.232336ms)
✔ render readiness includes active displacement and protection but excludes disabled warp edits (6.877125ms)
✔ painting and source sampling reject transparent contain corners while shape handles can clamp (3.501007ms)
✔ layer handles retain off-frame freedom and pixel painting follows inverse displacement (1.964608ms)
✔ prefers native randomUUID and keeps the Web Crypto receiver (0.710668ms)
✔ HTTP-style Crypto without randomUUID uses exactly 16 random bytes (0.171981ms)
✔ fallback enforces v4 and RFC variant bits while preserving the remaining entropy (0.618377ms)
✔ a native UUID failure can fall back only to a working secure RNG (0.251492ms)
✔ no RNG is an explicit unavailable error, never a weak identifier (0.818321ms)
✔ a failing secure RNG rejects rather than returning zero or pseudo-random bytes (0.142056ms)
✔ 844×390 restores all dock modes inside the workspace and above the reachable toolbar (1.281342ms)
✔ continuous panel sizes are bounded by available pixels, not a 330px product ceiling (0.178791ms)
✔ phone width, height, floating positions and side docking remain user choices (0.177349ms)
✔ a very large docked panel never automatically covers the photo; explicit overlay remains available (0.859914ms)
✔ a 339px saved phone sheet preserves the complete exclusion area at both 320×700 and 390×844 (0.274937ms)
✔ fresh phone defaults reserve photo pixels without beginning in overlay (0.329149ms)
✔ low-room guidance uses actual fit space without changing composition or limiting manual sizes (0.303641ms)
✔ side docks and short windows deduct their own viewport chrome and fit padding (0.238061ms)
✔ 320px quick photo view preserves the requested 339px panel and keeps fitted images above it (0.399936ms)
✔ measured banners and keyboard space constrain panels without overwriting their saved rectangle (0.279574ms)
✔ maximize and collapse are derived display modes with an exact normal-size return path (0.193403ms)
✔ undocking preserves the visible origin and keyboard movement supports one pixel (0.218641ms)
✔ floating west/north resize holds the opposite edge through minimum size and viewport limits (0.357462ms)
✔ bottom sheets resize symmetrically in width and retain their bottom anchor in height (0.125259ms)
✔ resizing across six actual QA sizes keeps every edge accessible (4.193318ms)
✔ layout parsing repairs unavailable display modes and rejects corrupt old preferences (0.375679ms)
✔ multimodal SQL integration requires the explicit CI database when requested (1.186359ms)
▶ multimodal jobs use real SQL, private normalized images and injected supplier boundaries
  ✔ v3 plans preserve image dependencies and fine transform, while unuploaded or foreign layer references create no hold (89.252997ms)
  ✔ new v2 numeric plans freeze their protocol, moderate generated changes and preserve existing masks without auto-applying (54.09178ms)
  ✔ invalid generated v2 paths never publish and retain their genuine receipt plus unknown hold (47.918527ms)
  ✔ old frozen v2 tasks retain the legacy adjustment protocol and digest while new protocol tampering fails before dispatch (82.788087ms)
  ✔ text iteration explicitly freezes its successful same-project parent, without implicit full chat history (92.572903ms)
  ✔ image submit is idempotent, reserves once and exposes no generated asset until normalized-byte review passes (89.233467ms)
  ✔ text generation freezes document context and returns a candidate without overwriting the live document (57.400758ms)
  ✔ speech success retains only the audio hash, omits raw audio from DTOs and does not execute edits (60.473734ms)
  ✔ edit-plan still returns a complete frozen-recipe candidate without changing the artwork (46.026287ms)
  ✔ successful empty ASR becomes an explicit no-speech result and settles once without fabricated text (49.758878ms)
  ✔ input review rejection and review-hash mismatch do not call a billable image model (60.321252ms)
  ✔ reference-image block prevents generation and preserves the existing source (33.939805ms)
  ✔ blocked generated image is never attached or exposed, private bytes are removed and billing remains unknown (45.351153ms)
  ✔ independent image adapter returning a wrong decoded size cannot bypass worker validation (36.591327ms)
  ✔ post-generation text moderation block preserves the source and never publishes the candidate (32.913875ms)
  ✔ unknown image outcome is not retried and only an operator can settle it idempotently (51.653581ms)
  ✔ a definitive model refusal releases the hold for all four operations without a retry (123.793684ms)
  ✔ a definitive output-review error cannot release a hold after the model has already succeeded (91.556722ms)
  ✔ speech unknown, invalid frozen bytes and stale worker recovery all redact raw audio without retry (80.249211ms)
  ✔ authorization and project scoping reject outsiders, wrong wallets and cross-project references before a hold (23.837769ms)
  ✔ text permission revoked during asynchronous input review stops the billable call (31.330358ms)
  ✔ model disabled during input review stops image dispatch even though admission was valid (45.508372ms)
  ✔ speech permission revoked during journal persistence stops transcription and erases queued audio (41.8417ms)
  ✔ image revocation during output review prevents asset attachment and discards the private candidate (50.148819ms)
  ✔ frozen manifest detects tampering and binds image row model to the approved model (53.32713ms)
  ✔ a missing frozen reference cannot silently downgrade an approved reference-image request to text-only generation (36.512312ms)
  ✔ reference revocation during image review prevents its bytes from being sent to generation (38.522235ms)
  ✔ edit-plan integrity includes the whole base recipe, not only currentAdjustments sent to the LLM (35.772485ms)
  ✔ an existing dispatch record freezes a restored queued image job instead of sending it again (35.347801ms)
  ✔ restored image dispatch evidence wins over later model disablement and cannot release the paid hold (31.231958ms)
  ✔ restored plan dispatch evidence wins over revoked membership before any access-denied release (51.610046ms)
  ✔ missing database dispatch evidence halts new work instead of silently rebuilding vendor requests (22.135036ms)
✔ multimodal jobs use real SQL, private normalized images and injected supplier boundaries (1766.470369ms)
▶ OpenAI persistent batch lifecycle, accounting, references and real request lineage
  ✔ lost acknowledgement after a real batch COMMIT keeps every published image and settles once (118.605375ms)
{"event":"ai_asset_cleanup_deferred"}
  ✔ unknown output plus unavailable cleanup check retains private bytes without publishing them (65.402539ms)
  ✔ n outputs reserve n times the selected quality price once; queued price does not change (83.576878ms)
  ✔ input denial releases the whole reservation and calls no image supplier (52.210947ms)
  ✔ one rejected output leaves the entire batch unpublished, unknown and not retried (63.073682ms)
  ✔ references and mask use exact hashed bytes; parent output is explicitly selected and persisted (194.681533ms)
  ✔ a reference revoked during supplier execution prevents all publication (74.156166ms)
  ✔ batch cardinality and transport uncertainty keep the complete hold; malformed options create none (116.269392ms)
  ✔ editing queued parameters cannot replace the frozen payload or mint a cheaper multi-image job (48.25083ms)
✔ OpenAI persistent batch lifecycle, accounting, references and real request lineage (872.291738ms)
✔ endpoint allowlist rejects userinfo, off-region, query and redirect targets (1.159258ms)
✔ frozen input hashes include endpoint, exact JSON body and requested adjustments (0.775025ms)
✔ AI proposals cannot call arbitrary tools, overwrite geometry or exceed parameter bounds (3.630456ms)
✔ AI legacy adjustment proposals preserve the complete v2 recipe and never gain access to its new fields (3.074583ms)
✔ new v2 plans expose only registry numeric values, keep the old default protocol byte-for-byte and bound moderation input (1.678246ms)
✔ v2 proposals atomically validate joint levels, report actual differences and preserve all regions (4.939762ms)
✔ v3 global proposals preserve fine geometry, layers and warp without exposing their private data to the provider (3.007392ms)
✔ v2 whitelist rejects arbitrary paths, duplicates, non-finite numbers, integer violations and invalid final levels (1.810215ms)
✔ real HTTP adapter uses bounded JSON, authorization, no redirects and never retries (8.003388ms)
✔ Qwen adapter retains vendor receipt for incomplete responses and rejects a definite error without retry (1.973763ms)
✔ database integration is explicitly required by CI (0.79122ms)
▶ AI transaction, moderation, idempotency, unknown and restore invariants
  ✔ one submission reserves once; completed candidate never modifies the artwork (56.27142ms)
  ✔ input rejection never calls the model and releases the original lot (37.928049ms)
  ✔ ambiguous external result holds points and is never automatically retried (43.967414ms)
  ✔ existing dispatch evidence prevents re-execution of a restored queued row (23.613003ms)
  ✔ changed head and revoked membership reject new paid requests (7.135292ms)
  ✔ journal record missing from restored DB stops all future dispatch (3.954367ms)
✔ AI transaction, moderation, idempotency, unknown and restore invariants (202.590122ms)
✔ module registry rejects duplicates, missing dependencies and cycles without executing code (4.922166ms)
✔ asset copy contract accepts only a destination and stable request key, never caller ownership or bytes (1.43066ms)
✔ sealed registry isolates caller data, resolves explicit gates and cannot pretend a contract has an executor (2.377667ms)
✔ decision schema keeps kind-specific fields, CAS and idempotency explicit (3.110197ms)
✔ shared source frame binds analysis to normalized pixels and command envelope carries no actor authority (1.254142ms)
▶ schema readiness uses the migration registry and rejects old, incomplete and newer databases
  ✔ migrate and readiness agree on the actual highest registered migration (5.357466ms)
  ✔ old v2 (4.840862ms)
  ✔ missing intermediate (4.468242ms)
  ✔ newer than this code (5.322412ms)
  ✔ empty (2.813758ms)
  ✔ doctor CLI reports the complete current schema without contacting vendors (309.645029ms)
✔ schema readiness uses the migration registry and rejects old, incomplete and newer databases (346.661155ms)
✔ recipe construction owns its arrays and the shared default is deeply frozen (2.116891ms)
✔ full-recipe validation rejects malformed versions, unknown params, NaN and negative detail (1.897568ms)
✔ validation does not invoke getters and rejects inherited/prototype payloads (0.924903ms)
✔ JSON round trip has deterministic versioned data and no references to the input (0.562983ms)
✔ neutral recipe is byte-identical for all byte values and alpha, but never mutates input (2.042488ms)
✔ exposure performs linear-light EV rather than multiplying encoded bytes (0.762226ms)
✔ signed light tools move in both directions, and brightness is not exposure (2.490688ms)
✔ contrast has a midtone pivot and highlight/shadow controls target different tonal ranges (0.651598ms)
✔ saturation -100 is grayscale and vibrance leaves neutral gray neutral (0.812062ms)
✔ temperature and tint have signed, distinct relative color semantics (0.615985ms)
✔ curve endpoints, channel isolation and RGB-then-channel order are explicit (2.438178ms)
✔ bad curve ordering, duplicate x, missing endpoints and accessors are rejected (0.618327ms)
✔ crop, all clockwise rotations and output-axis flips are exact RGBA permutations (1.018575ms)
✔ geometry helpers use actual crop quantization and invert across all rotations/flips (0.961458ms)
✔ alpha survives every adjustment and transparent color cannot bleed through detail filters (1.98487ms)
✔ soften reduces a small local fluctuation and sharpening increases it without changing flat fields (0.537886ms)
✔ radial feather and inverse have bounded complementary weights (0.216468ms)
✔ enabled local tone and smoothing leave every outside pixel byte-identical to the global baseline (2.547924ms)
✔ inverted local mask protects its center and local detail does not become a global effect (0.449893ms)
✔ histograms count visible pixels, preserve channel bins and ignore hidden RGB (0.246354ms)
✔ bounds reject excessive dimensions, incomplete buffers and unauthorized budget enlargement (0.33662ms)
✔ extreme valid settings remain bounded, keep alpha, and do not mutate recipes (3.010827ms)
✔ worker-rendered preview and main-thread export use identical canonical pixels for the same input (117.756628ms)
✔ BMP preflight supports explicit uncompressed RGB variants and rejects alternate encodings (1.998131ms)
✔ real static GIF is inspected through complete frame/trailer and rejects truncation/animation (8.054786ms)
✔ real AVIF primary-image associations work for RGB and alpha; sequence/missing/invalid boxes fail closed (27.830189ms)
✔ header inspection requires explicit larger image budget, bounded at 64MP/16384 (0.475421ms)
✔ AVIF dimensions are selected through the actual primary item association, not the first ispe (3.076166ms)
✔ AVIF FullBox fields cannot borrow bytes from a following sibling box (0.9426ms)
✔ AVIF item counts, item IDs, primary flags and minimum AV1 configuration are checked (0.594802ms)
✔ AVIF rejects duplicate singleton metadata instead of choosing an arbitrary primary (0.489372ms)
✔ AVIF scans visible top-level boxes after meta and rejects sequence or duplicate metadata (0.36245ms)
✔ AVIF box lengths, extended sizes and bounded nesting fail closed (4.84646ms)
✔ AVIF distinguishes an intentionally bounded large-file prefix from a truncated complete small file (8.768809ms)
✔ BMP validates signed dimensions, padded row footprint and declared payload before decoding (0.430764ms)
✔ GIF counts actual image blocks, bounds extensions and requires the complete static trailer (0.473498ms)
✔ extended formats share explicit pixel budgets without allocating decoded high-resolution images (0.532037ms)
✔ header preflight recognizes static PNG, 8-bit JPEG profiles and both WebP bitstreams (2.98004ms)
✔ animation declarations are flagged before any decoder is constructed (0.651017ms)
✔ header dimensions block zero sizes, huge sides and decompression pixel bombs (0.439687ms)
✔ PNG preflight checks header CRC, chunk boundaries, ordering and bounded metadata (43.5893ms)
✔ JPEG preflight rejects malformed segments, alternate size frames and unknown coding modes (0.370271ms)
✔ WebP preflight checks RIFF length, padding, frame signatures, versions and canvas mismatch (0.427419ms)
✔ unsupported signatures and oversized header buffers fail closed (0.398214ms)
✔ tiled neutral rendering preserves all RGBA byte values and disabled local state (4.260662ms)
✔ all stages match the reference byte for byte for several non-dividing tile sizes (38.543707ms)
✔ fractional crop, all rotations and output flips share exact geometry with the reference (106.053969ms)
✔ default 512-pixel tile boundaries and partial edge tiles have no seams or alpha drift (475.586167ms)
✔ two consecutive radius-1 detail stages retain their full two-pixel dependency halo (2.229542ms)
✔ radial masks, feather and inversion remain in original whole-image coordinates across tiles (87.325604ms)
✔ crop-border detail samples include neighbors outside the crop just like pre-crop reference processing (2.371997ms)
✔ single-pixel, row, column and small transparent images retain correct real-image edge extension (1.828463ms)
✔ Float32 work buffers are tile-sized and allocated twice, then reused for all tiles (60.989225ms)
✔ the explicit tiled path supports a 16,384-pixel side without widening reference-renderer admission (1.64161ms)
✔ a real 20MP input with a small crop uses only cropped tiles and honors an explicitly lower admission budget (1.82654ms)
✔ high-resolution geometry helpers map coordinates without requiring a whole-image float allocation (0.431605ms)
✔ tiled input budgets, tile size, buffer completeness and cancellation fail before unsafe work (7.202894ms)
✔ tiled rendering in a real worker uses the same canonical pixels as reference export (172.205849ms)
✔ compiled radial masks preserve the old radial mathematical convention (1.501427ms)
✔ linear gradient projection uses source pixel aspect, bounded endpoints and optional smoothing (0.265493ms)
✔ polygon selection has pixel-aspect-aware inward feather and exact zero exterior (0.484224ms)
✔ brush capsules are continuous between samples and maintain circular source-pixel radii (0.355319ms)
✔ brush additive/subtractive strokes compose ordered coverage without point-density buildup (0.50089ms)
✔ a half-pixel brush selects exactly one pixel center at the maximum admitted square dimensions (0.603585ms)
✔ RLE masks preserve every byte weight at source cell centers and explicit normalized resizing (1.54986ms)
✔ continuous source color selection wraps hue, distinguishes grey and preserves transparent exclusion under inversion (0.591897ms)
✔ continuous color saturation and encoded-luminance bands feather independently (0.343541ms)
✔ color overlay can explicitly sample a smaller original preview through normalized coordinates (0.23733ms)
✔ compiled mask domain rejects non-finite samples and bounds inverse selection to the actual source image (0.196037ms)
✔ version dispatch is explicit and never drops unknown version fields (4.521097ms)
✔ explicit v1 migration preserves all common fields and owns every nested value (2.16259ms)
✔ AI-safe base adjustment patch preserves version, masks and every v2 control (3.035965ms)
✔ the v2 registry exactly addresses implemented bounded controls and canonical defaults (27.666391ms)
✔ v2 rejects invalid coupled ranges, integer seeds, incomplete masks and unsupported fields (1.306171ms)
✔ new nested validators do not execute accessors or accept prototype payloads (1.029982ms)
✔ discriminated region builders replace masks without leaking radial fields (6.858022ms)
✔ mask validation enforces finite geometry, nondegeneracy, RLE coverage and complexity caps (67.57578ms)
✔ default v2 is an exact RGBA identity and migrated v1 replays byte-for-byte in both renderers (23.719314ms)
✔ levels independently set input endpoints, gamma direction and output endpoints (4.200305ms)
✔ each of eight HSL bands has real signed hue, saturation and lightness behavior without recoloring grey (25.634064ms)
✔ HSL interpolation is continuous across hue zero and stable at extreme dark levels (1.218377ms)
✔ three-way color grading and split-tone settings affect the intended tonal weights (1.616431ms)
✔ monochrome and fade have separate linear-luminance and encoded-range semantics (0.726402ms)
✔ vignette has signed exposure, adjustable source-space center/radii and a neutral interior (1.189043ms)
✔ grain is deterministic by source coordinate and seed, has real size/color modes and leaves alpha intact (14.489191ms)
✔ texture and clarity are signed, spatially distinct, flat-preserving and alpha-weighted (5.440641ms)
✔ every manual mask type produces a real local edit with exact zero-weight outside preservation (7.069723ms)
✔ ordered regions, opacity, disabled state and invert retain real independent semantics (1.592275ms)
✔ a real one-pixel edit preserves every exterior RGBA byte and ignores transparent neighbor colors (2.413271ms)
✔ continuous color-range remains bound to unmodified source pixels after global and prior regional edits (2.639398ms)
✔ all v2 stages preserve alpha and hidden RGB without mutating source or recipe (15.900246ms)
✔ full/tiled v2 share exact pixels for all stages, masks, geometry and nondividing tile edges (954.162385ms)
✔ maximum ordered detail dependency uses the complete twelve-pixel halo (63.075453ms)
✔ v2 default tile size crosses a real 512 boundary without seams, including source-anchored noise (38.167938ms)
✔ v2 full/tiled handle real image edges, singleton axes, budgets and cancellation (10.56809ms)
✔ v2 tiled rendering allocates only two reusable tile-sized Float32 work buffers (25.737154ms)
✔ every registered extreme remains a bounded real rendering parameter with stable alpha (28.134989ms)
✔ a real worker v2 tile export equals the main-thread reference for the same frozen input (247.453486ms)
✔ compound union/intersection/subtract/xor combine multiple soft areas with bounded inversion (2.813684ms)
✔ full regional curves, HSL and levels change only selected pixels and leave all exterior bytes untouched (18.593746ms)
✔ shared group correction is applied once across overlapping regions, with independent per-region edits afterwards (18.083372ms)
✔ region and group enable/opacity controls are independent and zero is exact identity (3.378691ms)
✔ source-color selection is fixed to immutable input even after global color adjustments (5.905382ms)
✔ every declared blend mode is finite, alpha-correct and distinguishes representative colors (0.75896ms)
✔ normal/multiply/screen/soft-light use their actual distinct equations, with transparent backdrops unaffected by blend choice (0.248546ms)
✔ a half-pixel paint stroke controls exactly one RGBA pixel and leaves its neighbors byte-identical (2.001093ms)
✔ paint opacity and isolated erasing do not erase the original image (3.741762ms)
✔ clone strokes sample a fixed pre-paint source instead of repeatedly sampling already painted pixels (1.690122ms)
✔ paint mask, visibility and layer order are genuine non-destructive compositing controls (3.321685ms)
✔ image layers resolve explicit pixels and perform placement, scale, alpha, masking and rotation (7.702346ms)
✔ disabled image layers never trigger resolution and can be retained without a fake output (1.289504ms)
✔ warp has signed compact support and distinct push, pinch, bulge and twirl fields (0.627921ms)
✔ warp protection locks selected background pixels exactly, including alpha and hidden RGB (4.760065ms)
✔ zero or disabled warp remains byte-identical and off-region pixels are not resampled (3.850857ms)
✔ luminance and chroma denoising operate independently, preserve flat fields and alpha (7.339987ms)
✔ signed chromatic aberration shifts the chosen channel without changing alpha or other channels (2.601413ms)
✔ all new source-space stages have identical full/tiled output across non-dividing tile edges and preserve input ownership (77.194316ms)
✔ spatial brush indexing preserves continuous capsules and does not build up opacity from denser samples (10.098508ms)
✔ paint workload admission rejects excessive paths before any image-sized byte allocation (108.678993ms)
✔ reusing one immutable image source in several layers counts its pixels once (2.623166ms)
✔ tiled v3 allocates only tile-sized Float32 buffers even across local color and paint layers (35.297616ms)
✔ a real worker exports v3 source layers, regional edits and geometry byte-identically to the main-thread reference (153.59506ms)
✔ v3 neutral migration reproduces original v1/v2 bytes including legacy locals, crop and alpha (31.421966ms)
✔ all-angle affine/projective source/output mappings round-trip through integer crop and quarter turns (31.40083ms)
✔ fine exact quarter-turn rotation swaps dimensions and produces no extra border pixels (3.790847ms)
✔ fine fractional rotation adds real transparent support and crop mode retains the chosen output frame (3.170235ms)
✔ fine quarter turns preserve hidden transparent RGB across round-off in both rotation directions (24.438656ms)
✔ compiled frame mapping retains exact legacy crop quantization and every quarter-turn/flip convention (18.355935ms)
✔ translation and independent axis scales are real geometric operations with invertible hit testing (2.705361ms)
✔ v3 geometry validates allocation budgets and singular or horizon-crossing transforms before rendering (2.977944ms)
✔ premultiplied linear reconstruction excludes hidden transparent colors and preserves neutral transparent data (1.762061ms)
✔ v3 rendering is cancellable at admission and through repeated pixel-row checks (1.935554ms)
✔ compiled gesture coordinates distinguish frame controls from inverse-warp content picking (1.903265ms)
✔ v3 creation owns defaults, round-trips strict JSON and never silently downgrades (12.779502ms)
✔ v3 global registry exposes exact defaults and generic setters retain all extension data (38.394791ms)
✔ v3 validation rejects unknown keys, invalid versions and incomplete color blocks (3.306562ms)
✔ v3 parser never executes accessors and rejects cycles, symbols, exotic prototypes and sparse arrays (1.348494ms)
✔ groups reference unique explicit identities and have independent validated complete color blocks (3.68746ms)
✔ operation provenance is bounded inert data and can carry a complete person control vector (3.224858ms)
✔ compound masks preserve discriminants and enforce depth, node and shape budgets (0.473088ms)
✔ paint validation enforces alpha/channel, finite coordinates and clone origins before any rendering (36.457124ms)
✔ image layers use bounded resource identities and reject URL payloads and illegal dimensions (2.566ms)
✔ strict WAV validates actual duration including the 30-second boundary and typed-array offsets (102.705492ms)
✔ WAV rejects compressed, stereo, wrong-rate, wrong-byte-rate, missing, truncated and oversized input (6.798255ms)
✔ WAV rejects appended data, duplicate chunks and forged RIFF lengths (0.262247ms)
✔ provider setup has no implicit enabled model or endpoint bypass (1.044383ms)
✔ Ark audited profiles enforce request dimensions, reference types and model allowlists before dispatch (1.468876ms)
✔ Ark single-image request sends real official fields with reference bytes and keeps AI watermark (7.532949ms)
✔ Ark older group-capable profiles explicitly disable multiple output and streaming (1.273421ms)
✔ Ark rejects URL-only output, extra images, malformed base64 and wrong real dimensions as unknown (3.332962ms)
✔ HTTP refusal is distinguished from uncertain billing and raw provider error text is not propagated (1.420103ms)
✔ response readers reject announced excess, streamed excess, invalid JSON and interrupted bodies (2.003777ms)
✔ Qwen transcription uses allowed Beijing workspace endpoint and base64 WAV, never a public audio URL (0.613981ms)
✔ Qwen rejects unsafe input locally and treats truncated/malformed transcription as unknown (1.181891ms)
✔ OpenAI adapter is disabled without explicit enable/key/model allowlist and refuses arbitrary endpoints (122.599664ms)
✔ OpenAI generation uses the fixed real Images JSON protocol and returns all requested raster outputs (164.232285ms)
✔ OpenAI edit protocol sends exact normalized reference and markup bytes, with 2.6 complexity (18.452096ms)
✔ OpenAI mask requires a matching transparent PNG and never silently flattens a guide (15.416528ms)
✔ OpenAI profiles enforce real quality, format dependencies, current size evidence and batch budgets locally (0.816758ms)
✔ OpenAI JPEG and WebP compression is transmitted and decoded as the requested real format (1.649ms)
✔ explicit transparency checks actual decoded alpha, not a filename or response declaration (1.888263ms)
✔ OpenAI ambiguous or partially completed batch responses stay unknown, preserve request receipt and never retry (3.840872ms)
✔ portrait analysis is owned, strictly source-bound and rejects stale IDs, duplicate targets and unknown fields (16.26807ms)
✔ portrait boundary rejects accessors, non-finite landmarks, sparse data and invalid visibility without executing them (1.369847ms)
✔ bounded off-image pose estimates retain a valid face and visible shoulders without enabling invisible legs (30.059597ms)
✔ open eyebrow chains use all hull vertices while only actually closed edges form contour loops (0.594601ms)
✔ face skin and lipstick masks protect eyes and the mouth cavity (1.934732ms)
✔ all registered face/body controls compile to real valid primitives with their own named targets (161.850393ms)
✔ every enabled portrait control produces real pixels, signed controls reverse, and tiled export matches the preview engine (437.670319ms)
✔ portrait controls replace their own operations without growing repeated slider changes or modifying other modules (17.916729ms)
✔ detaching a whole person preserves pixels and provenance while allowing a new automatic pass without IDs colliding or manual edits being overwritten (25.23987ms)
✔ makeup color is per tool and does not leak into numeric controls or recolor other tools on unrelated changes (16.984718ms)
✔ automatic recompilation refuses manual changes, deletion, ordering and missing checksums without losing the existing recipe (78.587879ms)
✔ changing automatic values retains existing order relative to later independent layers (9.78306ms)
✔ two fully configured portrait targets fit published operation budgets and keep independent values (88.849033ms)
✔ body tools check only the joints they need, retaining shoulder editing when lower-body joints are hidden (2.784882ms)
✔ tilted non-square portraits push their chin along the actual pixel-space facial axis (2.795498ms)
✔ sideways and inverted portraits retain a mouth-oriented facial axis instead of the screen vertical (7.526769ms)
✔ makeup options and RGBA reject sparse data and accessors without running user code (5.206553ms)
✔ a large face can receive masked makeup without an illegal paint radius or painting the mouth cavity (6.610851ms)
✔ semantic zero/reset remains identity and can remove a previous effect even if new contours are unavailable (9.315921ms)
✔ analysis adapter validates configuration, source binding, preview ratio and response version before accepting inference (5.165831ms)
✔ analysis adapter rejects cancelled work before and after inference and never treats partial output as success (0.723827ms)
✔ Tencent adapters have no unconfigured delivery or moderation bypass (1.695771ms)
✔ TC3 authorization binds exact body, action and UTC credential scope (1.768702ms)
✔ SMS uses official fixed endpoint, one approved purpose template and exact recipient receipt (8.796624ms)
✔ network errors, streamed interruption, invalid envelopes and large responses stay unknown without retries (2.923782ms)
✔ definite Tencent client rejection differs from ambiguous internal failure (1.677744ms)
✔ text moderation binds exact UTF-8 bytes and keeps Review distinct from Pass (1.130644ms)
✔ image moderation hashes the exact file and refuses small, mismatched or oversized content before external dispatch (11.617236ms)
✔ real JPEG/PNG/WebP/AVIF/static GIF/single-page TIFF codecs normalize to private PNG (76.438491ms)
✔ real animated GIF/WebP and multipage TIFF are rejected without first-frame flattening (15.31138ms)
✔ APNG/AVIF sequence declarations and unsupported containers are refused before decoding (21.971536ms)
✔ high-resolution normalization processes a real 20MP source and enforces independent server bounds (409.151568ms)
✔ streaming byte cap and process-wide decoder admission apply across storage instances (12.550515ms)
✔ private thumbnails preserve aspect and alpha, do not enlarge, and reuse immutable cached files (69.144774ms)
✔ model preparation rejects a truncated task even when its bad download hash was recorded (1.257396ms)
✔ model preparation validates length and TFLite magic independently of its hash (0.353265ms)
✔ model preparation requires a complete archive directory and exact versioned pose size (0.445355ms)
ℹ tests 444
ℹ suites 0
ℹ pass 444
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 28856.612727
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````

## web-build

原始文件：`v3-final-01-web-build.log`；SHA-256：`8331f4ecbb752601e99b4492e5624c26c105e94799992bc9bb6645dbd8d153b2`。

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

✓ built in 598ms
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

````

## production-dependencies

原始文件：`v3-final-01-production-dependencies.log`；SHA-256：`70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c`。

````text
found 0 vulnerabilities
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````
