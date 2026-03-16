-- Repository registry
CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  auth_method TEXT NOT NULL DEFAULT 'ssh_key',
  auth_credential_ref TEXT,
  preferred_machine_id TEXT REFERENCES machines(id),
  dependency_manager TEXT,
  node_version TEXT,
  setup_commands TEXT,
  pre_flight_commands TEXT,
  post_flight_commands TEXT,
  env_vars TEXT,
  tags TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_repos_name ON repos(name);

-- Workspaces
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  machine_id TEXT NOT NULL REFERENCES machines(id),
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  is_worktree INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'creating',
  job_id TEXT,
  disk_usage_bytes INTEGER,
  deps_installed_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER
);

CREATE INDEX idx_workspaces_repo ON workspaces(repo_id, machine_id);
CREATE INDEX idx_workspaces_status ON workspaces(status);

-- Jobs
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  workspace_id TEXT REFERENCES workspaces(id),
  machine_id TEXT REFERENCES machines(id),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  branch TEXT,
  branch_created TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  pr_number INTEGER,
  pr_url TEXT,
  github_issue_number INTEGER,
  cost_usd REAL DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  files_changed INTEGER DEFAULT 0,
  tests_passed INTEGER,
  error_message TEXT,
  parent_job_id TEXT REFERENCES jobs(id),
  timeout_seconds INTEGER,
  max_cost_usd REAL,
  auto_pr INTEGER NOT NULL DEFAULT 0,
  auto_cleanup INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_jobs_repo ON jobs(repo_id, status);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_machine ON jobs(machine_id);

-- Link sessions to jobs
ALTER TABLE sessions ADD COLUMN job_id TEXT REFERENCES jobs(id);
