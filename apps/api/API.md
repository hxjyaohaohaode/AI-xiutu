# API contract (implemented baseline)

Base URL: `/v1`; same-origin browser requests use `credentials: 'include'`.
Every mutation requires an exact configured `Origin`. The server uses opaque,
HttpOnly session cookies; it never returns SMS codes, passwords or provider keys.
Errors are `{ "error": { "code": "...", "message": "...", "details": {} } }`.
Dates are ISO-8601; business-object IDs are UUIDs, while `modelId` is an exact provider-model string; numeric points are integers.

## Public and authentication

- `GET /health` -> `{ok:true}` (database checked).
- `GET /v1/modules` -> `{protocolVersion:1,modules}` from the shared `@ai-xiutu/contracts` registry. Modules declare dependencies, input/output resource types, execution/permission/confirmation/persistence requirements, limitations and separate implementation/runtime states. Discovery grants no access to private objects and is not proof of vendor account access. Client model assets remain a client-side runtime gate.
- `GET /v1/editor-contract` -> `{protocolVersion:1,recipeVersions,preferredRecipeVersion:3,coordinates:'source-normalized',colorEncoding:'rgba8-srgb',parameters,limits,notes}`. Numeric descriptors derive directly from the executable editor registries: path, range, step, neutral, integer constraint, supported schema versions, scopes with `scopeMinimumVersion`, and `aiWritable`. The step is an interaction increment; it is not an instruction to quantize all stored floating-point values. v3-only geometry remains outside the AI numeric whitelist.
- `GET /v1/public-config` -> `{brand:{name,tagline,logoAssetId,logoUrl},capabilities:{smsConfigured,providerConfigured,moderationConfigured,aiConfigured,aiUnavailableReason,paymentConfigured:false,imageGenerationConfigured,availableOperations,operationStatus,providerModelCatalog},quota:{period:'month',freeUnits,policyVersion},limits:{maxUploadBytes,maxPixels},media:{serverImport,canonical:'png',maxPixels,maxDimension,maxUploadBytes,maxCanonicalBytes},registrationMode:'open'|'invite'}`. `serverImport` is filtered by the actual installed codecs; it is not a list of formats every browser can decode locally. Capability flags describe configured adapters, not proof of vendor account approval or a completed production acceptance test.
- `GET /v1/public-logo` -> the image explicitly published by the brand configuration. This does not expose arbitrary private asset IDs. `logoUrl` is null until a logo is selected.
- `GET /v1/session` -> `{user:null|{id,displayName,phoneMasked,isOperator,status},spaces:[{id,name,kind,role}]}`.
- `POST /v1/auth/otp` `{phone,purpose:'register'|'reset'|'login'}` -> 202 `{ok:true,message,expiresIn:600}`. Sends to any valid number within durable limits; account eligibility is checked only after proof of the code, avoiding an account-existence delivery oracle. No SMS configuration -> 503 `SMS_NOT_CONFIGURED`. Ambiguous sending -> 503 `SMS_SEND_UNKNOWN`; an actually received code remains usable, without automatic resend.
- `POST /v1/auth/register` `{phone,code,password,displayName,inviteCode?}` -> 201 session response.
- `POST /v1/auth/login` `{phone,password}` -> session response.
- `POST /v1/auth/login-otp` `{phone,code}` -> session response.
- `POST /v1/auth/reset` `{phone,code,newPassword}` -> `{ok:true}`; invalidates all existing sessions.
- `POST /v1/auth/logout` -> `{ok:true}`.
- Phone may be a Chinese 11-digit mobile number or E.164. Password: 10–128 characters. SMS requires Tencent credentials/template configuration. The server has no fixed administrator account or bypass code.

## Spaces, membership and projects

`Space={id,name,kind:'personal'|'team',role:'owner'|'admin'|'editor'|'reviewer'|'viewer'}`.
`Project={id,spaceId,title,description,version,createdAt,updatedAt,role}`.

- `GET /v1/spaces` -> `{spaces}`.
- `POST /v1/spaces` `{name}` -> 201 `{space}`; creates a team with the caller as owner, without another free monthly grant.
- `GET /v1/spaces/:id/members` -> `{members:[{userId,displayName,phoneMasked,role}]}`.
- `POST /v1/spaces/:id/invitations` `{role:'admin'|'editor'|'reviewer'|'viewer',expiresInDays?:1..30,maxUses?:1..20}` -> 201 `{invitation:{id,code,role,expiresAt,maxUses}}`. The plaintext code is returned once.
- `POST /v1/invitations/accept` `{code}` -> `{space}`.
- `DELETE /v1/spaces/:id/invitations/:invitationId` -> `{ok:true}`.
- `PATCH /v1/spaces/:id/members/:userId` `{role}`; `DELETE` same route -> `{ok:true}`. Owner cannot be silently removed/demoted. Admins cannot elevate or modify owner/admin peers. A non-owner can remove their own membership. Removal revokes invitations that member created and project grants to that member in the space.
- `GET /v1/projects?spaceId=UUID` -> `{projects}`. Omit `spaceId` for all member projects and current reference shares.
- `POST /v1/projects` `{spaceId,title,description?}` -> 201 `{project}`.
- `GET /v1/projects/:id` -> `{project,assets,artworks}`.
- `PATCH /v1/projects/:id` `{expectedVersion,title?,description?}` -> `{project}`; stale version -> 409 `VERSION_CONFLICT`.
- `DELETE /v1/projects/:id` -> `{ok:true}`; owner/admin only; tombstone blocks all access.

