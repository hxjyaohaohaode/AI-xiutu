# Durable AI orchestration

This package owns frozen requests, current actor/model authorization, moderation,
quota reservation and settlement, persistent worker leases and private dispatch
evidence. `packages/multimodal` owns actual transport and model-specific parameter
contracts. Runtime keys and external calls are not exposed to the browser.

Image generation publishes a fully reviewed output batch atomically. New output
artworks start with a neutral Recipe v3. Existing v1/v2 sources are not silently
upgraded. A completed image, text or numerical proposal is still a candidate.

Edit-plan protocol 2 supports v2 and v3 recipes through the same 13+52 global
numeric whitelist. It preserves all v3 layer, region, warp and geometry state.
Neither composition names nor image-layer IDs are sent to that text-only model.
Cloud requests reject unuploaded or foreign-project image-layer references before
creating a paid hold. This interface is not visual face analysis.

The API's `ai-decisions.ts` applies a confirmed result under the same project's
current ACL. It records an immutable decision and either creates a branch,
appends a source-aware revision (including explicit composition-layer adoption),
or saves an immutable document version. Layer adoption preserves the old base and
edits, freezes the candidate reference and uses the same CAS/ACL/idempotency checks.
Rejecting
a completed result does not refund an already settled provider request.

Unknown external outcomes keep their holds and real receipts. No client retry or
lost response acknowledgement automatically resends a potentially billable call.
`runOnce` always runs the shared stale-lease recovery before consulting provider
flags, including when every capability is disabled. Recovery changes lost
running jobs to unknown, redacts audio, emits an event and never releases or
requeues them. The worker entry point must continue invoking it while disabled.

Queued jobs have an authenticated cancellation path: current project editors
can cancel their own queued jobs; space owners/admins can cancel other queued
jobs. The row lock arbitrates cancellation against claiming. Current membership
and active-account checks are repeated server-side, with no operator privacy
override. A safe queue cancellation releases the original reservation once,
preserving expiry semantics. Existing dispatch, prior lease, receipt, anomalous
hold or unreadable journal evidence instead moves the queued row to unknown and
requires reconciliation. Both worker claim paths use the same evidence check
before any permission/model failure may release a restored task's hold.
See [API](../../apps/api/API.md), [extensions](../../docs/EXTENSIONS.md) and
[operations](../../docs/OPERATIONS.md).
