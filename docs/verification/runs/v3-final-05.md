# v3-final-05 实际运行记录

机器记录如下；本页复制真实输出，不将测试清单当作人工逐行审计。

```json
{
  "label": "v3-final-05",
  "startedAt": "2026-11-09T18:34:34.469Z",
  "finishedAt": "2026-11-09T18:35:34.734Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "e9bfb4480d3ad2e7fa865fbd31416c3131ea603e9c684814e6ee321e99613366",
  "inventory": "v3-final-05-inventory.json",
  "files": 283,
  "sourceLines": 82421,
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 22624,
      "log": "v3-final-05-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 31077,
      "log": "v3-final-05-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 951,
      "log": "v3-final-05-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 5605,
      "log": "v3-final-05-production-dependencies.log"
    }
  ],
  "passed": true
}
```

## typecheck

原始文件：`v3-final-05-typecheck.log`；SHA-256：`a9cbeed8f1d9b26b6285203e7aaf4f61472bdc5b69a22f7bc2f539ab940d4b90`。

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

原始文件：`v3-final-05-tests.log`；SHA-256：`c5f660eeb9a9ac10202a444a5716bee2bbf0812b62c5b79e929db9a61da2244a`。

````text

> ai-xiutu@0.1.0 test
> node scripts/test.mjs

▶ queued cancellation and disabled-provider recovery use actual SQL and API ACL
  ✔ disabled capabilities still expose authorized cancellation; concurrent retries release once (178.360193ms)
  ✔ revoked or suspended actor cannot cancel; owner can release queued work without private operator access (66.078927ms)
  ✔ cancel racing an already dispatched request never releases or resends it (76.057041ms)
  ✔ restored queued rows with dispatch or unreadable evidence become unknown without refunds (284.462091ms)
  ✔ all adapters disabled still recover every stale operation once, redact audio and preserve receipts/holds (292.3848ms)
  ✔ missing backup evidence stops dispatch but never prevents conservative stale recovery (48.934639ms)
✔ queued cancellation and disabled-provider recovery use actual SQL and API ACL (1240.398307ms)
▶ AI result decisions, immutable source history and composition ACL
  ✔ forward migration preserves existing history and backfills retained storage without double counting (151.932278ms)
  ✔ public discovery resolves unconfigured adapters honestly and exposes no credentials (16.841433ms)
  ✔ fixtures create real immutable uploads, source snapshots and completed candidates (99.007457ms)
  ✔ missing session, outsider, viewer and platform operations do not gain adoption privileges (19.234233ms)
  ✔ rejection records an immutable decision without changing already settled points (49.865271ms)
  ✔ concurrent identical forks create one branch and changing a reused key fails (35.379583ms)
{"event":"api_error","requestId":"req-k","errorType":"Error","code":"INTERNAL"}
  ✔ lost adoption COMMIT acknowledgement replays the committed branch without duplicating it or settling again (29.846179ms)
{"event":"api_error","requestId":"req-n","errorType":"Error","code":"INTERNAL"}
  ✔ failed decision persistence rolls back its artwork and source snapshot in the same transaction (18.154833ms)
  ✔ adopting an image as a layer preserves its base, parameters, contain placement and immutable source history (100.394733ms)
  ✔ AI layer adoption checks capacity, output provenance and project ownership before appending (40.521424ms)
  ✔ replace atomically changes current source, preserves old source and rejects stale proposals (38.674492ms)
  ✔ restoring history appends source plus recipe together and uses CAS (27.772407ms)
  ✔ outdated parameter proposal may be preserved as a branch from its original source (18.008625ms)
  ✔ matching parameter suggestion applies exactly once and records a new revision (19.783118ms)
  ✔ text adoption creates document snapshots and prevents stale replacement (30.009208ms)
  ✔ wrong output type/index, unfinished jobs and attempted automatic refund fail closed (33.542341ms)
  ✔ composition saves enforce same-project image dependencies and block deletion from history (54.267287ms)
  ✔ cross-space copy remaps all composition source IDs to independently authorized assets (46.888629ms)
  ✔ user decision history stays project scoped after membership revocation (10.364986ms)
✔ AI result decisions, immutable source history and composition ACL (987.926704ms)
▶ asset annotations, authorized organization and v2 revision persistence
  ✔ additive migration is repeatable and user declarations preserve timezone without changing image bytes (40.413271ms)
  ✔ viewer and platform operator cannot edit or inspect unauthorized private annotations (32.670278ms)
  ✔ annotation validation rejects implicit timezones, unexpected GPS/export flags and malformed tags (17.576695ms)
  ✔ real project/space filters and exact microsecond cursors do not lose same-millisecond assets (34.244521ms)
  ✔ expired or revoked reference grant cannot query metadata; old cursor does not preserve access (8.729324ms)
  ✔ actual upload origin is recorded explicitly; a suggestive filename never implies AI provenance (35.408445ms)
  ✔ full v2 recipes and region data persist through ordinary artwork/revision CAS (28.113831ms)
{"event":"api_error","requestId":"req-z","errorType":"Error","code":"INTERNAL"}
  ✔ a lost upload COMMIT acknowledgement never deletes an already committed private asset (22.432595ms)
{"event":"upload_asset_cleanup_deferred"}
{"event":"api_error","requestId":"req-11","errorType":"Error","code":"INTERNAL"}
  ✔ an unavailable authoritative cleanup query preserves an unconfirmed private upload (13.381634ms)
