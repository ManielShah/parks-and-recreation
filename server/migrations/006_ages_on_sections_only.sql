-- Age limits live on sections only. A section with no min_age/max_age is open to all ages.
-- Until now a NULL meant "use the program's range": copy that range down first so existing
-- sections keep exactly the limits they had, then drop the program-level columns.
UPDATE sections s
   SET min_age = COALESCE(s.min_age, p.min_age),
       max_age = COALESCE(s.max_age, p.max_age)
  FROM programs p
 WHERE p.id = s.program_id;

ALTER TABLE programs DROP COLUMN min_age;
ALTER TABLE programs DROP COLUMN max_age;
