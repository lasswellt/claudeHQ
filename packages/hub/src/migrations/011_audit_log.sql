-- CAP-015: persistent audit trail of every state-changing operation.
-- E002 (approvals completeness), E004 (cost budgets), and E009 (compliance
-- sweep) all depend on this table existing.

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,                 -- e.g. 'session.create', 'approval.resolve'
  entity_type TEXT NOT NULL,            -- 'session', 'machine', 'approval', 'job', 'queue', ...
  entity_id TEXT NOT NULL,
  actor TEXT,                           -- 'user', 'system', 'agent:<machine-id>'
  details TEXT,                         -- JSON blob of the change payload
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
