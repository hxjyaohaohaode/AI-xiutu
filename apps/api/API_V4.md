# V4 API additions: actual request and lifecycle contracts

This extends [API.md](API.md). Authentication, same-origin mutation checks,
strict request validation, version conflicts and operator/content isolation remain.
Shared DTOs are in `@ai-xiutu/contracts`. These are implemented routes, not a claim
that external model accounts, every image format or all production scales are verified.

## 1. Same-artwork realtime collaboration

All routes require an active login and current space membership. A reference-only
grant does not create a realtime member. Viewers can read presence; leases,
previews and commands require owner/admin/editor. Platform operator is not a bypass.
The prefix below is `/v1/artworks/:id/collaboration`.

| Method and suffix             | Request                                                                                 | Response                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET prefix                    | `after?:decimal-string`, `knownVersion?:positive integer`, `waitMs?:0..20000`           | `CollaborationPollResponse`                                                                        |
| POST `/sessions`              | `{clientId:UUID}`                                                                       | 201 `{session,...CollaborationPollResponse}`; same actor/artwork/client rejoins its active session |
| PATCH `/sessions/:sessionId`  | `{sequence,cursor?:{x,y}\|null,tool?:string\|null,selection?:target\|null}`             | `{session,accepted,reason?,retryAfterMs?}`                                                         |
| DELETE `/sessions/:sessionId` | none                                                                                    | `{ok:true}`; removes owned session and its leases/previews                                         |
| POST `/leases`                | `{sessionId,target}`                                                                    | 201 `{lease,replayed:false}`, or 200 same live target lease                                        |
| PATCH `/leases/:leaseId`      | `{sessionId,fence}`                                                                     | `{lease}` renewed for30seconds                                                                     |
| DELETE `/leases/:leaseId`     | `{sessionId,fence}`                                                                     | `{ok:true,replayed?}`                                                                              |
| POST `/previews`              | `{sessionId,leaseId,fence,baseVersion,sequence,operation}`                              | `{accepted,reason?,retryAfterMs?,preview?,cursor?}`                                                |
| DELETE `/previews/:leaseId`   | `{sessionId,fence}`                                                                     | `{ok:true}`                                                                                        |
| POST `/commands`              | `{protocolVersion:1,idempotencyKey:UUID,sessionId,leaseId,fence,baseVersion,operation}` | 201/200 `{artwork,revision,asset,cursor,rebased,replayed}`                                         |

Fences and event cursors are decimal strings, not JavaScript numbers; they must
fit a PostgreSQL bigint. Sequence is a nonnegative safe integer. Older/duplicate
temporary updates are ignored, not applied in reverse order. Cursor coordinates
are normalized to the immutable oriented source image.

Targets:

```ts
{kind:'document'}
{kind:'parameter',id:'adjustments.exposure'} // an actual registered path
{kind:'curve',id:'rgb'|'red'|'green'|'blue'}
{kind:'region',collection:'regions'|'regionEdits',id:string}
{kind:'region-group'|'image-layer'|'paint-layer',id:string}
```

Operations:

```ts
{type:'set-parameter',path:string,value:number}
{type:'set-curve',channel:'rgb'|'red'|'green'|'blue',points:[number,number][]}
{type:'replace-node',collection:'regions'|'regionEdits'|'regionGroups'|'imageLayers'|'paintLayers',id:string,value:object}
{type:'replace-recipe',recipe:EditorRecipe}
```

The transport schema and all currently supported recipe versions accept2–16
tuple points per curve. The full recipe parser also validates ordering and
shape. Node replacement cannot change
its ID or add arbitrary nodes. Structural
changes, geometry, warp and V4 projective/healing/retouch require a document lease
and current base. Every candidate uses the full parser and checks all image-layer
source IDs, even disabled layers.

`CollaborationPollResponse={protocolVersion:1,cursor,resetRequired,hasMore,events,snapshot}`.
`snapshot={artwork,revision,asset,presences,leases,previews,limits,serverTime}`.
If knownVersion matches the head and no reset is needed, revision is null; this
does not mean the artwork is empty. The snapshot is the latest authoritative head
even while event pages are being consumed. Events notify changes; do not replay
older event payloads over that newer snapshot. Types are `presence.changed`,
`lease.changed`, `preview.changed`, `revision.committed`. The latest1000 transport
events per artwork are retained; stale/ahead cursors force a full snapshot with
resetRequired. Durable revisions and command receipts are not pruned with events.

