/** Explicit, expiring AI delegation. Budgets are checked in the same transaction
 * as wallet reservations; failed/unknown external calls never reset the budget. */
export const schemaV11Sql = String.raw`
ALTER TABLE assistant_candidates ADD COLUMN applied_revision_id uuid REFERENCES revisions(id);
CREATE TABLE assistant_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES users(id), project_id uuid NOT NULL REFERENCES projects(id),
 mode text NOT NULL CHECK(mode IN ('suggest','confirm','auto')),
 unit_limit integer NOT NULL CHECK(unit_limit BETWEEN 1 AND 100000),
 step_limit integer NOT NULL CHECK(step_limit BETWEEN 1 AND 100),
 used_units integer NOT NULL DEFAULT 0 CHECK(used_units>=0 AND used_units<=unit_limit),
 used_steps integer NOT NULL DEFAULT 0 CHECK(used_steps>=0 AND used_steps<=step_limit),
 allowed_actions jsonb NOT NULL, model_ids jsonb NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX assistant_grants_actor ON assistant_grants(actor_id,project_id,created_at DESC);
CREATE TABLE assistant_grant_claims (
 grant_id uuid NOT NULL REFERENCES assistant_grants(id), claim_key text NOT NULL,
 action text NOT NULL, model_id text NOT NULL, units integer NOT NULL CHECK(units>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(grant_id,claim_key)
);
`;