## Assets and immutable artwork revisions

`Asset={id,projectId,name,mime,width,height,bytes,url,thumbnailUrl,provenance,source,createdAt,annotations,annotationVersion,annotationUpdatedAt}`. AI-generated provenance includes `kind:'ai-generated',jobId,modelId,inputHash`. `source` is `upload|generated|sketch|unknown`, derived from recorded provenance rather than a filename. `annotations={title:null|string,tags:string[],capturedAt:null|ISO8601,location:null|{label:string}}` contains user declarations; it is separate from immutable image bytes and technical metadata. `createdAt` is ingestion time; `capturedAt` must explicitly include `Z` or a numeric timezone offset and is never guessed from ingestion time. No EXIF location is extracted or silently included in export.
`Artwork={id,projectId,assetId,title,headVersion,headRevisionId,createdAt,updatedAt}`.
`Revision={id,artworkId,assetId,version,parentId,recipe,label,authorId,createdAt}`. `assetId` is that immutable revision's source, not necessarily the current artwork source. Source snapshots and image-layer references are recorded separately and cannot be rewritten.

- `GET /v1/projects/:id/assets` or `GET /v1/assets?spaceId=UUID` -> `{assets,nextCursor}`. Optional `query` searches the recorded filename, declared title and tags literally and case-insensitively; `source`, `createdFrom` (inclusive), `createdTo` (exclusive), `limit` (1–100, default50) and `cursor` support filtered pagination. Space-wide listing requires actual space membership; project listing also permits a current sharing grant. Cursors preserve microsecond timestamp ordering and are bound to the actor/scope/filters. Changing filters requires a fresh first page; every page rechecks current ACL, including revocation and deletion. This is scoped search, not a global public index.
- `PATCH /v1/assets/:id/annotations` `{expectedVersion,title?,tags?,capturedAt?,location?}` -> `{asset}`. Requires project edit permission and matching `annotationVersion`; stale writes return 409. Title is nullable or1–200 characters, tags are up to20 distinct strings of1–40 characters, location is nullable or a user-entered `{label}` up to200 characters. Nullable fields use `null` to clear; tags use `[]`. Coordinate keys, unknown fields and control characters are rejected. Changes emit `asset.updated`; the operator-visible audit records changed field names/version, not private titles or location values. Image bytes, dimensions and storage hashes remain immutable.
- `POST /v1/projects/:id/assets?source=upload|sketch` multipart, single `file` -> 201 `{asset}`. The optional source defaults to `upload`; `sketch` is an explicit caller declaration. The caller cannot declare AI-generated provenance. Actual supported server codecs are static JPEG/PNG/WebP/AVIF/GIF and single-page TIFF. Bytes/signatures/pixels are checked; APNG, AVIF sequences, multiple frames/pages and unsupported containers are rejected explicitly. Orientation is applied, pixels converted to sRGB PNG and EXIF removed. The raw original, TIFF layers/HDR workflow and original file encoding are not retained. Canonical private files are immutable and only referenced after successful SQL commit. Publication and failure cleanup serialize on the same storage-key transaction lock. A lost COMMIT acknowledgement never authorizes file deletion: cleanup waits for the publishing transaction and queries all asset references; an unavailable check retains private candidates for later reference-aware cleanup. HEIC/RAW/PSD/SVG/BMP are not server import capabilities; a supported browser-local BMP conversion may upload its actual resulting PNG.
- `GET /v1/assets/:id/file` authenticated bytes, current project/share ACL checked on every request; no public local-storage directory.
- `GET /v1/assets/:id/thumbnail` authenticated WebP, longest side at most 512 pixels, preserving aspect ratio and without enlargement. Use `thumbnailUrl` for grids/covers and `url` for original-resolution editing. Every request, including a disk-cache hit, checks the current asset/project/share ACL; cold generation rechecks deletion/permission before delivery. Cached derivatives are private, immutable by source storage key, and published by atomic rename. Original decoding shares the process media slot; a bounded cold-cache queue returns 503 when busy, without substituting another image.
- `DELETE /v1/assets/:id` -> `{ok:true}`. Assets referenced by an artwork, any historical source snapshot, or any historical image layer cannot be removed (`ASSET_IN_USE`). A queued AI job alone does not block deletion of its input asset. AI input references are revalidated before dispatch and publication; deletion invalidates that reference instead of silently substituting another image.
- `POST /v1/assets/:id/copy` `{targetProjectId:UUID,idempotencyKey:UUID}` -> `{asset,copy,replayed,reused}`. First physical asset-record publication returns201; the same committed key or reuse of an existing active source-to-target copy returns200. Source read permission, current source `allowCopy`, source owner/admin status or a current `copy` grant, and target owner/admin/editor permission are required for a new request. The body cannot supply bytes, a storage key, provenance or an actor. Source bytes/dimensions/hash remain immutable; the destination gets its own asset record and annotation snapshot with `provenance.copiedFrom:{assetId,projectId,contentHash}`. Copies share retained canonical storage safely, not an external URL. `copy={id,sourceAssetId,sourceProjectId,targetProjectId,copiedAssetId,createdAt}`.
- `POST /v1/projects/:id/artworks` `{assetId,title,recipe}` -> 201 `{artwork,revision}`. Complete recipe validated by `@ai-xiutu/editor`; first headVersion is 1.
- `GET /v1/artworks/:id` -> `{artwork,asset,revision}`.
- `PATCH /v1/artworks/:id` `{expectedVersion,title}` -> `{artwork}`; advances revision through a new immutable entry.
- `POST /v1/artworks/:id/revisions` `{expectedVersion,recipe,label?}` -> 201 `{artwork,revision}`. CAS conflict includes `details:{currentVersion}`.
- `GET /v1/artworks/:id/revisions` -> `{revisions}` (latest 100).
- `GET /v1/artworks/:id/revisions/:revisionId` -> `{revision,asset}`. Historical preview must load this source and resolve this revision's layer assets; it must not apply an old recipe to the current artwork source.
- `POST /v1/artworks/:id/restore` `{revisionId,expectedVersion}` -> 201 `{artwork,revision,asset}`. Requires edit ACL and current CAS; appends a new revision containing the old source plus recipe, retaining all intervening history.

