# API contract (implemented baseline)

Base URL: `/v1`; same-origin browser requests use `credentials: 'include'`.
Every mutation requires an exact configured `Origin`. The server uses opaque,
HttpOnly session cookies; it never returns SMS codes, passwords or provider keys.
Errors are `{ "error": { "code": "...", "message": "...", "details": {} } }`.
Dates are ISO-8601; IDs are UUIDs; numeric points are integers.

## Public and authentication

- `GET /health` -> `{ok:true}` (database checked).
- `GET /v1/public-config` -> `{brand:{name,tagline,logoAssetId,logoUrl},capabilities:{smsConfigured,providerConfigured,moderationConfigured,aiConfigured,aiUnavailableReason,paymentConfigured:false,imageGenerationConfigured,availableOperations,operationStatus},quota:{period:'month',freeUnits,policyVersion},limits:{maxUploadBytes,maxPixels},media:{serverImport,canonical:'png',maxPixels,maxDimension,maxUploadBytes,maxCanonicalBytes},registrationMode:'open'|'invite'}`. `serverImport` is filtered by the actual installed codecs; it is not a list of formats every browser can decode locally. Capability flags describe configured adapters, not proof of vendor account approval or a completed production acceptance test.
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

`Asset={id,projectId,name,mime,width,height,bytes,url,thumbnailUrl,provenance,createdAt}`. AI-generated provenance includes `kind:'ai-generated',jobId,modelId,inputHash`.
`Artwork={id,projectId,assetId,title,headVersion,headRevisionId,createdAt,updatedAt}`.
`Revision={id,artworkId,version,parentId,recipe,label,authorId,createdAt}`.

- `POST /v1/projects/:id/assets` multipart, single `file` -> 201 `{asset}`. Actual supported server codecs are static JPEG/PNG/WebP/AVIF/GIF and single-page TIFF. Bytes/signatures/pixels are checked; APNG, AVIF sequences, multiple frames/pages and unsupported containers are rejected explicitly. Orientation is applied, pixels converted to sRGB PNG and EXIF removed. The raw original, TIFF layers/HDR workflow and original file encoding are not retained. Canonical private files are immutable and only referenced after successful SQL commit. HEIC/RAW/PSD/SVG/BMP are not server import capabilities; a supported browser-local BMP conversion may upload its actual resulting PNG.
- `GET /v1/assets/:id/file` authenticated bytes, current project/share ACL checked on every request; no public local-storage directory.
- `GET /v1/assets/:id/thumbnail` authenticated WebP, longest side at most 512 pixels, preserving aspect ratio and without enlargement. Use `thumbnailUrl` for grids/covers and `url` for original-resolution editing. Every request, including a disk-cache hit, checks the current asset/project/share ACL; cold generation rechecks deletion/permission before delivery. Cached derivatives are private, immutable by source storage key, and published by atomic rename. Original decoding shares the process media slot; a bounded cold-cache queue returns 503 when busy, without substituting another image.
- `DELETE /v1/assets/:id` -> `{ok:true}`. Referenced assets cannot be removed (`ASSET_IN_USE`).
- `POST /v1/projects/:id/artworks` `{assetId,title,recipe}` -> 201 `{artwork,revision}`. Complete recipe validated by `@ai-xiutu/editor`; first headVersion is 1.
- `GET /v1/artworks/:id` -> `{artwork,asset,revision}`.
- `PATCH /v1/artworks/:id` `{expectedVersion,title}` -> `{artwork}`; advances revision through a new immutable entry.
- `POST /v1/artworks/:id/revisions` `{expectedVersion,recipe,label?}` -> 201 `{artwork,revision}`. CAS conflict includes `details:{currentVersion}`.
- `GET /v1/artworks/:id/revisions` -> `{revisions}` (latest 100).
- `GET /v1/artworks/:id/revisions/:revisionId` -> `{revision}`.

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
- `POST /v1/projects/:id/copy` `{title?,targetSpaceId?,idempotencyKey?}` -> 201 `{project}`. Destination defaults to the actor's personal space; an explicit team destination requires owner/admin/editor membership. A current source copy grant permits one completed copy; its replay returns the same project. Source owner/admin can copy their own project when `allowCopy` is true, with a required idempotency key of 8–128 characters. Changing destination/body under that key gives 409. The transaction copies assets, current artwork recipes and current documents from one database snapshot, up to the asset cap; comments/tasks/history are not copied. Assets retain immutable canonical bytes and AI provenance under independent destination ACL. Revocation does not erase a copy already explicitly completed; UI must disclose this.

## Quota, AI and operations

