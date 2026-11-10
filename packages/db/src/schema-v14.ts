/** A stop request is durable and serialized with paid dispatch and artwork publication. */
export const schemaV14Sql = String.raw`
ALTER TABLE assistant_turns ADD COLUMN stop_requested_at timestamptz;
ALTER TABLE assistant_turns DROP CONSTRAINT assistant_turns_state_check;
ALTER TABLE assistant_turns ADD CONSTRAINT assistant_turns_state_check
 CHECK(state IN ('running','completed','failed','unknown','stopped'));
`;
