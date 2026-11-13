import { schemaV24Sql } from './schema-v24.js';

// Some local databases used version 24 for the image tables before the two
// worktrees were consolidated. Recover the missing migration in that case.
export const schemaV26Sql = String.raw`
DO $reconcile$
BEGIN
  IF to_regclass('public.photo_storage_cleanup') IS NULL THEN
    EXECUTE $recycle$${schemaV24Sql}$recycle$;
  END IF;
END $reconcile$;

CREATE TABLE IF NOT EXISTS ai_job_image_artifacts (
  job_id uuid NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  output_index integer NOT NULL CHECK (output_index BETWEEN 0 AND 9),
  format text NOT NULL CHECK (format IN ('svg','gif')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 16 AND 7000000),
  PRIMARY KEY (job_id,output_index)
);
CREATE OR REPLACE FUNCTION charge_ai_image_artifact_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination uuid;
BEGIN
  SELECT p.space_id INTO destination FROM ai_jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=NEW.job_id;
  INSERT INTO space_storage_accounts(space_id) VALUES(destination) ON CONFLICT DO NOTHING;
  UPDATE space_storage_accounts SET retained_bytes=retained_bytes+octet_length(NEW.bytes),updated_at=clock_timestamp()
    WHERE space_id=destination AND retained_bytes+media_reserved_bytes+octet_length(NEW.bytes)<=max_bytes;
  IF NOT FOUND THEN RAISE EXCEPTION 'SPACE_STORAGE_LIMIT' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER ai_job_image_artifact_storage_charge AFTER INSERT ON ai_job_image_artifacts
  FOR EACH ROW EXECUTE FUNCTION charge_ai_image_artifact_storage();
CREATE OR REPLACE TRIGGER ai_job_image_artifact_immutable BEFORE UPDATE OR DELETE ON ai_job_image_artifacts
  FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();

CREATE TABLE IF NOT EXISTS ai_job_image_previews (
  job_id uuid PRIMARY KEY REFERENCES ai_jobs(id) ON DELETE CASCADE,
  frame_index integer NOT NULL CHECK (frame_index BETWEEN 0 AND 2),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 16 AND 1600000),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_job_image_previews_expiry ON ai_job_image_previews(expires_at);
`;
