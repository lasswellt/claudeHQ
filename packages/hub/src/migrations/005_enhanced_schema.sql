-- Enhanced session fields
ALTER TABLE sessions ADD COLUMN tags TEXT;
ALTER TABLE sessions ADD COLUMN timeout_seconds INTEGER;
ALTER TABLE sessions ADD COLUMN max_cost_usd REAL;
ALTER TABLE sessions ADD COLUMN cost_usd REAL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN tokens_used INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN created_by TEXT DEFAULT 'owner';

-- Enhanced machine fields
ALTER TABLE machines ADD COLUMN capabilities TEXT;

-- Enhanced queue fields
ALTER TABLE queue ADD COLUMN tags TEXT;
ALTER TABLE queue ADD COLUMN timeout_seconds INTEGER;
ALTER TABLE queue ADD COLUMN max_cost_usd REAL;
ALTER TABLE queue ADD COLUMN requirements TEXT;
ALTER TABLE queue ADD COLUMN depends_on TEXT;
ALTER TABLE queue ADD COLUMN name TEXT;

-- Templates table
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  prompt TEXT NOT NULL,
  cwd TEXT,
  flags TEXT,
  machine_id TEXT,
  timeout_seconds INTEGER,
  max_cost_usd REAL,
  variables TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
