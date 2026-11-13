/** Integrate the independently tested audio schema. A local audio-first database
 * may have already recorded version 23, so complete the earlier plan/comment DDL
 * and reuse existing immutable audio rows and accounting triggers. */
export const schemaV25Sql = String.raw`
ALTER TABLE plan_versions ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE plan_versions ADD COLUMN IF NOT EXISTS benefits text[] NOT NULL DEFAULT '{}';
ALTER TABLE plan_versions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'credits'
  CHECK (kind IN ('credits','subscription'));
ALTER TABLE comments ADD COLUMN IF NOT EXISTS body_version integer NOT NULL DEFAULT 1 CHECK (body_version > 0);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS ai_job_audio (
  job_id uuid PRIMARY KEY REFERENCES ai_jobs(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('mp3','opus','aac','flac','wav','pcm','pcm16')),
  mime text NOT NULL CHECK (mime IN ('audio/mpeg','audio/ogg','audio/aac','audio/flac','audio/wav','application/octet-stream')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 2 AND 4500000)
);
CREATE OR REPLACE FUNCTION charge_ai_audio_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination uuid;
BEGIN
  SELECT p.space_id INTO destination FROM ai_jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=NEW.job_id;
  INSERT INTO space_storage_accounts(space_id) VALUES(destination) ON CONFLICT DO NOTHING;
  UPDATE space_storage_accounts SET retained_bytes=retained_bytes+octet_length(NEW.bytes),updated_at=clock_timestamp()
    WHERE space_id=destination AND retained_bytes+media_reserved_bytes+octet_length(NEW.bytes)<=max_bytes;
  IF NOT FOUND THEN RAISE EXCEPTION 'SPACE_STORAGE_LIMIT' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER ai_job_audio_storage_charge AFTER INSERT ON ai_job_audio
  FOR EACH ROW EXECUTE FUNCTION charge_ai_audio_storage();
CREATE OR REPLACE TRIGGER ai_job_audio_immutable BEFORE UPDATE OR DELETE ON ai_job_audio
  FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
`;
