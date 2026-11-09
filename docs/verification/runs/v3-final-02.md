# v3-final-02 实际运行记录

机器记录如下；本页复制真实输出，不将测试清单当作人工逐行审计。

```json
{
  "label": "v3-final-02",
  "startedAt": "2026-11-09T18:27:53.661Z",
  "finishedAt": "2026-11-09T18:28:51.097Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "e9bfb4480d3ad2e7fa865fbd31416c3131ea603e9c684814e6ee321e99613366",
  "inventory": "v3-final-02-inventory.json",
  "files": 283,
  "sourceLines": 82421,
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 22276,
      "log": "v3-final-02-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 29915,
      "log": "v3-final-02-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 855,
      "log": "v3-final-02-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 4382,
      "log": "v3-final-02-production-dependencies.log"
    }
  ],
  "passed": true
}
```

## typecheck

原始文件：`v3-final-02-typecheck.log`；SHA-256：`a9cbeed8f1d9b26b6285203e7aaf4f61472bdc5b69a22f7bc2f539ab940d4b90`。

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

原始文件：`v3-final-02-tests.log`；SHA-256：`fb57a363eaea5b65f7bd345c1381215176e5ffc553d0805573f0da8ddcfe5414`。

````text

> ai-xiutu@0.1.0 test
> node scripts/test.mjs

▶ queued cancellation and disabled-provider recovery use actual SQL and API ACL
  ✔ disabled capabilities still expose authorized cancellation; concurrent retries release once (191.856806ms)
  ✔ revoked or suspended actor cannot cancel; owner can release queued work without private operator access (52.471063ms)
  ✔ cancel racing an already dispatched request never releases or resends it (60.534107ms)
  ✔ restored queued rows with dispatch or unreadable evidence become unknown without refunds (254.255587ms)
  ✔ all adapters disabled still recover every stale operation once, redact audio and preserve receipts/holds (209.860748ms)
  ✔ missing backup evidence stops dispatch but never prevents conservative stale recovery (32.062078ms)
✔ queued cancellation and disabled-provider recovery use actual SQL and API ACL (1082.938376ms)
▶ AI result decisions, immutable source history and composition ACL
  ✔ forward migration preserves existing history and backfills retained storage without double counting (160.427987ms)
  ✔ public discovery resolves unconfigured adapters honestly and exposes no credentials (15.656806ms)
  ✔ fixtures create real immutable uploads, source snapshots and completed candidates (90.988891ms)
  ✔ missing session, outsider, viewer and platform operations do not gain adoption privileges (22.929183ms)
  ✔ rejection records an immutable decision without changing already settled points (55.364287ms)
  ✔ concurrent identical forks create one branch and changing a reused key fails (33.299642ms)
{"event":"api_error","requestId":"req-k","errorType":"Error","code":"INTERNAL"}
  ✔ lost adoption COMMIT acknowledgement replays the committed branch without duplicating it or settling again (30.135088ms)
{"event":"api_error","requestId":"req-n","errorType":"Error","code":"INTERNAL"}
  ✔ failed decision persistence rolls back its artwork and source snapshot in the same transaction (17.509793ms)
  ✔ adopting an image as a layer preserves its base, parameters, contain placement and immutable source history (78.886288ms)
  ✔ AI layer adoption checks capacity, output provenance and project ownership before appending (42.345706ms)
  ✔ replace atomically changes current source, preserves old source and rejects stale proposals (37.469458ms)
  ✔ restoring history appends source plus recipe together and uses CAS (29.553107ms)
  ✔ outdated parameter proposal may be preserved as a branch from its original source (17.271503ms)
  ✔ matching parameter suggestion applies exactly once and records a new revision (19.01186ms)
  ✔ text adoption creates document snapshots and prevents stale replacement (31.566016ms)
  ✔ wrong output type/index, unfinished jobs and attempted automatic refund fail closed (24.539893ms)
  ✔ composition saves enforce same-project image dependencies and block deletion from history (44.526239ms)
  ✔ cross-space copy remaps all composition source IDs to independently authorized assets (43.452882ms)
  ✔ user decision history stays project scoped after membership revocation (6.326213ms)
✔ AI result decisions, immutable source history and composition ACL (938.366519ms)
▶ asset annotations, authorized organization and v2 revision persistence
  ✔ additive migration is repeatable and user declarations preserve timezone without changing image bytes (36.615816ms)
  ✔ viewer and platform operator cannot edit or inspect unauthorized private annotations (25.446496ms)
  ✔ annotation validation rejects implicit timezones, unexpected GPS/export flags and malformed tags (16.069217ms)
  ✔ real project/space filters and exact microsecond cursors do not lose same-millisecond assets (26.232617ms)
  ✔ expired or revoked reference grant cannot query metadata; old cursor does not preserve access (8.061061ms)
  ✔ actual upload origin is recorded explicitly; a suggestive filename never implies AI provenance (29.153737ms)
  ✔ full v2 recipes and region data persist through ordinary artwork/revision CAS (25.446697ms)
{"event":"api_error","requestId":"req-z","errorType":"Error","code":"INTERNAL"}
  ✔ a lost upload COMMIT acknowledgement never deletes an already committed private asset (18.934994ms)
{"event":"upload_asset_cleanup_deferred"}
{"event":"api_error","requestId":"req-11","errorType":"Error","code":"INTERNAL"}
  ✔ an unavailable authoritative cleanup query preserves an unconfirmed private upload (12.416298ms)
