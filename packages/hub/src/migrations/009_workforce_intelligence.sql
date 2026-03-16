-- Session cost tracking
CREATE TABLE session_costs (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  model TEXT NOT NULL DEFAULT 'unknown',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  num_turns INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Budget configuration
CREATE TABLE budget_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  per_session_max_usd REAL,
  per_machine_daily_usd REAL,
  global_daily_usd REAL,
  alert_thresholds TEXT DEFAULT '[50,75,90,100]',
  enabled INTEGER NOT NULL DEFAULT 1
);

-- Scheduled tasks (cron)
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  machine_id TEXT,
  repo_id TEXT REFERENCES repos(id),
  flags TEXT,
  concurrency_policy TEXT DEFAULT 'forbid',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  successful_runs INTEGER NOT NULL DEFAULT 0,
  failed_runs INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_scheduled_enabled ON scheduled_tasks(enabled, next_run_at);
