-- =====================================================================
-- Module variants.
--
-- Some modules exist in two runnable forms: the established layout (A) and a
-- spatial extension (B). They measure the same construct but they are
-- different tasks, so their results must never share a norm group, a personal
-- best or a leaderboard.
--
-- `config_version` already distinguished them; this migration adds the short
-- variant label for querying, and - more importantly - fixes the personal_bests
-- view, which previously collapsed A and B into a single "best" per module.
-- =====================================================================

ALTER TABLE runs ADD COLUMN IF NOT EXISTS variant CHAR(1);

CREATE INDEX IF NOT EXISTS runs_variant_idx
  ON runs (module_code, domain, config_version, comparability, ops_score DESC);

-- Backfill from the config version for anything recorded before this column.
UPDATE runs
   SET variant = CASE
       WHEN config_version LIKE '%\_SPATIAL\_B' THEN 'B'
       ELSE 'A'
   END
 WHERE variant IS NULL;

DROP VIEW IF EXISTS personal_bests;
CREATE VIEW personal_bests AS
SELECT subject_id, module_code, domain, config_version, comparability,
       MAX(ops_score) AS best_score, COUNT(*) AS runs
FROM runs
WHERE subject_id IS NOT NULL AND status = 'completed' AND mode = 'assessment'
GROUP BY subject_id, module_code, domain, config_version, comparability;
