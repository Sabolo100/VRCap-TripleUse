-- COMMAND has two variants, and the B variant's result is a completely
-- different shape: an inventory of a structure, scored against the truth and
-- against what the best-placed seat could have managed alone.
--
-- Before this, `teams` recorded the variant only inside the config blob, and
-- the structure outcome was not stored at all - the flagship measurement
-- (pooling gain: did the team beat its best single member?) could not be
-- recovered from the database afterwards.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS variant CHAR(1);

UPDATE teams
   SET variant = COALESCE(NULLIF(config->>'variant', ''), 'A')
 WHERE variant IS NULL;

ALTER TABLE teams ALTER COLUMN variant SET DEFAULT 'A';

CREATE INDEX IF NOT EXISTS teams_variant_idx ON teams (module_code, domain, variant, created_at DESC);

-- Variant B round outcome. Null for variant A rounds, which keep using
-- assignment / achieved_value / optimal_value.
ALTER TABLE team_rounds ADD COLUMN IF NOT EXISTS inventory_error INTEGER;
ALTER TABLE team_rounds ADD COLUMN IF NOT EXISTS over_count INTEGER;
ALTER TABLE team_rounds ADD COLUMN IF NOT EXISTS under_count INTEGER;
ALTER TABLE team_rounds ADD COLUMN IF NOT EXISTS best_single_seat_error INTEGER;
ALTER TABLE team_rounds ADD COLUMN IF NOT EXISTS submitted_inventory JSONB;
ALTER TABLE team_rounds ADD COLUMN IF NOT EXISTS true_inventory JSONB;

-- Pooling gain is the whole point of the exercise: positive means the team
-- did better together than its best-placed member could have alone.
CREATE OR REPLACE VIEW team_pooling AS
SELECT t.id AS team_id, t.room_code, t.domain, t.variant, t.created_at,
       r.round,
       r.inventory_error,
       r.best_single_seat_error,
       r.best_single_seat_error - r.inventory_error AS pooling_gain,
       r.over_count, r.under_count, r.info_coverage, r.time_to_commit_ms
FROM teams t
JOIN team_rounds r ON r.team_id = t.id
WHERE t.variant = 'B' AND r.inventory_error IS NOT NULL;