Same-process changes wake polls; other process/API/worker writes are checked at
350ms intervals. PostgreSQL NOTIFY is emitted but no dedicated LISTEN consumer is
required. Every bounded iteration rechecks login, account and membership. No
transaction stays open while waiting. Limits within one API instance:8 concurrent
polls per actor and128 total. 429 `COLLABORATION_POLL_LIMIT` includes
retryAfterMs1000; back off. These counters are not distributed across API instances.

Sessions last60s, leases30s; recommend10s heartbeats/renewals. Per artwork there are
at most24 sessions, and at most4 sessions for each actor in that artwork. Each
session has at most8 leases. Presence minimum interval250ms; preview300ms,128KiB
per operation and512KiB total per artwork. These temporary states create neither
revisions nor AI credit charges. Expired room state is cleaned on room access,
not by a global continuous room sweeper.

Same target, overlapping conservative source-space support bounds or a document
lease return409 `LEASE_CONFLICT` with blocking lease DTOs. Inverse/global masks
protect the full image. Bounds are rechecked on preview/commit, so mask growth
cannot invade another lease. Conservative bounds can reject some complex shapes
which are actually disjoint; this is not a pixel-exact conflict solver.

Expired proof returns409 `SESSION_EXPIRED`/`LEASE_EXPIRED`; wrong target returns
`LEASE_SCOPE_MISMATCH`. A stale baseVersion can rebase only when the affected target
and the source/schema/geometry basis have not changed. Otherwise return409
`VERSION_CONFLICT`. Never silently take a new lease and replace the full recipe.

Commands append immutable revisions and receipts. Same actor/key/body replays
without a second revision even after lease release, while current access is still
required. Changed content under a reused key conflicts. Existing save/title/restore,
AI replace/layer/apply-plan and direct revision writes are protected by DB guards.
Missing proof while a lease exists returns409 `COLLABORATION_LOCKED`; expired
transaction proof returns `COLLABORATION_LEASE_EXPIRED`. Trusted server code sets
the proof inside its transaction. This is targeted replay with leases, not CRDT.

## 2. Authorized resource search and private memory

- `GET /v1/resources`: `scope=all|personal|team`, `spaceId?`, `projectId?`, `query?` up to120 characters, `remembered=true|false?`, `source=upload|generated|sketch|unknown?`, `createdFrom?`, `createdTo?`, `limit=1..100` default50, `cursor?`.
- Response `{resources:[{asset,space:{id,name,kind},project:{id,title},memory}],nextCursor}`. Rows require current membership or an unexpired grant permitted by current sharing policy. Operator status adds no private rows. Cursor binds actor/filters; changed filters return400 `CURSOR_SCOPE_MISMATCH`.
- `GET /v1/assets/:id/memory` -> `{memory:null|{remembered,title,tags,note,version,updatedAt}}`; current asset read access.
- `PUT /v1/assets/:id/memory` `{expectedVersion,remembered,title:null|string,tags:string[],note:string}` -> `{memory}`. Version0 creates a record; later changes use CAS. Title≤200, ≤30 unique tags of≤40characters each, note≤2000. Unknown fields rejected.
- `DELETE /v1/assets/:id/memory` `{expectedVersion:positive integer}` -> `{ok:true}`. Own memory can be erased after source access was revoked. This never deletes the asset or another user's record; already-absent is successful.

Memory is per-user metadata, separate from shared asset annotations. Audit logs
carry IDs/version/remembered, not private text. Memory is not implicitly copied
to teams or sent to AI. Assistant use needs explicit personal-memory authorization
and an authorized resource scope. A long-term mark is not a permanent-storage SLA.

## 3. Membership activity and owner transfer

