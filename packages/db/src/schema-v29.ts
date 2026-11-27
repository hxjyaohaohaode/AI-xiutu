/** Preserve the outcome of each concurrent assistant dispatch independently. */
export const schemaV29Sql = String.raw`
ALTER TABLE assistant_dispatches
  ADD COLUMN rejected_at timestamptz,
  ADD CONSTRAINT assistant_dispatch_outcome CHECK (rejected_at IS NULL OR completed_at IS NULL),
  DROP CONSTRAINT assistant_dispatches_purpose_check,
  ADD CONSTRAINT assistant_dispatches_purpose_check
    CHECK (purpose IN ('conversation','web-search','research-merge','specialist-review'));
`;