### Composition source references

Recipe v3 `imageLayers[].sourceId` must be a UUID identifying an existing,
non-deleted asset in the same project, including disabled layers. Save operations
reject `local:*`, URLs, another project's assets, or deleted IDs before publishing
a revision. The browser must upload extra local layers and replace their temporary
IDs before saving. Known cloud sources, including cloud layers whose local owner
cache is missing, must use the authorized copy endpoint when saved into another
project. A denied copy must never fall back to uploading the already downloaded
file. A cloud UUID may be reused directly only in its current owning project.
`revision_image_layers` records all immutable dependencies;
historical references prevent asset deletion. Project copies remap every image
layer to the destination project's copied assets under its independent ACL.

Asset-copy idempotency is scoped to actor plus UUID and binds the route source
and target project. A changed request under the same key returns409
`IDEMPOTENCY_CONFLICT`. Different keys for the same active source-to-target copy
return that copy without a second asset or storage charge. Source-policy caps
count distinct source assets per source-project/target-project pair, across keys
and actors; a soft-deleted copy still contributes to this distinct-source count.
An explicitly new key may recreate a deleted destination asset and consumes a
new retained asset record. A same-key retry whose original destination is deleted
returns409 `COPY_TARGET_UNAVAILABLE` and does not manufacture a replacement.

A non-owner copy grant binds to one target project on the first successful asset
copy and can copy additional source assets there within policy limits. It cannot
also be consumed as a full-project grant, nor target a second project; a new grant
is needed for that separate operation. Source revocation or `allowCopy:false`
denies **new** copy keys. A **previously committed same-key** replay only reads its
independent destination under current destination edit ACL; it remains available
after source revocation and never performs another copy or capacity reservation.
Losing destination edit access denies that replay. This is intentionally different
from the source permission required to create a new copy.

Local files have no trustworthy remote origin attached to their bytes. The browser
preserves tracked cloud provenance and enforces its copy route, but this system
does not claim it can identify an independently downloaded and re-imported file.

### AI result decisions and source-aware history

- `GET /v1/ai-jobs/:id/decisions` -> `{decisions}` (latest100), current project read ACL.
- `POST /v1/ai-jobs/:id/decisions` requires project edit ACL and an actually completed job. Shared fields are `{protocolVersion:1,idempotencyKey:UUID,action,reason?:1..500 chars}`. Body variants are strict; unsupported fields are rejected.

