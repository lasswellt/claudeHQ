CREATE TABLE machines (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  last_seen INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  max_sessions INTEGER NOT NULL DEFAULT 2,
  meta TEXT  -- JSON: { version, os, arch }
);