✔ asset annotations, authorized organization and v2 revision persistence (380.085624ms)
▶ authorized source copies, retained capacity and durable replay use actual SQL
  ✔ real private fixtures and disabled copy policies do not silently reupload (129.064031ms)
  ✔ concurrent identical and independently keyed copies share one immutable source and one capacity charge (65.968439ms)
{"event":"api_error","requestId":"req-p","errorType":"Error","code":"INTERNAL"}
  ✔ lost commit response can be retried without a second asset or capacity reservation (41.168642ms)
  ✔ one capacity row covers concurrent copies to different projects in the same space (81.196176ms)
  ✔ byte capacity and a partial full-project copy roll back all rows and counters (54.450142ms)
  ✔ operators configure capacity with CAS but do not acquire private image access (40.900561ms)
  ✔ revoking copy policy denies new decisions but a committed same-key retry reads only its independent destination (24.417778ms)
  ✔ a non-owner copy grant binds one destination and cannot be reused as a full project grant (89.1107ms)
  ✔ grant expiry at the final publication boundary rolls back the copy, request and capacity together (50.228206ms)
  ✔ source copy cap applies across distinct idempotency keys and concurrent source assets (37.389228ms)
✔ authorized source copies, retained capacity and durable replay use actual SQL (742.586607ms)
▶ persistent API security, collaboration, quota and private media integration
  ✔ strict Origin and real unavailable SMS gate (37.213501ms)
  ✔ SMS registration, hashed sessions and invalid OTP attempt persistence (193.719286ms)
  ✔ private project ACL excludes platform operator; team roles are real (47.837625ms)
  ✔ bounded image decoding, EXIF removal and authenticated file access (63.351235ms)
  ✔ complete recipe validation, immutable revisions and CAS conflict (31.160251ms)
  ✔ comments anchor to exact revision; tasks/documents use durable CAS (41.32547ms)
  ✔ independent reference/copy policies, revocation and personal-team copy idempotency (60.257658ms)
  ✔ admin records and audited quota adjustment never grant private project access (138.207867ms)
  ✔ period uniqueness, concurrent reservations and expired unknown release conserve lots (97.052155ms)
  ✔ unconfigured AI cannot fabricate a job and revoked team members lose read access (10.31142ms)
  ✔ reset consumes its purpose code and revokes old sessions (136.977865ms)
  ✔ SQL rate limits survive app recreation and untrusted XFF cannot replace peer IP (407.384221ms)
  ✔ exactly one trusted proxy hop uses the nearest forwarded address (20.773548ms)
✔ persistent API security, collaboration, quota and private media integration (1395.325256ms)
✔ editing one region or group retains every other color block, mask, composition and version (13.650238ms)
✔ numeric controls require registry identity and preserve independent fields (0.715114ms)
✔ singular or excessive transformations are rejected before preview reaches React or the renderer (1.791785ms)
✔ all interactive mask creation kinds start from valid editable geometry (0.465005ms)
✔ image dimensions use all returned limits, including discrete lists and custom step (1.582186ms)
✔ platform or operator narrower bounds cannot be bypassed by a provider profile (0.169797ms)
✔ unsupported fields and PNG compression are absent from outgoing options (0.346505ms)
✔ transparent JPEG, excessive outputs and invalid compression are visible failures (0.23136ms)
✔ displayed service points include quality price and exact output count (0.169076ms)
✔ batch budget includes every selected image and enforces the transaction point cap (0.237279ms)
✔ uncertain decision retries retain a token without persisting generated or edited content (2.247124ms)
✔ privacy-mode storage failure and malformed persisted tokens cannot corrupt decision requests (0.803237ms)
✔ current adoption is blocked for dirty, different-project, wrong-source and stale-revision results (2.233173ms)
✔ cloud sources retain their copy policy across project changes and cannot become local uploads (1.310755ms)
✔ a lost copy response preserves one request identity while actor, source and destination are isolated (0.941106ms)
✔ persisted valid identities recover after a reload; corrupt or unavailable session storage fails safely (0.533678ms)
✔ second contact cancels a drawing transaction once and suppresses both pointers until released (0.962648ms)
✔ third contact and unrelated releases cannot unlock the suppressed transaction early (0.161154ms)
✔ duplicate down by the owned pointer is blocked without cancelling the valid stroke (0.155696ms)
✔ normal two-finger navigation remains possible but a new edit cannot join the gesture (0.102165ms)
✔ blur/source reset discards obsolete contacts without leaving the next gesture disabled (0.141074ms)
✔ rollback uses the original pre-stroke recipe and never removes a newer edit or source (5.193577ms)
✔ RGBA8 colors round-trip through both numeric color spaces without channel or alpha drift (4.209516ms)
✔ continuous hue reaches every sector rather than snapping to the quick swatches (1.666405ms)
✔ HEX shorthand and every alpha byte preserve precise RGBA data (1.022889ms)
✔ editing a nested region preserves siblings and independently edited latest data (2.077407ms)
✔ stale nested paths cannot write into a sibling or silently replace the parent (0.559848ms)
✔ curve drag has one pointer owner; another finger cannot move, finish, cancel or replace it (3.594911ms)
✔ cancellation restores the starting recipe once and a late lost-capture event cannot repeat it (0.932985ms)
✔ window-level cancellation without a pointer id uses the same ownership and rollback rule (0.816658ms)
✔ source changes invalidate late move, up, cancel and lost-capture paths without writing old data (1.482488ms)
✔ a changed channel cannot receive a former channel gesture or its rollback (0.487269ms)
✔ releasePointerCapture reentrancy cannot turn a committed drag into a rollback (0.592679ms)
✔ an external commit interrupts the drag so late move, commit and cancel preserve the new edit (1.888184ms)
✔ several synchronous owned previews remain cancellable without requiring a React render (0.397563ms)
✔ unavailable capture and explicit discard leave no dangling transaction (0.353836ms)
✔ a local curve transaction owns the whole recipe and cannot commit after its scope changes (0.458535ms)
✔ unchanged image export prepares the encoded bytes with the captured source filename (2.232826ms)
▶ source, recipe, generation, loading and unmount changes discard a late export before URL allocation
  ✔ new source with the identical recipe (0.294467ms)
  ✔ changed adjustments on the same source (0.23081ms)
  ✔ replacement recipe object even when values happen to match (0.212722ms)
  ✔ new request generation (0.220244ms)
  ✔ pending source replacement (0.208866ms)
  ✔ unmounted owner (0.183649ms)