| action       | Additional fields                                                         | Result                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reject`     | `outputIndex?:0..9` for image results                                     | Immutable non-adoption record. Does not delete the output, change completed job state, or refund settled points.                                  |
| `fork`       | `outputIndex?:0..9,title?`                                                | New artwork from a generated image, or from a parameter proposal and its original source revision.                                                |
| `replace`    | `targetArtworkId,expectedVersion,outputIndex?:0..9` (default0)            | Generated image becomes the target's source with a new neutral v3 revision; prior sources and revisions remain readable.                          |
| `layer`      | `targetArtworkId,expectedVersion,outputIndex?:0..9` (default0)            | Keeps the target's source and edits, migrates to v3 and appends an independently editable candidate image layer, centered with contain placement. |
| `apply-plan` | `targetArtworkId,expectedVersion`                                         | Requires the exact artwork and baseVersion of the proposal; CAS protects against concurrent changes.                                              |
| `save-text`  | `title?,body?:0..100000 chars,targetDocumentId?,expectedDocumentVersion?` | New document, or CAS-protected append to the selected document. Target ID and expected version must be provided together.                         |

The response is `{decision,replayed,artwork?,revision?,asset?,document?}`.
`Decision={id,jobId,projectId,actorId,action,outputIndex:null|number,targetArtworkId:null|UUID,revisionId:null|UUID,documentId:null|UUID,documentVersion:null|number,reason:null|string,contentEdited:boolean,createdAt}`.
First execution returns201; an identical actor+idempotency-key request returns200
with the same saved result snapshot. Reusing a key for different content returns409.
Key comparison includes the job and complete normalized body. Authorization is
rechecked before replays; a formerly authorized client cannot retain access by
reusing an old key. Read-only reviewers and platform operators have no implicit
adoption right. No endpoint directly mutates quota balances.

Image candidates are selected from the completed job's actual output list and
cross-checked against asset provenance. Replacement clears old crop/mask/warp
settings rather than applying them to unrelated new pixels. A stale parameter
proposal can be explicitly forked from its old source, but cannot silently apply
to a newer head. The old `POST /artworks/:id/revisions` remains available for
ordinary manual edits; AI adoption uses the decision endpoint to retain lineage.

`layer` snapshots the candidate asset into `revision_image_layers`; removing the
layer in a later revision does not invalidate its history or permit source
deletion. It preserves existing adjustments and geometry, requires capacity for
another image layer, and checks the v3 base and combined layer pixel budgets.
The decision cannot inject a URL or asset ID. Subsequent user edits can change
the layer placement, blend mode, opacity and mask through ordinary v3 revisions.

If text was manually edited before saving, `contentEdited:true` records that
fact without overwriting the original `job.output`. The edited document is
user-authored content, not a claim that it is unchanged moderated model output.
Audit metadata contains identifiers and the edited flag, not private body text.

## Collaboration and documents

- `GET /v1/projects/:id/comments` -> `{comments:[{id,projectId,artworkId,revisionId,body,anchor,authorId,authorName,resolved,createdAt}]}`.
- `POST /v1/projects/:id/comments` `{body,artworkId?,revisionId?,anchor?:{x:number,y:number}}` -> 201 `{comment}`.
- `PATCH /v1/comments/:id` `{resolved:boolean}` -> `{comment}`; author/editor/admin/owner.
- `GET /v1/projects/:id/tasks` -> `{tasks:[{id,title,description,status:'todo'|'doing'|'done',assigneeId,version,createdAt,updatedAt}]}`.
- `POST /v1/projects/:id/tasks` `{title,description?,assigneeId?}` -> 201 `{task}`.
- `PATCH /v1/tasks/:id` `{expectedVersion,title?,description?,status?,assigneeId?}` -> `{task}`.
- `GET /v1/projects/:id/documents` -> `{documents:[{id,title,body,version,authorId,createdAt,updatedAt}]}`.
- `POST /v1/projects/:id/documents` `{title,body?}` -> 201 `{document}`.
- `PATCH /v1/documents/:id` `{expectedVersion,title?,body?}` -> `{document}`. Plain text, no raw HTML execution.
- `GET /v1/events?spaceId=UUID&after=0&waitMs=0` -> `{events:[{seq,type,projectId,entityId,createdAt}],nextCursor}`. Max 20s long-poll, bounded batch, rechecks current membership. Events are persistence notifications, not CRDT/automatic merge.

## Sharing

- `GET /v1/spaces/:id/sharing-policy` -> `{policy:{allowReference,allowCopy,maxActiveGrants,maxCopyAssets}}`.
- `PUT /v1/spaces/:id/sharing-policy` same policy -> `{policy}`; owner/admin.
- `GET /v1/projects/:id/grants` -> `{grants}`; owner/admin.
- `POST /v1/projects/:id/grants` `{targetPhone,mode:'reference'|'copy',expiresInDays?:1..30}` -> 201 `{grant}`; target must already be a registered user. Reference gives read/comment access; copy also permits a one-time explicit copy. Each mode checks its own policy flag independently; disabling reference does not disable an explicitly permitted copy grant.
- `DELETE /v1/projects/:id/grants/:grantId` -> `{ok:true}`; immediate revocation for future source access.
- `POST /v1/projects/:id/copy` `{title?,targetSpaceId?,idempotencyKey?}` -> 201 `{project}`. Destination defaults to the actor's personal space; an explicit team destination requires owner/admin/editor membership. A current source copy grant permits one completed copy; its replay returns the same project. Source owner/admin can copy their own project when `allowCopy` is true, with a required idempotency key of 8–128 characters. Changing destination/body under that key gives 409. The transaction copies assets, current artwork recipes and current documents from one database snapshot, up to the asset cap; comments/tasks/history are not copied. Assets retain immutable canonical bytes, recorded provenance and a snapshot of user annotations under independent destination ACL. Annotation versions start anew in the destination; later source metadata changes do not mutate completed copies. Revocation does not erase a copy already explicitly completed; UI must disclose this.

Full-project copying also records each asset's immediate `copiedFrom` provenance
and remaps every current image-layer source. Its source-grant mode cannot be mixed
with a previously started single-asset-copy grant. A target storage capacity
failure rolls back the complete project, all asset rows and capacity increments.

## Retained storage capacity

- `GET /v1/spaces/:id/storage` -> `{storage}`; current space membership required.
- `GET /v1/ops/spaces/:id/storage` -> `{storage}`; operator only, audited metadata access, without granting access to private assets.
- `PUT /v1/ops/spaces/:id/storage` `{expectedVersion,maxBytes,maxAssets,reason}` -> `{storage}`. Operator only, strict full policy update and CAS; stale policy versions return409. `maxBytes` is an integer0…10 TiB, `maxAssets` an integer0…1,000,000; `reason` follows the ordinary required audit-reason rule. Policy updates emit `storage.policy` and audit old/new limits, not image contents. These operator endpoints are implemented; a dedicated capacity-settings panel is not yet included in the web dashboard.

`StorageAccountSummary={spaceId,version,maxBytes,maxAssets,retainedBytes,reservedMediaBytes,retainedAssets,accounting:'retained-logical-assets',softDeleteReclaimsCapacity:false}`.
The initial policy is **1 GiB and1,000 retained asset records per space**, adjustable
through the operator API. Each asset row counts its canonical byte length, including
copies which may share a physical blob. Soft-deleted assets and deleted projects
remain counted; deletion is not a storage-capacity refund. Migration7 backfills
existing retained rows before installing the guard, including deleted records;
already over-limit data is preserved, active data remains readable under its
ordinary ACL, deleted rows remain tombstoned, and new records are blocked.
Lowering limits below existing use similarly does not delete or rewrite data.

A database insert trigger atomically updates one locked space-storage account.
Uploads, AI outputs, full-project copies and single-asset copies all use that same
guard. Exceeding either retained limit returns409 `SPACE_STORAGE_LIMIT`; rollback
also rolls back counters, and reused copies do not reserve again. Immutable asset
content fields prevent changes to byte counts, owner project or storage identity
after insertion. No physical garbage-collection or retention-reclamation job is
implemented; permanent deletion requires a separate reference-aware workflow.

Storage limits are separate from AI points and per-image decode/size budgets.
There is no estimate-based reservation of future generated image bytes before an
external AI dispatch. If storage fills before a billed candidate publishes, the
existing dispatch/unknown-result reconciliation rules still apply; a storage error
does not prove the provider did not charge and does not justify a new automatic call.

## Quota, AI and operations

- `GET /v1/me/entitlements?spaceId=UUID` -> `{spaceId,periodStart,periodEnd,available,held,freeAvailable,purchasedAvailable,lots,usage}`. Personal monthly grant is unique per subject+month, independent of policy version. Team creation does not multiply free quota.
- `GET /v1/me/usage?spaceId=UUID` -> `{entries}` (latest 100 immutable ledger entries).
- `GET /v1/models` -> `{models,executionEnabled,reason,availableOperations,operationStatus,providerModelCatalog}`. Each model exposes `id,label,provider,operations,enabled,minWidth,maxWidth,minHeight,maxHeight,maxOutputs,unitCost,allowedQualities,imageUnitCosts?,version,pointsPerPlan,runtimeAvailable,runtimeReason,runtimeOperations?,minPixels?,maxPixels?,maxDimension?,parameterCapabilities?,pricing?,batchLimits?`. Integer service points are not currency. Runtime availability requires the corresponding server switches and credentials. OpenAI, Ark and ASR additionally use exact server model allowlists; Qwen text models use the exact enabled operator-catalog ID, approved endpoint, credentials and execution switch, without a separate environment model allowlist. A catalog row alone cannot enable execution. `providerModelCatalog` lists audited OpenAI profiles with `{providerReady:boolean,accountVerified:false,catalogEnabledRequired:true}`, not accounts or enabled billable choices. Ark fixes one output; OpenAI uses the reported output-count, per-image and whole-batch limits. Normalized images must independently fit the moderation byte cap.
- `POST /v1/projects/:id/ai-jobs` -> 202 `{job}` after durable quota reservation. Every operation requires its enabled catalog model, corresponding server switches/credentials and configured moderation; absent readiness fails closed with 503. See the operation-specific bodies below.
- `GET /v1/projects/:id/ai-jobs` -> `{jobs}` from actual database, not generated demo history.
- `GET /v1/ops/overview` -> `{counts:{users,spaces,projects,assets,artworks,jobs},pointTotals,capabilities}`.
- `GET /v1/ops/users?query=` -> `{users:[{id,displayName,phoneMasked,status,isOperator,createdAt}]}`.
- `GET /v1/ops/users/:id/entitlements` -> `{user:{id,displayName,phoneMasked,status},spaces:[{id,kind,name,role,entitlements}]}`. Shows that user's personal space and teams they own, with existing quota aggregates/lots/usage; no project content. Pending users without spaces return `[]`. Active verified users receive their due monthly entitlement idempotently. Reading is audited. Use the returned space ID for adjustments, not a manually guessed UUID.
- `PATCH /v1/ops/users/:id` `{status:'active'|'banned',reason}` -> `{user}`; revokes sessions on ban; cannot ban self. Restoring an unverified banned user returns `status:'pending'`, requiring the ordinary SMS activation workflow; changing status cannot manufacture phone verification.
- `POST /v1/ops/users` `{phone,displayName,reason}` -> 201 `{user}` with `status:'pending'`. No fixed password, no auto-consent/verification/free grant; user activates through SMS registration.
- `GET /v1/ops/config` -> `{brand,registrationMode,quota,sharingDefaults}`.
- `PATCH /v1/ops/config` `{brand?,registrationMode?,quota?:{freeUnits},reason}` -> config; immutable audit and policy version, no retroactive second grant.
- `GET /v1/ops/plans` -> `{plans}`.
- `POST /v1/ops/plans` `{name,units,priceCents,expiresAfterDays?:null|number,active,reason}` -> 201 `{plan}`. Display/catalog configuration only; payments disabled, no fake paid orders.
- `PATCH /v1/ops/plans/:id` same full values -> `{plan}`; creates next immutable version.
- `GET /v1/ops/models` -> `{models,providerModelCatalog}`; includes runtime descriptors for disabled catalog rows as well.
- `PUT /v1/ops/models/:id` `{label,provider:'qwen'|'ark'|'openai',operations,enabled,minWidth,maxWidth,minHeight,maxHeight,maxOutputs,unitCost,allowedQualities,imageUnitCosts?,reason}` -> `{model}`. OpenAI/Ark allow `generate-image`; Qwen allows `edit-plan`, `generate-text`, `transcribe`. `maxOutputs` accepts1…10 but runtime capability may be narrower; quality acceptsauto/low/medium/high/xhigh/max. `imageUnitCosts` is an optional partial map of these qualities to positive integer points. OpenAI reserves `(imageUnitCosts[quality] ?? unitCost) × n`, at most100000 points, from the frozen catalog version; later price edits never reprice a queued job. Ark remains single-output with no quality controls. Omitted provider/operations preserve Qwen/edit-plan compatibility.
- `POST /v1/ops/adjustments` `{spaceId,units,reason,idempotencyKey}` -> `{adjustment,entitlements}`. Positive grant or negative available-point correction, no direct UPDATE balance; cannot consume held points, no cash claim.
- `GET /v1/ops/audit` -> `{entries}`; metadata only, not private recipes/photos/messages.
- `POST /v1/ops/registration-invites` `{maxUses?:1..100,expiresInDays?:1..30,reason}` -> 201 `{invitation:{id,code,expiresAt,maxUses}}`.
- `GET /v1/ops/ai-jobs/unknown` -> `{jobs:[{id,projectId,actorId,modelId,operation,providerRequestId,errorCode,heldUnits,createdAt}]}`; no private prompts or outputs. `providerRequestId` is the actual retained upstream receipt, or null when no receipt was obtained; use it for vendor reconciliation, never invent one.
- `POST /v1/ops/ai-jobs/:id/resolve` `{resolution:'release'|'settle',reason,evidenceRef}` -> `{ok:true,state:'failed',resolution}`. Only a current operator can resolve an unknown result after examining vendor evidence; reason is 10–1000 characters and evidenceRef 3–200. Same resolution is idempotent; conflicting terminal resolution is rejected. The hold is released back to its original lot (or expired bucket) or settled, with an immutable audit record. This does not fabricate an output or retry a vendor call.

### AI request bodies and results

All bodies require a UUID `idempotencyKey` and exact `modelId`. Reusing a key with changed content is a conflict. Prompt length is 1–1500 characters. The body limit is 2 MiB.

| Operation                        | Additional body                                                                                                                | Completed output                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edit-plan` (default if omitted) | `prompt,artworkId,expectedVersion,recipe,parentJobId?` (complete validated v1/v2/v3/v4 recipe)                                 | `{kind:'edit-plan',summary,recipe,artworkId,baseVersion,inputHash}` candidate. New v2/v3/v4 requests additionally return `proposalVersion:2,parameterChanges:[{path,label,before,after,unit}]`: original13 adjustments plus52 registry numeric paths; geometry, curves, local masks and regions remain unchanged. Save explicitly through revision CAS.                             |
| `generate-image`                 | `prompt,width,height,referenceAssetId?` or `referenceAssetIds?`; optional `maskAssetId,markupAssetId,parentJobId,imageOptions` | `{kind:'image',assetId,artworkId,url,thumbnailUrl,width,height,modelId,images:[{index,assetId,artworkId,url,thumbnailUrl,width,height}],providerOutputFormat?,canonicalFormat?}`. Legacy first-image fields are retained; all output images publish in one transaction.                                                                                                             |
| `generate-text`                  | `prompt,contextDocumentId?,expectedDocumentVersion?,parentJobId?`                                                              | `{kind:'text',title,body,summary}` candidate. A successful same-project parent text is explicitly frozen into this request; selected document version must match. Combined context beyond moderation bounds is rejected, never silently truncated. Adopt through `POST /v1/ai-jobs/:id/decisions` with `action:'save-text'` to preserve the decision and edited-content provenance. |
| `transcribe`                     | `audioBase64`                                                                                                                  | `{kind:'transcript',text,noSpeech:boolean}`; actual RIFF/WAV PCM16 mono, 16 kHz, no more than 30 seconds. Transcription is an external ASR call; its non-empty returned text is moderated before exposure; an empty result returns `noSpeech:true` without sending an empty string to text moderation. This is not pre-call audio-content moderation.                               |

