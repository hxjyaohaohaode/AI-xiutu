/** Durable conversation boundaries. A new root is independent of older project chat. */
export const schemaV13Sql = `
ALTER TABLE assistant_turns ADD COLUMN conversation_id uuid REFERENCES assistant_turns(id);
WITH RECURSIVE roots AS (
  SELECT id,id AS root FROM assistant_turns WHERE parent_turn_id IS NULL
  UNION ALL
  SELECT child.id,parent.root FROM assistant_turns child JOIN roots parent ON child.parent_turn_id=parent.id
) UPDATE assistant_turns t SET conversation_id=roots.root FROM roots WHERE t.id=roots.id;
UPDATE assistant_turns SET conversation_id=id WHERE conversation_id IS NULL;
ALTER TABLE assistant_turns ALTER COLUMN conversation_id SET NOT NULL;
CREATE INDEX assistant_turn_conversation ON assistant_turns(actor_id,project_id,conversation_id,created_at DESC);
CREATE FUNCTION bind_assistant_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_root uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.actor_id,NEW.project_id,NEW.parent_turn_id,NEW.conversation_id)
      IS DISTINCT FROM ROW(OLD.id,OLD.actor_id,OLD.project_id,OLD.parent_turn_id,OLD.conversation_id) THEN
      RAISE EXCEPTION 'assistant conversation identity is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_turn_id IS NULL THEN NEW.conversation_id=NEW.id;
  ELSE
    SELECT conversation_id INTO parent_root FROM assistant_turns
      WHERE id=NEW.parent_turn_id AND actor_id=NEW.actor_id AND project_id=NEW.project_id;
    IF parent_root IS NULL THEN RAISE EXCEPTION 'assistant parent outside conversation scope'; END IF;
    NEW.conversation_id=parent_root;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_conversation_identity BEFORE INSERT OR UPDATE ON assistant_turns
  FOR EACH ROW EXECUTE FUNCTION bind_assistant_conversation();
`;
