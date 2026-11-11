export const schemaV20Sql = String.raw`
CREATE TABLE media_grade_revisions (
  asset_id uuid NOT NULL REFERENCES assets(id),
  version integer NOT NULL CHECK (version > 0),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  precision_input text NOT NULL CHECK (precision_input IN ('master16','linear-master')),
  edit jsonb NOT NULL CHECK (jsonb_typeof(edit) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (asset_id, version)
);
CREATE TRIGGER media_grade_revisions_immutable BEFORE UPDATE OR DELETE ON media_grade_revisions
  FOR EACH ROW EXECUTE FUNCTION immutable_revision_guard();
ALTER TABLE asset_derivations DROP CONSTRAINT asset_derivations_algorithm_check;
ALTER TABLE asset_derivations ADD CONSTRAINT asset_derivations_algorithm_check
  CHECK (algorithm IN ('linear-trimap-v1','rgb-guided-trimap-v2','rgb-guided-trimap-v3',
    'rgb-guided-trimap-v4','collage-v1','gif-v1','photo-restore-v1'));
`;