`Job={id,projectId,operation,modelId,state,canCancel,inputHash,output,errorCode,reservedUnits,createdAt,updatedAt,prompt?,artworkId?,request,parentJobId,threadId,contextSummary?}`. Authorized project members receive the safe request snapshot; it never includes raw audio, provider credentials or prepared private transport objects. `canCancel` is calculated from current membership, job ownership and queued state; it is a UI affordance, not authorization or proof that no dispatch evidence exists. When continuing an image job with `parentJobId`, the request must explicitly select at least one actual output asset of that successful same-project parent as a reference. A new image task does not require a parent. Edit-plan parents must belong to the same artwork. Thread IDs are server-derived, depth limited to50; no implicit entire-conversation memory is claimed. States remain `queued,running,completed,failed,unknown,cancelled`. All published images and non-empty generated text are moderated before publication. An empty ASR result returns `noSpeech:true` without an empty-string moderation call. Each image batch publishes in one transaction. A partial/malformed/unsafe batch remains unknown with its full hold and any genuine vendor receipt; it is never automatically retried. Audio is removed after processing.

New v2/v3/v4 `edit-plan` requests use a server-derived protocol version; the client cannot select arbitrary tools or a protocol version. The frozen prompt includes only supported global numeric controls, not image pixels or region names/masks. Supplier JSON accepts the13 basic `adjustments` keys plus a `parameters` array of exact52 `V2_TOOLS` paths, with finite/range checks, no duplicates, integer pixel/seed values and one final joint validation of the entire recipe. It cannot add/delete regions, replace masks or write arbitrary JSON paths. `parameterChanges` reports only actual differences with original values for explicit user review; unchanged v2/v3/v4 content is preserved. Input moderation covers the exact transmitted prompt; v2 output moderation covers the complete newly generated summary and validated numeric differences, without resending untouched existing mask data. v1 and pre-existing frozen tasks without `proposalVersion` retain the original13-field protocol and digest. The v2 output-token cap is2800 rather than the old1200; the configured per-request service-point quote remains frozen, and operators must budget its actual model cost. No face recognition or visual analysis is implied.