✔ asset annotations, authorized organization and v2 revision persistence (383.5084ms)
▶ authorized source copies, retained capacity and durable replay use actual SQL
  ✔ real private fixtures and disabled copy policies do not silently reupload (143.457723ms)
  ✔ concurrent identical and independently keyed copies share one immutable source and one capacity charge (87.356173ms)
{"event":"api_error","requestId":"req-p","errorType":"Error","code":"INTERNAL"}
  ✔ lost commit response can be retried without a second asset or capacity reservation (52.228858ms)
  ✔ one capacity row covers concurrent copies to different projects in the same space (86.134922ms)
  ✔ byte capacity and a partial full-project copy roll back all rows and counters (88.663074ms)
  ✔ operators configure capacity with CAS but do not acquire private image access (52.175667ms)
  ✔ revoking copy policy denies new decisions but a committed same-key retry reads only its independent destination (28.988682ms)
  ✔ a non-owner copy grant binds one destination and cannot be reused as a full project grant (100.897129ms)
  ✔ grant expiry at the final publication boundary rolls back the copy, request and capacity together (55.723309ms)
  ✔ source copy cap applies across distinct idempotency keys and concurrent source assets (48.622662ms)
✔ authorized source copies, retained capacity and durable replay use actual SQL (902.2246ms)
▶ persistent API security, collaboration, quota and private media integration
  ✔ strict Origin and real unavailable SMS gate (45.840513ms)
  ✔ SMS registration, hashed sessions and invalid OTP attempt persistence (230.597214ms)
  ✔ private project ACL excludes platform operator; team roles are real (80.671444ms)
  ✔ bounded image decoding, EXIF removal and authenticated file access (76.733443ms)
  ✔ complete recipe validation, immutable revisions and CAS conflict (41.10829ms)
  ✔ comments anchor to exact revision; tasks/documents use durable CAS (49.171236ms)
  ✔ independent reference/copy policies, revocation and personal-team copy idempotency (99.141915ms)
  ✔ admin records and audited quota adjustment never grant private project access (171.592987ms)
  ✔ period uniqueness, concurrent reservations and expired unknown release conserve lots (117.328217ms)
  ✔ unconfigured AI cannot fabricate a job and revoked team members lose read access (15.056476ms)
  ✔ reset consumes its purpose code and revokes old sessions (154.323541ms)
  ✔ SQL rate limits survive app recreation and untrusted XFF cannot replace peer IP (416.933729ms)
  ✔ exactly one trusted proxy hop uses the nearest forwarded address (24.524446ms)
✔ persistent API security, collaboration, quota and private media integration (1661.852285ms)
✔ editing one region or group retains every other color block, mask, composition and version (19.1716ms)
✔ numeric controls require registry identity and preserve independent fields (0.697214ms)
✔ singular or excessive transformations are rejected before preview reaches React or the renderer (2.294167ms)
✔ all interactive mask creation kinds start from valid editable geometry (0.481067ms)
✔ image dimensions use all returned limits, including discrete lists and custom step (1.722944ms)
✔ platform or operator narrower bounds cannot be bypassed by a provider profile (0.295036ms)
✔ unsupported fields and PNG compression are absent from outgoing options (0.330419ms)
✔ transparent JPEG, excessive outputs and invalid compression are visible failures (0.226843ms)
✔ displayed service points include quality price and exact output count (0.385803ms)
✔ batch budget includes every selected image and enforces the transaction point cap (0.293443ms)
✔ uncertain decision retries retain a token without persisting generated or edited content (2.312527ms)
✔ privacy-mode storage failure and malformed persisted tokens cannot corrupt decision requests (0.545186ms)
✔ current adoption is blocked for dirty, different-project, wrong-source and stale-revision results (2.055787ms)
✔ cloud sources retain their copy policy across project changes and cannot become local uploads (1.768592ms)
✔ a lost copy response preserves one request identity while actor, source and destination are isolated (1.020247ms)
✔ persisted valid identities recover after a reload; corrupt or unavailable session storage fails safely (0.404744ms)
✔ second contact cancels a drawing transaction once and suppresses both pointers until released (1.156724ms)
✔ third contact and unrelated releases cannot unlock the suppressed transaction early (0.219423ms)
✔ duplicate down by the owned pointer is blocked without cancelling the valid stroke (0.131129ms)
✔ normal two-finger navigation remains possible but a new edit cannot join the gesture (0.100021ms)
✔ blur/source reset discards obsolete contacts without leaving the next gesture disabled (0.144479ms)
✔ rollback uses the original pre-stroke recipe and never removes a newer edit or source (3.61302ms)
✔ RGBA8 colors round-trip through both numeric color spaces without channel or alpha drift (5.588876ms)
✔ continuous hue reaches every sector rather than snapping to the quick swatches (3.894126ms)
✔ HEX shorthand and every alpha byte preserve precise RGBA data (2.919828ms)
✔ editing a nested region preserves siblings and independently edited latest data (2.675117ms)
✔ stale nested paths cannot write into a sibling or silently replace the parent (0.779903ms)
✔ curve drag has one pointer owner; another finger cannot move, finish, cancel or replace it (3.250469ms)
✔ cancellation restores the starting recipe once and a late lost-capture event cannot repeat it (0.873825ms)
✔ window-level cancellation without a pointer id uses the same ownership and rollback rule (0.855448ms)
✔ source changes invalidate late move, up, cancel and lost-capture paths without writing old data (1.827071ms)
✔ a changed channel cannot receive a former channel gesture or its rollback (0.447339ms)
✔ releasePointerCapture reentrancy cannot turn a committed drag into a rollback (0.63927ms)
✔ an external commit interrupts the drag so late move, commit and cancel preserve the new edit (2.26152ms)
✔ several synchronous owned previews remain cancellable without requiring a React render (0.54756ms)
✔ unavailable capture and explicit discard leave no dangling transaction (0.456652ms)
✔ a local curve transaction owns the whole recipe and cannot commit after its scope changes (0.539929ms)
✔ unchanged image export prepares the encoded bytes with the captured source filename (1.631074ms)
▶ source, recipe, generation, loading and unmount changes discard a late export before URL allocation
  ✔ new source with the identical recipe (0.239713ms)
  ✔ changed adjustments on the same source (0.218812ms)
  ✔ replacement recipe object even when values happen to match (0.197269ms)
  ✔ new request generation (0.209948ms)
  ✔ pending source replacement (0.223219ms)
  ✔ unmounted owner (0.168916ms)
