export const schemaV27Sql = String.raw`
ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('pending','active','banned','closed'));
ALTER TABLE operator_users ADD COLUMN manages_accounts boolean NOT NULL DEFAULT false;
UPDATE operator_users SET manages_accounts=true;
`;
