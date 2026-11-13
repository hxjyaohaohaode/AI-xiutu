export const schemaV23Sql = String.raw`
CREATE TABLE ai_job_audio (
  job_id uuid PRIMARY KEY REFERENCES ai_jobs(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('mp3','opus','aac','flac','wav','pcm','pcm16')),
  mime text NOT NULL CHECK (mime IN ('audio/mpeg','audio/ogg','audio/aac','audio/flac','audio/wav','application/octet-stream')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 2 AND 4500000)
);
CREATE FUNCTION charge_ai_audio_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination uuid;
BEGIN
  SELECT p.space_id INTO destination FROM ai_jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=NEW.job_id;
  INSERT INTO space_storage_accounts(space_id) VALUES(destination) ON CONFLICT DO NOTHING;
  UPDATE space_storage_accounts SET retained_bytes=retained_bytes+octet_length(NEW.bytes),updated_at=clock_timestamp()
    WHERE space_id=destination AND retained_bytes+media_reserved_bytes+octet_length(NEW.bytes)<=max_bytes;
  IF NOT FOUND THEN RAISE EXCEPTION 'SPACE_STORAGE_LIMIT' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_job_audio_storage_charge AFTER INSERT ON ai_job_audio
  FOR EACH ROW EXECUTE FUNCTION charge_ai_audio_storage();
CREATE TRIGGER ai_job_audio_immutable BEFORE UPDATE OR DELETE ON ai_job_audio
  FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
`;
