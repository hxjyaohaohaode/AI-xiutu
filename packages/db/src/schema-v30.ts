export const schemaV30Sql = `
ALTER TABLE media_import_jobs ADD COLUMN IF NOT EXISTS profile text NOT NULL DEFAULT 'studio'
  CHECK (profile IN ('studio','photo'));
ALTER TABLE media_import_jobs ADD COLUMN IF NOT EXISTS expected_sha256 text;
ALTER TABLE media_import_jobs ADD COLUMN IF NOT EXISTS declared_source text NOT NULL DEFAULT 'upload'
  CHECK (declared_source IN ('upload','sketch'));
`;
