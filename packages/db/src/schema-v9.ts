/** V4 assistant records are private project content. Credentials/raw microphone
 * audio never enter these tables. Each paid dispatch is recorded before sending. */
export const schemaV9Sql = String.raw`
-- A provider model can have several capabilities. Editing its conversational
-- budget must never replace image-generation parameters for the same model ID.
CREATE TABLE IF NOT EXISTS assistant_model_configs (
 id text PRIMARY KEY, config jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assistant_turns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES projects(id), actor_id uuid NOT NULL REFERENCES users(id),
 model_id text NOT NULL, idempotency_key uuid NOT NULL, request_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('running','completed','failed','unknown')),
 prompt text NOT NULL, context jsonb NOT NULL DEFAULT '{}', scope jsonb NOT NULL DEFAULT '{}', config jsonb NOT NULL DEFAULT '{}',
 parent_turn_id uuid REFERENCES assistant_turns(id), hold_id uuid NOT NULL REFERENCES quota_holds(id),
 output jsonb, error_code text, usage jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS assistant_turns_project ON assistant_turns(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS voice_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
 actor_id uuid NOT NULL REFERENCES users(id), model_id text NOT NULL, backend_model_id text NOT NULL,
 idempotency_key uuid NOT NULL, request_hash text NOT NULL, hold_id uuid NOT NULL REFERENCES quota_holds(id),
 state text NOT NULL CHECK(state IN ('prepared','connecting','active','closed','failed','unknown')),
 config jsonb NOT NULL, scope jsonb NOT NULL, context jsonb NOT NULL DEFAULT '{}',
 connection_hash text NOT NULL, connect_expires_at timestamptz NOT NULL,
 provider_session_id text, usage jsonb NOT NULL DEFAULT '[]', elapsed_seconds integer NOT NULL DEFAULT 0,
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS voice_sessions_project ON voice_sessions(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS assistant_dispatches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), turn_id uuid REFERENCES assistant_turns(id),
 voice_id uuid REFERENCES voice_sessions(id), sequence integer NOT NULL CHECK(sequence>=0),
 input_hash text NOT NULL, request_id text, usage jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CHECK((turn_id IS NULL)<>(voice_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_dispatch_turn ON assistant_dispatches(turn_id,sequence) WHERE turn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assistant_dispatch_voice ON assistant_dispatches(voice_id,sequence) WHERE voice_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS assistant_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
 actor_id uuid NOT NULL REFERENCES users(id), turn_id uuid REFERENCES assistant_turns(id), voice_id uuid REFERENCES voice_sessions(id),
 kind text NOT NULL CHECK(kind IN ('edit','generation')), artwork_id uuid REFERENCES artworks(id),
 base_version integer, base_recipe_hash text, payload jsonb NOT NULL,
 decision text NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','previewed','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'),
 CHECK((turn_id IS NULL)<>(voice_id IS NULL))
);
CREATE INDEX IF NOT EXISTS assistant_candidates_project ON assistant_candidates(project_id,created_at DESC);
`;
