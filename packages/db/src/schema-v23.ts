export const schemaV23Sql = String.raw`
ALTER TABLE plan_versions ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE plan_versions ADD COLUMN benefits text[] NOT NULL DEFAULT '{}';
ALTER TABLE plan_versions ADD COLUMN kind text NOT NULL DEFAULT 'credits'
  CHECK (kind IN ('credits','subscription'));
ALTER TABLE comments ADD COLUMN body_version integer NOT NULL DEFAULT 1 CHECK (body_version > 0);
ALTER TABLE comments ADD COLUMN edited_at timestamptz;
ALTER TABLE comments ADD COLUMN deleted_at timestamptz;
`;
