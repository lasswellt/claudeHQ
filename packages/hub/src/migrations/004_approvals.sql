CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  job_id TEXT,
  machine_id TEXT NOT NULL REFERENCES machines(id),
  request_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'hook',
  tool_name TEXT,
  tool_input TEXT,
  prompt_text TEXT,
  prompt_options TEXT,
  terminal_context TEXT,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_by TEXT,
  policy_rule_id TEXT,
  response_text TEXT,
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  timeout_action TEXT NOT NULL DEFAULT 'deny',
  timeout_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER
);

CREATE INDEX idx_approvals_session ON approval_requests(session_id, status);
CREATE INDEX idx_approvals_status ON approval_requests(status, created_at);
CREATE INDEX idx_approvals_timeout ON approval_requests(status, timeout_at);

CREATE TABLE approval_policy_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  match_request_type TEXT,
  match_tool_name TEXT,
  match_bash_command_pattern TEXT,
  match_file_path_pattern TEXT,
  match_session_tags TEXT,
  match_risk_level TEXT,
  action TEXT NOT NULL,
  timeout_override_seconds INTEGER,
  created_from_approval_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_policy_rules_enabled ON approval_policy_rules(enabled, priority);