- `GET /v1/spaces/:id/activity?limit=1..100&cursor?` -> `{activities,nextCursor}`. Current members only. Activity fields: decimal-string id, kind, actorId/actorName, targetUserId/targetName, previousRole, role, createdAt. Kinds: joined, role-changed, removed, owner-transferred.
- `POST /v1/spaces/:id/transfer-owner` `{targetUserId,expectedOwnerId}` -> `{ok:true,ownerId}`. Current owner, team space and existing active target member required. Stale owner409. Old owner becomesadmin and new owner becomesowner in one transaction; personal spaces are excluded.

Migration8 backfills current memberships as facts, not fabricated historical exits.
Existing joins/removals/role changes record activity. A real role change or removal
clears that actor's realtime sessions, leases and previews in the same transaction;
departure unassigns tasks. Team-owned assets, documents and revisions remain with
the team. Last owner cannot be directly removed. Subsequent/pending reads recheck
membership; private downloads keep normal asset ACL.

## 4. Credit history and time aggregates

- `GET /v1/usage?scope=personal` (default) queries the current user's personal wallet; due monthly rights are issued idempotently.
- `GET /v1/usage?scope=space&spaceId=UUID` requires current membership. Normal callers cannot pass actorId or read a foreign personal wallet.
- `GET /v1/ops/usage?spaceId?&actorId?` is operator-only and may aggregate all spaces. It returns billing/model metadata, not prompts/output/images.
- Shared filters: from/to ISO, bucket day|month, limit1..500 default100, cursor, format json|csv. Default last30days; positive span≤732days.

JSON: `{unit:'credit',timezone:'Asia/Shanghai',scope,range,totals,unknownAmountEntries,series,entries,nextCursor,balance}`.
Totals/series contain issued,held,consumed,released,expired,adjusted. Entries contain
string id, kind, nullable units, movement counters, spaceId,actorId,lotId,holdId,
jobId,modelId,operation,sourceKind,createdAt,reason,amountKnown,movementComplete.
The execution ID may identify ai_jobs, assistant_turns or voice_sessions; operation
identifies the family, so do not route every ID to the image-job endpoint.

Held is reservation movement, not currently frozen balance. Releasing an expired
lot records both release and expiry. New expiry/release entries record the exact
movement; unrecoverable old expiry amounts stay explicitly incomplete/unknown.
`balance={available,held,consumed,expired,revoked}` is the current complete wallet
view, independent of interval/actor filters. These are service points, not cash.

The keyset cursor binds filters, resolved time interval and observed high ledger
ID. It is not a retained cross-request database snapshot. CSV is one bounded page
with UTF-8 BOM and formula-safe cells; X-Next-Cursor identifies the next page.
Existing monthly grants, entitlements and operator adjustment routes remain the
same quota system, not a second independent ledger.

## 5. Retained media and logical storage

Migration10 adds reservedMediaBytes to storage responses. Input reservations and
retained objects share the ordinary space capacity gate. Every independently owned
asset link charges original/master/tile bytes. Identical proxy bytes do not convey
original ownership; only explicitly authorized asset/project copy commands create
additional media links, with explicit source asset IDs and audited provenance.

- `GET /v1/media-capabilities`: enabled/effective available, decoder details, per-format pixel/byte budgets and maxChunkBytes. Runtime readiness does not prove every file is decodable.
- `POST /v1/projects/:id/media-imports` `{name,size,idempotencyKey,generateTiles?:boolean}` ->201 `{job}`. Current editor; size1..512MiB, name has no paths/control characters. Reserves input bytes. One active import per actor, at most4 database-wide. Same key/body returns existing job; changed body409.
- `PUT /v1/media-imports/:id/chunk?offset=N`, application/octet-stream,1..4MiB -> `{uploadedBytes,chunkSha256}`. Task actor and current project editor only. Contiguous append or exact-byte retry wholly inside confirmed bytes; overlaps/mismatch409. No caller path/URL.
- `POST /v1/media-imports/:id/complete` ->202 `{job}`. Fully uploaded input required; repeated complete never launches another decoder.
- `GET /v1/media-imports/:id` -> `{job,asset:null|Asset}`; states uploading|processing|ready|failed|cancelled.
- `POST /v1/media-imports/:id/cancel` -> `{ok:true,cleanupPending:boolean}`; unfinished work only. Ready409 never deletes published originals. When processing may still be owned by another worker, cancellation remains durable but the reservation and work directory stay until that worker stops or stale recovery confirms ownership loss. Repeated cancellation does not extend its lease or free its capacity early.
- `GET /v1/assets/:id/media` -> `{descriptor,downloads,editor}`; asset ACL is separate from task ownership.
- `GET /v1/assets/:id/media/original`, `/master`, `/tiles.dzi`, `/tiles_files/:level/:tile`: private original/master/tiles under current asset ACL. DZI uses the actual encoded extension.
- `POST /v1/assets/:id/media/export` `{format:'png16'|'tiff16'|'jpeg'|'webp',quality?:1..100}` converts the retained master to a private temporary response, with `X-Editor-Recipe-Included:false`.

