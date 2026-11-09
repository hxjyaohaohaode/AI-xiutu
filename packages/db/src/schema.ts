export const schemaSql = String.raw`
CREATE TABLE IF NOT EXISTS app_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  brand jsonb NOT NULL DEFAULT '{"name":"映间","tagline":"让想法在共同创作中成为作品","logoAssetId":null}',
  registration_mode text NOT NULL DEFAULT 'open' CHECK (registration_mode IN ('open','invite')),
  free_units integer NOT NULL DEFAULT 200 CHECK (free_units BETWEEN 0 AND 100000),
  quota_policy_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_config(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text NOT NULL UNIQUE,
  display_name text NOT NULL, password_hash text, status text NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','banned')),
  phone_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operator_users (
  user_id uuid PRIMARY KEY REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS otp_challenges (
  id uuid PRIMARY KEY, phone_key text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('register','login','reset')),
  code_hash text NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  state text NOT NULL CHECK(state IN ('sending','sent','unknown','failed')),
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_lookup_idx ON otp_challenges(phone_key,purpose,created_at DESC);
CREATE TABLE IF NOT EXISTS rate_buckets (
  key text NOT NULL, window_start bigint NOT NULL, hits integer NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY(key,window_start)
);
CREATE TABLE IF NOT EXISTS spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, kind text NOT NULL CHECK(kind IN ('personal','team')),
  owner_id uuid NOT NULL REFERENCES users(id),
  sharing_policy jsonb NOT NULL DEFAULT '{"allowReference":true,"allowCopy":false,"maxActiveGrants":20,"maxCopyAssets":20}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,kind,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_personal_space ON spaces(owner_id) WHERE kind='personal';
CREATE TABLE IF NOT EXISTS memberships (
  space_id uuid NOT NULL REFERENCES spaces(id), user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK(role IN ('owner','admin','editor','reviewer','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(space_id,user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK(kind IN ('registration','space')), space_id uuid REFERENCES spaces(id),
  role text CHECK(role IN ('admin','editor','reviewer','viewer')), max_uses integer NOT NULL CHECK(max_uses>0),
  uses integer NOT NULL DEFAULT 0 CHECK(uses>=0 AND uses<=max_uses), expires_at timestamptz NOT NULL,
  revoked_at timestamptz, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((kind='space' AND space_id IS NOT NULL AND role IS NOT NULL) OR (kind='registration' AND space_id IS NULL))
);
CREATE TABLE IF NOT EXISTS invitation_uses (
  invitation_id uuid NOT NULL REFERENCES invitations(id), user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(invitation_id,user_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES spaces(id), title text NOT NULL,
  description text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL REFERENCES users(id),
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_space_idx ON projects(space_id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), name text NOT NULL,
  storage_key text NOT NULL, mime text NOT NULL, width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0),
  bytes bigint NOT NULL CHECK(bytes>=0), content_hash text NOT NULL, provenance jsonb NOT NULL DEFAULT '{}', created_by uuid NOT NULL REFERENCES users(id),
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(project_id);
CREATE TABLE IF NOT EXISTS artworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), asset_id uuid NOT NULL REFERENCES assets(id),
  title text NOT NULL, head_version integer NOT NULL DEFAULT 1 CHECK(head_version>0), head_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), artwork_id uuid NOT NULL REFERENCES artworks(id), version integer NOT NULL CHECK(version>0),
  parent_id uuid REFERENCES revisions(id), recipe jsonb NOT NULL, label text NOT NULL DEFAULT '',
  author_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(artwork_id,version)
);
CREATE OR REPLACE FUNCTION immutable_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'revisions are immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS revisions_immutable ON revisions;
CREATE TRIGGER revisions_immutable BEFORE UPDATE OR DELETE ON revisions FOR EACH ROW EXECUTE FUNCTION immutable_revision_guard();
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), artwork_id uuid REFERENCES artworks(id),
  revision_id uuid REFERENCES revisions(id), body text NOT NULL, anchor jsonb, author_id uuid NOT NULL REFERENCES users(id),
  resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), title text NOT NULL,
  description text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
  assignee_id uuid REFERENCES users(id), version integer NOT NULL DEFAULT 1, author_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), title text NOT NULL,
  body text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1, author_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES documents(id), version integer NOT NULL,
  title text NOT NULL, body text NOT NULL, author_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id,version)
);
CREATE TABLE IF NOT EXISTS events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, space_id uuid NOT NULL REFERENCES spaces(id), project_id uuid REFERENCES projects(id),
  type text NOT NULL, entity_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_space_seq_idx ON events(space_id,seq);
CREATE TABLE IF NOT EXISTS share_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), target_user_id uuid NOT NULL REFERENCES users(id),
  mode text NOT NULL CHECK(mode IN ('reference','copy')), expires_at timestamptz NOT NULL, revoked_at timestamptz,
  copied_project_id uuid REFERENCES projects(id), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_copies (
  actor_id uuid NOT NULL REFERENCES users(id), idempotency_key text NOT NULL,
  source_project_id uuid NOT NULL REFERENCES projects(id), target_space_id uuid NOT NULL REFERENCES spaces(id),
  copied_project_id uuid NOT NULL REFERENCES projects(id), request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS grants_lookup_idx ON share_grants(target_user_id,project_id);
CREATE TABLE IF NOT EXISTS quota_wallets (
  space_id uuid PRIMARY KEY REFERENCES spaces(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quota_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_id uuid NOT NULL REFERENCES users(id), period_start date NOT NULL,
  policy_version integer NOT NULL, units integer NOT NULL CHECK(units>=0), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id,period_start)
);
CREATE TABLE IF NOT EXISTS quota_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES spaces(id),
  kind text NOT NULL CHECK(kind IN ('free','gift','purchased')), source_key text NOT NULL UNIQUE,
  total_units integer NOT NULL CHECK(total_units>=0), available integer NOT NULL CHECK(available>=0), held integer NOT NULL DEFAULT 0 CHECK(held>=0),
  spent integer NOT NULL DEFAULT 0 CHECK(spent>=0), expired integer NOT NULL DEFAULT 0 CHECK(expired>=0), revoked integer NOT NULL DEFAULT 0 CHECK(revoked>=0),
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(total_units=available+held+spent+expired+revoked)
);
CREATE INDEX IF NOT EXISTS lots_space_idx ON quota_lots(space_id);
CREATE TABLE IF NOT EXISTS quota_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES spaces(id), user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL, request_hash text NOT NULL, units integer NOT NULL CHECK(units>0),
  state text NOT NULL CHECK(state IN ('held','settled','released','unknown')), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS hold_allocations (
  hold_id uuid NOT NULL REFERENCES quota_holds(id), lot_id uuid NOT NULL REFERENCES quota_lots(id), units integer NOT NULL CHECK(units>0),
  PRIMARY KEY(hold_id,lot_id)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, space_id uuid NOT NULL REFERENCES spaces(id), lot_id uuid REFERENCES quota_lots(id),
  kind text NOT NULL, units integer NOT NULL, event_key text NOT NULL UNIQUE, actor_id uuid REFERENCES users(id),
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION immutable_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'ledger entries are immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS ledger_immutable ON ledger_entries;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION immutable_ledger_guard();
CREATE TABLE IF NOT EXISTS quota_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES spaces(id), units integer NOT NULL CHECK(units<>0),
  reason text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), idempotency_key text NOT NULL UNIQUE, request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), current_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plan_versions (
  plan_id uuid NOT NULL REFERENCES plans(id), version integer NOT NULL, name text NOT NULL, units integer NOT NULL CHECK(units>0),
  price_cents integer NOT NULL CHECK(price_cents>=0), expires_after_days integer CHECK(expires_after_days>0), active boolean NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(plan_id,version)
);
CREATE TABLE IF NOT EXISTS model_configs (
  id text PRIMARY KEY, config jsonb NOT NULL, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), actor_id uuid NOT NULL REFERENCES users(id),
  model_id text NOT NULL, input_hash text NOT NULL, state text NOT NULL CHECK(state IN ('queued','running','unknown','completed','failed','cancelled')),
  hold_id uuid REFERENCES quota_holds(id), provider_request_id text,
  operation text NOT NULL DEFAULT 'edit-plan', idempotency_key text, input jsonb NOT NULL DEFAULT '{}', output jsonb,
  error_code text, lease_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS audit_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL,
  target_type text NOT NULL, target_id text, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION immutable_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'audit entries are immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS audit_immutable ON audit_entries;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_entries FOR EACH ROW EXECUTE FUNCTION immutable_audit_guard();
`;