✔ source, recipe, generation, loading and unmount changes discard a late export before URL allocation (2.880398ms)
✔ a slower superseded export cannot replace the newer source result (0.477815ms)
✔ an already unavailable export does not start encoding (0.400998ms)
✔ codec failures remain actionable only for the current request owner (0.60684ms)
✔ delivery disables image and recipe actions during decode or pending cloud source lookup (9.886212ms)
✔ two consumers of the same immutable preview share its exact histogram allocation (1.648911ms)
✔ new frame identity recomputes independently and never returns the preceding frame counts (0.192462ms)
✔ absent frames remain absent without creating placeholder counts or mutating a cached result (0.15868ms)
✔ late image download cannot overwrite edits made while its network request was pending (3.867955ms)
✔ late referenced-layer decoding stops after project switch even if the same recipe is selected (1.380253ms)
✔ unchanged request may commit while changed source identity cancels an otherwise identical recipe (0.865022ms)
✔ history binding resolves the old immutable source and rejects the current source or foreign project (0.475892ms)
✔ component motion has explicit independently selected desktop, tablet and phone tracks (1.14712ms)
✔ all media-containing wrappers keep zero blur in every breakpoint (0.13889ms)
✔ CSS includes reduced-motion and gesture escape paths with hidden state inert support (0.75821ms)
✔ selecting a compact-panel parameter reveals its whole main control with bounded local scrolling (0.760743ms)
✔ a control taller than an unusually short panel aligns its heading rather than oscillating (0.121654ms)
✔ the shelf retains named native controls, exact signed ranges, selected state and disabled availability (21.810005ms)
✔ pixel crop keeps exact boundaries at small, odd, tall and 16K sizes (7.579304ms)
✔ pixel crop clamps edge drags to at least one real source pixel (0.30971ms)
✔ numeric editor changes require trusted registry identity and leave input untouched (0.77202ms)
✔ legacy radial selection updates never erase v2 color, effects or independent regions (0.429942ms)
✔ one-pixel brush snaps a boundary click to exactly one original pixel center (2.226025ms)
✔ source preview sampling maps normalized source locations and clamps outer edge (0.558157ms)
✔ duplicate validates global brush complexity and preserves original when budget would overflow (13.035598ms)
✔ a secondary pointer cannot steal, finish or cancel the owned slider preview (1.601158ms)
✔ Escape cancellation cannot be followed by a late keyup commit (0.302699ms)
✔ keyboard chord commits once after its final key and ignores unrelated releases (0.126342ms)
✔ neutral gestures create no changed result and source unmount discards ownership (0.214285ms)
✔ v2 AI confirmation includes advanced changes alongside legacy exposure (2.376494ms)
✔ v3 confirmation lists inherited color/effects and new optical/transform parameters (2.65149ms)
✔ v3 retained masks, groups, paint, composition and warp changes are explicitly disclosed (4.100879ms)
✔ non-numeric review ignores object key order but preserves ordered-layer and curve differences (0.768726ms)
✔ equal JSONB-style reordered recipes do not create false numeric changes (0.404804ms)
✔ legacy candidates remain legacy and non-numeric replacements are explicitly named (1.003201ms)
✔ preview preparation is an exact reference identity when geometry already fits the budget (8.973234ms)
✔ adaptive downsampling preserves alpha with premultiplied linear area reconstruction (2.084215ms)
✔ output-aware planning handles rotation, projective crop and scale without rewriting recipe or source coordinates (10.671035ms)
✔ actual worker protocol downsizes expanded previews and retains the full transformed export and layer coordinates (1880.460818ms)
✔ worker fallback keeps original pixels after transfer, resolves layer aliases and clears them for a new source (22.95812ms)
✔ render readiness includes active displacement and protection but excludes disabled warp edits (6.905775ms)
✔ painting and source sampling reject transparent contain corners while shape handles can clamp (2.62836ms)
✔ layer handles retain off-frame freedom and pixel painting follows inverse displacement (1.47315ms)
✔ prefers native randomUUID and keeps the Web Crypto receiver (0.969528ms)
✔ HTTP-style Crypto without randomUUID uses exactly 16 random bytes (0.170198ms)
✔ fallback enforces v4 and RFC variant bits while preserving the remaining entropy (0.632868ms)
✔ a native UUID failure can fall back only to a working secure RNG (0.1586ms)
✔ no RNG is an explicit unavailable error, never a weak identifier (0.447187ms)
✔ a failing secure RNG rejects rather than returning zero or pseudo-random bytes (0.139391ms)
✔ 844×390 restores all dock modes inside the workspace and above the reachable toolbar (1.317846ms)
✔ continuous panel sizes are bounded by available pixels, not a 330px product ceiling (0.18469ms)
✔ phone width, height, floating positions and side docking remain user choices (0.233424ms)
✔ a very large docked panel never automatically covers the photo; explicit overlay remains available (0.926543ms)
✔ a 339px saved phone sheet preserves the complete exclusion area at both 320×700 and 390×844 (0.265892ms)
✔ fresh phone defaults reserve photo pixels without beginning in overlay (0.324962ms)
✔ low-room guidance uses actual fit space without changing composition or limiting manual sizes (0.309619ms)
✔ side docks and short windows deduct their own viewport chrome and fit padding (0.44903ms)
✔ 320px quick photo view preserves the requested 339px panel and keeps fitted images above it (0.477233ms)
✔ measured banners and keyboard space constrain panels without overwriting their saved rectangle (0.302447ms)
✔ maximize and collapse are derived display modes with an exact normal-size return path (0.186793ms)
✔ undocking preserves the visible origin and keyboard movement supports one pixel (0.308376ms)
✔ floating west/north resize holds the opposite edge through minimum size and viewport limits (0.413406ms)
✔ bottom sheets resize symmetrically in width and retain their bottom anchor in height (0.340856ms)
✔ resizing across six actual QA sizes keeps every edge accessible (5.537574ms)
✔ layout parsing repairs unavailable display modes and rejects corrupt old preferences (0.808975ms)
✔ multimodal SQL integration requires the explicit CI database when requested (2.905359ms)
▶ multimodal jobs use real SQL, private normalized images and injected supplier boundaries
  ✔ v3 plans preserve image dependencies and fine transform, while unuploaded or foreign layer references create no hold (117.241404ms)
  ✔ new v2 numeric plans freeze their protocol, moderate generated changes and preserve existing masks without auto-applying (67.676468ms)
  ✔ invalid generated v2 paths never publish and retain their genuine receipt plus unknown hold (75.407389ms)
  ✔ old frozen v2 tasks retain the legacy adjustment protocol and digest while new protocol tampering fails before dispatch (110.228566ms)
  ✔ text iteration explicitly freezes its successful same-project parent, without implicit full chat history (101.693944ms)
  ✔ image submit is idempotent, reserves once and exposes no generated asset until normalized-byte review passes (95.241569ms)
  ✔ text generation freezes document context and returns a candidate without overwriting the live document (66.739234ms)
  ✔ speech success retains only the audio hash, omits raw audio from DTOs and does not execute edits (66.536282ms)
  ✔ edit-plan still returns a complete frozen-recipe candidate without changing the artwork (48.202418ms)
  ✔ successful empty ASR becomes an explicit no-speech result and settles once without fabricated text (59.208206ms)
  ✔ input review rejection and review-hash mismatch do not call a billable image model (82.840974ms)
  ✔ reference-image block prevents generation and preserves the existing source (50.547639ms)
  ✔ blocked generated image is never attached or exposed, private bytes are removed and billing remains unknown (66.338353ms)
  ✔ independent image adapter returning a wrong decoded size cannot bypass worker validation (58.172704ms)
  ✔ post-generation text moderation block preserves the source and never publishes the candidate (54.391153ms)
  ✔ unknown image outcome is not retried and only an operator can settle it idempotently (68.915269ms)
  ✔ a definitive model refusal releases the hold for all four operations without a retry (164.448836ms)
  ✔ a definitive output-review error cannot release a hold after the model has already succeeded (128.622667ms)
  ✔ speech unknown, invalid frozen bytes and stale worker recovery all redact raw audio without retry (107.486774ms)
  ✔ authorization and project scoping reject outsiders, wrong wallets and cross-project references before a hold (30.99602ms)
  ✔ text permission revoked during asynchronous input review stops the billable call (45.292012ms)
  ✔ model disabled during input review stops image dispatch even though admission was valid (48.322564ms)
  ✔ speech permission revoked during journal persistence stops transcription and erases queued audio (43.824739ms)
  ✔ image revocation during output review prevents asset attachment and discards the private candidate (49.472672ms)
  ✔ frozen manifest detects tampering and binds image row model to the approved model (60.908081ms)
  ✔ a missing frozen reference cannot silently downgrade an approved reference-image request to text-only generation (41.090144ms)
  ✔ reference revocation during image review prevents its bytes from being sent to generation (47.585679ms)
  ✔ edit-plan integrity includes the whole base recipe, not only currentAdjustments sent to the LLM (48.834901ms)
  ✔ an existing dispatch record freezes a restored queued image job instead of sending it again (39.287595ms)
  ✔ restored image dispatch evidence wins over later model disablement and cannot release the paid hold (34.547989ms)
  ✔ restored plan dispatch evidence wins over revoked membership before any access-denied release (50.756169ms)
  ✔ missing database dispatch evidence halts new work instead of silently rebuilding vendor requests (25.901938ms)