`imageOptions={quality?,background?,outputFormat?,outputCompression?,n?,complexity?}` uses camelCase and rejects unknown fields. The runtime `parameterCapabilities` contains quality/background/outputFormat/outputCompression/n/complexity descriptors (`supported,values?,min?,max?,default?,reason?`), references (`maxCount,maxBytes,maxTotalBytes?,allowMask,allowMarkup`), size (`multipleOf,minPixels,maxPixels,maxDimension,minAspectRatio,maxAspectRatio,auto:false,allowedSizes?,reason?`), explicit unsupported inputFidelity/stream/partialImages/svg/gif descriptors, and dependencies. JPEG cannot be transparent; onlyJPEG/WebP acceptcompression; masks andmarkup are mutually exclusive transparent PNGs matching the first reference. No implicit conversion of the editor's radial mask occurs. Every referenced asset uses current project ACL and byte hashes. Provider formats are real wire parameters; final private storage remains canonicalPNG. See [OpenAI capability matrix](../../packages/multimodal/OPENAI.md) for exact source evidence and application limits.

### Queued cancellation and disabled-provider recovery

`POST /v1/ai-jobs/:id/cancel` accepts `{reason?:string}` (at most 500 trimmed characters; unknown fields rejected). It remains available when model execution is disabled. The caller needs current project edit permission and must be the original job actor or the space owner/admin. Platform operations permission alone never grants access. The API holds the job row and current membership locks while validating the transition.