✔ source, recipe, generation, loading and unmount changes discard a late export before URL allocation (2.504137ms)
✔ a slower superseded export cannot replace the newer source result (0.458165ms)
✔ an already unavailable export does not start encoding (0.306324ms)
✔ codec failures remain actionable only for the current request owner (0.545568ms)
✔ delivery disables image and recipe actions during decode or pending cloud source lookup (9.732289ms)
✔ two consumers of the same immutable preview share its exact histogram allocation (1.317048ms)
✔ new frame identity recomputes independently and never returns the preceding frame counts (0.19119ms)
✔ absent frames remain absent without creating placeholder counts or mutating a cached result (0.154434ms)
✔ late image download cannot overwrite edits made while its network request was pending (4.09504ms)
✔ late referenced-layer decoding stops after project switch even if the same recipe is selected (1.382437ms)
✔ unchanged request may commit while changed source identity cancels an otherwise identical recipe (0.821125ms)
✔ history binding resolves the old immutable source and rejects the current source or foreign project (0.552979ms)
✔ component motion has explicit independently selected desktop, tablet and phone tracks (1.801932ms)
✔ all media-containing wrappers keep zero blur in every breakpoint (0.194234ms)
✔ CSS includes reduced-motion and gesture escape paths with hidden state inert support (0.938353ms)
✔ selecting a compact-panel parameter reveals its whole main control with bounded local scrolling (0.937878ms)
✔ a control taller than an unusually short panel aligns its heading rather than oscillating (0.123897ms)
✔ the shelf retains named native controls, exact signed ranges, selected state and disabled availability (20.180627ms)
✔ pixel crop keeps exact boundaries at small, odd, tall and 16K sizes (8.299727ms)
✔ pixel crop clamps edge drags to at least one real source pixel (0.315737ms)
✔ numeric editor changes require trusted registry identity and leave input untouched (0.789103ms)
✔ legacy radial selection updates never erase v2 color, effects or independent regions (0.41669ms)
✔ one-pixel brush snaps a boundary click to exactly one original pixel center (1.30969ms)
✔ source preview sampling maps normalized source locations and clamps outer edge (0.38359ms)
✔ duplicate validates global brush complexity and preserves original when budget would overflow (13.471244ms)
✔ a secondary pointer cannot steal, finish or cancel the owned slider preview (1.219844ms)
✔ Escape cancellation cannot be followed by a late keyup commit (0.231981ms)
✔ keyboard chord commits once after its final key and ignores unrelated releases (0.379975ms)
✔ neutral gestures create no changed result and source unmount discards ownership (0.229237ms)
✔ v2 AI confirmation includes advanced changes alongside legacy exposure (2.25628ms)
✔ v3 confirmation lists inherited color/effects and new optical/transform parameters (2.622173ms)
✔ v3 retained masks, groups, paint, composition and warp changes are explicitly disclosed (4.466852ms)
✔ non-numeric review ignores object key order but preserves ordered-layer and curve differences (0.834261ms)
✔ equal JSONB-style reordered recipes do not create false numeric changes (0.437361ms)
✔ legacy candidates remain legacy and non-numeric replacements are explicitly named (1.05133ms)
✔ preview preparation is an exact reference identity when geometry already fits the budget (10.975917ms)
✔ adaptive downsampling preserves alpha with premultiplied linear area reconstruction (2.468201ms)
✔ output-aware planning handles rotation, projective crop and scale without rewriting recipe or source coordinates (13.68015ms)
✔ actual worker protocol downsizes expanded previews and retains the full transformed export and layer coordinates (1505.782987ms)
✔ worker fallback keeps original pixels after transfer, resolves layer aliases and clears them for a new source (19.763515ms)
✔ render readiness includes active displacement and protection but excludes disabled warp edits (6.510962ms)
✔ painting and source sampling reject transparent contain corners while shape handles can clamp (3.368577ms)
✔ layer handles retain off-frame freedom and pixel painting follows inverse displacement (1.65834ms)
✔ prefers native randomUUID and keeps the Web Crypto receiver (0.724867ms)
✔ HTTP-style Crypto without randomUUID uses exactly 16 random bytes (0.167052ms)
✔ fallback enforces v4 and RFC variant bits while preserving the remaining entropy (0.492695ms)
✔ a native UUID failure can fall back only to a working secure RNG (0.15832ms)
✔ no RNG is an explicit unavailable error, never a weak identifier (0.391673ms)
✔ a failing secure RNG rejects rather than returning zero or pseudo-random bytes (0.152601ms)
✔ 844×390 restores all dock modes inside the workspace and above the reachable toolbar (1.425837ms)
✔ continuous panel sizes are bounded by available pixels, not a 330px product ceiling (0.448239ms)
✔ phone width, height, floating positions and side docking remain user choices (0.239192ms)
✔ a very large docked panel never automatically covers the photo; explicit overlay remains available (0.981375ms)
✔ a 339px saved phone sheet preserves the complete exclusion area at both 320×700 and 390×844 (0.269488ms)
✔ fresh phone defaults reserve photo pixels without beginning in overlay (0.482239ms)
✔ low-room guidance uses actual fit space without changing composition or limiting manual sizes (0.293564ms)
✔ side docks and short windows deduct their own viewport chrome and fit padding (0.463261ms)
✔ 320px quick photo view preserves the requested 339px panel and keeps fitted images above it (0.491353ms)
✔ measured banners and keyboard space constrain panels without overwriting their saved rectangle (0.37692ms)
✔ maximize and collapse are derived display modes with an exact normal-size return path (0.201535ms)
✔ undocking preserves the visible origin and keyboard movement supports one pixel (0.326224ms)
✔ floating west/north resize holds the opposite edge through minimum size and viewport limits (0.474568ms)
✔ bottom sheets resize symmetrically in width and retain their bottom anchor in height (0.169407ms)
✔ resizing across six actual QA sizes keeps every edge accessible (4.641133ms)
✔ layout parsing repairs unavailable display modes and rejects corrupt old preferences (0.48264ms)
✔ multimodal SQL integration requires the explicit CI database when requested (0.695873ms)
▶ multimodal jobs use real SQL, private normalized images and injected supplier boundaries
  ✔ v3 plans preserve image dependencies and fine transform, while unuploaded or foreign layer references create no hold (102.181042ms)
  ✔ new v2 numeric plans freeze their protocol, moderate generated changes and preserve existing masks without auto-applying (61.60584ms)
  ✔ invalid generated v2 paths never publish and retain their genuine receipt plus unknown hold (58.829839ms)
  ✔ old frozen v2 tasks retain the legacy adjustment protocol and digest while new protocol tampering fails before dispatch (104.864117ms)
  ✔ text iteration explicitly freezes its successful same-project parent, without implicit full chat history (97.416522ms)
  ✔ image submit is idempotent, reserves once and exposes no generated asset until normalized-byte review passes (93.795633ms)
  ✔ text generation freezes document context and returns a candidate without overwriting the live document (53.679195ms)
  ✔ speech success retains only the audio hash, omits raw audio from DTOs and does not execute edits (57.879882ms)
  ✔ edit-plan still returns a complete frozen-recipe candidate without changing the artwork (58.705681ms)
  ✔ successful empty ASR becomes an explicit no-speech result and settles once without fabricated text (60.32364ms)
  ✔ input review rejection and review-hash mismatch do not call a billable image model (77.307465ms)
  ✔ reference-image block prevents generation and preserves the existing source (42.968853ms)
  ✔ blocked generated image is never attached or exposed, private bytes are removed and billing remains unknown (51.276065ms)
  ✔ independent image adapter returning a wrong decoded size cannot bypass worker validation (50.933005ms)
  ✔ post-generation text moderation block preserves the source and never publishes the candidate (38.219372ms)
  ✔ unknown image outcome is not retried and only an operator can settle it idempotently (68.139746ms)
  ✔ a definitive model refusal releases the hold for all four operations without a retry (132.438046ms)
  ✔ a definitive output-review error cannot release a hold after the model has already succeeded (117.032284ms)
  ✔ speech unknown, invalid frozen bytes and stale worker recovery all redact raw audio without retry (105.192904ms)
  ✔ authorization and project scoping reject outsiders, wrong wallets and cross-project references before a hold (28.596261ms)
  ✔ text permission revoked during asynchronous input review stops the billable call (47.023635ms)
  ✔ model disabled during input review stops image dispatch even though admission was valid (50.02073ms)
  ✔ speech permission revoked during journal persistence stops transcription and erases queued audio (44.928314ms)
  ✔ image revocation during output review prevents asset attachment and discards the private candidate (48.833192ms)
  ✔ frozen manifest detects tampering and binds image row model to the approved model (67.340417ms)
  ✔ a missing frozen reference cannot silently downgrade an approved reference-image request to text-only generation (39.194588ms)
  ✔ reference revocation during image review prevents its bytes from being sent to generation (39.684901ms)
  ✔ edit-plan integrity includes the whole base recipe, not only currentAdjustments sent to the LLM (35.915716ms)
  ✔ an existing dispatch record freezes a restored queued image job instead of sending it again (36.876445ms)
  ✔ restored image dispatch evidence wins over later model disablement and cannot release the paid hold (36.25199ms)
  ✔ restored plan dispatch evidence wins over revoked membership before any access-denied release (38.019089ms)
  ✔ missing database dispatch evidence halts new work instead of silently rebuilding vendor requests (25.932651ms)
