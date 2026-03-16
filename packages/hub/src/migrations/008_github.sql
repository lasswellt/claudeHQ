-- GitHub App credentials
CREATE TABLE github_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  app_id TEXT,
  private_key TEXT,
  client_id TEXT,
  client_secret TEXT,
  webhook_secret TEXT,
  installation_id TEXT,
  slug TEXT,
  auth_method TEXT NOT NULL DEFAULT 'none',
  pat_token TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Pull requests created by Claude HQ
CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  repo_id TEXT NOT NULL REFERENCES repos(id),
  github_pr_number INTEGER NOT NULL,
  github_pr_url TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  review_status TEXT DEFAULT 'pending',
  ci_status TEXT DEFAULT 'unknown',
  additions INTEGER,
  deletions INTEGER,
  changed_files INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_prs_repo ON pull_requests(repo_id, status);
CREATE INDEX idx_prs_job ON pull_requests(job_id);
