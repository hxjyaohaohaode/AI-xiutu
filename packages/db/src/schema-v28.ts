/** Site-wide appreciation settings. Existing file-backed QR codes remain a fallback. */
export const schemaV28Sql = String.raw`
CREATE TABLE site_support_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  enabled boolean NOT NULL DEFAULT true,
  tiers jsonb CHECK (tiers IS NULL OR jsonb_typeof(tiers) = 'array'),
  qr_png bytea CHECK (qr_png IS NULL OR octet_length(qr_png) BETWEEN 32 AND 2097152),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_support_config(id) VALUES (true);
ALTER TABLE projects ADD COLUMN personal_inbox boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX projects_personal_inbox_idx ON projects(space_id)
  WHERE personal_inbox AND deleted_at IS NULL;
ALTER TABLE assets ADD COLUMN purge_requested_at timestamptz;
CREATE TABLE assistant_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  text_model varchar(128) NOT NULL DEFAULT '',
  voice_model varchar(128) NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'confirm' CHECK (mode IN ('suggest','confirm')),
  captions boolean NOT NULL DEFAULT true
);
`;
