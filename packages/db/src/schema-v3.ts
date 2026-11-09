/** Additive migration. Existing image bytes, provenance and revisions remain unchanged. */
export const schemaV3Sql = String.raw`
ALTER TABLE assets ADD COLUMN annotations jsonb NOT NULL DEFAULT '{}';
ALTER TABLE assets ADD COLUMN annotation_version integer NOT NULL DEFAULT 1 CHECK(annotation_version>0);
ALTER TABLE assets ADD COLUMN annotation_updated_at timestamptz;
ALTER TABLE assets ADD CONSTRAINT assets_annotations_object CHECK(jsonb_typeof(annotations)='object');
CREATE INDEX assets_project_created_id_idx ON assets(project_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
`;
