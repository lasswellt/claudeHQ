CREATE TABLE machine_health_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL REFERENCES machines(id),
  cpu_percent REAL NOT NULL,
  mem_percent REAL NOT NULL,
  disk_percent REAL,
  active_sessions INTEGER NOT NULL DEFAULT 0,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_health_machine_time ON machine_health_history(machine_id, recorded_at);
