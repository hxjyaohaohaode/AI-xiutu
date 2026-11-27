export const schemaV31Sql = `
ALTER TABLE documents ADD COLUMN IF NOT EXISTS formatting jsonb;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS formatting jsonb;
`;