Publication atomically replaces the input reservation with actual object/proxy
bytes. Capacity failure rolls back the asset and links. No prior content is
overwritten. Soft deletion does not release originals; no public media GC exists.
RGBA8 proxy editing and retained master conversion are distinct: exporting a
master does not apply the browser recipe at high bit depth or full resolution.
Format/native-runtime budgets are documented in packages/media. Current review
and actual HTTP checks are in docs/verification/v4-backend-review.md.

## 6. Contextual assistant and continuous voice

These routes use `assistant_model_configs`, independently of the earlier image,
text and short-recording job configuration. Reusing an upstream model identifier
does not overwrite another capability's budget. Readiness requires explicit server
switches, API credentials and configured text/image moderators; it is not proof
that an external account or network route has passed a live paid test.

### 6.1 Scope, context and ordinary turns

- `GET /v1/assistant/models` requires login and returns `{ready,voiceReady,reason,models,voiceProfiles,verifiedAt,sources}`. Public entries contain model labels, allowed operations, service-unit cost and application budgets, never credentials. Voice profiles describe the protocol adapter; use the model-specific voice list supported by the request validator.
- `POST /v1/projects/:projectId/assistant-turns` accepts `{idempotencyKey:UUID,modelId,prompt,context?,scope?,parentTurnId?}`. Prompt is 1..4000 characters. Returns202 while running, otherwise200, with `{id,state,modelId,output,errorCode,createdAt}`. A current verified owner/admin/editor is required; reference-only grants and platform-operator status do not grant assistant execution rights.
- `GET /v1/assistant-turns/:turnId` returns that DTO while the actor retains project edit and referenced resource access. It includes `stopRequested`. Turn states are running, completed, failed, unknown and stopped.
- `POST /v1/assistant-turns/:turnId/stop` accepts an empty object and idempotently records the owner's stop. It returns `{id,state,stopRequested}`. An in-flight dispatch stays running while the server reads the receipt. Verified receipts settle, an unsent hold releases, and ambiguous outcomes remain unknown. The stop blocks new tool actions and candidate publication.
- `GET /v1/projects/:projectId/assistant-turns?conversationId=UUID` returns `{turns}`: the actor's most recent30 turns within that stable root, including prompt/output and current candidate decisions. Without a conversation filter it returns recent project history. This is a bounded view, not a fully paginated archive.
- `GET /v1/projects/:projectId/assistant-conversations` returns the actor's most recent100 conversation roots. `conversationId` is assigned by the server; a child inherits its authorized parent's root.
- `GET /v1/assistant-turns/:turnId/events?after=N` streams persisted sequence events. `Last-Event-ID` also resumes the cursor. This endpoint is read-only: reconnecting never resubmits or charges. Connections rotate after25seconds with actor/process concurrency limits and current access checks.
- `GET /v1/assistant-turns/:turnId/context` exposes the actor-authorized context manifest, including original/retained token estimates and archived turn sources.

`context={artworkId,assetId,expectedVersion,recipe,imageDataUrl?}` binds an immutable
base asset, current saved head and the user's current local recipe. All image-layer
source references are checked. The optional image is an explicitly shared single
JPEG/PNG/WebP snapshot, bounded to1.5million base64 characters,1.1MB decoded and
4,194,304 input pixels; it is normalized to a≤1024px JPEG and reviewed before
sharing. The server retains the recipe and image hash, not that base64 snapshot.
This is user-triggered snapshot sharing, not continuous screen capture.

