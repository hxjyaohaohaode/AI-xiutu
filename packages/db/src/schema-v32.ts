export const schemaV32Sql = `
CREATE TABLE document_live_heads (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  epoch integer NOT NULL CHECK (epoch > 0),
  document_version integer NOT NULL CHECK (document_version > 0),
  step_version integer NOT NULL CHECK (step_version > 0)
);
CREATE TABLE document_live_batches (
  document_id uuid NOT NULL REFERENCES document_live_heads(document_id) ON DELETE CASCADE,
  epoch integer NOT NULL CHECK (epoch > 0),
  step_from integer NOT NULL CHECK (step_from >= 0),
  step_to integer NOT NULL CHECK (step_to > step_from AND step_to - step_from <= 32),
  actor_id uuid NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL,
  mutation_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) = step_to - step_from),
  PRIMARY KEY (document_id, epoch, step_from),
  UNIQUE (document_id, epoch, actor_id, client_id, mutation_id)
);
CREATE TABLE office_audio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  mime text NOT NULL CHECK (mime IN ('audio/wav','audio/mpeg','audio/ogg')),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 8388608),
  contents bytea NOT NULL CHECK (octet_length(contents) = bytes),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, sha256)
);
CREATE INDEX office_audio_project_created ON office_audio(project_id, created_at DESC);
`;
