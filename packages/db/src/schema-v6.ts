/** Add an adoption mode without changing already-applied history migrations. */
export const schemaV6Sql = String.raw`
ALTER TABLE ai_result_decisions DROP CONSTRAINT IF EXISTS ai_result_decisions_action_check;
ALTER TABLE ai_result_decisions ADD CONSTRAINT ai_result_decisions_action_check
  CHECK(action IN ('reject','fork','replace','layer','apply-plan','save-text'));
`;
