-- Why each program's class size is what it is (supervision ratios, space), shown to families.
ALTER TABLE programs ADD COLUMN capacity_note text;

-- Registration can open later than the catalog is published. NULL means open now.
ALTER TABLE programs ADD COLUMN registration_opens_at timestamptz;

-- A family on the waitlist can opt in to be registered and charged as soon as a spot opens,
-- instead of getting a 2-hour offer.
ALTER TABLE waitlist_entries ADD COLUMN auto_register boolean NOT NULL DEFAULT false;
ALTER TABLE registrations ADD COLUMN auto_registered boolean NOT NULL DEFAULT false;

-- "Notify me when registration opens" requests.
CREATE TABLE registration_reminders (
  family_id   text NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  program_id  text NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  PRIMARY KEY (family_id, program_id)
);
CREATE INDEX registration_reminders_pending_idx ON registration_reminders (program_id) WHERE notified_at IS NULL;
