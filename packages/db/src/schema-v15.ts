/** Voice candidates are bound to the accepted editor context that produced them. */
export const schemaV15Sql = String.raw`
ALTER TABLE voice_sessions ADD COLUMN context_epoch integer NOT NULL DEFAULT 0 CHECK(context_epoch>=0);
`;