`scope={spaceIds:UUID[],referenceAssetIds:UUID[],allowWebSearch,publicSearch?,usePersonalMemory,creativeBrief?,executionGrantId?}`
defaults to empty resource lists and false flags. There are at most12 spaces and8
explicit image references, without duplicates. Each space requires current
membership, and each reference must remain readable inside that chosen scope.
Search results are metadata; only explicitly selected references become image
input when the configured backend model supports it. `publicSearch={query,kind}`
requires explicit authorization and a matching backend capability. The query is
1–240 characters and kind is `text` or `images`. Only the explicit query goes
to the public tool. Validated search results are recorded as `search.results`
events and returned in `output.search`.

`POST /v1/projects/:projectId/assistant-resources/search` accepts
`{spaceIds,query,limit?}` for scoped cloud lookup. It returns metadata and
asset IDs for the existing protected thumbnail route. It uses no model or units.
With `usePersonalMemory=true`, recall keeps confirmed constraints and corrections
verbatim, plus up to six relevant preferences or workflows and four resource
notes. The manifest records IDs and versions. Parent traversal retains up to256
authorized turns. Compacted assistant prose keeps candidate decisions and
original source pointers. Text, visual, tool and output reservations are checked
before dispatch. Resource access and the frozen memory versions are rechecked
before dispatch and publication.

One ordinary turn runs at a time per actor. The API admission limit is30 per hour.
The agent can make at most4 bounded Responses requests and prepares proposals
through a tool allowlist. The configured unitCost is a fixed service-unit charge
for that admitted turn, not a claim about the provider's token invoice. Same
actor/key/body replays the existing turn and does not dispatch or charge again;
changed content under that key returns409. Interrupted work with an unresolved
dispatch remains unknown. Completed dispatch receipts remain available for
settlement even if publication was stopped.

### 6.2 Suggestions remain candidates

`POST /v1/assistant-candidates/:candidateId/decision` accepts
`{decision:'previewed'|'rejected',recipe?,expectedVersion?}` and returns
`{ok:true,decision,payload,applied:false}`. It is actor-private, current-project
authorized, and only valid before the candidate expires after7days. An edit
preview requires the exact recorded local base-recipe hash and saved base version;
stale input returns409 `CANDIDATE_STALE`. A rejected candidate cannot be restored
to previewed through this endpoint.

Previewed does not mean saved. Explicit adoption uses the normal versioned editor
command/save chain. `POST /v1/assistant-candidates/:candidateId/apply` executes a
candidate under a current automatic grant, locking access, source/version and
collaboration conflicts. Replay returns the original `appliedRevisionId`.
The source comes from the candidate's immutable base revision. A voice session's
opening context does not override a subsequently accepted artwork context.
For text turns, the server uses this same authority during completion, inside a
savepoint, then commits candidates, revision, step claim and completed result
together. A blocked local edit preserves the completed provider receipt and its
charge, leaves a reviewable candidate and consumes no rolled-back edit step.
Generation candidates contain a prompt and authorized references, not a generated
image. The user chooses an image model/parameters and confirms its separate price
through the existing AI job workflow. Candidates cannot execute arbitrary tools,
change ownership or bypass content review. Rejecting one does not refund work
already completed by a provider.

`inspect_candidate` requires explicit current-image sharing. A bounded Worker
decodes currently accessible source/layers and renders both recipes using the
actual editor. Ordinary parameter candidates use a <=512px proxy. New/changed
healing and retouch stages instead render both recipes at original resolution
using the tiled reference engine: source/output <=16MP, combined layers <=16MP,
compressed inputs <=32MiB, one native render per process, 30s timeout (ordinary
proxy: 15s; total Workers <=2). The editor's smaller spatial/work budgets also
apply. The model still receives a moderated JPEG reduced to <=512px, while native
measurements cover the complete rendered images. `fullResolutionChecked` and
`inspectedRecipeHash` must match a new spatial candidate before `/apply` can save
it; otherwise409 `NATIVE_PIXEL_CHECK_REQUIRED`. Unshared/failed inspections retain
reviewable proposals. Measurements are not aesthetic or high-bit-depth guarantees. At most three
inspections are allowed per turn. Selection in the same round as inspection is
rejected: the model must first receive the result. When an image was shared,
automatic saving requires an explicitly selected, observed candidate. Multiple
unselected alternatives, dirty local bases, active peer leases, stale versions,
expired grants or exhausted budgets remain reviewable instead of overwriting.

