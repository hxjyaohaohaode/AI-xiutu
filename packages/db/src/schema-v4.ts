/** Append-only source snapshots and user decisions. Existing immutable revisions
 * are not rewritten; their source is captured in a separate immutable table. */
export const schemaV4Sql = String.raw`
CREATE TABLE revision_sources (
  revision_id uuid PRIMARY KEY REFERENCES revisions(id),
  asset_id uuid NOT NULL REFERENCES assets(id)
);
INSERT INTO revision_sources(revision_id,asset_id)
SELECT r.id,a.asset_id FROM revisions r JOIN artworks a ON a.id=r.artwork_id;
CREATE INDEX revision_sources_asset_idx ON revision_sources(asset_id);
CREATE TRIGGER revision_sources_immutable BEFORE UPDATE OR DELETE ON revision_sources
FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();

CREATE TABLE revision_image_layers (
  revision_id uuid NOT NULL REFERENCES revisions(id),
  layer_id text NOT NULL,
  asset_id uuid NOT NULL REFERENCES assets(id),
  PRIMARY KEY(revision_id,layer_id)
);
CREATE INDEX revision_image_layers_asset_idx ON revision_image_layers(asset_id);
CREATE TRIGGER revision_image_layers_immutable BEFORE UPDATE OR DELETE ON revision_image_layers
FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();

CREATE OR REPLACE FUNCTION snapshot_revision_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_asset uuid; project uuid; layer jsonb; layer_asset uuid;
BEGIN
  SELECT a.asset_id,a.project_id INTO base_asset,project FROM artworks a WHERE a.id=NEW.artwork_id;
  PERFORM 1 FROM assets WHERE id=base_asset AND project_id=project AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'revision source unavailable' USING ERRCODE='23514'; END IF;
  INSERT INTO revision_sources(revision_id,asset_id) VALUES(NEW.id,base_asset);
  IF NEW.recipe->>'schemaVersion'='3' THEN
    FOR layer IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.recipe->'imageLayers','[]'::jsonb)) LOOP
      layer_asset := (layer->>'sourceId')::uuid;
      PERFORM 1 FROM assets WHERE id=layer_asset AND project_id=project AND deleted_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'revision layer unavailable' USING ERRCODE='23514'; END IF;
      INSERT INTO revision_image_layers(revision_id,layer_id,asset_id) VALUES(NEW.id,layer->>'id',layer_asset);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revisions_snapshot_sources AFTER INSERT ON revisions
FOR EACH ROW EXECUTE FUNCTION snapshot_revision_sources();

CREATE TABLE ai_result_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES ai_jobs(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  action text NOT NULL CHECK(action IN ('reject','fork','replace','apply-plan','save-text')),
  output_index integer CHECK(output_index BETWEEN 0 AND 9),
  target_artwork_id uuid REFERENCES artworks(id),
  revision_id uuid REFERENCES revisions(id),
  document_id uuid REFERENCES documents(id),
  document_version integer CHECK(document_version>0),
  reason text,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX ai_result_decisions_project_job_idx ON ai_result_decisions(project_id,job_id,created_at);
CREATE TRIGGER ai_result_decisions_immutable BEFORE UPDATE OR DELETE ON ai_result_decisions
FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
`;
