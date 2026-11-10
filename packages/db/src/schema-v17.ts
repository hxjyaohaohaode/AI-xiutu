export const schemaV17Sql = String.raw`
CREATE TABLE asset_derivations (
  asset_id uuid PRIMARY KEY REFERENCES assets(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  algorithm text NOT NULL CHECK (algorithm IN ('linear-trimap-v1','collage-v1','gif-v1')),
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources)='array'),
  parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters)='object'),
  UNIQUE(actor_id,request_id)
);
CREATE TABLE asset_recognitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  engine text NOT NULL,
  preprocessing text NOT NULL CHECK (preprocessing IN ('original','contrast-resampled')),
  language text NOT NULL,
  layout text NOT NULL,
  width integer NOT NULL CHECK (width>0),
  height integer NOT NULL CHECK (height>0),
  text_content text NOT NULL,
  words jsonb NOT NULL CHECK (jsonb_typeof(words)='array'),
  table_result jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(asset_id,source_hash,engine,language,layout)
);
CREATE INDEX asset_recognitions_asset ON asset_recognitions(asset_id,created_at DESC,id DESC);
CREATE TABLE animation_assets (
  asset_id uuid PRIMARY KEY REFERENCES assets(id),
  storage_name uuid NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  bytes integer NOT NULL CHECK (bytes>0),
  descriptor jsonb NOT NULL CHECK (jsonb_typeof(descriptor)='object')
);
CREATE INDEX animation_assets_storage_name ON animation_assets(storage_name);
CREATE FUNCTION charge_animation_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination uuid;
BEGIN
  SELECT p.space_id INTO destination FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.id=NEW.asset_id;
  UPDATE space_storage_accounts SET retained_bytes=retained_bytes+NEW.bytes,updated_at=clock_timestamp()
    WHERE space_id=destination AND retained_bytes+media_reserved_bytes+NEW.bytes<=max_bytes;
  IF NOT FOUND THEN RAISE EXCEPTION 'SPACE_STORAGE_LIMIT' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER animation_asset_storage_charge AFTER INSERT ON animation_assets
  FOR EACH ROW EXECUTE FUNCTION charge_animation_storage();
CREATE TRIGGER animation_assets_immutable BEFORE UPDATE OR DELETE ON animation_assets
  FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
CREATE TRIGGER asset_derivations_immutable BEFORE UPDATE OR DELETE ON asset_derivations
  FOR EACH ROW EXECUTE FUNCTION immutable_snapshot_guard();
ALTER TABLE assistant_dispatches ADD COLUMN purpose text CHECK (purpose IN ('conversation','web-search','research-merge'));
ALTER TABLE assistant_dispatches ADD COLUMN branch_key text;
ALTER TABLE assistant_dispatches ADD COLUMN pricing jsonb;
ALTER TABLE assistant_dispatches ADD COLUMN tool_calls integer CHECK (tool_calls>=0);
ALTER TABLE assistant_dispatches ADD COLUMN service_tier text;
ALTER TABLE ai_jobs ADD COLUMN provider_pricing jsonb;
ALTER TABLE ai_jobs ADD COLUMN provider_dispatched_at timestamptz;
ALTER TABLE ai_jobs ADD COLUMN provider_usage jsonb;
ALTER TABLE ai_jobs ADD COLUMN provider_received_at timestamptz;
ALTER TABLE voice_sessions ADD COLUMN provider_pricing jsonb;
`;
