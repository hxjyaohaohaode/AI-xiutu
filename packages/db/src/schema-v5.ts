/** Forward-compatible even when a development watcher already applied v4
 * before editable text adoption was introduced. Never reset that database. */
export const schemaV5Sql = String.raw`
ALTER TABLE ai_result_decisions ADD COLUMN IF NOT EXISTS content_edited boolean NOT NULL DEFAULT false;
`;
