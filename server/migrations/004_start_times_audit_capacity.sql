-- When the section's first class starts. Offer windows shrink as this approaches, and
-- automatic waitlist offers stop near it. day_label/time_label stay as display copy.
ALTER TABLE sections ADD COLUMN starts_at timestamptz;
UPDATE sections SET starts_at = now() + interval '60 days' WHERE starts_at IS NULL;
ALTER TABLE sections ALTER COLUMN starts_at SET NOT NULL;

-- Staff "last call": until this time, any family on the waitlist can claim an open spot,
-- first come first served. Only used close to class start, when automatic offers have stopped.
ALTER TABLE sections ADD COLUMN last_call_until timestamptz;

-- Audit trail of everything that happens on a waitlist.
CREATE TABLE waitlist_events (
  id               bigserial PRIMARY KEY,
  section_id       text NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
  family_id        text REFERENCES families (id) ON DELETE CASCADE,
  child_id         text REFERENCES children (id) ON DELETE SET NULL,
  event            text NOT NULL CHECK (event IN ('joined', 'left', 'offered', 'accepted', 'declined', 'expired', 'last_call', 'claimed')),
  actor            text NOT NULL CHECK (actor IN ('family', 'system', 'staff')),
  offer_expires_at timestamptz,
  detail           text,
  created_at       timestamptz NOT NULL
);
CREATE INDEX waitlist_events_section_idx ON waitlist_events (section_id, id);
CREATE INDEX waitlist_events_recent_idx ON waitlist_events (id DESC);

-- Backstop for "never over capacity". The API already checks capacity under the section lock;
-- this rejects any transaction that would still leave more registrations plus holds than seats.
-- It's checked at commit, so a transaction may briefly swap a hold for a registration.
CREATE FUNCTION assert_section_capacity() RETURNS trigger AS $$
DECLARE
  cap  int;
  used int;
BEGIN
  SELECT capacity INTO cap FROM sections WHERE id = NEW.section_id;
  SELECT (SELECT count(*) FROM registrations WHERE section_id = NEW.section_id AND withdrawn_at IS NULL)
       + (SELECT count(*) FROM holds WHERE section_id = NEW.section_id)
    INTO used;
  IF used > cap THEN
    RAISE EXCEPTION 'section % is over capacity (% of %)', NEW.section_id, used, cap
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER registrations_within_capacity
  AFTER INSERT OR UPDATE OF withdrawn_at, section_id ON registrations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_section_capacity();

CREATE CONSTRAINT TRIGGER holds_within_capacity
  AFTER INSERT OR UPDATE OF section_id ON holds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_section_capacity();
