/** Authoritative collaboration is additive. Original revisions, assets and ledger stay immutable. */
export const schemaV8Sql = String.raw`
ALTER TABLE artworks ADD COLUMN collaboration_cursor bigint NOT NULL DEFAULT 0;
CREATE TABLE collaboration_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), artwork_id uuid NOT NULL REFERENCES artworks(id),
  user_id uuid NOT NULL REFERENCES users(id), client_id uuid NOT NULL,
  auth_session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  sequence bigint NOT NULL DEFAULT -1, cursor jsonb, tool text, selection jsonb,
  last_presence_at timestamptz NOT NULL DEFAULT '-infinity',
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(artwork_id,user_id,client_id)
);
CREATE INDEX collaboration_sessions_artwork ON collaboration_sessions(artwork_id,expires_at);
CREATE TABLE collaboration_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), artwork_id uuid NOT NULL REFERENCES artworks(id),
  session_id uuid NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  fence bigint GENERATED ALWAYS AS IDENTITY UNIQUE, target jsonb NOT NULL, bounds jsonb,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX collaboration_leases_artwork ON collaboration_leases(artwork_id,expires_at);
CREATE TABLE collaboration_previews (
  lease_id uuid PRIMARY KEY REFERENCES collaboration_leases(id) ON DELETE CASCADE,
  sequence bigint NOT NULL, base_version integer NOT NULL, operation jsonb NOT NULL,
  expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE collaboration_events (
  artwork_id uuid NOT NULL REFERENCES artworks(id), seq bigint NOT NULL,
  type text NOT NULL CHECK(type IN ('presence.changed','lease.changed','preview.changed','revision.committed')),
  actor_id uuid REFERENCES users(id), payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(artwork_id,seq)
);
CREATE TABLE collaboration_commands (
  actor_id uuid NOT NULL REFERENCES users(id), idempotency_key uuid NOT NULL,
  artwork_id uuid NOT NULL REFERENCES artworks(id), request_hash text NOT NULL,
  response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,idempotency_key)
);
CREATE TRIGGER collaboration_commands_immutable BEFORE UPDATE OR DELETE ON collaboration_commands
  FOR EACH ROW EXECUTE FUNCTION immutable_ledger_guard();

CREATE FUNCTION collaboration_emit(room uuid, event_type text, actor uuid, body jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE next_cursor bigint;
BEGIN
  UPDATE artworks SET collaboration_cursor=collaboration_cursor+1 WHERE id=room RETURNING collaboration_cursor INTO next_cursor;
  INSERT INTO collaboration_events(artwork_id,seq,type,actor_id,payload) VALUES(room,next_cursor,event_type,actor,body);
  -- The durable revisions and command receipts are retained. Reconnect beyond this bounded
  -- transport history requires a full authoritative snapshot, never an inferred delta.
  DELETE FROM collaboration_events WHERE artwork_id=room AND seq<=next_cursor-1000;
  PERFORM pg_notify('xiutu_collaboration',room::text);
  RETURN next_cursor;
END $$;

CREATE FUNCTION collaboration_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room uuid; proof text; valid_proof boolean;
BEGIN
  IF TG_TABLE_NAME='artworks' THEN
    IF NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id AND NEW.head_version IS NOT DISTINCT FROM OLD.head_version
       AND NEW.head_revision_id IS NOT DISTINCT FROM OLD.head_revision_id AND NEW.title IS NOT DISTINCT FROM OLD.title THEN RETURN NEW; END IF;
    room:=NEW.id;
  ELSE room:=NEW.artwork_id; END IF;
  -- Even a future writer which forgot the shared command helper must serialize
  -- with lease acquisition before inspecting its permission to append.
  PERFORM 1 FROM artworks WHERE id=room FOR UPDATE;
  proof:=NULLIF(current_setting('ai_xiutu.collaboration_lease',true),'');
  IF proof IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM collaboration_leases l JOIN collaboration_sessions c ON c.id=l.session_id
      JOIN sessions auth ON auth.token_hash=c.auth_session_hash JOIN users u ON u.id=c.user_id
      JOIN artworks a ON a.id=c.artwork_id JOIN projects p ON p.id=a.project_id
      JOIN memberships m ON m.space_id=p.space_id AND m.user_id=c.user_id
      WHERE l.id::text=proof AND l.artwork_id=room
      AND c.id::text=current_setting('ai_xiutu.collaboration_session',true)
      AND l.fence::text=current_setting('ai_xiutu.collaboration_fence',true)
      AND l.expires_at>clock_timestamp() AND c.expires_at>clock_timestamp()
      AND auth.expires_at>clock_timestamp() AND u.status='active' AND p.deleted_at IS NULL
      AND m.role IN ('owner','admin','editor')) INTO valid_proof;
    IF NOT valid_proof THEN RAISE EXCEPTION 'COLLABORATION_LEASE_EXPIRED' USING ERRCODE='P0001'; END IF;
  ELSIF EXISTS(SELECT 1 FROM collaboration_leases l JOIN collaboration_sessions c ON c.id=l.session_id
      JOIN sessions auth ON auth.token_hash=c.auth_session_hash JOIN users u ON u.id=c.user_id
      JOIN artworks a ON a.id=c.artwork_id JOIN projects p ON p.id=a.project_id
      JOIN memberships m ON m.space_id=p.space_id AND m.user_id=c.user_id
      WHERE l.artwork_id=room AND l.expires_at>clock_timestamp() AND c.expires_at>clock_timestamp()
      AND auth.expires_at>clock_timestamp() AND u.status='active' AND m.role IN ('owner','admin','editor')) THEN
    RAISE EXCEPTION 'COLLABORATION_LOCKED' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artworks_collaboration_guard BEFORE UPDATE OF asset_id,head_version,head_revision_id,title ON artworks
  FOR EACH ROW EXECUTE FUNCTION collaboration_write_guard();
CREATE TRIGGER revisions_collaboration_guard BEFORE INSERT ON revisions
  FOR EACH ROW EXECUTE FUNCTION collaboration_write_guard();
CREATE FUNCTION collaboration_revision_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM collaboration_emit(NEW.artwork_id,'revision.committed',NEW.author_id,
    jsonb_build_object('revisionId',NEW.id,'version',NEW.version,'sourceAssetId',(SELECT asset_id FROM artworks WHERE id=NEW.artwork_id)));
  RETURN NEW;
END $$;
CREATE TRIGGER revisions_collaboration_event AFTER INSERT ON revisions FOR EACH ROW EXECUTE FUNCTION collaboration_revision_event();

CREATE TABLE resource_memories (
  user_id uuid NOT NULL REFERENCES users(id), asset_id uuid NOT NULL REFERENCES assets(id),
  remembered boolean NOT NULL DEFAULT true, title text, tags jsonb NOT NULL DEFAULT '[]', note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,asset_id), CHECK(length(note)<=2000), CHECK(jsonb_array_length(tags)<=30)
);
CREATE INDEX resource_memories_user ON resource_memories(user_id,remembered,updated_at);
CREATE TABLE membership_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, space_id uuid NOT NULL REFERENCES spaces(id),
  actor_id uuid REFERENCES users(id), target_user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK(kind IN ('joined','role-changed','removed','owner-transferred')),
  previous_role text, role text, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX membership_activity_space ON membership_activity(space_id,id DESC);
CREATE TRIGGER membership_activity_immutable BEFORE UPDATE OR DELETE ON membership_activity FOR EACH ROW EXECUTE FUNCTION immutable_ledger_guard();
INSERT INTO membership_activity(space_id,actor_id,target_user_id,kind,role,created_at)
  SELECT space_id,NULL,user_id,'joined',role,created_at FROM memberships;
CREATE FUNCTION membership_activity_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
  actor:=NULLIF(current_setting('ai_xiutu.membership_actor',true),'')::uuid;
  IF TG_OP='INSERT' THEN
    INSERT INTO membership_activity(space_id,actor_id,target_user_id,kind,role) VALUES(NEW.space_id,actor,NEW.user_id,'joined',NEW.role);
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    INSERT INTO membership_activity(space_id,actor_id,target_user_id,kind,previous_role) VALUES(OLD.space_id,actor,OLD.user_id,'removed',OLD.role);
    RETURN OLD;
  ELSIF NEW.role<>OLD.role THEN
    INSERT INTO membership_activity(space_id,actor_id,target_user_id,kind,previous_role,role)
    VALUES(NEW.space_id,actor,NEW.user_id,CASE WHEN NEW.role='owner' THEN 'owner-transferred' ELSE 'role-changed' END,OLD.role,NEW.role);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memberships_activity AFTER INSERT OR UPDATE OF role OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION membership_activity_record();
CREATE FUNCTION collaboration_membership_revoked() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.role=OLD.role THEN RETURN NEW; END IF;
  -- Keep resources in the owning space. Only access and transient editing state are revoked.
  FOR room IN SELECT DISTINCT c.artwork_id FROM collaboration_sessions c JOIN artworks a ON a.id=c.artwork_id
    JOIN projects p ON p.id=a.project_id WHERE p.space_id=OLD.space_id AND c.user_id=OLD.user_id ORDER BY c.artwork_id LOOP
    PERFORM 1 FROM artworks WHERE id=room FOR UPDATE;
    DELETE FROM collaboration_sessions WHERE artwork_id=room AND user_id=OLD.user_id;
    PERFORM collaboration_emit(room,'presence.changed',OLD.user_id,jsonb_build_object('reason','membership-changed'));
  END LOOP;
  IF TG_OP='DELETE' THEN
    UPDATE tasks SET assignee_id=NULL,version=version+1,updated_at=clock_timestamp()
      WHERE assignee_id=OLD.user_id AND project_id IN (SELECT id FROM projects WHERE space_id=OLD.space_id);
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memberships_collaboration_revoked AFTER UPDATE OF role OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION collaboration_membership_revoked();

-- Accurate movements are recorded alongside future immutable ledger entries. Historic
-- expiry records did not encode their amount; backfill leaves those unknown explicitly.
ALTER TABLE ledger_entries ADD COLUMN movement jsonb;

CREATE OR REPLACE FUNCTION snapshot_revision_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_asset uuid; project uuid; layer jsonb; layer_asset uuid;
BEGIN
  SELECT a.asset_id,a.project_id INTO base_asset,project FROM artworks a WHERE a.id=NEW.artwork_id;
  PERFORM 1 FROM assets WHERE id=base_asset AND project_id=project AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'revision source unavailable' USING ERRCODE='23514'; END IF;
  INSERT INTO revision_sources(revision_id,asset_id) VALUES(NEW.id,base_asset);
  IF NEW.recipe->>'schemaVersion' IN ('3','4') THEN
    FOR layer IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.recipe->'imageLayers','[]'::jsonb)) LOOP
      layer_asset := (layer->>'sourceId')::uuid;
      PERFORM 1 FROM assets WHERE id=layer_asset AND project_id=project AND deleted_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'revision layer unavailable' USING ERRCODE='23514'; END IF;
      INSERT INTO revision_image_layers(revision_id,layer_id,asset_id) VALUES(NEW.id,layer->>'id',layer_asset);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
`;
