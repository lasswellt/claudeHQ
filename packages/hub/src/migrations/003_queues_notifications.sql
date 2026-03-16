CREATE TABLE queue (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id),
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  flags TEXT,
  priority INTEGER NOT NULL DEFAULT 100,  -- lower = higher priority
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_queue_machine ON queue(machine_id, position);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  type TEXT NOT NULL,
  channel TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  delivered INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE notification_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  webhooks TEXT,                        -- JSON array of webhook configs
  events TEXT NOT NULL DEFAULT '["session_completed","session_failed"]',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id),
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,  -- raw JSON from hook
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_events_session ON session_events(session_id, received_at);
