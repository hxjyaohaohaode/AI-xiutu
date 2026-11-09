/** Retained logical storage is counted once per asset row, including copies and
 * soft-deleted records. No physical garbage collection is implied by this quota. */
export const schemaV7Sql = String.raw`
LOCK TABLE assets IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS space_storage_accounts (
  space_id uuid PRIMARY KEY REFERENCES spaces(id),
  max_bytes bigint NOT NULL DEFAULT 1073741824 CHECK(max_bytes BETWEEN 0 AND 10995116277760),
  max_assets integer NOT NULL DEFAULT 1000 CHECK(max_assets BETWEEN 0 AND 1000000),
  retained_bytes bigint NOT NULL DEFAULT 0 CHECK(retained_bytes>=0),
  retained_assets bigint NOT NULL DEFAULT 0 CHECK(retained_assets>=0),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO space_storage_accounts(space_id,retained_bytes,retained_assets)
 SELECT s.id,COALESCE(sum(a.bytes),0),count(a.id)
 FROM spaces s LEFT JOIN projects p ON p.space_id=s.id LEFT JOIN assets a ON a.project_id=p.id
 GROUP BY s.id ON CONFLICT(space_id) DO NOTHING;

CREATE OR REPLACE FUNCTION reserve_asset_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination uuid;
BEGIN
  SELECT space_id INTO destination FROM projects WHERE id=NEW.project_id;
  IF destination IS NULL THEN RAISE EXCEPTION 'asset project missing' USING ERRCODE='23503'; END IF;
  INSERT INTO space_storage_accounts(space_id) VALUES(destination) ON CONFLICT DO NOTHING;
  UPDATE space_storage_accounts SET retained_bytes=retained_bytes+NEW.bytes,
    retained_assets=retained_assets+1,updated_at=clock_timestamp()
    WHERE space_id=destination AND retained_bytes+NEW.bytes<=max_bytes AND retained_assets+1<=max_assets;
  IF NOT FOUND THEN RAISE EXCEPTION 'SPACE_STORAGE_LIMIT' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assets_storage_budget ON assets;
CREATE TRIGGER assets_storage_budget BEFORE INSERT ON assets FOR EACH ROW EXECUTE FUNCTION reserve_asset_storage();

CREATE OR REPLACE FUNCTION immutable_asset_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'asset reclamation requires an explicit retention workflow' USING ERRCODE='23514';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
    OR NEW.mime IS DISTINCT FROM OLD.mime OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height
    OR NEW.bytes IS DISTINCT FROM OLD.bytes OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'asset content is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assets_content_immutable ON assets;
CREATE TRIGGER assets_content_immutable BEFORE UPDATE OR DELETE ON assets FOR EACH ROW EXECUTE FUNCTION immutable_asset_content();

CREATE TABLE IF NOT EXISTS asset_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_asset_id uuid NOT NULL REFERENCES assets(id),
  source_project_id uuid NOT NULL REFERENCES projects(id),
  target_project_id uuid NOT NULL REFERENCES projects(id),
  copied_asset_id uuid NOT NULL UNIQUE REFERENCES assets(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  grant_id uuid REFERENCES share_grants(id),
  source_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_project_id<>target_project_id)
);
CREATE INDEX IF NOT EXISTS asset_copies_lookup ON asset_copies(source_asset_id,target_project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS asset_copies_grant ON asset_copies(grant_id) WHERE grant_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS asset_copy_requests (
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  copy_id uuid NOT NULL REFERENCES asset_copies(id),
  grant_id uuid REFERENCES share_grants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS asset_copy_requests_grant ON asset_copy_requests(grant_id) WHERE grant_id IS NOT NULL;
DROP TRIGGER IF EXISTS asset_copies_immutable ON asset_copies;
CREATE TRIGGER asset_copies_immutable BEFORE UPDATE OR DELETE ON asset_copies FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
DROP TRIGGER IF EXISTS asset_copy_requests_immutable ON asset_copy_requests;
CREATE TRIGGER asset_copy_requests_immutable BEFORE UPDATE OR DELETE ON asset_copy_requests FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
`;
