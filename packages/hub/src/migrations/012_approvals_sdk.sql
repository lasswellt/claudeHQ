-- CAP-025 / story 013-001..013-002: SDK canUseTool bridge.
-- Adds tool_use_id as the idempotency key so duplicate POSTs from
-- the agent (e.g. on reconnect) resolve to the same approval row.

ALTER TABLE approval_requests ADD COLUMN tool_use_id TEXT;

CREATE INDEX IF NOT EXISTS idx_approvals_tool_use
  ON approval_requests(session_id, tool_use_id);
