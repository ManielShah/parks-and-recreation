-- Families and their children. Auth is not wired up yet; the API identifies a family by header.
CREATE TABLE families (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  email      text,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE children (
  id        text PRIMARY KEY,
  family_id text NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  name      text NOT NULL,
  age       int  NOT NULL CHECK (age BETWEEN 0 AND 25)
);
CREATE INDEX children_family_idx ON children (family_id);

CREATE TABLE programs (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('Aquatics', 'Arts', 'Sports', 'Gymnastics')),
  min_age     int  NOT NULL,
  max_age     int  NOT NULL CHECK (max_age >= min_age),
  location    text NOT NULL,
  price_cents int  NOT NULL CHECK (price_cents >= 0),
  dates_label text NOT NULL,
  description text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0
);

-- A section is one bookable class time. Its row is the lock that serialises every
-- change to the section's spots (holds, registrations, waitlist).
CREATE TABLE sections (
  id         text PRIMARY KEY,
  program_id text NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  day_label  text NOT NULL,
  time_label text NOT NULL,
  capacity   int  NOT NULL CHECK (capacity > 0),
  sort_order int  NOT NULL DEFAULT 0
);
CREATE INDEX sections_program_idx ON sections (program_id);

-- child_id is NULL only for seeded or simulated families with no child records.
CREATE TABLE registrations (
  id           bigserial PRIMARY KEY,
  section_id   text NOT NULL REFERENCES sections (id),
  family_id    text NOT NULL REFERENCES families (id),
  child_id     text REFERENCES children (id),
  confirmation text NOT NULL UNIQUE,
  price_cents  int  NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);
CREATE INDEX registrations_active_section_idx ON registrations (section_id) WHERE withdrawn_at IS NULL;
CREATE INDEX registrations_family_idx ON registrations (family_id);
CREATE UNIQUE INDEX registrations_one_active_per_child
  ON registrations (section_id, child_id) WHERE withdrawn_at IS NULL AND child_id IS NOT NULL;

-- kind 'cart': held for 5 minutes during checkout.
-- kind 'offer': offered to the head of the waitlist for 2 hours.
-- An accepted offer becomes a 'cart' hold with accepted = true.
CREATE TABLE holds (
  id         bigserial PRIMARY KEY,
  section_id text NOT NULL REFERENCES sections (id),
  family_id  text NOT NULL REFERENCES families (id),
  child_id   text REFERENCES children (id),
  kind       text NOT NULL CHECK (kind IN ('cart', 'offer')),
  accepted   boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX holds_section_idx ON holds (section_id);
CREATE INDEX holds_family_idx ON holds (family_id);
CREATE INDEX holds_expires_idx ON holds (expires_at);

-- Place in line is the order of id within a section.
CREATE TABLE waitlist_entries (
  id         bigserial PRIMARY KEY,
  section_id text NOT NULL REFERENCES sections (id),
  family_id  text NOT NULL REFERENCES families (id),
  child_id   text REFERENCES children (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waitlist_section_idx ON waitlist_entries (section_id, id);
CREATE UNIQUE INDEX waitlist_one_per_child
  ON waitlist_entries (section_id, child_id) WHERE child_id IS NOT NULL;

-- In-app notices, doubling as the outbox for text and email delivery.
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  family_id  text NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  tone       text NOT NULL CHECK (tone IN ('good', 'warn', 'info')),
  message    text NOT NULL,
  send_sms   boolean NOT NULL DEFAULT false,
  send_email boolean NOT NULL DEFAULT false,
  delivered_at timestamptz,
  seen_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unseen_idx ON notifications (family_id) WHERE seen_at IS NULL;
CREATE INDEX notifications_outbox_idx ON notifications (id)
  WHERE delivered_at IS NULL AND (send_sms OR send_email);

CREATE SEQUENCE confirmation_seq START 20417;