// Forward migration for development databases created before multimodal jobs and
// cross-space copies were introduced. Never replace or rewrite existing data.
export const schemaV2Sql = String.raw`
ALTER TABLE assets ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS operation text NOT NULL DEFAULT 'edit-plan';
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS input jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS output jsonb;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS lease_started_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_project_id_actor_id_idempotency_key_key ON ai_jobs(project_id,actor_id,idempotency_key);
CREATE INDEX IF NOT EXISTS ai_jobs_state_created_idx ON ai_jobs(state,created_at);
CREATE TABLE IF NOT EXISTS project_copies (
  actor_id uuid NOT NULL REFERENCES users(id), idempotency_key text NOT NULL,
  source_project_id uuid NOT NULL REFERENCES projects(id), target_space_id uuid NOT NULL REFERENCES spaces(id),
  copied_project_id uuid NOT NULL REFERENCES projects(id), request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,idempotency_key)
);
CREATE OR REPLACE FUNCTION immutable_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION '% are immutable',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS document_versions_immutable ON document_versions;
CREATE TRIGGER document_versions_immutable BEFORE UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
DROP TRIGGER IF EXISTS plan_versions_immutable ON plan_versions;
CREATE TRIGGER plan_versions_immutable BEFORE UPDATE OR DELETE ON plan_versions FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
`;
