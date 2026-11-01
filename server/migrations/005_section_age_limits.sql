-- A section can narrow its program's age range (e.g. a "9–10" week of a 9–12 camp).
-- NULL means the section takes the program's range. Either end can be set on its own.
ALTER TABLE sections ADD COLUMN min_age int;
ALTER TABLE sections ADD COLUMN max_age int;
ALTER TABLE sections ADD CONSTRAINT sections_age_range_valid
  CHECK (min_age IS NULL OR max_age IS NULL OR max_age >= min_age);
