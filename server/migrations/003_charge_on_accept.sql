-- A waitlisted family is charged only when they accept the spot they're offered.
-- There is no auto-charge mode, and an accepted offer becomes a registration directly
-- instead of a cart hold.
ALTER TABLE waitlist_entries DROP COLUMN auto_register;
ALTER TABLE holds DROP COLUMN accepted;
ALTER TABLE registrations RENAME COLUMN auto_registered TO from_waitlist;