✔ multimodal jobs use real SQL, private normalized images and injected supplier boundaries (2020.574421ms)
▶ OpenAI persistent batch lifecycle, accounting, references and real request lineage
  ✔ lost acknowledgement after a real batch COMMIT keeps every published image and settles once (135.952899ms)
{"event":"ai_asset_cleanup_deferred"}
  ✔ unknown output plus unavailable cleanup check retains private bytes without publishing them (61.32838ms)
  ✔ n outputs reserve n times the selected quality price once; queued price does not change (98.947574ms)
  ✔ input denial releases the whole reservation and calls no image supplier (52.375994ms)
  ✔ one rejected output leaves the entire batch unpublished, unknown and not retried (80.704089ms)
  ✔ references and mask use exact hashed bytes; parent output is explicitly selected and persisted (205.666192ms)
  ✔ a reference revoked during supplier execution prevents all publication (81.932232ms)
  ✔ batch cardinality and transport uncertainty keep the complete hold; malformed options create none (135.794941ms)
  ✔ editing queued parameters cannot replace the frozen payload or mint a cheaper multi-image job (53.211878ms)
✔ OpenAI persistent batch lifecycle, accounting, references and real request lineage (959.731273ms)
✔ endpoint allowlist rejects userinfo, off-region, query and redirect targets (1.230311ms)
✔ frozen input hashes include endpoint, exact JSON body and requested adjustments (0.959221ms)
✔ AI proposals cannot call arbitrary tools, overwrite geometry or exceed parameter bounds (4.600831ms)
✔ AI legacy adjustment proposals preserve the complete v2 recipe and never gain access to its new fields (3.630234ms)
✔ new v2 plans expose only registry numeric values, keep the old default protocol byte-for-byte and bound moderation input (2.455726ms)
✔ v2 proposals atomically validate joint levels, report actual differences and preserve all regions (6.930702ms)
✔ v3 global proposals preserve fine geometry, layers and warp without exposing their private data to the provider (3.973323ms)
✔ v2 whitelist rejects arbitrary paths, duplicates, non-finite numbers, integer violations and invalid final levels (2.717522ms)
✔ real HTTP adapter uses bounded JSON, authorization, no redirects and never retries (10.754253ms)
✔ Qwen adapter retains vendor receipt for incomplete responses and rejects a definite error without retry (2.084725ms)
✔ database integration is explicitly required by CI (0.79306ms)
▶ AI transaction, moderation, idempotency, unknown and restore invariants
  ✔ one submission reserves once; completed candidate never modifies the artwork (58.874647ms)
  ✔ input rejection never calls the model and releases the original lot (35.623374ms)
  ✔ ambiguous external result holds points and is never automatically retried (47.732657ms)
  ✔ existing dispatch evidence prevents re-execution of a restored queued row (28.553662ms)
  ✔ changed head and revoked membership reject new paid requests (7.955392ms)
  ✔ journal record missing from restored DB stops all future dispatch (4.449773ms)
