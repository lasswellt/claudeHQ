-- CAP-071 / story 015-003: budget threshold notification idempotency.
--
-- Records each threshold crossing exactly once per (scope, period,
-- threshold_pct) tuple so we can notify on 50/75/90/100% without
-- duplicating on every sweeper pass.

CREATE TABLE IF NOT EXISTS budget_threshold_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,                  -- 'global' | 'machine:<id>' | 'user:<id>'
  period TEXT NOT NULL,                 -- 'daily:2026-04-09' | 'monthly:2026-04'
  threshold_pct INTEGER NOT NULL,       -- 50 | 75 | 90 | 100
  observed_usd REAL NOT NULL,           -- actual spend when the threshold fired
  limit_usd REAL NOT NULL,              -- the budget cap at the time
  notified_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (scope, period, threshold_pct)
);

CREATE INDEX IF NOT EXISTS idx_budget_threshold_period
  ON budget_threshold_events(period);
