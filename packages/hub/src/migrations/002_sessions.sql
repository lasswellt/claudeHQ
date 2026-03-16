CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id),
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  flags TEXT,                          -- JSON array of CLI flags
  status TEXT NOT NULL DEFAULT 'queued',
  pid INTEGER,
  exit_code INTEGER,
  claude_session_id TEXT,              -- for --resume follow-ups
  parent_session_id TEXT,              -- links resume chains
  started_at INTEGER,
  ended_at INTEGER,
  last_activity_at INTEGER,
  recording_path TEXT,
  recording_size_bytes INTEGER,
  recording_chunk_count INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_sessions_machine ON sessions(machine_id, status);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
