/** Media objects are immutable; per-asset links carry independent ACL/retention
 * and logical storage charges. Copies retain their own link after source exit. */
export const schemaV10Sql = String.raw`
ALTER TABLE space_storage_accounts ADD COLUMN IF NOT EXISTS media_reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(media_reserved_bytes>=0);
CREATE OR REPLACE FUNCTION reserve_asset_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination uuid;
BEGIN
 SELECT space_id INTO destination FROM projects WHERE id=NEW.project_id;
 IF destination IS NULL THEN RAISE EXCEPTION 'asset project missing' USING ERRCODE='23503'; END IF;
 INSERT INTO space_storage_accounts(space_id) VALUES(destination) ON CONFLICT DO NOTHING;
 UPDATE space_storage_accounts SET retained_bytes=retained_bytes+NEW.bytes,retained_assets=retained_assets+1,updated_at=clock_timestamp()
 WHERE space_id=destination AND retained_bytes+media_reserved_bytes+NEW.bytes<=max_bytes AND retained_assets+1<=max_assets;
 IF NOT FOUND THEN RAISE EXCEPTION 'SPACE_STORAGE_LIMIT' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TABLE IF NOT EXISTS media_import_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
 actor_id uuid NOT NULL REFERENCES users(id), idempotency_key uuid NOT NULL, request_hash text NOT NULL,
 name text NOT NULL, expected_bytes bigint NOT NULL CHECK(expected_bytes BETWEEN 1 AND 536870912),
 reservation_bytes bigint NOT NULL DEFAULT 0 CHECK(reservation_bytes>=0),
 uploaded_bytes bigint NOT NULL DEFAULT 0 CHECK(uploaded_bytes>=0 AND uploaded_bytes<=expected_bytes),
 generate_tiles boolean NOT NULL DEFAULT true,
 state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','processing','ready','failed','cancelled')),
 asset_id uuid REFERENCES assets(id), error_code text, error_message text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS media_import_jobs_work ON media_import_jobs(state,updated_at);
CREATE TABLE IF NOT EXISTS media_objects (
 id uuid PRIMARY KEY REFERENCES media_import_jobs(id), descriptor jsonb NOT NULL,
 retained_bytes bigint NOT NULL CHECK(retained_bytes>0), created_at timestamptz NOT NULL DEFAULT now(),
 purged_at timestamptz
);
CREATE TABLE IF NOT EXISTS media_sources (
 asset_id uuid PRIMARY KEY REFERENCES assets(id), object_id uuid NOT NULL REFERENCES media_objects(id),
 retained_bytes bigint NOT NULL CHECK(retained_bytes>0), created_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz
);
CREATE INDEX IF NOT EXISTS media_sources_object ON media_sources(object_id) WHERE released_at IS NULL;
CREATE OR REPLACE FUNCTION media_source_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination uuid;
BEGIN
 SELECT p.space_id INTO destination FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.id=NEW.asset_id;
 IF TG_OP='INSERT' THEN
   IF NEW.released_at IS NOT NULL THEN RAISE EXCEPTION 'invalid initial media retention' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM media_objects WHERE id=NEW.object_id AND purged_at IS NULL AND retained_bytes=NEW.retained_bytes) THEN
     RAISE EXCEPTION 'media object unavailable' USING ERRCODE='23514';
   END IF;
   INSERT INTO space_storage_accounts(space_id) VALUES(destination) ON CONFLICT DO NOTHING;
   UPDATE space_storage_accounts SET retained_bytes=retained_bytes+NEW.retained_bytes,updated_at=clock_timestamp()
     WHERE space_id=destination AND retained_bytes+media_reserved_bytes+NEW.retained_bytes<=max_bytes;
   IF NOT FOUND THEN RAISE EXCEPTION 'SPACE_STORAGE_LIMIT' USING ERRCODE='P0001'; END IF;
 ELSE
   IF NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.object_id IS DISTINCT FROM OLD.object_id
     OR NEW.retained_bytes IS DISTINCT FROM OLD.retained_bytes OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL THEN
     RAISE EXCEPTION 'media source is immutable except one-way release' USING ERRCODE='23514';
   END IF;
   UPDATE space_storage_accounts SET retained_bytes=retained_bytes-OLD.retained_bytes,updated_at=clock_timestamp() WHERE space_id=destination;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER media_source_budget_guard BEFORE INSERT OR UPDATE ON media_sources FOR EACH ROW EXECUTE FUNCTION media_source_budget();
CREATE TRIGGER media_source_no_delete BEFORE DELETE ON media_sources FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
-- A matching proxy hash is not proof of ownership of the original. Media links
-- are copied only by explicitly authorized source/target copy commands, which
-- acquire media-object locks before inserting assets and reserving capacity.
`;
