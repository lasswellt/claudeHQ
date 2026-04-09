-- E005 / story 016-004: batch job grouping.
--
-- Adds a batch_id column so a single POST /api/jobs/batch can
-- fan out to N child jobs and later cascade-cancel them. Also
-- records idle_since for the workspace TTL sweeper (story 016-001)
-- so stale workspaces can be transitioned automatically.

ALTER TABLE jobs ADD COLUMN batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_batch_id ON jobs(batch_id);

ALTER TABLE workspaces ADD COLUMN idle_since INTEGER;
CREATE INDEX IF NOT EXISTS idx_workspaces_idle_since ON workspaces(idle_since);

-- Pre/post flight execution results, captured by the runners in
-- stories 016-002 + 016-003. One row per flight invocation so a
-- single job can have multiple sequential flight phases.
CREATE TABLE IF NOT EXISTS job_flight_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  phase TEXT NOT NULL,              -- 'pre_flight' | 'post_flight'
  command TEXT NOT NULL,
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  UNIQUE (job_id, phase, command, started_at)
);
CREATE INDEX IF NOT EXISTS idx_job_flight_runs_job ON job_flight_runs(job_id, phase);