`propose_retouch` and `propose_healing` reference an existing source-space
selection in `regions/regionEdits/healing/retouch`; arbitrary model masks or
preview coordinates are not accepted. `operationId:null` adds an independent
operation; an existing manually owned ID updates absolute settings, retaining
its protection, algorithm (retouch) and donor (healing). Portrait-owned operations
cannot be overwritten. Additional protection is combined by union. Both tools
also work inside `propose_sequence`. Sequence order constructs recipe state; it
does not reorder the engine's fixed pixel stages. These are actual deterministic
editor filters, not neural portrait or large-object reconstruction claims.

### 6.2.1 Execution grants and confirmed memory

- `POST /v1/projects/:projectId/assistant-grants`: `{mode:'suggest'|'confirm'|'auto',unitLimit,stepLimit,minutes,allowedActions,modelIds}`. Actions are assistant-turn, realtime-voice, edit and generate-image. Authority is actor/project/model/action scoped, atomically claimed and never inferred from model text.
- `GET /v1/assistant-grants/:grantId` returns current usage and expiry; `DELETE` revokes future actions. Default product mode is preview-confirm. Browser closure does not prevent a text auto run from finishing; voice auto application still depends on the active browser coordinator.
- `GET /v1/projects/:projectId/assistant-memory?artworkId=UUID&includeExpired=true&page=0` returns pages of100 visible memories and `hasMore`. Runtime recall checks a bounded set of100 active entries. More than100 active constraints and corrections stops the run.
- `POST /v1/projects/:projectId/assistant-memory` explicitly confirms `{scope,category,title,content,artworkId?,sourceTurnId?,expiresAt}`. Scopes are user/team/project/artwork; team writes require owner/admin. Source turns belong to the current actor/project.
- `PUT` and `DELETE /v1/projects/:projectId/assistant-memory/:memoryId` require `expectedVersion`; updates also include title/content/category/expiry. Deletion removes recall but retains the auditable version history.
- `GET .../:memoryId/history?beforeVersion=N` returns up to100 versions. Memory suggestions are drafts with exact quoted user evidence; saving always requires a user action.

Creative direction includes feeling, use, intensity, preservation/avoidance and
reference role. Generated workspace cards use the shared strict whitelist and
existing candidate/reference IDs; they cannot run arbitrary HTML or commands.

### 6.3 Voice preparation and application WebSocket

`POST /v1/projects/:projectId/voice-sessions` accepts
`{idempotencyKey:UUID,modelId,backendModelId,voice,context?,scope?}` and returns
`{id,ticket,websocketPath,maxSeconds,reservedUnits,billing}`. It reserves one
configured, time-limited voice service-unit block. Backend delegations share that
declared block; provider token/second receipts are separate metadata. Limits are
one prepared/connecting/active voice session per actor and12 preparations per
hour. Same-key preparation returns409 `VOICE_ALREADY_PREPARED`, without another
hold or automatic reconnect. A lost ticket is not reissued; unconnected preparation
expires after60seconds and is safely released during maintenance.

Connect to the returned same-origin path `/v1/voice-sessions/:id/stream` with the
normal session cookie and exactly two subprotocols: `xiutu-voice` and the opaque
ticket. The server selects only xiutu-voice. Do not put the ticket in the URL or
logs. Origin, active login, ownership, unexpired single-use ticket, selected model
availability and current project/resource scope are checked before upstream
connection. At most32 active/upgrading connections are admitted per API instance.

The client sends only these application events, not arbitrary provider events:

