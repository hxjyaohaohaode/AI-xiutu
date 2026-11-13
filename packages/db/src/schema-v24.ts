/** Recycle-bin state is separate from immutable content and revision snapshots. */
export const schemaV24Sql = String.raw`
ALTER TABLE artworks
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN trash_token uuid,
  ADD COLUMN purged_at timestamptz,
  ADD CONSTRAINT artwork_trash_state CHECK (
    (deleted_at IS NULL AND trash_token IS NULL AND purged_at IS NULL)
    OR (deleted_at IS NOT NULL AND trash_token IS NOT NULL)
  );
ALTER TABLE assets
  ADD COLUMN trash_token uuid,
  ADD COLUMN purged_at timestamptz,
  ADD CONSTRAINT asset_trash_state CHECK (
    (trash_token IS NULL OR deleted_at IS NOT NULL)
    AND (purged_at IS NULL OR trash_token IS NOT NULL)
  );
CREATE INDEX artwork_recycle_bin ON artworks(deleted_at,trash_token)
  WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE INDEX asset_recycle_bin ON assets(deleted_at,trash_token)
  WHERE trash_token IS NOT NULL AND purged_at IS NULL;
CREATE INDEX asset_retained_storage_key ON assets(storage_key) WHERE purged_at IS NULL;

CREATE TABLE photo_storage_cleanup (
  kind text NOT NULL CHECK (kind IN ('canonical','original','animation')),
  storage_key text NOT NULL,
  retry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(kind,storage_key)
);
CREATE INDEX photo_storage_cleanup_due ON photo_storage_cleanup(retry_at);

CREATE FUNCTION reject_trashed_artwork_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='artworks' THEN
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'ARTWORK_TRASHED' USING ERRCODE='P0001';
    END IF;
  ELSE
    PERFORM 1 FROM artworks WHERE id=NEW.artwork_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ARTWORK_TRASHED' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artwork_trash_write_guard BEFORE UPDATE OF asset_id,head_version,head_revision_id,title
  ON artworks FOR EACH ROW EXECUTE FUNCTION reject_trashed_artwork_write();
CREATE TRIGGER revision_trash_write_guard BEFORE INSERT ON revisions
  FOR EACH ROW EXECUTE FUNCTION reject_trashed_artwork_write();
`;
