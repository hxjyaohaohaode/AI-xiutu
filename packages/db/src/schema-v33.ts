/**
 * v33: read-only document share links.
 * Tokens are stored only as SHA-256 hashes. A link works only while it is not
 * revoked or expired, the document and project exist, and the space policy
 * (sharing_policy.allowDocumentLinks) is enabled at read time.
 */
export const schemaV33Sql = `
CREATE TABLE document_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  allow_download boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz CHECK (expires_at IS NULL OR expires_at > created_at),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_viewed_at timestamptz,
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX document_share_links_document ON document_share_links(document_id, created_at DESC);
`;