| Type      | Fields and meaning                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| audio     | `pcm`: canonical base64 PCM16 mono24kHz, maximum9600 decoded bytes per chunk; rate budget144000 bytes per2seconds |
| text      | `text`:1..4000 characters; reviewed before sending, with control/in-flight-response backpressure                  |
| search    | `search:{query,kind}` submits an explicit public query during a call. One public lookup per call, with prior web permission and matching model capability. |
| context   | `context`: a fresh explicit editor snapshot, no more often than once per2.5seconds. Optional `contextTag` is echoed in the acceptance event. |
| context.invalidate | Invalidate the previous snapshot and advance the context generation. A pending or published old candidate cannot be applied to the changed canvas. |
| mute      | `muted:boolean`; muted audio is not forwarded                                                                     |
| interrupt | optional `itemId,playedMs`; only the actual current output item may be truncated, bounded by delivered audio      |
| playback-cut | `itemId,playedMs` acknowledges the currently interrupted Realtime output item after speech starts. It truncates at the heard position without cancelling a newer response. |
| end       | explicit end; no automatic redial or retry                                                                        |
| ping      | renew browser heartbeat; missing heartbeat beyond35seconds closes the session                                     |

Server events are ready, audio, transcript, interrupted, context, search-started, tool,
assistant-result, closed, error and pong. Shared discriminated unions are in
`packages/contracts/src/assistant.ts`. Tool proposals use the same candidate
format and confirmation boundary as ordinary turns. Presence of an audio delta
does not prove it has been played; playback timing comes from the client and is
bounded by actual output bytes.

GPT-Live and Realtime use separate vendor protocols. Live delegates image/editor
work to the backend; it is not sent image messages through an unsupported voice
protocol. Realtime may receive an explicitly shared preview when supported. Raw
microphone audio is forwarded continuously and is not stored as a recording in
these tables. Do not equate this with zero provider-side processing/retention;
provider policies and enabled account capabilities require separate verification.

Browser responses have a1MB backpressure threshold; provider input/output and
messages are bounded. One application WebSocket message is at most1.6MB: an image
snapshot and its recipe share that combined budget, rather than each receiving a
separate allowance. Text responses have a single in-flight request and a finite
response/delegation budget. Membership, login and model availability are rechecked
on a5second interval and before contextual backend work. Thus revocation is
bounded polling. A search sends the literal user-approved query in a separate
Responses request. A recognized spoken request beginning with `公开搜索` can
supply that query when the caller enabled public search. Private context stays
in the editor delegation. Search evidence is returned as source cards.

### 6.3.1 Team voice on a shared artwork

| Route | Contract |
| --- | --- |
| `POST /v1/artworks/:artworkId/team-voice/join` | Active team members get a 30-second single-use ticket bound to the login and artwork. |
| `GET /v1/artworks/:artworkId/team-voice/stream` (upgrade) | Same-origin WebSocket with cookie and subprotocols `xiutu-team-voice` and the ticket. |
| `POST /v1/artworks/:artworkId/team-voice/agent` | A connected editor, admin or owner confirms one AI session. Body includes `confirmed:true,idempotencyKey,modelId,backendModelId,voice,context?`. Optional shared preview is moderated and bound to current artwork and version. |
| `PUT /v1/artworks/:artworkId/team-voice/agent/context` | Host synchronizes the current version. An empty body uses saved parameters. Output and microphone forwarding to the AI pause until the new context is accepted. |
| `DELETE /v1/artworks/:artworkId/team-voice/agent` | Host, admin or owner can end the AI connection. Human conversation continues. |

Mic input is binary little-endian 24 kHz mono PCM16. Output adds a little-endian
uint16 speaker slot before the PCM. Slot 0 is AI. The client plays each human
source independently and omits its own relay. Control JSON uses `mute`, `ping`,
and `ai-listen:{invitationId,enabled}`. Roster acknowledgment identifies which
members have granted the current invitation access to their open microphones.
Consent starts off for every invitation. The AI receives a 20 ms frame stream
mixed from the current authorized tracks, with at most 160 ms queued per speaker.
Mute, withdrawal, loss of membership and context changes discard pending audio.
The application stores no room audio files. Human-only caption recognition uses
the listener's on-device browser support. Provider captions and collaboration
results are delivered separately when AI participates.

Rooms are process-local with a six-person limit. One member may join one room
at a time, and one API instance admits up to 72 participants. Human-only calls
have no provider hold. A team AI invitation shares the existing voice time,
delegation and team-wallet rules. Team audio and its delegated tools are scoped
to the artwork and team resources. Personal memory and public web lookup are
outside the team voice scope. Revocation checks run once per second with a
2.5-second maximum age for the last authorization. Reaching the backend
delegation limit declines further tool work while the voice channel continues
within its duration and response limits.