- `GET /v1/me/entitlements?spaceId=UUID` -> `{spaceId,periodStart,periodEnd,available,held,freeAvailable,purchasedAvailable,lots,usage}`. Personal monthly grant is unique per subject+month, independent of policy version. Team creation does not multiply free quota.
- `GET /v1/me/usage?spaceId=UUID` -> `{entries}` (latest 100 immutable ledger entries).
- `GET /v1/models` -> `{models,executionEnabled,reason,availableOperations,operationStatus}`. Each model exposes `id,label,provider,operations,enabled,minWidth,maxWidth,minHeight,maxHeight,maxOutputs,unitCost,allowedQualities,version,pointsPerPlan,runtimeAvailable,runtimeReason,runtimeOperations?,minPixels?,maxPixels?,maxDimension?`. `unitCost`/`pointsPerPlan` are integer service points, not currency. Runtime availability is derived from execution switches and exact server adapter allowlists; an enabled catalog row alone cannot enable execution. The client must intersect profile, operator and application limits. The current image path accepts one output; use the runtime model's `maxPixels` and `maxDimension` (not the server import cap). Exact normalized image bytes must also fit the moderation input limit; a high resolution does not guarantee every detailed image fits that independent byte limit.
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
- `GET /v1/ops/models` -> `{models}`.
- `PUT /v1/ops/models/:id` `{label,provider:'qwen'|'ark',operations,enabled,minWidth,maxWidth,minHeight,maxHeight,maxOutputs,unitCost,allowedQualities,reason}` -> `{model}`; configured bounds validated. Ark allows `generate-image`; Qwen allows `edit-plan`, `generate-text`, `transcribe`. Runtime switches and exact vendor model/profile allowlists still apply. Omitted provider/operations default to Qwen/edit-plan for compatibility. Quality lists and `maxOutputs` are catalog constraints; the current image adapter fixes one output and does not accept client quality/output-count controls.
- `POST /v1/ops/adjustments` `{spaceId,units,reason,idempotencyKey}` -> `{adjustment,entitlements}`. Positive grant or negative available-point correction, no direct UPDATE balance; cannot consume held points, no cash claim.
- `GET /v1/ops/audit` -> `{entries}`; metadata only, not private recipes/photos/messages.
- `POST /v1/ops/registration-invites` `{maxUses?:1..100,expiresInDays?:1..30,reason}` -> 201 `{invitation:{id,code,expiresAt,maxUses}}`.
- `GET /v1/ops/ai-jobs/unknown` -> `{jobs:[{id,projectId,actorId,modelId,operation,providerRequestId,errorCode,heldUnits,createdAt}]}`; no private prompts or outputs. `providerRequestId` is the actual retained upstream receipt, or null when no receipt was obtained; use it for vendor reconciliation, never invent one.
- `POST /v1/ops/ai-jobs/:id/resolve` `{resolution:'release'|'settle',reason,evidenceRef}` -> `{ok:true,state:'failed',resolution}`. Only a current operator can resolve an unknown result after examining vendor evidence; reason is 10–1000 characters and evidenceRef 3–200. Same resolution is idempotent; conflicting terminal resolution is rejected. The hold is released back to its original lot (or expired bucket) or settled, with an immutable audit record. This does not fabricate an output or retry a vendor call.

### AI request bodies and results

All bodies require a UUID `idempotencyKey` and exact `modelId`. Reusing a key with changed content is a conflict. Prompt length is 1–1500 characters. The body limit is 2 MiB.

| Operation                        | Additional body                                                       | Completed output                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edit-plan` (default if omitted) | `prompt,artworkId,expectedVersion,recipe` (complete validated recipe) | `{summary,recipe}` candidate; does not alter the current artwork. Apply it through the ordinary revision CAS endpoint.                                                                                                                  |
| `generate-image`                 | `prompt,width,height,referenceAssetId?`                               | `{kind:'image',assetId,artworkId,url,width,height,modelId}`; verified image is stored as a new private asset/artwork. A sketch/reference uses the ordinary project asset upload and is advisory, not a deterministic preservation mask. |
| `generate-text`                  | `prompt,contextDocumentId?,expectedDocumentVersion?`                  | `{kind:'text',title,body,summary}` candidate; a referenced document must match the expected current version. Save with the document API explicitly.                                                                                     |
| `transcribe`                     | `audioBase64`                                                         | `{kind:'transcript',text}`; actual RIFF/WAV PCM16 mono, 16 kHz, no more than 30 seconds. Transcription is an external ASR call; its returned text is moderated before exposure. This is not pre-call audio-content moderation.          |

`Job={id,projectId,operation,modelId,state,inputHash,output,errorCode,reservedUnits,createdAt,updatedAt,prompt?,artworkId?}`. States are `queued,running,completed,failed,unknown,cancelled` (the baseline has no cancellation endpoint). Actual jobs run in the separate worker. Exact text payloads and source/output images are checked using configured moderation; generated image bytes are normalized and the exact stored PNG is moderated before a database asset becomes visible. Audio is removed from the job after processing; queued raw audio must be treated as sensitive database content. Unknown external results keep their original hold and are never automatically reissued.

The local dispatch journal and database invariants protect the documented single-machine pilot path. They are not a claim that a geographically independent production financial recovery system, cash payments or service qualifications are complete. Production accounts, region access, billable requests and deployment recovery require separate acceptance testing.

### Runtime and persistence constraints

`DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, exact comma-separated `APP_ORIGIN`, `STORAGE_DIR`, `PORT` and `HOST` configure the API. `DB_POOL_MAX` bounds connections. `TRUST_PROXY_HOPS` is `0` by default or exactly `1` behind a private single reverse proxy; never expose that trusted-proxy backend port to users. HTTPS origins imply secure cookies. Run migration/bootstrap using the documented commands; the bootstrap CLI requires explicit operator phone/password/name and has no default credentials. Server import defaults to 40,000,000 pixels; `MAX_IMAGE_PIXELS` permits at most 64,000,000. Sides are bounded at 16,384. Upload size defaults to 20 MiB and can be configured up to 50 MiB; normalized PNG output has a streaming 256 MiB cap.

Sessions and OTPs are stored only as hashes/HMACs, passwords as salted scrypt hashes. Rate buckets are durable SQL rows. Uploads are bounded both while streaming and during decode. All storage instances in one process share a single admission slot, and sharp's per-image thread concurrency is 1; this is not a global multi-process or multi-host admission limit. Deletion tombstones block API access immediately; physical blob reclamation and retention scheduling are not automated, and completed copies can still reference the same immutable storage key. Do not remove shared files without a reference-aware maintenance procedure.

Platform operators can administer users/catalog/policies and audited quota corrections,
but have no automatic permission to read private projects/files/comments/revisions.
Real SMS, model generation, payment, public-service approvals and disaster recovery are
separate capability gates. No credentials are seeded in the repository.
