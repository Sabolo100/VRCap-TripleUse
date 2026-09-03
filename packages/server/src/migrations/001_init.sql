-- =====================================================================
-- VR CAP - initial schema
--
-- Design notes:
--  * The person is pseudonymous: an external identifier plus an internal
--    UUID, no name required. Everything else hangs off the UUID.
--  * Runs are immutable measurement records. Trials, events, metrics and
--    scores are stored separately so a new metric can be computed from old
--    data without re-running anybody.
--  * Device profile is stored on the run, not the session, because a person
--    can go from headset to laptop inside one session, and results from the
--    two must never be compared.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------- people
CREATE TABLE IF NOT EXISTS subjects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     TEXT NOT NULL,
  display_name    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  -- Domains this identifier has been used in (A / B / C).
  domains         TEXT[] NOT NULL DEFAULT '{}',
  notes           JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT subjects_external_id_key UNIQUE (external_id)
);

-- ------------------------------------------------------------- sessions
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY,
  subject_id      UUID REFERENCES subjects(id) ON DELETE SET NULL,
  domain          CHAR(1) NOT NULL CHECK (domain IN ('A','B','C')),
  group_code      TEXT,
  device_profile  JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_subject_idx ON sessions (subject_id, started_at DESC);

-- -------------------------------------------------------------- modules
CREATE TABLE IF NOT EXISTS modules (
  code            TEXT PRIMARY KEY,
  ordinal         TEXT NOT NULL,
  title           TEXT NOT NULL,
  subtitle        TEXT,
  current_version TEXT NOT NULL,
  status          TEXT NOT NULL,
  manifest        JSONB NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Relevance of each module per domain: this is what the hub filters on, and
-- keeping it in the database (rather than only in client code) lets a
-- deployment re-tune its own catalog without a rebuild.
CREATE TABLE IF NOT EXISTS module_domain_relevance (
  module_code     TEXT NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  domain          CHAR(1) NOT NULL CHECK (domain IN ('A','B','C')),
  relevance       TEXT NOT NULL CHECK (relevance IN ('primary','secondary','none')),
  headline        TEXT,
  rationale       TEXT,
  examples        TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (module_code, domain)
);

CREATE TABLE IF NOT EXISTS module_versions (
  module_code     TEXT NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  version         TEXT NOT NULL,
  config_version  TEXT NOT NULL DEFAULT 'STANDARD_A',
  configuration   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (module_code, version, config_version)
);

-- ----------------------------------------------------------------- runs
CREATE TABLE IF NOT EXISTS runs (
  id              UUID PRIMARY KEY,
  session_id      UUID,
  subject_id      UUID REFERENCES subjects(id) ON DELETE SET NULL,
  domain          CHAR(1) NOT NULL CHECK (domain IN ('A','B','C')),
  module_code     TEXT NOT NULL,
  module_version  TEXT NOT NULL,
  config_version  TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('assessment','challenge','practice')),
  seed            BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'completed',
  ops_score       INTEGER NOT NULL DEFAULT 0,
  -- Denormalised comparability key: only runs sharing this string may be
  -- ranked against each other.
  comparability   TEXT NOT NULL,
  device_profile  JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary         JSONB NOT NULL DEFAULT '{}'::jsonb,
  team_id         TEXT,
  team_role       TEXT,
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_subject_idx   ON runs (subject_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS runs_module_idx    ON runs (module_code, domain, finished_at DESC);
CREATE INDEX IF NOT EXISTS runs_leaderboard_idx ON runs (module_code, domain, comparability, ops_score DESC);
CREATE INDEX IF NOT EXISTS runs_team_idx      ON runs (team_id) WHERE team_id IS NOT NULL;

-- --------------------------------------------------------------- trials
CREATE TABLE IF NOT EXISTS trials (
  id              BIGSERIAL PRIMARY KEY,
  run_id          UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  trial_number    INTEGER NOT NULL,
  block           TEXT NOT NULL,
  stimulus        JSONB NOT NULL DEFAULT '{}'::jsonb,
  response        JSONB,
  correct         BOOLEAN,
  outcome         TEXT NOT NULL,
  reaction_time_ms REAL,
  started_at_ms   REAL NOT NULL,
  ended_at_ms     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS trials_run_idx ON trials (run_id, trial_number);

-- --------------------------------------------------------------- events
-- The event log is the reason this platform is worth building: new metrics
-- can be derived years later from runs collected today.
CREATE TABLE IF NOT EXISTS events (
  id              BIGSERIAL PRIMARY KEY,
  run_id          UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  trial_number    INTEGER,
  t_ms            REAL NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB
);
CREATE INDEX IF NOT EXISTS events_run_idx ON events (run_id, t_ms);
CREATE INDEX IF NOT EXISTS events_type_idx ON events (event_type);

-- Motion traces are bulky and rarely queried row-by-row, so they are kept as
-- one compressed JSON document per run rather than a row per sample.
CREATE TABLE IF NOT EXISTS motion_traces (
  run_id          UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  sample_count    INTEGER NOT NULL,
  hz              REAL,
  samples         JSONB NOT NULL
);

-- -------------------------------------------------------- metrics/scores
CREATE TABLE IF NOT EXISTS metrics (
  id              BIGSERIAL PRIMARY KEY,
  run_id          UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  scope           TEXT,
  value           DOUBLE PRECISION NOT NULL,
  unit            TEXT
);
CREATE INDEX IF NOT EXISTS metrics_run_idx  ON metrics (run_id);
CREATE INDEX IF NOT EXISTS metrics_name_idx ON metrics (name, value);

CREATE TABLE IF NOT EXISTS scores (
  id              BIGSERIAL PRIMARY KEY,
  run_id          UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  score_type      TEXT NOT NULL,
  value           DOUBLE PRECISION NOT NULL,
  scoring_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_run_idx ON scores (run_id);

-- ----------------------------------------------------------- multiuser
CREATE TABLE IF NOT EXISTS teams (
  id              TEXT PRIMARY KEY,
  room_code       TEXT NOT NULL,
  domain          CHAR(1) NOT NULL,
  module_code     TEXT NOT NULL DEFAULT 'COMMAND',
  seed            BIGINT NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS team_rounds (
  id              BIGSERIAL PRIMARY KEY,
  team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round           TEXT NOT NULL,
  assignment      JSONB NOT NULL,
  achieved_value  INTEGER NOT NULL,
  optimal_value   INTEGER NOT NULL,
  optimality      REAL NOT NULL,
  time_to_commit_ms INTEGER NOT NULL,
  info_coverage   REAL NOT NULL,
  revisions       INTEGER NOT NULL,
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_rounds_team_idx ON team_rounds (team_id);

-- Full communication transcript: who said what, when, and whether it was a
-- private fact being disclosed. This is the raw material for every
-- information-sharing and leadership metric.
CREATE TABLE IF NOT EXISTS team_messages (
  id              BIGSERIAL PRIMARY KEY,
  team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round           TEXT,
  seat            INTEGER NOT NULL,
  external_id     TEXT NOT NULL,
  is_bot          BOOLEAN NOT NULL DEFAULT FALSE,
  kind            TEXT NOT NULL,
  text            TEXT NOT NULL,
  t_ms            INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_messages_team_idx ON team_messages (team_id, t_ms);

-- ------------------------------------------------------------ audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor           TEXT,
  action          TEXT NOT NULL,
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ------------------------------------------------------------- helpers
-- Personal best per subject / module / comparability class.
CREATE OR REPLACE VIEW personal_bests AS
SELECT subject_id, module_code, domain, comparability, MAX(ops_score) AS best_score, COUNT(*) AS runs
FROM runs
WHERE subject_id IS NOT NULL AND status = 'completed' AND mode = 'assessment'
GROUP BY subject_id, module_code, domain, comparability;