✔ AI transaction, moderation, idempotency, unknown and restore invariants (213.597459ms)
✔ module registry rejects duplicates, missing dependencies and cycles without executing code (4.944331ms)
✔ asset copy contract accepts only a destination and stable request key, never caller ownership or bytes (1.502904ms)
✔ sealed registry isolates caller data, resolves explicit gates and cannot pretend a contract has an executor (2.258377ms)
✔ decision schema keeps kind-specific fields, CAS and idempotency explicit (3.580137ms)
✔ shared source frame binds analysis to normalized pixels and command envelope carries no actor authority (1.343603ms)
▶ schema readiness uses the migration registry and rejects old, incomplete and newer databases
  ✔ migrate and readiness agree on the actual highest registered migration (6.063815ms)
  ✔ old v2 (4.828276ms)
  ✔ missing intermediate (5.370276ms)
  ✔ newer than this code (5.236533ms)
  ✔ empty (2.341994ms)
  ✔ doctor CLI reports the complete current schema without contacting vendors (315.610271ms)
✔ schema readiness uses the migration registry and rejects old, incomplete and newer databases (357.136161ms)
✔ recipe construction owns its arrays and the shared default is deeply frozen (1.99629ms)
✔ full-recipe validation rejects malformed versions, unknown params, NaN and negative detail (2.078395ms)
✔ validation does not invoke getters and rejects inherited/prototype payloads (0.799149ms)
✔ JSON round trip has deterministic versioned data and no references to the input (0.551865ms)
✔ neutral recipe is byte-identical for all byte values and alpha, but never mutates input (2.00251ms)
✔ exposure performs linear-light EV rather than multiplying encoded bytes (0.873872ms)
✔ signed light tools move in both directions, and brightness is not exposure (2.574485ms)
✔ contrast has a midtone pivot and highlight/shadow controls target different tonal ranges (0.577294ms)
✔ saturation -100 is grayscale and vibrance leaves neutral gray neutral (0.724497ms)
✔ temperature and tint have signed, distinct relative color semantics (0.542481ms)
✔ curve endpoints, channel isolation and RGB-then-channel order are explicit (2.612193ms)
✔ bad curve ordering, duplicate x, missing endpoints and accessors are rejected (0.576493ms)
✔ crop, all clockwise rotations and output-axis flips are exact RGBA permutations (1.195209ms)
✔ geometry helpers use actual crop quantization and invert across all rotations/flips (1.001846ms)
✔ alpha survives every adjustment and transparent color cannot bleed through detail filters (2.389055ms)
✔ soften reduces a small local fluctuation and sharpening increases it without changing flat fields (1.036288ms)
✔ radial feather and inverse have bounded complementary weights (0.351853ms)
✔ enabled local tone and smoothing leave every outside pixel byte-identical to the global baseline (2.099878ms)
✔ inverted local mask protects its center and local detail does not become a global effect (0.552806ms)
✔ histograms count visible pixels, preserve channel bins and ignore hidden RGB (0.32433ms)
✔ bounds reject excessive dimensions, incomplete buffers and unauthorized budget enlargement (0.366534ms)
✔ extreme valid settings remain bounded, keep alpha, and do not mutate recipes (3.175696ms)
✔ worker-rendered preview and main-thread export use identical canonical pixels for the same input (122.038755ms)
✔ BMP preflight supports explicit uncompressed RGB variants and rejects alternate encodings (2.011734ms)
✔ real static GIF is inspected through complete frame/trailer and rejects truncation/animation (6.394466ms)
✔ real AVIF primary-image associations work for RGB and alpha; sequence/missing/invalid boxes fail closed (22.573242ms)
✔ header inspection requires explicit larger image budget, bounded at 64MP/16384 (0.480056ms)
✔ AVIF dimensions are selected through the actual primary item association, not the first ispe (3.182976ms)
✔ AVIF FullBox fields cannot borrow bytes from a following sibling box (0.981505ms)
✔ AVIF item counts, item IDs, primary flags and minimum AV1 configuration are checked (0.724156ms)
✔ AVIF rejects duplicate singleton metadata instead of choosing an arbitrary primary (0.5286ms)
✔ AVIF scans visible top-level boxes after meta and rejects sequence or duplicate metadata (0.478244ms)
✔ AVIF box lengths, extended sizes and bounded nesting fail closed (4.518858ms)
✔ AVIF distinguishes an intentionally bounded large-file prefix from a truncated complete small file (14.275932ms)
✔ BMP validates signed dimensions, padded row footprint and declared payload before decoding (0.664455ms)
✔ GIF counts actual image blocks, bounds extensions and requires the complete static trailer (0.476871ms)
✔ extended formats share explicit pixel budgets without allocating decoded high-resolution images (0.698847ms)
✔ header preflight recognizes static PNG, 8-bit JPEG profiles and both WebP bitstreams (2.288823ms)
✔ animation declarations are flagged before any decoder is constructed (0.704006ms)
✔ header dimensions block zero sizes, huge sides and decompression pixel bombs (0.434718ms)
✔ PNG preflight checks header CRC, chunk boundaries, ordering and bounded metadata (43.223344ms)
✔ JPEG preflight rejects malformed segments, alternate size frames and unknown coding modes (0.367566ms)
✔ WebP preflight checks RIFF length, padding, frame signatures, versions and canvas mismatch (0.332022ms)
✔ unsupported signatures and oversized header buffers fail closed (0.315227ms)
✔ tiled neutral rendering preserves all RGBA byte values and disabled local state (4.272888ms)
✔ all stages match the reference byte for byte for several non-dividing tile sizes (41.209906ms)
✔ fractional crop, all rotations and output flips share exact geometry with the reference (106.374617ms)
✔ default 512-pixel tile boundaries and partial edge tiles have no seams or alpha drift (437.617597ms)
✔ two consecutive radius-1 detail stages retain their full two-pixel dependency halo (2.002969ms)
✔ radial masks, feather and inversion remain in original whole-image coordinates across tiles (95.183045ms)
✔ crop-border detail samples include neighbors outside the crop just like pre-crop reference processing (2.486764ms)
✔ single-pixel, row, column and small transparent images retain correct real-image edge extension (3.096192ms)
✔ Float32 work buffers are tile-sized and allocated twice, then reused for all tiles (54.748816ms)
✔ the explicit tiled path supports a 16,384-pixel side without widening reference-renderer admission (1.504028ms)
✔ a real 20MP input with a small crop uses only cropped tiles and honors an explicitly lower admission budget (1.505622ms)
✔ high-resolution geometry helpers map coordinates without requiring a whole-image float allocation (0.429714ms)
✔ tiled input budgets, tile size, buffer completeness and cancellation fail before unsafe work (3.779822ms)
✔ tiled rendering in a real worker uses the same canonical pixels as reference export (194.805255ms)
✔ compiled radial masks preserve the old radial mathematical convention (1.600506ms)
✔ linear gradient projection uses source pixel aspect, bounded endpoints and optional smoothing (0.581555ms)
✔ polygon selection has pixel-aspect-aware inward feather and exact zero exterior (0.858146ms)
✔ brush capsules are continuous between samples and maintain circular source-pixel radii (0.443334ms)
✔ brush additive/subtractive strokes compose ordered coverage without point-density buildup (0.508624ms)
✔ a half-pixel brush selects exactly one pixel center at the maximum admitted square dimensions (0.649658ms)
✔ RLE masks preserve every byte weight at source cell centers and explicit normalized resizing (1.874307ms)
✔ continuous source color selection wraps hue, distinguishes grey and preserves transparent exclusion under inversion (0.515394ms)
✔ continuous color saturation and encoded-luminance bands feather independently (0.436094ms)
✔ color overlay can explicitly sample a smaller original preview through normalized coordinates (0.272485ms)
✔ compiled mask domain rejects non-finite samples and bounds inverse selection to the actual source image (0.182598ms)
✔ version dispatch is explicit and never drops unknown version fields (4.280334ms)
✔ explicit v1 migration preserves all common fields and owns every nested value (2.327903ms)
✔ AI-safe base adjustment patch preserves version, masks and every v2 control (2.990761ms)
✔ the v2 registry exactly addresses implemented bounded controls and canonical defaults (21.05284ms)
✔ v2 rejects invalid coupled ranges, integer seeds, incomplete masks and unsupported fields (0.905138ms)
✔ new nested validators do not execute accessors or accept prototype payloads (0.743441ms)
✔ discriminated region builders replace masks without leaking radial fields (2.999644ms)
✔ mask validation enforces finite geometry, nondegeneracy, RLE coverage and complexity caps (54.298705ms)
✔ default v2 is an exact RGBA identity and migrated v1 replays byte-for-byte in both renderers (20.328998ms)
✔ levels independently set input endpoints, gamma direction and output endpoints (2.463329ms)
✔ each of eight HSL bands has real signed hue, saturation and lightness behavior without recoloring grey (15.117497ms)
✔ HSL interpolation is continuous across hue zero and stable at extreme dark levels (0.621556ms)
✔ three-way color grading and split-tone settings affect the intended tonal weights (1.391427ms)
✔ monochrome and fade have separate linear-luminance and encoded-range semantics (0.46049ms)
✔ vignette has signed exposure, adjustable source-space center/radii and a neutral interior (1.290504ms)
✔ grain is deterministic by source coordinate and seed, has real size/color modes and leaves alpha intact (5.106261ms)
✔ texture and clarity are signed, spatially distinct, flat-preserving and alpha-weighted (4.634734ms)
✔ every manual mask type produces a real local edit with exact zero-weight outside preservation (5.923134ms)
✔ ordered regions, opacity, disabled state and invert retain real independent semantics (1.872089ms)
✔ a real one-pixel edit preserves every exterior RGBA byte and ignores transparent neighbor colors (1.942737ms)
✔ continuous color-range remains bound to unmodified source pixels after global and prior regional edits (2.329115ms)
✔ all v2 stages preserve alpha and hidden RGB without mutating source or recipe (14.100388ms)
✔ full/tiled v2 share exact pixels for all stages, masks, geometry and nondividing tile edges (865.73201ms)
✔ maximum ordered detail dependency uses the complete twelve-pixel halo (61.289979ms)
✔ v2 default tile size crosses a real 512 boundary without seams, including source-anchored noise (34.993487ms)
✔ v2 full/tiled handle real image edges, singleton axes, budgets and cancellation (8.358897ms)
✔ v2 tiled rendering allocates only two reusable tile-sized Float32 work buffers (21.769819ms)
✔ every registered extreme remains a bounded real rendering parameter with stable alpha (23.737917ms)
✔ a real worker v2 tile export equals the main-thread reference for the same frozen input (230.240396ms)
✔ compound union/intersection/subtract/xor combine multiple soft areas with bounded inversion (2.810693ms)
✔ full regional curves, HSL and levels change only selected pixels and leave all exterior bytes untouched (17.278594ms)
✔ shared group correction is applied once across overlapping regions, with independent per-region edits afterwards (17.296721ms)
✔ region and group enable/opacity controls are independent and zero is exact identity (3.321025ms)
✔ source-color selection is fixed to immutable input even after global color adjustments (5.803791ms)
✔ every declared blend mode is finite, alpha-correct and distinguishes representative colors (0.743625ms)
✔ normal/multiply/screen/soft-light use their actual distinct equations, with transparent backdrops unaffected by blend choice (0.238551ms)
✔ a half-pixel paint stroke controls exactly one RGBA pixel and leaves its neighbors byte-identical (2.027648ms)
✔ paint opacity and isolated erasing do not erase the original image (3.620338ms)
✔ clone strokes sample a fixed pre-paint source instead of repeatedly sampling already painted pixels (1.795407ms)
✔ paint mask, visibility and layer order are genuine non-destructive compositing controls (3.422449ms)
✔ image layers resolve explicit pixels and perform placement, scale, alpha, masking and rotation (4.853824ms)
✔ disabled image layers never trigger resolution and can be retained without a fake output (1.246927ms)
✔ warp has signed compact support and distinct push, pinch, bulge and twirl fields (0.782874ms)
✔ warp protection locks selected background pixels exactly, including alpha and hidden RGB (4.1642ms)
✔ zero or disabled warp remains byte-identical and off-region pixels are not resampled (2.224135ms)
✔ luminance and chroma denoising operate independently, preserve flat fields and alpha (7.64647ms)
✔ signed chromatic aberration shifts the chosen channel without changing alpha or other channels (2.511681ms)
✔ all new source-space stages have identical full/tiled output across non-dividing tile edges and preserve input ownership (80.663828ms)
✔ spatial brush indexing preserves continuous capsules and does not build up opacity from denser samples (7.176759ms)
✔ paint workload admission rejects excessive paths before any image-sized byte allocation (95.493818ms)
✔ reusing one immutable image source in several layers counts its pixels once (2.689439ms)
✔ tiled v3 allocates only tile-sized Float32 buffers even across local color and paint layers (69.443002ms)
✔ a real worker exports v3 source layers, regional edits and geometry byte-identically to the main-thread reference (146.986478ms)
✔ v3 neutral migration reproduces original v1/v2 bytes including legacy locals, crop and alpha (33.437132ms)
✔ all-angle affine/projective source/output mappings round-trip through integer crop and quarter turns (36.481889ms)
✔ fine exact quarter-turn rotation swaps dimensions and produces no extra border pixels (3.596832ms)
✔ fine fractional rotation adds real transparent support and crop mode retains the chosen output frame (2.569789ms)
✔ fine quarter turns preserve hidden transparent RGB across round-off in both rotation directions (22.493464ms)
✔ compiled frame mapping retains exact legacy crop quantization and every quarter-turn/flip convention (17.104982ms)
✔ translation and independent axis scales are real geometric operations with invertible hit testing (2.026896ms)
✔ v3 geometry validates allocation budgets and singular or horizon-crossing transforms before rendering (2.28023ms)
✔ premultiplied linear reconstruction excludes hidden transparent colors and preserves neutral transparent data (1.642966ms)
✔ v3 rendering is cancellable at admission and through repeated pixel-row checks (1.367239ms)
✔ compiled gesture coordinates distinguish frame controls from inverse-warp content picking (1.502924ms)
✔ v3 creation owns defaults, round-trips strict JSON and never silently downgrades (12.326611ms)
✔ v3 global registry exposes exact defaults and generic setters retain all extension data (35.172032ms)
✔ v3 validation rejects unknown keys, invalid versions and incomplete color blocks (3.739909ms)
✔ v3 parser never executes accessors and rejects cycles, symbols, exotic prototypes and sparse arrays (1.613291ms)
✔ groups reference unique explicit identities and have independent validated complete color blocks (4.04508ms)
✔ operation provenance is bounded inert data and can carry a complete person control vector (3.0463ms)
✔ compound masks preserve discriminants and enforce depth, node and shape budgets (0.507458ms)
✔ paint validation enforces alpha/channel, finite coordinates and clone origins before any rendering (36.713735ms)
✔ image layers use bounded resource identities and reject URL payloads and illegal dimensions (2.182453ms)
✔ strict WAV validates actual duration including the 30-second boundary and typed-array offsets (111.733589ms)
✔ WAV rejects compressed, stereo, wrong-rate, wrong-byte-rate, missing, truncated and oversized input (7.701823ms)
✔ WAV rejects appended data, duplicate chunks and forged RIFF lengths (0.25105ms)
✔ provider setup has no implicit enabled model or endpoint bypass (0.980003ms)
✔ Ark audited profiles enforce request dimensions, reference types and model allowlists before dispatch (1.603186ms)
✔ Ark single-image request sends real official fields with reference bytes and keeps AI watermark (9.293722ms)
✔ Ark older group-capable profiles explicitly disable multiple output and streaming (1.060584ms)
✔ Ark rejects URL-only output, extra images, malformed base64 and wrong real dimensions as unknown (3.570232ms)
✔ HTTP refusal is distinguished from uncertain billing and raw provider error text is not propagated (1.376333ms)
✔ response readers reject announced excess, streamed excess, invalid JSON and interrupted bodies (2.026396ms)
✔ Qwen transcription uses allowed Beijing workspace endpoint and base64 WAV, never a public audio URL (0.546156ms)
✔ Qwen rejects unsafe input locally and treats truncated/malformed transcription as unknown (0.924198ms)
✔ OpenAI adapter is disabled without explicit enable/key/model allowlist and refuses arbitrary endpoints (120.971176ms)
✔ OpenAI generation uses the fixed real Images JSON protocol and returns all requested raster outputs (171.49794ms)
✔ OpenAI edit protocol sends exact normalized reference and markup bytes, with 2.6 complexity (14.979425ms)
✔ OpenAI mask requires a matching transparent PNG and never silently flattens a guide (12.728178ms)
✔ OpenAI profiles enforce real quality, format dependencies, current size evidence and batch budgets locally (0.642422ms)
✔ OpenAI JPEG and WebP compression is transmitted and decoded as the requested real format (1.611118ms)
✔ explicit transparency checks actual decoded alpha, not a filename or response declaration (1.7313ms)
✔ OpenAI ambiguous or partially completed batch responses stay unknown, preserve request receipt and never retry (5.32734ms)
✔ portrait analysis is owned, strictly source-bound and rejects stale IDs, duplicate targets and unknown fields (14.787995ms)
✔ portrait boundary rejects accessors, non-finite landmarks, sparse data and invalid visibility without executing them (1.595074ms)
✔ bounded off-image pose estimates retain a valid face and visible shoulders without enabling invisible legs (29.758456ms)
✔ open eyebrow chains use all hull vertices while only actually closed edges form contour loops (0.545365ms)
✔ face skin and lipstick masks protect eyes and the mouth cavity (2.297146ms)
✔ all registered face/body controls compile to real valid primitives with their own named targets (157.713049ms)
✔ every enabled portrait control produces real pixels, signed controls reverse, and tiled export matches the preview engine (456.034208ms)
✔ portrait controls replace their own operations without growing repeated slider changes or modifying other modules (16.606497ms)
✔ detaching a whole person preserves pixels and provenance while allowing a new automatic pass without IDs colliding or manual edits being overwritten (23.294185ms)
✔ makeup color is per tool and does not leak into numeric controls or recolor other tools on unrelated changes (19.685856ms)
✔ automatic recompilation refuses manual changes, deletion, ordering and missing checksums without losing the existing recipe (80.602171ms)
✔ changing automatic values retains existing order relative to later independent layers (10.889767ms)
✔ two fully configured portrait targets fit published operation budgets and keep independent values (74.33971ms)
✔ body tools check only the joints they need, retaining shoulder editing when lower-body joints are hidden (2.499602ms)
✔ tilted non-square portraits push their chin along the actual pixel-space facial axis (2.507654ms)
✔ sideways and inverted portraits retain a mouth-oriented facial axis instead of the screen vertical (8.828928ms)
✔ makeup options and RGBA reject sparse data and accessors without running user code (7.709715ms)
✔ a large face can receive masked makeup without an illegal paint radius or painting the mouth cavity (4.315229ms)
✔ semantic zero/reset remains identity and can remove a previous effect even if new contours are unavailable (8.376494ms)
✔ analysis adapter validates configuration, source binding, preview ratio and response version before accepting inference (3.619297ms)
✔ analysis adapter rejects cancelled work before and after inference and never treats partial output as success (0.996398ms)
✔ Tencent adapters have no unconfigured delivery or moderation bypass (1.677478ms)
✔ TC3 authorization binds exact body, action and UTC credential scope (2.169082ms)
✔ SMS uses official fixed endpoint, one approved purpose template and exact recipient receipt (12.556428ms)
✔ network errors, streamed interruption, invalid envelopes and large responses stay unknown without retries (3.551213ms)
✔ definite Tencent client rejection differs from ambiguous internal failure (1.795236ms)
✔ text moderation binds exact UTF-8 bytes and keeps Review distinct from Pass (1.185474ms)
✔ image moderation hashes the exact file and refuses small, mismatched or oversized content before external dispatch (12.109452ms)
✔ real JPEG/PNG/WebP/AVIF/static GIF/single-page TIFF codecs normalize to private PNG (74.269654ms)
✔ real animated GIF/WebP and multipage TIFF are rejected without first-frame flattening (13.180213ms)
✔ APNG/AVIF sequence declarations and unsupported containers are refused before decoding (24.750249ms)
✔ high-resolution normalization processes a real 20MP source and enforces independent server bounds (453.24351ms)
✔ streaming byte cap and process-wide decoder admission apply across storage instances (10.470212ms)
✔ private thumbnails preserve aspect and alpha, do not enlarge, and reuse immutable cached files (74.517835ms)
✔ model preparation rejects a truncated task even when its bad download hash was recorded (1.468602ms)
✔ model preparation validates length and TFLite magic independently of its hash (0.425473ms)
✔ model preparation requires a complete archive directory and exact versioned pose size (0.308567ms)
ℹ tests 444
ℹ suites 0
ℹ pass 444
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 30739.456219
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````

## web-build

原始文件：`v3-final-05-web-build.log`；SHA-256：`938d0c7cf5145c3be88959f4f9c7a5fa35fd076f16c3f26679504184562467b6`。

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

✓ built in 591ms
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

````

## production-dependencies

原始文件：`v3-final-05-production-dependencies.log`；SHA-256：`70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c`。

````text
found 0 vulnerabilities
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````
