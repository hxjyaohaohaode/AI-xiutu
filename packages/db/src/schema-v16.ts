/** Operation lineage lives on the immutable revision. Legacy origin is unknown. */
export const schemaV16Sql = String.raw`
-- Ledger entries that committed after a report began may have a lower
-- sequence id than the last visible entry. Record top-level transaction IDs
-- for new movements so keyset pagination can keep the original visibility.
ALTER TABLE ledger_entries ADD COLUMN recorded_tx xid8;
ALTER TABLE ledger_entries ALTER COLUMN recorded_tx SET DEFAULT pg_current_xact_id();

ALTER TABLE revisions
  ADD COLUMN origin_kind text,
  ADD COLUMN source_revision_id uuid REFERENCES revisions(id),
  ADD COLUMN origin_ref uuid,
  ADD COLUMN request_digest text,
  ADD CONSTRAINT revisions_origin_kind_check CHECK (origin_kind IN (
    'initial','manual','rename','restore','history-fork','project-copy',
    'collaboration','ai-generated','ai-fork','ai-replace','ai-layer','ai-parameters',
    'assistant-auto','assistant-confirm'
  )),
  ADD CONSTRAINT revisions_origin_fields_check CHECK (
    (origin_kind IS NOT NULL OR (source_revision_id IS NULL AND origin_ref IS NULL AND request_digest IS NULL))
    AND (source_revision_id IS NOT NULL) = COALESCE(origin_kind IN ('restore','history-fork'),false)
    AND (request_digest IS NULL OR request_digest ~ '^[0-9a-f]{64}$')
    AND (origin_kind IS DISTINCT FROM 'history-fork' OR (origin_ref IS NOT NULL AND request_digest IS NOT NULL))
  );
CREATE UNIQUE INDEX revisions_history_fork_key ON revisions(author_id,origin_ref)
  WHERE origin_kind='history-fork';

CREATE FUNCTION revision_topology_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_version integer; parent_art uuid; source_version integer; source_art uuid; source_project uuid;
BEGIN
  IF NEW.version=1 THEN
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'first revision cannot have a parent' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT r.version,r.artwork_id INTO parent_version,parent_art FROM revisions r WHERE r.id=NEW.parent_id;
    IF parent_art IS DISTINCT FROM NEW.artwork_id OR parent_version IS DISTINCT FROM NEW.version-1 THEN
      RAISE EXCEPTION 'revision parent must be its previous version' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.source_revision_id IS NOT NULL THEN
    SELECT r.version,r.artwork_id,a.project_id INTO source_version,source_art,source_project
      FROM revisions r JOIN artworks a ON a.id=r.artwork_id WHERE r.id=NEW.source_revision_id;
    IF source_project IS DISTINCT FROM (SELECT project_id FROM artworks WHERE id=NEW.artwork_id)
      OR (NEW.origin_kind='restore' AND (source_art IS DISTINCT FROM NEW.artwork_id OR source_version>=NEW.version))
      OR (NEW.origin_kind='history-fork' AND (source_art=NEW.artwork_id OR NEW.version<>1)) THEN
      RAISE EXCEPTION 'revision origin does not match its lineage' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.origin_kind='ai-generated' AND (NEW.version<>1 OR NOT EXISTS (
    SELECT 1 FROM ai_jobs j JOIN artworks a ON a.project_id=j.project_id
    WHERE j.id=NEW.origin_ref AND a.id=NEW.artwork_id AND j.actor_id=NEW.author_id
      AND j.operation='generate-image' AND j.state='running'
  )) THEN
    RAISE EXCEPTION 'generated revision requires its current image job' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revisions_topology_guard BEFORE INSERT ON revisions
  FOR EACH ROW EXECUTE FUNCTION revision_topology_guard();

CREATE FUNCTION artwork_revision_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room uuid; head uuid; head_version integer; head_asset uuid;
  latest uuid; latest_version integer; latest_asset uuid;
BEGIN
  IF TG_TABLE_NAME='revisions' THEN room=NEW.artwork_id; ELSE room=NEW.id; END IF;
  SELECT a.head_revision_id,a.head_version,a.asset_id INTO head,head_version,head_asset
    FROM artworks a WHERE a.id=room;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT r.id,r.version,s.asset_id INTO latest,latest_version,latest_asset
    FROM revisions r LEFT JOIN revision_sources s ON s.revision_id=r.id
    WHERE r.artwork_id=room ORDER BY r.version DESC LIMIT 1;
  IF head IS DISTINCT FROM latest OR head_version IS DISTINCT FROM COALESCE(latest_version,1)
    OR (latest IS NOT NULL AND head_asset IS DISTINCT FROM latest_asset) THEN
    RAISE EXCEPTION 'artwork head must match its latest immutable revision and source' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER artworks_revision_head_guard
  AFTER INSERT OR UPDATE OF asset_id,head_version,head_revision_id ON artworks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION artwork_revision_head_guard();
CREATE CONSTRAINT TRIGGER revisions_artwork_head_guard AFTER INSERT ON revisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION artwork_revision_head_guard();
`;
