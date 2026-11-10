export const schemaV12Sql = String.raw`
CREATE TABLE assistant_run_events (
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 turn_id uuid NOT NULL REFERENCES assistant_turns(id),
 type text NOT NULL CHECK(length(type) BETWEEN 1 AND 64),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=262144),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX assistant_run_events_turn ON assistant_run_events(turn_id,seq);
CREATE TABLE assistant_context_snapshots (
 turn_id uuid PRIMARY KEY REFERENCES assistant_turns(id),
 manifest jsonb NOT NULL CHECK(octet_length(manifest::text)<=524288),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE assistant_tool_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), turn_id uuid NOT NULL REFERENCES assistant_turns(id),
 call_id text NOT NULL, content text NOT NULL CHECK(octet_length(content)<=1000000),
 content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(turn_id,call_id)
);
CREATE TABLE assistant_memories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope text NOT NULL CHECK(scope IN ('user','team','project','artwork')),
 owner_id uuid NOT NULL REFERENCES users(id), space_id uuid REFERENCES spaces(id),
 project_id uuid REFERENCES projects(id), artwork_id uuid REFERENCES artworks(id),
 category text NOT NULL CHECK(category IN ('preference','constraint','workflow','correction')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160), content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
 source_turn_id uuid REFERENCES assistant_turns(id), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 expires_at timestamptz, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((scope='user' AND space_id IS NULL AND project_id IS NULL AND artwork_id IS NULL) OR
       (scope='team' AND space_id IS NOT NULL AND project_id IS NULL AND artwork_id IS NULL) OR
       (scope='project' AND project_id IS NOT NULL AND artwork_id IS NULL) OR
       (scope='artwork' AND project_id IS NOT NULL AND artwork_id IS NOT NULL))
);
CREATE INDEX assistant_memories_owner ON assistant_memories(owner_id,updated_at DESC);
CREATE INDEX assistant_memories_project ON assistant_memories(project_id,updated_at DESC);
CREATE TABLE assistant_memory_versions (
 memory_id uuid NOT NULL REFERENCES assistant_memories(id), version integer NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(memory_id,version)
);
`;