### 6.4 Operations, settlement and recovery

- `GET /v1/ops/assistant-models` returns configurations with their current content hash, protocol profiles and server readiness.
- `PUT /v1/ops/assistant-models/:modelId` accepts `{config,expectedHash:null|string}`. The first write requiresnull; updates compare the prior hash. Concurrent edits return409 `MODEL_CONFIG_CHANGED`. Only assistant-turn/realtime-voice operations and supported voice profiles are accepted. Costs and application limits come from this server configuration.
- `GET /v1/ops/assistant-reconciliation?kind=turn|voice&recordId=UUID&actorId=UUID&limit=50&cursor=...` paginates unknown records by stable creation time/id. Limit1..100; without a kind both groups are returned with `nextCursors`. Cursors bind actor/filter/kind. Execution/account/model/error metadata excludes private prompts/output.
- `GET /v1/ops/ai-jobs/unknown?jobId=UUID&actorId=UUID&operation=...&limit=50&cursor=...` provides the corresponding paginated image/job queue, including resolver readiness. Neither queue's first page is an upper bound on all unresolved work.
- `POST /v1/ops/assistant-reconciliation/:kind/:recordId`, kind turn|voice, accepts `{resolution:'release'|'settle',reason,evidenceRef}`. It requires an operator, a currently unknown record, a10..1000character reason and3..200character evidence reference. The action locks the record, adjusts its hold once and audits the decision. A repeated action against an already resolved record returns409; callers must reread and must not treat a conflict as permission to charge again.

The strict assistant-model configuration contains these fields. Budgets here are
application limits, not assertions about the maximum capability of every upstream
model; operators must choose a model with the corresponding actual protocol.

| Field           | Accepted setting                     | Actual use                                                                                           |
| --------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| enabled         | boolean                              | Admission and subsequent dispatch/voice checks                                                       |
| label           | optional string≤120                  | User-facing model name                                                                               |
| provider        | openai                               | Current adapter family                                                                               |
| operations      | assistant-turn and/or realtime-voice | Explicit capability selection; unsupported voice profile IDs are rejected                            |
| unitCost        | integer1..100000                     | One turn or one time-limited voice block, reserved server-side                                       |
| maxSeconds      | integer30..600, default180           | Voice duration ceiling                                                                               |
| maxDelegations  | integer1..20, default6               | Voice backend delegation budget; Realtime response budget is four times this amount                  |
| maxOutputTokens | integer256..8192, default2048        | Backend Responses bound; Realtime adapter also clamps to4096; not sent as an invented GPT-Live field |
| imageInput      | boolean, defaultfalse                | Whether the backend Responses model is offered explicitly shared images                              |
| webSearch       | boolean, defaultfalse                | Backend web tool, enabled only when the user also authorizes web search                              |
| webImageSearch  | optional boolean                     | Public image search capability, usable with webSearch and a user-supplied image query                |
| reasoningEffort | optional none/low/medium/high        | Responses setting; configure only for a model that accepts it                                        |

These switches do not authorize private resource access and do not override the
fixed protocol abilities in a voice profile. No browser-supplied provider URL,
API credential or price is accepted. Frozen admitted configuration and dispatch
hashes make later operator changes distinguishable from an existing paid task.

DB派发标记、独立fsync日志和发送前的第二次权限/状态校验共同防止恢复后重发。
有可能已经发送的请求，不能因为关闭网页、停用模型或没有收到最终回应就退款。
长期无心跳的普通运行任务或语音连接保留为unknown，等待依据真实收据核验。
服务优雅关闭等待已派发委派的有限收尾，再结束数据库连接。

写前日志与数据库不匹配时，新付费请求全局返回503
`ASSISTANT_RECOVERY_REQUIRED`。这是恢复阻断，不是普通unknown结果的自动处理：
部署者必须先按原始日志/数据库备份核对丢失标记，不能删除日志、伪造收据或直接重试。
文件日志不包含私密内容，也不在本接口中开放修改或清除。服务点结算、传输关闭、
供应商响应收据及供应商最终账单是不同事实；界面与运营报告应分别呈现。