Only a `queued` job with a normal held reservation and no existing dispatch journal, prior lease or provider receipt can become `cancelled`. The same transaction releases its original quota allocations, erases any queued raw audio, emits `ai.cancelled` and audits the cancellation. HTTP 200 returns `{job,replayed,quotaReleased:true}` using the same Job DTO. Retrying a completed cancellation is idempotent and creates no second release/audit/event; current ACL is still required. No separate cancellation key is needed because the job ID identifies the single terminal transition. Quota returned to an expired lot remains expired; this is not a cash refund or a new quota grant.

`running`, `unknown` and other terminal states return HTTP 409 `JOB_NOT_QUEUED`, with no release or retry. A restored queued record with dispatch/lease/receipt/abnormal-hold evidence (including unreadable journal evidence) is committed as `unknown`, retaining its hold and receipt, then returns HTTP 409 `CANCELLATION_REQUIRES_RECONCILIATION`. Clients refresh the job after this response and must not automatically retry generation. Operator reconciliation continues through the existing evidence-required `/v1/ops/ai-jobs/:id/resolve` endpoint.

The worker performs one shared stale-lease recovery pass before consulting enabled operations. Even when every provider is disabled, stale `running` jobs from every operation become `unknown`, preserve receipts/reservations and erase raw audio. Recovery never queues or resends them. Restored queued dispatch evidence is also checked before model/permission rejection is allowed to release a hold. Journal/database inconsistency blocks further dispatch; conservative stale recovery still occurs first. Keep the worker process running for maintenance even when no AI model is enabled.

