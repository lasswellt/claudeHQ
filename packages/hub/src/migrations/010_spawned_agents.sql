CREATE TABLE spawned_agents (
  id TEXT PRIMARY KEY,
  container_id TEXT,
  repo_id TEXT REFERENCES repos(id),
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  worktree_path TEXT,
  status TEXT NOT NULL DEFAULT 'creating',
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  stopped_at INTEGER
);
CREATE INDEX idx_spawned_agents_status ON spawned_agents(status);