✔ multimodal jobs use real SQL, private normalized images and injected supplier boundaries (2219.61103ms)
▶ OpenAI persistent batch lifecycle, accounting, references and real request lineage
  ✔ lost acknowledgement after a real batch COMMIT keeps every published image and settles once (135.04488ms)
{"event":"ai_asset_cleanup_deferred"}
  ✔ unknown output plus unavailable cleanup check retains private bytes without publishing them (63.67575ms)
  ✔ n outputs reserve n times the selected quality price once; queued price does not change (108.638559ms)
  ✔ input denial releases the whole reservation and calls no image supplier (46.834191ms)
  ✔ one rejected output leaves the entire batch unpublished, unknown and not retried (75.952359ms)
  ✔ references and mask use exact hashed bytes; parent output is explicitly selected and persisted (222.737325ms)
  ✔ a reference revoked during supplier execution prevents all publication (76.240064ms)
  ✔ batch cardinality and transport uncertainty keep the complete hold; malformed options create none (134.960363ms)
  ✔ editing queued parameters cannot replace the frozen payload or mint a cheaper multi-image job (50.199597ms)
✔ OpenAI persistent batch lifecycle, accounting, references and real request lineage (969.656697ms)
✔ endpoint allowlist rejects userinfo, off-region, query and redirect targets (1.328742ms)
✔ frozen input hashes include endpoint, exact JSON body and requested adjustments (0.782054ms)
✔ AI proposals cannot call arbitrary tools, overwrite geometry or exceed parameter bounds (3.953406ms)
✔ AI legacy adjustment proposals preserve the complete v2 recipe and never gain access to its new fields (2.934804ms)
✔ new v2 plans expose only registry numeric values, keep the old default protocol byte-for-byte and bound moderation input (1.586742ms)
✔ v2 proposals atomically validate joint levels, report actual differences and preserve all regions (4.247065ms)
✔ v3 global proposals preserve fine geometry, layers and warp without exposing their private data to the provider (7.50278ms)
✔ v2 whitelist rejects arbitrary paths, duplicates, non-finite numbers, integer violations and invalid final levels (2.497391ms)
✔ real HTTP adapter uses bounded JSON, authorization, no redirects and never retries (8.98262ms)
✔ Qwen adapter retains vendor receipt for incomplete responses and rejects a definite error without retry (2.135063ms)
✔ database integration is explicitly required by CI (3.683146ms)
▶ AI transaction, moderation, idempotency, unknown and restore invariants
  ✔ one submission reserves once; completed candidate never modifies the artwork (60.583044ms)
  ✔ input rejection never calls the model and releases the original lot (38.856026ms)
  ✔ ambiguous external result holds points and is never automatically retried (40.442654ms)
  ✔ existing dispatch evidence prevents re-execution of a restored queued row (24.281965ms)
  ✔ changed head and revoked membership reject new paid requests (8.225034ms)
  ✔ journal record missing from restored DB stops all future dispatch (7.078698ms)
