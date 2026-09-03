-- =====================================================================
-- Normative reference data.
--
-- Scores are currently normalised against provisional anchors baked into
-- the scoring code. This table is where empirically derived norms live once
-- a deployment has enough runs, so old runs can be re-scored without
-- changing the client. Nothing reads it yet - the schema exists so the
-- upgrade does not require a migration during a live study.
-- =====================================================================

CREATE TABLE IF NOT EXISTS metric_norms (
  id              BIGSERIAL PRIMARY KEY,
  module_code     TEXT NOT NULL,
  metric_name     TEXT NOT NULL,
  comparability   TEXT NOT NULL,
  domain          CHAR(1),
  -- Optional stratification, e.g. {"age_band":"18-25"}
  stratum         JSONB NOT NULL DEFAULT '{}'::jsonb,
  n               INTEGER NOT NULL,
  mean            DOUBLE PRECISION NOT NULL,
  sd              DOUBLE PRECISION NOT NULL,
  p05             DOUBLE PRECISION,
  p25             DOUBLE PRECISION,
  p50             DOUBLE PRECISION,
  p75             DOUBLE PRECISION,
  p95             DOUBLE PRECISION,
  -- TRUE when a lower raw value is better (reaction time, error).
  lower_is_better BOOLEAN NOT NULL DEFAULT TRUE,
  scoring_version TEXT NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module_code, metric_name, comparability, domain, stratum, scoring_version)
);

CREATE INDEX IF NOT EXISTS metric_norms_lookup_idx
  ON metric_norms (module_code, metric_name, comparability);