The local dispatch journal and database invariants protect the documented single-machine pilot path. They are not a claim that a geographically independent production financial recovery system, cash payments or service qualifications are complete. Production accounts, region access, billable requests and deployment recovery require separate acceptance testing.

`doctor` derives its required schema version from the exact ordered migration registry used by `migrate`, through `LATEST_SCHEMA_VERSION` / `getSchemaReadiness`. It rejects old, missing-intermediate and newer-than-this-code migration ledgers instead of accepting any version above 2. A successful version check describes recorded migration readiness, not a complete forensic verification of all physical database objects.

### Runtime and persistence constraints

`DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, exact comma-separated `APP_ORIGIN`, `STORAGE_DIR`, `PORT` and `HOST` configure the API. `DB_POOL_MAX` bounds connections. `TRUST_PROXY_HOPS` is `0` by default or exactly `1` behind a private single reverse proxy; never expose that trusted-proxy backend port to users. HTTPS origins imply secure cookies. Run migration/bootstrap using the documented commands; the bootstrap CLI requires explicit operator phone/password/name and has no default credentials. Server import defaults to 40,000,000 pixels; `MAX_IMAGE_PIXELS` permits at most 64,000,000. Sides are bounded at 16,384. Upload size defaults to 20 MiB and can be configured up to 50 MiB; normalized PNG output has a streaming 256 MiB cap.

Sessions and OTPs are stored only as hashes/HMACs, passwords as salted scrypt hashes. Rate buckets are durable SQL rows. Uploads are bounded both while streaming and during decode. All storage instances in one process share a single admission slot, and sharp's per-image thread concurrency is 1; this is not a global multi-process or multi-host admission limit. Deletion tombstones block API access immediately; physical blob reclamation and retention scheduling are not automated, and completed copies can still reference the same immutable storage key. Do not remove shared files without a reference-aware maintenance procedure.

Platform operators can administer users/catalog/policies and audited quota corrections,
but have no automatic permission to read private projects/files/comments/revisions.
Real SMS, model generation, payment, public-service approvals and disaster recovery are
separate capability gates. No credentials are seeded in the repository.

## V4 collaboration, resources, usage and retained media

The implemented V4 routes and lifecycle rules are documented in [API_V4.md](API_V4.md).
They extend this API without removing existing save, sharing, entitlements or quota
adjustment endpoints. Active collaboration leases also guard those existing writes.
Storage responses include `reservedMediaBytes`; retained originals and explicit
authorized copies add logical bytes. Matching proxy hashes never grant original access.