✔ AI transaction, moderation, idempotency, unknown and restore invariants (210.709493ms)
✔ module registry rejects duplicates, missing dependencies and cycles without executing code (5.172001ms)
✔ asset copy contract accepts only a destination and stable request key, never caller ownership or bytes (1.579661ms)
✔ sealed registry isolates caller data, resolves explicit gates and cannot pretend a contract has an executor (2.309818ms)
✔ decision schema keeps kind-specific fields, CAS and idempotency explicit (3.527982ms)
✔ shared source frame binds analysis to normalized pixels and command envelope carries no actor authority (1.438428ms)
▶ schema readiness uses the migration registry and rejects old, incomplete and newer databases
  ✔ migrate and readiness agree on the actual highest registered migration (5.226824ms)
  ✔ old v2 (4.682389ms)
  ✔ missing intermediate (3.931913ms)
  ✔ newer than this code (4.914962ms)
  ✔ empty (2.647699ms)
  ✔ doctor CLI reports the complete current schema without contacting vendors (337.616056ms)
✔ schema readiness uses the migration registry and rejects old, incomplete and newer databases (374.592442ms)
✔ recipe construction owns its arrays and the shared default is deeply frozen (2.142925ms)
✔ full-recipe validation rejects malformed versions, unknown params, NaN and negative detail (2.011606ms)
✔ validation does not invoke getters and rejects inherited/prototype payloads (0.934024ms)
✔ JSON round trip has deterministic versioned data and no references to the input (0.597164ms)
✔ neutral recipe is byte-identical for all byte values and alpha, but never mutates input (2.038406ms)
✔ exposure performs linear-light EV rather than multiplying encoded bytes (1.765493ms)
✔ signed light tools move in both directions, and brightness is not exposure (1.914379ms)
✔ contrast has a midtone pivot and highlight/shadow controls target different tonal ranges (0.611406ms)
✔ saturation -100 is grayscale and vibrance leaves neutral gray neutral (0.927264ms)
✔ temperature and tint have signed, distinct relative color semantics (0.589192ms)
✔ curve endpoints, channel isolation and RGB-then-channel order are explicit (3.271102ms)
✔ bad curve ordering, duplicate x, missing endpoints and accessors are rejected (0.614851ms)
✔ crop, all clockwise rotations and output-axis flips are exact RGBA permutations (1.140146ms)
✔ geometry helpers use actual crop quantization and invert across all rotations/flips (1.367571ms)
✔ alpha survives every adjustment and transparent color cannot bleed through detail filters (4.526664ms)
✔ soften reduces a small local fluctuation and sharpening increases it without changing flat fields (0.744548ms)
✔ radial feather and inverse have bounded complementary weights (0.518866ms)
✔ enabled local tone and smoothing leave every outside pixel byte-identical to the global baseline (2.912911ms)
✔ inverted local mask protects its center and local detail does not become a global effect (0.701883ms)
✔ histograms count visible pixels, preserve channel bins and ignore hidden RGB (0.314386ms)
✔ bounds reject excessive dimensions, incomplete buffers and unauthorized budget enlargement (1.097972ms)
✔ extreme valid settings remain bounded, keep alpha, and do not mutate recipes (3.957381ms)
✔ worker-rendered preview and main-thread export use identical canonical pixels for the same input (107.720258ms)
✔ BMP preflight supports explicit uncompressed RGB variants and rejects alternate encodings (1.966728ms)
✔ real static GIF is inspected through complete frame/trailer and rejects truncation/animation (7.030765ms)
✔ real AVIF primary-image associations work for RGB and alpha; sequence/missing/invalid boxes fail closed (25.701845ms)
✔ header inspection requires explicit larger image budget, bounded at 64MP/16384 (0.469961ms)
✔ AVIF dimensions are selected through the actual primary item association, not the first ispe (3.177701ms)
✔ AVIF FullBox fields cannot borrow bytes from a following sibling box (0.763716ms)
✔ AVIF item counts, item IDs, primary flags and minimum AV1 configuration are checked (0.614981ms)
✔ AVIF rejects duplicate singleton metadata instead of choosing an arbitrary primary (0.460407ms)
✔ AVIF scans visible top-level boxes after meta and rejects sequence or duplicate metadata (0.366005ms)
✔ AVIF box lengths, extended sizes and bounded nesting fail closed (4.479221ms)
✔ AVIF distinguishes an intentionally bounded large-file prefix from a truncated complete small file (8.625204ms)
✔ BMP validates signed dimensions, padded row footprint and declared payload before decoding (0.576272ms)
✔ GIF counts actual image blocks, bounds extensions and requires the complete static trailer (0.696906ms)
✔ extended formats share explicit pixel budgets without allocating decoded high-resolution images (0.690495ms)
✔ header preflight recognizes static PNG, 8-bit JPEG profiles and both WebP bitstreams (2.333263ms)
✔ animation declarations are flagged before any decoder is constructed (0.705558ms)
✔ header dimensions block zero sizes, huge sides and decompression pixel bombs (0.411723ms)
✔ PNG preflight checks header CRC, chunk boundaries, ordering and bounded metadata (43.554505ms)
✔ JPEG preflight rejects malformed segments, alternate size frames and unknown coding modes (0.388778ms)
✔ WebP preflight checks RIFF length, padding, frame signatures, versions and canvas mismatch (0.348228ms)
✔ unsupported signatures and oversized header buffers fail closed (0.406155ms)
✔ tiled neutral rendering preserves all RGBA byte values and disabled local state (4.019716ms)
✔ all stages match the reference byte for byte for several non-dividing tile sizes (41.488978ms)
✔ fractional crop, all rotations and output flips share exact geometry with the reference (110.499125ms)
✔ default 512-pixel tile boundaries and partial edge tiles have no seams or alpha drift (442.660623ms)
✔ two consecutive radius-1 detail stages retain their full two-pixel dependency halo (2.025587ms)
✔ radial masks, feather and inversion remain in original whole-image coordinates across tiles (80.345801ms)
✔ crop-border detail samples include neighbors outside the crop just like pre-crop reference processing (2.603251ms)
✔ single-pixel, row, column and small transparent images retain correct real-image edge extension (2.351079ms)
✔ Float32 work buffers are tile-sized and allocated twice, then reused for all tiles (55.722729ms)
✔ the explicit tiled path supports a 16,384-pixel side without widening reference-renderer admission (1.303243ms)
✔ a real 20MP input with a small crop uses only cropped tiles and honors an explicitly lower admission budget (5.720962ms)
✔ high-resolution geometry helpers map coordinates without requiring a whole-image float allocation (0.322679ms)
✔ tiled input budgets, tile size, buffer completeness and cancellation fail before unsafe work (2.602149ms)
✔ tiled rendering in a real worker uses the same canonical pixels as reference export (181.896738ms)
✔ compiled radial masks preserve the old radial mathematical convention (1.631169ms)
✔ linear gradient projection uses source pixel aspect, bounded endpoints and optional smoothing (0.278822ms)
✔ polygon selection has pixel-aspect-aware inward feather and exact zero exterior (0.468439ms)
✔ brush capsules are continuous between samples and maintain circular source-pixel radii (0.418934ms)
✔ brush additive/subtractive strokes compose ordered coverage without point-density buildup (0.485795ms)
✔ a half-pixel brush selects exactly one pixel center at the maximum admitted square dimensions (0.654291ms)
✔ RLE masks preserve every byte weight at source cell centers and explicit normalized resizing (1.622456ms)
✔ continuous source color selection wraps hue, distinguishes grey and preserves transparent exclusion under inversion (0.483712ms)
✔ continuous color saturation and encoded-luminance bands feather independently (0.457343ms)
✔ color overlay can explicitly sample a smaller original preview through normalized coordinates (0.266133ms)
✔ compiled mask domain rejects non-finite samples and bounds inverse selection to the actual source image (0.20481ms)
✔ version dispatch is explicit and never drops unknown version fields (4.473184ms)
✔ explicit v1 migration preserves all common fields and owns every nested value (2.196978ms)
✔ AI-safe base adjustment patch preserves version, masks and every v2 control (2.723145ms)
✔ the v2 registry exactly addresses implemented bounded controls and canonical defaults (24.127189ms)
✔ v2 rejects invalid coupled ranges, integer seeds, incomplete masks and unsupported fields (1.159495ms)
✔ new nested validators do not execute accessors or accept prototype payloads (5.498939ms)
✔ discriminated region builders replace masks without leaking radial fields (10.059264ms)
✔ mask validation enforces finite geometry, nondegeneracy, RLE coverage and complexity caps (53.823722ms)
✔ default v2 is an exact RGBA identity and migrated v1 replays byte-for-byte in both renderers (20.643716ms)
✔ levels independently set input endpoints, gamma direction and output endpoints (3.389533ms)
✔ each of eight HSL bands has real signed hue, saturation and lightness behavior without recoloring grey (16.364293ms)
✔ HSL interpolation is continuous across hue zero and stable at extreme dark levels (1.085965ms)
✔ three-way color grading and split-tone settings affect the intended tonal weights (1.384702ms)
✔ monochrome and fade have separate linear-luminance and encoded-range semantics (0.498536ms)
✔ vignette has signed exposure, adjustable source-space center/radii and a neutral interior (1.703159ms)
✔ grain is deterministic by source coordinate and seed, has real size/color modes and leaves alpha intact (5.005422ms)
✔ texture and clarity are signed, spatially distinct, flat-preserving and alpha-weighted (4.993474ms)
✔ every manual mask type produces a real local edit with exact zero-weight outside preservation (5.767062ms)
✔ ordered regions, opacity, disabled state and invert retain real independent semantics (1.916459ms)
✔ a real one-pixel edit preserves every exterior RGBA byte and ignores transparent neighbor colors (2.434825ms)
✔ continuous color-range remains bound to unmodified source pixels after global and prior regional edits (1.730681ms)
✔ all v2 stages preserve alpha and hidden RGB without mutating source or recipe (14.607073ms)
✔ full/tiled v2 share exact pixels for all stages, masks, geometry and nondividing tile edges (928.742731ms)
✔ maximum ordered detail dependency uses the complete twelve-pixel halo (75.308824ms)
✔ v2 default tile size crosses a real 512 boundary without seams, including source-anchored noise (36.318788ms)
✔ v2 full/tiled handle real image edges, singleton axes, budgets and cancellation (7.708567ms)
✔ v2 tiled rendering allocates only two reusable tile-sized Float32 work buffers (24.155945ms)
✔ every registered extreme remains a bounded real rendering parameter with stable alpha (25.27584ms)
✔ a real worker v2 tile export equals the main-thread reference for the same frozen input (232.251395ms)
✔ compound union/intersection/subtract/xor combine multiple soft areas with bounded inversion (2.539992ms)
✔ full regional curves, HSL and levels change only selected pixels and leave all exterior bytes untouched (15.305318ms)
✔ shared group correction is applied once across overlapping regions, with independent per-region edits afterwards (14.917707ms)
✔ region and group enable/opacity controls are independent and zero is exact identity (2.864066ms)
✔ source-color selection is fixed to immutable input even after global color adjustments (4.497151ms)
✔ every declared blend mode is finite, alpha-correct and distinguishes representative colors (0.639257ms)
✔ normal/multiply/screen/soft-light use their actual distinct equations, with transparent backdrops unaffected by blend choice (0.238517ms)
✔ a half-pixel paint stroke controls exactly one RGBA pixel and leaves its neighbors byte-identical (1.881677ms)
✔ paint opacity and isolated erasing do not erase the original image (3.266068ms)
✔ clone strokes sample a fixed pre-paint source instead of repeatedly sampling already painted pixels (1.451863ms)
✔ paint mask, visibility and layer order are genuine non-destructive compositing controls (3.369203ms)
✔ image layers resolve explicit pixels and perform placement, scale, alpha, masking and rotation (4.432634ms)
✔ disabled image layers never trigger resolution and can be retained without a fake output (1.144112ms)
✔ warp has signed compact support and distinct push, pinch, bulge and twirl fields (0.460309ms)
✔ warp protection locks selected background pixels exactly, including alpha and hidden RGB (3.568842ms)
✔ zero or disabled warp remains byte-identical and off-region pixels are not resampled (2.230088ms)
✔ luminance and chroma denoising operate independently, preserve flat fields and alpha (6.598055ms)
✔ signed chromatic aberration shifts the chosen channel without changing alpha or other channels (2.275786ms)
✔ all new source-space stages have identical full/tiled output across non-dividing tile edges and preserve input ownership (63.520872ms)
✔ spatial brush indexing preserves continuous capsules and does not build up opacity from denser samples (6.377104ms)
✔ paint workload admission rejects excessive paths before any image-sized byte allocation (92.464472ms)
✔ reusing one immutable image source in several layers counts its pixels once (2.555645ms)
✔ tiled v3 allocates only tile-sized Float32 buffers even across local color and paint layers (70.542177ms)
✔ a real worker exports v3 source layers, regional edits and geometry byte-identically to the main-thread reference (152.952302ms)
✔ v3 neutral migration reproduces original v1/v2 bytes including legacy locals, crop and alpha (25.199092ms)
✔ all-angle affine/projective source/output mappings round-trip through integer crop and quarter turns (31.278605ms)
✔ fine exact quarter-turn rotation swaps dimensions and produces no extra border pixels (3.822746ms)
✔ fine fractional rotation adds real transparent support and crop mode retains the chosen output frame (2.581948ms)
✔ fine quarter turns preserve hidden transparent RGB across round-off in both rotation directions (21.297146ms)
✔ compiled frame mapping retains exact legacy crop quantization and every quarter-turn/flip convention (16.640517ms)
✔ translation and independent axis scales are real geometric operations with invertible hit testing (2.148312ms)
✔ v3 geometry validates allocation budgets and singular or horizon-crossing transforms before rendering (2.448917ms)
✔ premultiplied linear reconstruction excludes hidden transparent colors and preserves neutral transparent data (1.705482ms)
✔ v3 rendering is cancellable at admission and through repeated pixel-row checks (1.768437ms)
✔ compiled gesture coordinates distinguish frame controls from inverse-warp content picking (1.577969ms)
✔ v3 creation owns defaults, round-trips strict JSON and never silently downgrades (11.452635ms)
✔ v3 global registry exposes exact defaults and generic setters retain all extension data (34.193726ms)
✔ v3 validation rejects unknown keys, invalid versions and incomplete color blocks (3.385855ms)
✔ v3 parser never executes accessors and rejects cycles, symbols, exotic prototypes and sparse arrays (1.683177ms)
✔ groups reference unique explicit identities and have independent validated complete color blocks (4.030711ms)
✔ operation provenance is bounded inert data and can carry a complete person control vector (2.93326ms)
✔ compound masks preserve discriminants and enforce depth, node and shape budgets (0.363851ms)
✔ paint validation enforces alpha/channel, finite coordinates and clone origins before any rendering (30.673739ms)
✔ image layers use bounded resource identities and reject URL payloads and illegal dimensions (2.420483ms)
✔ strict WAV validates actual duration including the 30-second boundary and typed-array offsets (95.97444ms)
✔ WAV rejects compressed, stereo, wrong-rate, wrong-byte-rate, missing, truncated and oversized input (7.282393ms)
✔ WAV rejects appended data, duplicate chunks and forged RIFF lengths (0.367947ms)
✔ provider setup has no implicit enabled model or endpoint bypass (0.975466ms)
✔ Ark audited profiles enforce request dimensions, reference types and model allowlists before dispatch (1.456384ms)
✔ Ark single-image request sends real official fields with reference bytes and keeps AI watermark (8.557503ms)
✔ Ark older group-capable profiles explicitly disable multiple output and streaming (1.080425ms)
✔ Ark rejects URL-only output, extra images, malformed base64 and wrong real dimensions as unknown (3.289339ms)
✔ HTTP refusal is distinguished from uncertain billing and raw provider error text is not propagated (1.947398ms)
✔ response readers reject announced excess, streamed excess, invalid JSON and interrupted bodies (2.108311ms)
✔ Qwen transcription uses allowed Beijing workspace endpoint and base64 WAV, never a public audio URL (0.717025ms)
✔ Qwen rejects unsafe input locally and treats truncated/malformed transcription as unknown (1.043019ms)
✔ OpenAI adapter is disabled without explicit enable/key/model allowlist and refuses arbitrary endpoints (104.776598ms)
✔ OpenAI generation uses the fixed real Images JSON protocol and returns all requested raster outputs (147.561347ms)
✔ OpenAI edit protocol sends exact normalized reference and markup bytes, with 2.6 complexity (14.732024ms)
✔ OpenAI mask requires a matching transparent PNG and never silently flattens a guide (11.619207ms)
✔ OpenAI profiles enforce real quality, format dependencies, current size evidence and batch budgets locally (0.679869ms)
✔ OpenAI JPEG and WebP compression is transmitted and decoded as the requested real format (1.652271ms)
✔ explicit transparency checks actual decoded alpha, not a filename or response declaration (1.851252ms)
✔ OpenAI ambiguous or partially completed batch responses stay unknown, preserve request receipt and never retry (3.883489ms)
✔ portrait analysis is owned, strictly source-bound and rejects stale IDs, duplicate targets and unknown fields (15.435413ms)
✔ portrait boundary rejects accessors, non-finite landmarks, sparse data and invalid visibility without executing them (1.839244ms)
✔ bounded off-image pose estimates retain a valid face and visible shoulders without enabling invisible legs (30.162635ms)
✔ open eyebrow chains use all hull vertices while only actually closed edges form contour loops (0.64089ms)
✔ face skin and lipstick masks protect eyes and the mouth cavity (2.057384ms)
✔ all registered face/body controls compile to real valid primitives with their own named targets (160.895185ms)
✔ every enabled portrait control produces real pixels, signed controls reverse, and tiled export matches the preview engine (428.335639ms)
✔ portrait controls replace their own operations without growing repeated slider changes or modifying other modules (15.071573ms)
✔ detaching a whole person preserves pixels and provenance while allowing a new automatic pass without IDs colliding or manual edits being overwritten (21.632454ms)
✔ makeup color is per tool and does not leak into numeric controls or recolor other tools on unrelated changes (16.54317ms)
✔ automatic recompilation refuses manual changes, deletion, ordering and missing checksums without losing the existing recipe (71.061189ms)
✔ changing automatic values retains existing order relative to later independent layers (8.79359ms)
✔ two fully configured portrait targets fit published operation budgets and keep independent values (70.232576ms)
✔ body tools check only the joints they need, retaining shoulder editing when lower-body joints are hidden (2.049953ms)
✔ tilted non-square portraits push their chin along the actual pixel-space facial axis (2.22697ms)
✔ sideways and inverted portraits retain a mouth-oriented facial axis instead of the screen vertical (6.74573ms)
✔ makeup options and RGBA reject sparse data and accessors without running user code (5.12658ms)
✔ a large face can receive masked makeup without an illegal paint radius or painting the mouth cavity (4.937474ms)
✔ semantic zero/reset remains identity and can remove a previous effect even if new contours are unavailable (8.198279ms)
✔ analysis adapter validates configuration, source binding, preview ratio and response version before accepting inference (3.585087ms)
✔ analysis adapter rejects cancelled work before and after inference and never treats partial output as success (0.646068ms)
✔ Tencent adapters have no unconfigured delivery or moderation bypass (1.682707ms)
✔ TC3 authorization binds exact body, action and UTC credential scope (1.690189ms)
✔ SMS uses official fixed endpoint, one approved purpose template and exact recipient receipt (7.142261ms)
✔ network errors, streamed interruption, invalid envelopes and large responses stay unknown without retries (2.829783ms)
✔ definite Tencent client rejection differs from ambiguous internal failure (1.900627ms)
✔ text moderation binds exact UTF-8 bytes and keeps Review distinct from Pass (1.085743ms)
✔ image moderation hashes the exact file and refuses small, mismatched or oversized content before external dispatch (10.951066ms)
✔ real JPEG/PNG/WebP/AVIF/static GIF/single-page TIFF codecs normalize to private PNG (66.378818ms)
✔ real animated GIF/WebP and multipage TIFF are rejected without first-frame flattening (11.793871ms)
✔ APNG/AVIF sequence declarations and unsupported containers are refused before decoding (15.670529ms)
✔ high-resolution normalization processes a real 20MP source and enforces independent server bounds (403.760913ms)
✔ streaming byte cap and process-wide decoder admission apply across storage instances (9.882628ms)
✔ private thumbnails preserve aspect and alpha, do not enlarge, and reuse immutable cached files (65.942672ms)
✔ model preparation rejects a truncated task even when its bad download hash was recorded (1.408502ms)
✔ model preparation validates length and TFLite magic independently of its hash (0.437302ms)
✔ model preparation requires a complete archive directory and exact versioned pose size (0.381467ms)
ℹ tests 444
ℹ suites 0
ℹ pass 444
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 29653.430707
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````

## web-build

原始文件：`v3-final-02-web-build.log`；SHA-256：`637fce47f5f8b16666f937851895a11bb1f9cbdc4ff7fe9c3d168dc5e86fd90f`。

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

✓ built in 546ms
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

````

## production-dependencies

原始文件：`v3-final-02-production-dependencies.log`；SHA-256：`70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c`。

````text
found 0 vulnerabilities
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

````
